import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FOCUS_ALTITUDE_KM,
  MAX_ALTITUDE_KM,
  MIN_ALTITUDE_KM,
  fovForDisc,
  framingDistance,
  latLonToXYZ,
  radiusForAltitude,
  xyzToLatLon,
} from '../src/geo.js';
import { TILE_LAYOUT, worldSize } from '../src/gibs.js';

test('lat/lon round-trips through the sphere mapping', () => {
  const samples = [
    [0, 0],
    [40.71, -74.01],
    [35.68, 139.69],
    [-33.87, 151.21],
    [89, 10],
    [-89, -170],
    [0, 180],
    [0, -180],
  ];
  for (const [lat, lon] of samples) {
    const point = latLonToXYZ(lat, lon, 1);
    const back = xyzToLatLon(point.x, point.y, point.z);
    assert.ok(Math.abs(back.lat - lat) < 1e-6, `lat ${lat} -> ${back.lat}`);
    const lonDelta = Math.abs(back.lon - lon);
    assert.ok(lonDelta < 1e-6 || Math.abs(lonDelta - 360) < 1e-4, `lon ${lon} -> ${back.lon}`);
  }
});

test('orbital distance stays in the requested altitude band', () => {
  assert.ok(radiusForAltitude(MIN_ALTITUDE_KM) < radiusForAltitude(FOCUS_ALTITUDE_KM));
  assert.ok(radiusForAltitude(FOCUS_ALTITUDE_KM) < radiusForAltitude(MAX_ALTITUDE_KM));
  assert.ok(FOCUS_ALTITUDE_KM >= MIN_ALTITUDE_KM && FOCUS_ALTITUDE_KM <= MAX_ALTITUDE_KM);
});

test('the intro camera sits outside the earth for both phone and desktop frames', () => {
  assert.ok(framingDistance(48, 16 / 9, 0.74) > 2);
  assert.ok(framingDistance(48, 0.5, 0.86) > 2);
});

test('the focused view keeps the planetary limb inside the shorter axis', () => {
  const distance = radiusForAltitude(FOCUS_ALTITUDE_KM);
  const desktop = (fovForDisc(distance, 16 / 9) * Math.PI) / 180;
  const phone = (fovForDisc(distance, 9 / 19.5) * Math.PI) / 180;
  const limb = 2 * Math.asin(1 / distance);
  assert.ok(desktop > limb * 0.9 && desktop < limb * 1.15);
  const phoneHorizontal = 2 * Math.atan(Math.tan(phone / 2) * (9 / 19.5));
  assert.ok(phoneHorizontal > limb * 0.85, phoneHorizontal);
});

test('GIBS world size doubles each level and matches the tile grid', () => {
  assert.deepEqual(worldSize(0), { width: 640, height: 320 });
  assert.deepEqual(worldSize(2), { width: 2560, height: 1280 });
  assert.deepEqual(worldSize(3), { width: 5120, height: 2560 });
  assert.deepEqual(TILE_LAYOUT[2], { cols: 5, rows: 3 });
  assert.equal(TILE_LAYOUT[3].cols * 512, worldSize(3).width);
});
