import * as THREE from 'three';
import { latLonToXYZ, xyzToLatLon } from './geo.js';

const EARTH_VERT = `
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const EARTH_FRAG = `
uniform sampler2D dayMap;
uniform sampler2D nightMap;
uniform sampler2D waterMap;
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float dayMix;
uniform float nightMix;
uniform float waterMix;
uniform float cloudMix;

varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;

vec3 saturateColor(vec3 c, float amount) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, amount);
}

void main() {
  vec3 normalW = normalize(vNormalW);
  vec3 light = normalize(sunDir);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float ndotl = dot(normalW, light);
  float ndotv = clamp(dot(normalW, viewDir), 0.0, 1.0);

  // Soft terminator: civil to astronomical twilight band.
  float dayAmt = smoothstep(-0.12, 0.18, ndotl);
  float twilight = smoothstep(-0.22, 0.0, ndotl) * (1.0 - smoothstep(0.0, 0.26, ndotl));

  // Tangent frame for sun-projected cloud shadows.
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), normalW) + vec3(1e-5, 0.0, 0.0));
  vec3 north = cross(normalW, east);
  float cosLat = max(length(normalW.xz), 0.2);

  vec3 dayTex = texture2D(dayMap, vUv).rgb;
  vec3 nightTex = texture2D(nightMap, vUv).rgb;
  float ocean = waterMix > 0.5
    ? texture2D(waterMap, vUv).a
    : smoothstep(0.02, 0.2, dayTex.b - max(dayTex.r, dayTex.g));

  vec3 baseOcean = vec3(0.006, 0.026, 0.07);
  vec3 dayColor = mix(baseOcean, dayTex, dayMix);
  dayColor = saturateColor(dayColor, 1.12);
  dayColor = mix(dayColor, dayColor * vec3(0.7, 0.86, 1.02), ocean * 0.6);

  // Lambert with a gentle wrap so the lit hemisphere keeps its form.
  float diffuse = clamp((ndotl + 0.06) / 1.06, 0.0, 1.0);
  diffuse = pow(diffuse, 0.82);
  // Warm, reddened sunlight near the terminator (longer air path).
  vec3 sunColor = mix(vec3(1.0, 0.52, 0.26), vec3(1.0, 0.98, 0.95), smoothstep(0.0, 0.38, ndotl));
  vec3 lit = dayColor * sunColor * diffuse * 1.12;

  // Cloud shadows cast along the sun direction.
  float cloudHere = texture2D(cloudMap, vUv).a;
  vec2 sunUv = vec2(dot(light, east) / (6.2831853 * cosLat), dot(light, north) / 3.1415926);
  float shadowLen = 0.012 / max(ndotl, 0.25);
  float cloudShadow = texture2D(cloudMap, vUv + sunUv * shadowLen).a * cloudMix;
  lit *= 1.0 - 0.55 * cloudShadow * dayAmt;

  // City lights, dimmed under cloud and faded by the sunlit side.
  vec3 lights = max(nightTex - vec3(0.012, 0.01, 0.04), vec3(0.0));
  float warmth = nightTex.r - nightTex.b;
  lights *= smoothstep(-0.004, 0.02, warmth) * nightMix;
  lights = pow(max(lights, vec3(0.0)), vec3(0.78)) * vec3(1.0, 0.78, 0.5) * 2.4;
  lights *= 1.0 - 0.72 * cloudHere * cloudMix;
  lights *= 1.0 - smoothstep(-0.18, 0.02, ndotl);

  vec3 color = lit + lights;
  color += twilight * vec3(0.55, 0.22, 0.1) * 0.05 * max(dayMix, 0.35);

  // Ocean: Schlick Fresnel with a broad sheen and a tight sun glint.
  vec3 halfDir = normalize(light + viewDir);
  float ndoth = max(dot(normalW, halfDir), 0.0);
  float schlick = 0.02 + 0.98 * pow(1.0 - max(dot(halfDir, viewDir), 0.0), 5.0);
  float sheen = pow(ndoth, 90.0);
  float glint = pow(ndoth, 900.0);
  float specMask = ocean * smoothstep(0.0, 0.2, ndotl) * (1.0 - 0.85 * cloudHere * cloudMix);
  color += (sheen * 0.35 + glint * 2.2) * schlick * 4.0 * specMask * sunColor;
  color += ocean * pow(1.0 - ndotv, 4.0) * dayAmt * vec3(0.06, 0.14, 0.3) * 0.5;

  // In-scattering haze thickening toward the limb.
  float fresnel = pow(1.0 - ndotv, 3.4);
  float sunSide = smoothstep(-0.25, 0.5, ndotl);
  vec3 haze = mix(vec3(0.02, 0.05, 0.16), vec3(0.3, 0.55, 1.0), sunSide);
  haze = mix(haze, vec3(0.9, 0.42, 0.2), twilight * 0.3);
  color = mix(color, haze, fresnel * 0.38 * sunSide);
  color += haze * fresnel * 0.18 * sunSide;
  color += vec3(0.05, 0.1, 0.22) * 0.07 * dayAmt;

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CLOUD_FRAG = `
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float cloudMix;
uniform vec2 cloudTexel;

varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;

void main() {
  float raw = texture2D(cloudMap, vUv).a;
  float alpha = pow(smoothstep(0.08, 0.95, raw), 1.3) * cloudMix;
  if (alpha < 0.01) discard;
  vec3 normalW = normalize(vNormalW);
  vec3 light = normalize(sunDir);
  vec3 viewDir = normalize(cameraPosition - vWorld);

  // Treat cloud density as height to give the deck a puffy relief.
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), normalW) + vec3(1e-5, 0.0, 0.0));
  vec3 north = cross(normalW, east);
  float hE = texture2D(cloudMap, vUv + vec2(cloudTexel.x, 0.0)).a - texture2D(cloudMap, vUv - vec2(cloudTexel.x, 0.0)).a;
  float hN = texture2D(cloudMap, vUv + vec2(0.0, cloudTexel.y)).a - texture2D(cloudMap, vUv - vec2(0.0, cloudTexel.y)).a;
  vec3 bumped = normalize(normalW - (east * hE + north * hN) * 1.6);

  float ndotl = dot(normalW, light);
  float bumpLight = clamp(dot(bumped, light) * 0.5 + 0.5, 0.0, 1.0);
  float dayAmt = smoothstep(-0.14, 0.2, ndotl);
  float twilight = smoothstep(-0.2, 0.02, ndotl) * (1.0 - smoothstep(0.02, 0.3, ndotl));

  vec3 sunColor = mix(vec3(1.0, 0.55, 0.3), vec3(1.0, 0.99, 0.97), smoothstep(0.02, 0.4, ndotl));
  float thickness = mix(0.82, 1.0, raw);
  vec3 dayLit = sunColor * mix(0.5, 1.0, bumpLight) * thickness;
  vec3 ambient = vec3(0.012, 0.016, 0.028);
  vec3 color = mix(ambient, dayLit, dayAmt);
  color += twilight * vec3(1.0, 0.45, 0.22) * 0.12;

  // Silver lining when the sun sits behind the limb.
  float fresnel = pow(1.0 - abs(dot(normalW, viewDir)), 2.4);
  color += fresnel * vec3(0.45, 0.62, 1.0) * 0.28 * dayAmt;

  float opacity = alpha * mix(0.9, 0.35, fresnel) * mix(0.55, 1.0, dayAmt);
  gl_FragColor = vec4(color, opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ATMO_VERT = `
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const ATMO_FRAG = `
uniform vec3 sunDir;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  vec3 light = normalize(sunDir);
  // Back faces of the shell: facing is 0 at the outer edge and about 0.33 at
  // the planet limb, so the glow thickens toward the surface.
  float facing = clamp(-dot(n, viewDir), 0.0, 1.0);
  float t = clamp(facing / 0.34, 0.0, 1.0);
  float shell = pow(t, 2.6);
  float sun = dot(n, light);
  float lit = smoothstep(-0.3, 0.4, sun);
  float twilight = smoothstep(-0.3, -0.02, sun) * (1.0 - smoothstep(-0.02, 0.25, sun));
  vec3 rayleigh = mix(vec3(0.02, 0.04, 0.12), vec3(0.28, 0.56, 1.0), lit);
  vec3 glow = rayleigh + twilight * vec3(1.0, 0.38, 0.12) * 0.5;
  float mie = pow(max(dot(-viewDir, light), 0.0), 10.0) * 0.8;
  float intensity = shell * (0.06 + 1.5 * lit + mie * lit);
  gl_FragColor = vec4(glow * intensity, 1.0);
  #include <colorspace_fragment>
}
`;

