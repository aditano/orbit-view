const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';
const TILE = 512;

// EPSG:4326 matrices share this layout. Level 0 is 0.5625°/pixel and the
// world occupies the top-left 640×320; each level doubles that resolution.
export const TILE_LAYOUT = {
  0: { cols: 2, rows: 1 },
  1: { cols: 3, rows: 2 },
  2: { cols: 5, rows: 3 },
  3: { cols: 10, rows: 5 },
  4: { cols: 20, rows: 10 },
};

export function worldSize(level) {
  const scale = 2 ** level;
  return { width: 640 * scale, height: 320 * scale };
}

export function tileUrl(layer, date, matrixSet, level, row, col, ext) {
  return `${GIBS}/${layer}/default/${date}/${matrixSet}/${level}/${row}/${col}.${ext}`;
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function fetchTile(url) {
  let lastError = new Error(`Failed to load ${url}`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal: timeoutSignal(25000) });
      if (!response.ok) throw new Error(String(response.status));
      const type = response.headers.get('content-type') || '';
      if (!type.includes('image')) throw new Error(type || 'not an image');
      const image = await createImageBitmap(await response.blob());
      return { image, actual: response.headers.get('layer-time-actual') };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}

function darkFraction(bitmap) {
  const sampleWidth = 96;
  const sampleHeight = Math.max(1, Math.round(sampleWidth * (320 / 512)));
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const sourceHeight = Math.max(1, Math.round(bitmap.height * (320 / 512)));
  context.drawImage(bitmap, 0, 0, bitmap.width, sourceHeight, 0, 0, sampleWidth, sampleHeight);
  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
  let dark = 0;
  const count = sampleWidth * sampleHeight;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] + data[index + 1] + data[index + 2] < 18) dark += 1;
  }
  return dark / count;
}

export async function sampleDarkFraction(layer, matrixSet, date, ext) {
  const url = tileUrl(layer, date, matrixSet, 0, 0, 0, ext);
  try {
    const tile = await fetchTile(url);
    const fraction = darkFraction(tile.image);
    tile.image.close?.();
    return fraction;
  } catch {
    return null;
  }
}

export async function recentDates(layer, matrixSet, ext, { days = 6, needed = 2 } = {}) {
  const dates = [];
  const today = new Date();
  for (let back = 0; back < days && dates.length < needed; back += 1) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    day.setUTCDate(day.getUTCDate() - back);
    const date = day.toISOString().slice(0, 10);
    const dark = await sampleDarkFraction(layer, matrixSet, date, ext);
    if (dark != null && dark < 0.8) dates.push(date);
  }
  return dates;
}

export async function loadEquirect(layer, matrixSet, date, level, ext) {
  const layout = TILE_LAYOUT[level];
  const size = worldSize(level);
  if (!layout) throw new Error(`Unsupported tile level ${level}`);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const jobs = [];
  for (let row = 0; row < layout.rows; row += 1) {
    for (let col = 0; col < layout.cols; col += 1) jobs.push({ row, col });
  }
  let loaded = 0;
  let actual = null;
  await mapPool(jobs, 6, async ({ row, col }) => {
    const url = tileUrl(layer, date, matrixSet, level, row, col, ext);
    try {
      const tile = await fetchTile(url);
      if (!actual && tile.actual) actual = tile.actual;
      context.drawImage(tile.image, col * TILE, row * TILE);
      tile.image.close?.();
      loaded += 1;
    } catch {
      // A missing tile stays empty and the rest of the mosaic still draws.
    }
  });
  if (loaded === 0) throw new Error(`No tiles for ${layer} ${date}`);
  return { canvas, actual, date, layer, loaded, total: jobs.length };
}
