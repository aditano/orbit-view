export const EARTH_RADIUS_KM = 6371;
export const MIN_ALTITUDE_KM = 1500;
export const MAX_ALTITUDE_KM = 5000;
export const FOCUS_ALTITUDE_KM = 4200;

export function radiusForAltitude(km) {
  return 1 + km / EARTH_RADIUS_KM;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function latLonToXYZ(lat, lon, radius = 1) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  return {
    x: -radius * sinPhi * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * sinPhi * Math.sin(theta),
  };
}

export function xyzToLatLon(x, y, z) {
  const radius = Math.hypot(x, y, z) || 1;
  const lat = 90 - (Math.acos(clamp(y / radius, -1, 1)) * 180) / Math.PI;
  const theta = Math.atan2(z, -x);
  let lon = (theta * 180) / Math.PI - 180;
  lon = ((lon + 540) % 360 + 360) % 360 - 180;
  return { lat, lon };
}

/** Vertical FOV that fits the planetary disc in the shorter screen axis. */
export function fovForDisc(distance, aspect, fill = 0.96) {
  const safeDistance = Math.max(distance, 1.02);
  const limb = Math.asin(Math.min(0.995, 1 / safeDistance));
  const needed = (2 * limb) / fill;
  const vertical =
    aspect >= 1 ? needed : 2 * Math.atan(Math.tan(needed / 2) / Math.max(aspect, 0.2));
  return clamp((vertical * 180) / Math.PI, 44, 118);
}

export function framingDistance(fovDeg, aspect, fill = 0.76) {
  const vertical = (fovDeg * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(aspect, 0.2));
  const limit = Math.min(vertical, horizontal);
  const limb = clamp((limit / 2) * fill, 0.22, 1.15);
  return 1 / Math.sin(limb);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}
