import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanCloudAlpha, cloudScore, isNodata } from '../src/clouds.js';

test('a bright white pixel over dark ocean is cloud', () => {
  assert.ok(cloudScore(250, 250, 250, 2, 5, 20) > 0.6);
});

test('desert that matches the cloud-free base is not painted as cloud', () => {
  assert.ok(cloudScore(203, 165, 120, 200, 160, 115) < 0.2);
});

test('empty swath pixels are treated as missing data', () => {
  assert.equal(isNodata(0, 0, 0), true);
  assert.equal(isNodata(2, 5, 20), false);
});

test('ice that is already bright in the base map is not painted as cloud', () => {
  assert.ok(cloudScore(250, 250, 250, 240, 240, 240) < 0.2);
});

test('thin scan streaks are softened and cloud masses remain', () => {
  const width = 64;
  const height = 24;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    alpha[y * width + 8] = 220;
    for (let x = 30; x < 48; x += 1) alpha[y * width + x] = 200;
  }
  const cleaned = cleanCloudAlpha(alpha, width, height);
  assert.ok(cleaned[12 * width + 8] < 100);
  assert.ok(cleaned[12 * width + 38] > 150);
});
