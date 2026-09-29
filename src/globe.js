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

void main() {
  vec3 normalW = normalize(vNormalW);
  vec3 light = normalize(sunDir);
  float ndotl = dot(normalW, light);
  float dayAmt = smoothstep(-0.16, 0.22, ndotl);
  float twilight = smoothstep(-0.32, -0.02, ndotl) * (1.0 - smoothstep(0.02, 0.34, ndotl));

  vec3 dayTex = texture2D(dayMap, vUv).rgb;
  vec3 nightTex = texture2D(nightMap, vUv).rgb;
  vec3 baseOcean = vec3(0.012, 0.04, 0.09);
  vec3 dayColor = mix(baseOcean, dayTex, dayMix);
  float form = mix(0.9, 1.0, smoothstep(0.0, 0.95, ndotl));
  dayColor *= form;

  vec3 lights = max(nightTex - vec3(0.012, 0.01, 0.04), vec3(0.0));
  float warmth = nightTex.r - nightTex.b;
  lights *= smoothstep(-0.004, 0.02, warmth) * nightMix;
  lights = pow(max(lights, vec3(0.0)), vec3(0.82)) * 1.85;

  vec3 color = mix(lights, dayColor, dayAmt);
  color += twilight * vec3(0.72, 0.34, 0.14) * 0.22 * max(dayMix, 0.35);

  vec3 viewDir = normalize(cameraPosition - vWorld);
  vec3 halfDir = normalize(light + viewDir);
  float spec = pow(max(dot(normalW, halfDir), 0.0), 160.0);
  float glint = pow(max(dot(normalW, halfDir), 0.0), 640.0);
  float ocean = waterMix > 0.5
    ? texture2D(waterMap, vUv).a
    : smoothstep(0.02, 0.2, dayTex.b - max(dayTex.r, dayTex.g));
  float lit = smoothstep(0.0, 0.22, ndotl);
  color += (spec * 0.07 + glint * 0.22) * ocean * lit * vec3(1.0, 0.98, 0.92);

  float clouds = cloudMix * texture2D(cloudMap, vUv).a;
  color *= mix(1.0, 0.64, clouds * dayAmt);

  float fresnel = pow(1.0 - clamp(dot(normalW, viewDir), 0.0, 1.0), 3.0);
  float sunSide = smoothstep(-0.2, 0.55, ndotl);
  vec3 rim = mix(vec3(0.04, 0.1, 0.28), vec3(0.42, 0.68, 1.0), sunSide);
  color += rim * fresnel * 0.72;

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CLOUD_FRAG = `
uniform sampler2D cloudMap;
uniform vec3 sunDir;
uniform float cloudMix;

varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;

void main() {
  float alpha = texture2D(cloudMap, vUv).a * cloudMix;
  if (alpha < 0.03) discard;
  vec3 normalW = normalize(vNormalW);
  float ndotl = dot(normalW, normalize(sunDir));
  float light = mix(0.08, 1.0, smoothstep(-0.4, 0.5, ndotl));
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fresnel = pow(1.0 - abs(dot(normalW, viewDir)), 2.2);
  vec3 color = mix(vec3(0.93, 0.95, 0.98), vec3(0.72, 0.82, 1.0), fresnel * 0.35) * light;
  gl_FragColor = vec4(color, alpha * 0.7);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ATMO_VERT = `
varying vec3 vViewNormal;
varying vec3 vWorldNormal;

void main() {
  vViewNormal = normalize(normalMatrix * normal);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATMO_FRAG = `
uniform vec3 sunDir;
varying vec3 vViewNormal;
varying vec3 vWorldNormal;

void main() {
  float rim = pow(clamp(0.7 - dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.15);
  float sun = smoothstep(-0.25, 0.7, dot(normalize(vWorldNormal), normalize(sunDir)));
  vec3 glow = mix(vec3(0.07, 0.14, 0.38), vec3(0.5, 0.74, 1.0), sun);
  float intensity = rim * (0.28 + 1.05 * sun);
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
  const count = 1600;
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
    this.aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
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
      },
      vertexShader: EARTH_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.016, widthSegments, heightSegments),
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
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.055, widthSegments, heightSegments), this.atmoMat);
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
