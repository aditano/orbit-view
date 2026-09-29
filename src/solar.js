const DEG = Math.PI / 180;

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function wrapLon(lon) {
  return mod(lon + 180, 360) - 180;
}

export function lerpAngle(from, to, t) {
  return from + wrapLon(to - from) * t;
}

export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function utcMinutes(date) {
  return (
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60000
  );
}

/**
 * Solar geometry from the NOAA Solar Calculator.
 * Declination and the equation of time follow the Jean Meeus formulas
 * used by https://gml.noaa.gov/grad/solcalc/
 */
export function solarGeometry(date) {
  const t = (julianDay(date) - 2451545.0) / 36525;
  const geomMeanLong = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  const geomMeanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const anomRad = geomMeanAnom * DEG;
  const sunEqCtr =
    Math.sin(anomRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * anomRad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * anomRad) * 0.000289;
  const sunTrueLong = geomMeanLong + sunEqCtr;
  const sunAppLong =
    sunTrueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * DEG);
  const meanObliq =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos((125.04 - 1934.136 * t) * DEG);
  const declination =
    Math.asin(Math.sin(obliqCorr * DEG) * Math.sin(sunAppLong * DEG)) / DEG;
  const varY = Math.tan((obliqCorr / 2) * DEG) ** 2;
  const geomLongRad = geomMeanLong * DEG;
  const equationOfTime =
    (4 / DEG) *
    (varY * Math.sin(2 * geomLongRad) -
      2 * eccent * Math.sin(anomRad) +
      4 * eccent * varY * Math.sin(anomRad) * Math.cos(2 * geomLongRad) -
      0.5 * varY * varY * Math.sin(4 * geomLongRad) -
      1.25 * eccent * eccent * Math.sin(2 * anomRad));
  const minutes = utcMinutes(date);
  const subsolarLon = wrapLon((720 - minutes - equationOfTime) / 4);

  return {
    declination,
    equationOfTime,
    subsolarLat: declination,
    subsolarLon,
  };
}

export function sunElevation(date, lat, lon, solar = solarGeometry(date)) {
  const trueSolar = mod(utcMinutes(date) + solar.equationOfTime + 4 * lon, 1440);
  const hourAngle = trueSolar / 4 - 180;
  const latRad = lat * DEG;
  const decRad = solar.declination * DEG;
  const hourRad = hourAngle * DEG;
  const cosZenith =
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(hourRad);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  return 90 - zenith / DEG;
}

export function daylightLabel(elevation) {
  if (elevation > 0) return 'Day';
  if (elevation > -6) return 'Twilight';
  return 'Night';
}

/**
 * Approximate sub-Earth point of the Moon (a few degrees), enough to place
 * a distant moon in the right part of the sky and let the sun light its phase.
 */
export function moonSubpoint(date) {
  const d = julianDay(date) - 2451545.0;
  const meanLon = (218.3164477 + 13.17639648 * d) * DEG;
  const meanAnom = (134.9633964 + 13.06499295 * d) * DEG;
  const meanDist = (93.272095 + 13.2293502 * d) * DEG;
  const eclLon = meanLon + 6.289 * DEG * Math.sin(meanAnom);
  const eclLat = 5.128 * DEG * Math.sin(meanDist);
  const eps = (23.4392911 - (0.0130042 * d) / 36525) * DEG;
  const ra = Math.atan2(
    Math.sin(eclLon) * Math.cos(eps) - Math.tan(eclLat) * Math.sin(eps),
    Math.cos(eclLon),
  );
  const dec = Math.asin(
    Math.sin(eclLat) * Math.cos(eps) +
      Math.cos(eclLat) * Math.sin(eps) * Math.sin(eclLon),
  );
  const gmst = mod(280.46061837 + 360.98564736629 * d, 360);
  const raDeg = mod(ra / DEG, 360);
  return {
    lat: dec / DEG,
    lon: wrapLon(raDeg - gmst),
  };
}

export function createClock(search = '') {
  const raw = new URLSearchParams(search).get('time');
  if (raw) {
    const fixed = new Date(raw);
    if (!Number.isNaN(fixed.getTime())) {
      const stamp = fixed.getTime();
      return () => new Date(stamp);
    }
  }
  return () => new Date();
}