const MOON_FRAG = `
uniform vec3 sunDir;
varying vec3 vNormalW;

void main() {
  float ndotl = dot(normalize(vNormalW), normalize(sunDir));
  float light = smoothstep(-0.06, 0.22, ndotl);
  vec3 color = vec3(0.73, 0.72, 0.68) * (0.035 + light);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const STAR_VERT = `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;

void main() {
  vColor = aColor;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (220.0 / max(1.0, -viewPosition.z));
  gl_Position = projectionMatrix * viewPosition;
}
`;

const STAR_FRAG = `
uniform sampler2D starMap;
varying vec3 vColor;

void main() {
  vec4 tex = texture2D(starMap, gl_PointCoord);
  if (tex.a < 0.04) discard;
  gl_FragColor = vec4(vColor * tex.a, tex.a);
  #include <colorspace_fragment>
}
`;

function starTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildStars() {
  const count = 3600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 78 + Math.random() * 36;
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    const roll = Math.random();
    const color = roll > 0.93 ? [0.65, 0.78, 1] : roll > 0.86 ? [1, 0.9, 0.72] : [0.95, 0.96, 1];
    colors.set(color, index * 3);
    sizes[index] = Math.random() < 0.04 ? 4.2 + Math.random() * 2.2 : 1.1 + Math.random() * 2.4;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { starMap: { value: starTexture() } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = -2;
  return points;
}

function placeholderTexture(rgba, colorSpace) {
  const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function placeCamera(camera, lat, lon, radius) {
  const position = latLonToXYZ(lat, lon, radius);
  camera.position.set(position.x, position.y, position.z);
  const radial = camera.position.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(radial, -radial.y);
  if (up.lengthSq() < 1e-8) {
    const lonRad = (lon * Math.PI) / 180;
    up.set(Math.sin(lonRad), 0, Math.cos(lonRad));
  }
  camera.up.copy(up.normalize());
  camera.lookAt(0, 0, 0);
}

export class Globe {
  constructor(canvas) {
    const narrow = Math.min(window.innerWidth, window.innerHeight) < 720;
    const widthSegments = narrow ? 96 : 168;
    const heightSegments = narrow ? 48 : 84;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.02, 400);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.sun = new THREE.Vector3(1, 0, 0);
    this.aniso = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    this.mixTarget = { dayMix: 0, nightMix: 0, waterMix: 0, cloudMix: 0 };
    this._normal = new THREE.Vector3();
    this._toCamera = new THREE.Vector3();
    this._projected = new THREE.Vector3();

    const dayMap = placeholderTexture([8, 28, 64, 255], THREE.SRGBColorSpace);
    const nightMap = placeholderTexture([0, 0, 0, 255], THREE.SRGBColorSpace);
    const waterMap = placeholderTexture([0, 0, 0, 0], THREE.LinearSRGBColorSpace);
    const cloudMap = placeholderTexture([255, 255, 255, 0], THREE.LinearSRGBColorSpace);
    const uniforms = {
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      waterMap: { value: waterMap },
      cloudMap: { value: cloudMap },
      sunDir: { value: this.sun },
      dayMix: { value: 0 },
      nightMix: { value: 0 },
      waterMix: { value: 0 },
      cloudMix: { value: 0 },
    };

    this.earthMat = new THREE.ShaderMaterial({
      name: 'earth',
      uniforms,
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, widthSegments, heightSegments), this.earthMat);
    this.scene.add(this.earth);

    this.cloudMat = new THREE.ShaderMaterial({
      name: 'clouds',
      uniforms: {
        cloudMap: { value: cloudMap },
        sunDir: { value: this.sun },
        cloudMix: { value: 0 },
        cloudTexel: { value: new THREE.Vector2(1 / 2048, 1 / 1024) },
      },
      vertexShader: EARTH_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.012, widthSegments, heightSegments),
      this.cloudMat,
    );
    this.clouds.renderOrder = 1;
    this.scene.add(this.clouds);

    this.atmoMat = new THREE.ShaderMaterial({
      name: 'atmosphere',
      uniforms: { sunDir: { value: this.sun } },
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.06, widthSegments, heightSegments), this.atmoMat);
    this.atmosphere.renderOrder = 2;
    this.scene.add(this.atmosphere);

    this.moonMat = new THREE.ShaderMaterial({
      name: 'moon',
      uniforms: { sunDir: { value: this.sun } },
      vertexShader: EARTH_VERT,
      fragmentShader: MOON_FRAG,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), this.moonMat);
    this.scene.add(this.moon);

    this.scene.add(buildStars());

    const pinCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.0075, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff6df, depthWrite: false }),
    );
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 18, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffd48a,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.pin = new THREE.Group();
    this.pin.add(pinCore);
    this.pin.add(this.halo);
    this.pin.visible = false;
    this.pin.renderOrder = 3;
    this.scene.add(this.pin);
  }

  resize(width, height, pixelRatio) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  setView(lat, lon, radius, fov) {
    placeCamera(this.camera, lat, lon, radius);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setSun(x, y, z) {
    this.sun.set(x, y, z).normalize();
  }

  setMoon(lat, lon) {
    const position = latLonToXYZ(lat, lon, 52);
    this.moon.position.set(position.x, position.y, position.z);
  }

  setPin(lat, lon) {
    const position = latLonToXYZ(lat, lon, 1.008);
    this.pin.position.set(position.x, position.y, position.z);
    this.pin.visible = true;
  }

  setTexture(kind, canvas) {
    const spec = {
      day: { uniform: 'dayMap', mix: 'dayMix', colorSpace: THREE.SRGBColorSpace, materials: [this.earthMat] },
      night: { uniform: 'nightMap', mix: 'nightMix', colorSpace: THREE.SRGBColorSpace, materials: [this.earthMat] },
      water: { uniform: 'waterMap', mix: 'waterMix', colorSpace: THREE.LinearSRGBColorSpace, materials: [this.earthMat] },
      cloud: { uniform: 'cloudMap', mix: 'cloudMix', colorSpace: THREE.LinearSRGBColorSpace, materials: [this.earthMat, this.cloudMat] },
    }[kind];
    if (!spec || !canvas) return;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = spec.colorSpace;
    texture.anisotropy = this.aniso;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    for (const material of spec.materials) {
      const previous = material.uniforms[spec.uniform].value;
      material.uniforms[spec.uniform].value = texture;
      if (previous && previous.isTexture && previous !== texture) previous.dispose();
    }
    if (kind === 'cloud') {
      this.cloudMat.uniforms.cloudTexel.value.set(1.5 / canvas.width, 1.5 / canvas.height);
    }
    this.mixTarget[spec.mix] = 1;
  }

  pick(x, y, width, height) {
    this.pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.earth, false);
    if (!hits.length) return null;
    const point = hits[0].point;
    return xyzToLatLon(point.x, point.y, point.z);
  }

  projectPin(width, height) {
    if (!this.pin.visible) return null;
    this._normal.copy(this.pin.position).normalize();
    this._toCamera.copy(this.camera.position).sub(this.pin.position).normalize();
    if (this._normal.dot(this._toCamera) < 0.08) return null;
    this._projected.copy(this.pin.position).project(this.camera);
    if (this._projected.z > 1) return null;
    return {
      x: (this._projected.x * 0.5 + 0.5) * width,
      y: (-this._projected.y * 0.5 + 0.5) * height,
    };
  }

  render(timeMs) {
    for (const key of Object.keys(this.mixTarget)) {
      const uniform = this.earthMat.uniforms[key];
      uniform.value += (this.mixTarget[key] - uniform.value) * 0.08;
      if (this.cloudMat.uniforms[key]) this.cloudMat.uniforms[key].value = uniform.value;
    }
    if (this.pin.visible) {
      const scale = 1 + 0.16 * Math.sin(timeMs * 0.0022);
      this.halo.scale.setScalar(scale);
      this.halo.material.opacity = 0.28 + 0.18 * (0.5 + 0.5 * Math.sin(timeMs * 0.0022));
    }
    this.renderer.render(this.scene, this.camera);
  }
}
