import './style.css';
import {
  FOCUS_ALTITUDE_KM,
  MAX_ALTITUDE_KM,
  MIN_ALTITUDE_KM,
  clamp,
  easeInOut,
  fovForDisc,
  framingDistance,
  latLonToXYZ,
  lerp,
  radiusForAltitude,
} from './geo.js';
import { Globe } from './globe.js';
import { beginImagery } from './imagery.js';
import { describePlace, locateUser, timeZoneFor } from './location.js';
import {
  anglesApart,
  formatCoordinates,
  formatElevation,
  formatSolarClock,
  formatWhen,
} from './format.js';
import {
  createClock,
  daylightLabel,
  lerpAngle,
  moonSubpoint,
  solarGeometry,
  sunElevation,
  wrapLon,
} from './solar.js';
const canvas = document.querySelector('#scene');
const startEl = document.querySelector('#start');
const startButton = document.querySelector('#start-btn');
const statusEl = document.querySelector('#status');
const hud = document.querySelector('#hud');
const progressEl = document.querySelector('#progress');
const pinLabel = document.querySelector('#pin-label');
const recenterButton = document.querySelector('#recenter');
const hudTime = document.querySelector('#hud-time');
const hudSun = document.querySelector('#hud-sun');
const hudName = document.querySelector('#hud-name');
const hudCoords = document.querySelector('#hud-coords');
const hudFix = document.querySelector('#hud-fix');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clock = createClock(window.location.search);
const closeRadius = radiusForAltitude(MIN_ALTITUDE_KM);
const farRadius = radiusForAltitude(MAX_ALTITUDE_KM);
const focusRadius = radiusForAltitude(FOCUS_ALTITUDE_KM);

const state = {
  mode: 'intro',
  busy: false,
  choosing: false,
  lat: 18,
  lon: -25,
  radius: 3.1,
  fov: 48,
  focusFov: 72,
  autoSpin: !reduceMotion,
  spinPausedUntil: 0,
  flight: null,
  home: null,
  place: null,
  zone: null,
  pinLat: null,
  pinLon: null,
  placeToken: 0,
  elevation: 0,
  imagery: {
    dayLevel: 0,
    cloudMode: 'loading',
    cloudLevel: 0,
    dates: [],
    layers: [],
    updated: null,
    note: '',
  },
};

const pointers = new Map();
let drag = null;

let globe;
try {
  globe = new Globe(canvas);
} catch {
  statusEl.textContent = 'This browser couldn’t start the 3D view.';
  startButton.disabled = true;
}

function pixelRatio() {
  const cap = window.innerWidth < 800 ? 1.5 : 2;
  return Math.min(window.devicePixelRatio || 1, cap);
}

