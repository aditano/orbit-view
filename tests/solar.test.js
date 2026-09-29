import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createClock,
  daylightLabel,
  julianDay,
  lerpAngle,
  solarGeometry,
  sunElevation,
  wrapLon,
} from '../src/solar.js';

test('unix epoch converts to the J2000 julian day', () => {
  const noon = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
  assert.ok(Math.abs(julianDay(noon) - 2451545.0) < 1e-6);
});

test('solstice and equinox declination stay inside the physical range', () => {
  const june = solarGeometry(new Date(Date.UTC(2024, 5, 20, 20, 51, 0)));
  const december = solarGeometry(new Date(Date.UTC(2024, 11, 21, 9, 20, 0)));
  const march = solarGeometry(new Date(Date.UTC(2024, 2, 20, 3, 6, 0)));
  assert.ok(june.declination > 23.2 && june.declination < 23.5, june.declination);
  assert.ok(december.declination < -23.2 && december.declination > -23.5, december.declination);
  assert.ok(Math.abs(march.declination) < 0.35, march.declination);
});

test('declination agrees with Spencer’s approximation', () => {
  const samples = [
    new Date(Date.UTC(2024, 0, 15, 12)),
    new Date(Date.UTC(2024, 3, 10, 18)),
    new Date(Date.UTC(2024, 6, 4, 6)),
    new Date(Date.UTC(2026, 8, 29, 4, 30)),
  ];
  for (const date of samples) {
    const solar = solarGeometry(date);
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const day = (date - start) / 86400000;
    const gamma = (2 * Math.PI * (day - 1 + (date.getUTCHours() - 12) / 24)) / 365;
    const spencer =
      (0.006918 -
        0.399912 * Math.cos(gamma) +
        0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) +
        0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) +
        0.00148 * Math.sin(3 * gamma)) *
      (180 / Math.PI);
    assert.ok(Math.abs(solar.declination - spencer) < 0.7, `${solar.declination} vs ${spencer}`);
  }
});

test('the sun is overhead at the subsolar point and night at the antipode', () => {
  const date = new Date(Date.UTC(2026, 8, 29, 16, 0, 0));
  const solar = solarGeometry(date);
  const overhead = sunElevation(date, solar.subsolarLat, solar.subsolarLon, solar);
  const antipode = sunElevation(
    date,
    -solar.subsolarLat,
    wrapLon(solar.subsolarLon + 180),
    solar,
  );
  assert.ok(overhead > 89.5, overhead);
  assert.ok(antipode < -89.5, antipode);
});

test('daylight labels follow civil twilight', () => {
  assert.equal(daylightLabel(12), 'Day');
  assert.equal(daylightLabel(-3), 'Twilight');
  assert.equal(daylightLabel(-20), 'Night');
});

test('longitude interpolation takes the short way around', () => {
  const mid = lerpAngle(170, -170, 0.5);
  assert.ok(Math.abs(Math.abs(wrapLon(mid)) - 180) < 1e-6);
});

test('a time query freezes the clock', () => {
  const now = createClock('?time=2026-09-29T04:30:00Z')();
  assert.equal(now.toISOString(), '2026-09-29T04:30:00.000Z');
});
