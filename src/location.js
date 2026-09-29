const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 };

export function readQueryLocation(search = '') {
  const params = new URLSearchParams(search);
  if (!params.has('lat') || !params.has('lon')) return null;
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    lat,
    lon,
    source: 'query',
    approximate: false,
    city: '',
    timeZone: '',
  };
}

function deviceLocation(options) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('Geolocation is unavailable'), { code: 2 }));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function ipLocation() {
  const response = await fetch('https://get.geojs.io/v1/ip/geo.json');
  if (!response.ok) throw new Error('IP location failed');
  const data = await response.json();
  const lat = Number(data.latitude);
  const lon = Number(data.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('IP location was incomplete');
  return {
    lat,
    lon,
    source: 'ip',
    approximate: true,
    city: data.city || '',
    region: data.region || '',
    timeZone: data.timezone || '',
  };
}

export async function locateUser(search = '') {
  const override = readQueryLocation(search);
  if (override) return override;
  try {
    let position;
    try {
      position = await deviceLocation(GEO_OPTIONS);
    } catch (error) {
      if (error && error.code === 1) throw error;
      position = await deviceLocation({
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 300000,
      });
    }
    return {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      source: 'device',
      approximate: false,
      city: '',
      timeZone: '',
    };
  } catch (error) {
    const denied = Boolean(error && error.code === 1);
    try {
      const ip = await ipLocation();
      return { ...ip, denied };
    } catch {
      return {
        lat: null,
        lon: null,
        source: 'none',
        approximate: true,
        denied,
        city: '',
        timeZone: '',
      };
    }
  }
}

export async function describePlace(lat, lon) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=en`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Reverse geocode failed');
  const data = await response.json();
  return {
    city: data.city || data.locality || data.principalSubdivision || '',
    region: data.principalSubdivision || '',
    country: data.countryName || '',
  };
}

export async function timeZoneFor(lat, lon) {
  const url = `https://timeapi.io/api/timezone/coordinate?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Time zone lookup failed');
  const data = await response.json();
  if (!data.timeZone) throw new Error('Time zone lookup was empty');
  return data.timeZone;
}
