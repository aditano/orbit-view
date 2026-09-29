import { wrapLon } from './solar.js';

export function formatCoordinates(lat, lon) {
  const northSouth = lat >= 0 ? 'N' : 'S';
  const eastWest = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}° ${northSouth}, ${Math.abs(lon).toFixed(2)}° ${eastWest}`;
}

export function formatElevation(degrees) {
  const rounded = Math.round(degrees);
  const sign = rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded)}°`;
}

export function formatWhen(date, timeZone) {
  const options = {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  };
  if (timeZone) options.timeZone = timeZone;
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    return date.toISOString().slice(11, 16) + ' UTC';
  }
}

export function formatSolarClock(date, lon, equationOfTime) {
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const clock = ((minutes + equationOfTime + 4 * lon) % 1440 + 1440) % 1440;
  const hours = Math.floor(clock / 60);
  const mins = Math.floor(clock % 60);
  return `Solar ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function formatObservation(dates) {
  const unique = [...new Set(dates)].sort();
  if (!unique.length) return '';
  const pretty = (iso) => {
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };
  if (unique.length === 1) return pretty(unique[0]);
  return `${pretty(unique[0])} – ${pretty(unique[unique.length - 1])}`;
}

export function formatFetched(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function anglesApart(latA, lonA, latB, lonB) {
  const dLat = latA - latB;
  const dLon = wrapLon(lonA - lonB);
  return Math.hypot(dLat, dLon);
}