function resize() {
  if (!globe) return;
  globe.resize(window.innerWidth, window.innerHeight, pixelRatio());
  const aspect = globe.camera.aspect;
  // Frame the atmosphere shell (1.06), not just the planet, with headroom for the HUD.
  state.focusFov = fovForDisc(focusRadius, aspect, aspect < 1 ? 0.9 : 0.88, 1.06);
  if (state.mode === 'intro') {
    const fill = aspect < 1 ? 0.72 : 0.6;
    state.radius = framingDistance(state.fov, aspect, fill);
  } else if (state.mode === 'settled') {
    state.fov = state.focusFov;
  } else if (state.flight) {
    state.flight.to.fov = state.focusFov;
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function hideStart() {
  startEl.classList.add('is-hidden');
  startEl.setAttribute('aria-hidden', 'true');
}

function showHud() {
  hud.classList.add('is-on');
  hud.setAttribute('aria-hidden', 'false');
}

function placeTitle(city, country) {
  if (!city) return country || '';
  if (!country || country === city) return city;
  const short = country
    .replace('United States of America', 'United States')
    .replace('United Kingdom of Great Britain and Northern Ireland', 'United Kingdom');
  const combined = `${city}, ${short}`;
  return combined.length > 28 ? city : combined;
}

function fixLine(place) {
  if (!place) return '';
  if (place.source === 'ip') return 'Approximate, from your network';
  if (place.source === 'picked') return 'Chosen on the globe';
  if (place.source === 'query') return 'Selected location';
  return '';
}

function updateHud() {
  const now = clock();
  const place = state.place;
  if (!place || place.lat == null) return;
  const solar = solarGeometry(now);
  state.elevation = sunElevation(now, place.lat, place.lon, solar);
  const when = state.zone
    ? formatWhen(now, state.zone)
    : formatSolarClock(now, place.lon, solar.equationOfTime);
  hudTime.textContent = when;
  hudSun.textContent = `${daylightLabel(state.elevation)} · Sun ${formatElevation(state.elevation)}`;
  hudName.textContent = place.city || 'Your position';
  hudCoords.textContent = formatCoordinates(place.lat, place.lon);
  hudFix.textContent = fixLine(place);
}

function updateLabel() {
  const place = state.place;
  if (!place || place.lat == null || !globe) {
    pinLabel.hidden = true;
    return;
  }
  const point = globe.projectPin(window.innerWidth, window.innerHeight);
  if (!point) {
    pinLabel.hidden = true;
    return;
  }
  const city = (place.city || '').split(',')[0];
  const coords = formatCoordinates(place.lat, place.lon);
  pinLabel.textContent = city ? `${city} · ${coords}` : coords;
  pinLabel.hidden = false;
  pinLabel.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, calc(-100% - 14px))`;
}

function updateRecenter() {
  if (!state.home || state.mode !== 'settled' || state.pinLat == null) {
    recenterButton.hidden = true;
    return;
  }
  const cameraAway = anglesApart(state.lat, state.lon, state.pinLat, state.pinLon) > 0.35;
  const pinAway = anglesApart(state.pinLat, state.pinLon, state.home.lat, state.home.lon) > 0.25;
  const zoomed = Math.abs(state.radius - focusRadius) > 0.03;
  recenterButton.hidden = !(cameraAway || pinAway || zoomed);
}

function flyTo(lat, lon) {
  const from = { lat: state.lat, lon: state.lon, radius: state.radius, fov: state.fov };
  const to = { lat, lon, radius: focusRadius, fov: state.focusFov };
  state.flight = {
    from,
    to,
    started: performance.now(),
    duration: reduceMotion ? 1 : 3400,
  };
  state.mode = 'flying';
  state.autoSpin = false;
  hideStart();
}

async function resolveZone(place) {
  if (place.timeZone) return place.timeZone;
  try {
    const zone = await timeZoneFor(place.lat, place.lon);
    if (zone) return zone;
  } catch {
    // The coordinate service can be unreachable; the device clock still works.
  }
  if (place.source === 'device') {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function presentPlace(place) {
  const token = ++state.placeToken;
  if (!state.home) state.home = { ...place };
  state.place = { ...place };
  state.pinLat = place.lat;
  state.pinLon = place.lon;
  globe.setPin(place.lat, place.lon);
  flyTo(place.lat, place.lon);
  updateLabel();
  const described = place.city
    ? null
    : await describePlace(place.lat, place.lon).catch(() => null);
  const zone = await resolveZone(place);
  if (token !== state.placeToken) return;
  if (described?.city) {
    state.place.city = placeTitle(described.city, described.country);
  }
  state.zone = zone;
  updateHud();
  updateLabel();
}

async function begin() {
  if (!globe || state.busy || state.mode !== 'intro') return;
  state.busy = true;
  startButton.disabled = true;
  setStatus('Finding where you are…');
  const place = await locateUser(window.location.search);
  if (place.lat == null) {
    state.choosing = true;
    state.busy = false;
    startButton.hidden = true;
    setStatus(place.denied
      ? 'Location is off. Tap the globe to choose a place.'
      : 'Tap the globe to choose a place.');
    return;
  }
  if (place.approximate) {
    setStatus('Using an approximate fix from your network.');
  }
  await presentPlace(place);
}

function onPointerDown(event) {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.setPointerCapture?.(event.pointerId);
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    pinch: null,
  };
}

function onPointerMove(event) {
  if (!pointers.has(event.pointerId) || !drag) return;
  const previous = pointers.get(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2 && state.mode === 'settled') {
    const pts = [...pointers.values()];
    const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (drag.pinch) state.radius = clamp(state.radius * (drag.pinch / distance), closeRadius, farRadius);
    drag.pinch = distance;
    drag.moved = true;
    return;
  }
  if (state.mode === 'flying') return;
  const dx = event.clientX - previous.x;
  const dy = event.clientY - previous.y;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true;
  if (!drag.moved) return;
  const sensitivity = 0.09 * state.radius;
  state.lon = wrapLon(state.lon - dx * sensitivity);
  state.lat = clamp(state.lat + dy * sensitivity, -89.2, 89.2);
  if (state.mode === 'intro') state.spinPausedUntil = performance.now() + 5000;
}

function onPointerUp(event) {
  const info = drag;
  pointers.delete(event.pointerId);
  if (pointers.size === 0) drag = null;
  if (!info || info.moved || !globe) return;
  if (state.mode === 'intro' && !state.choosing) return;
  if (state.mode === 'flying') return;
  const hit = globe.pick(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
  if (!hit) return;
  presentPlace({
    lat: hit.lat,
    lon: hit.lon,
    source: 'picked',
    approximate: false,
    city: '',
    timeZone: '',
  });
}

function onWheel(event) {
  event.preventDefault();
  if (state.mode !== 'settled') return;
  state.radius = clamp(state.radius * Math.exp(event.deltaY * 0.0011), closeRadius, farRadius);
}

function tick(now) {
  requestAnimationFrame(tick);
  if (!globe) return;
  const dt = Math.min(0.05, (now - (tick.last || now)) / 1000);
  tick.last = now;
  if (state.mode === 'intro' && state.autoSpin && now > state.spinPausedUntil) {
    state.lon = wrapLon(state.lon + dt * 3.1);
  }
  if (state.mode === 'flying' && state.flight) {
    const flight = state.flight;
    const t = Math.min(1, (now - flight.started) / flight.duration);
    const eased = easeInOut(t);
    state.lat = lerp(flight.from.lat, flight.to.lat, eased);
    state.lon = lerpAngle(flight.from.lon, flight.to.lon, eased);
    state.radius = lerp(flight.from.radius, flight.to.radius, eased) + Math.sin(Math.PI * eased) * 0.38;
    state.fov = lerp(flight.from.fov, flight.to.fov, eased);
    if (t >= 1) {
      state.mode = 'settled';
      state.lat = flight.to.lat;
      state.lon = flight.to.lon;
      state.radius = flight.to.radius;
      state.fov = flight.to.fov;
      state.flight = null;
      showHud();
      updateHud();
    }
  }
  const moment = clock();
  const solar = solarGeometry(moment);
  const sun = latLonToXYZ(solar.subsolarLat, solar.subsolarLon, 1);
  globe.setSun(sun.x, sun.y, sun.z);
  const moon = moonSubpoint(moment);
  globe.setMoon(moon.lat, moon.lon);
  globe.setView(state.lat, state.lon, state.radius, state.fov);
  globe.render(now);
  updateLabel();
  updateRecenter();
  if (state.mode === 'settled' && Math.floor(now / 1000) !== tick.second) {
    tick.second = Math.floor(now / 1000);
    updateHud();
  }
}

function publishOrbit() {
  window.__orbit = {
    get mode() { return state.mode; },
    get dayLevel() { return state.imagery.dayLevel; },
    get cloudMode() { return state.imagery.cloudMode; },
    get cloudLevel() { return state.imagery.cloudLevel || 0; },
    get place() { return state.place; },
    get elevation() { return state.elevation; },
    get cloudSize() {
      const image = globe?.cloudMat.uniforms.cloudMap.value.image;
      return image ? [image.width, image.height] : null;
    },
    sunElevation() {
      if (!state.place || state.place.lat == null) return null;
      return sunElevation(clock(), state.place.lat, state.place.lon);
    },
  };
}

if (globe) {
  resize();
  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  startButton.addEventListener('click', () => {
    begin().catch(() => {
      state.choosing = true;
      state.busy = false;
      startButton.hidden = true;
      setStatus('Tap the globe to choose a place.');
    });
  });
  recenterButton.addEventListener('click', () => {
    if (!state.home) return;
    presentPlace({ ...state.home, city: state.home.city || '' });
  });
  const imagery = beginImagery(globe, {
    onProgress(fraction) {
      progressEl.style.width = `${Math.round(fraction * 100)}%`;
      if (fraction >= 1) progressEl.classList.add('is-done');
    },
    onStatus(next) {
      state.imagery = next;
      if (state.mode === 'settled') updateHud();
    },
  });
  imagery.task.catch(() => {
    state.imagery = {
      ...state.imagery,
      cloudMode: 'static',
      note: 'Live cloud imagery didn’t load. Showing a static NASA Blue Marble cloud map.',
    };
  });
  setInterval(() => {
    imagery.refresh().catch(() => {});
  }, 30 * 60 * 1000);
  publishOrbit();
  requestAnimationFrame(tick);
  if (new URLSearchParams(window.location.search).get('auto') === '1') {
    begin().catch(() => {});
  }
}
