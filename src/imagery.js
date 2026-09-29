import { buildCloudMap, cloudCoverage, loadStaticClouds } from './clouds.js';
import { loadEquirect, recentDates, worldSize } from './gibs.js';

const DAY = {
  layer: 'BlueMarble_ShadedRelief_Bathymetry',
  matrix: '500m',
  date: '2004-08-01',
  ext: 'jpg',
};
const NIGHT = {
  layer: 'VIIRS_Black_Marble',
  matrix: '500m',
  date: '2016-01-01',
  ext: 'png',
};
const WATER = {
  layer: 'MODIS_Water_Mask',
  matrix: '250m',
  date: 'default',
  ext: 'png',
};
const CLOUD_SOURCES = [
  { layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', label: 'VIIRS SNPP' },
  { layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', label: 'VIIRS NOAA-20' },
];

function detailLevel(maxTextureSize) {
  const width = window.innerWidth || 1200;
  const memory = navigator.deviceMemory || 4;
  let level = width >= 1100 && memory >= 4 ? 3 : 2;
  const limit = maxTextureSize || 4096;
  while (level > 0 && worldSize(level).width > limit) level -= 1;
  return level;
}

function snapshot(status) {
  return {
    dayLevel: status.dayLevel,
    cloudMode: status.cloudMode,
    dates: status.dates.slice(),
    layers: status.layers.slice(),
    updated: status.updated,
    note: status.note,
    cloudLevel: status.cloudLevel,
  };
}

async function loadOne(spec, level) {
  try {
    const mosaic = await loadEquirect(spec.layer, spec.matrix, spec.date, level, spec.ext);
    if (mosaic.loaded / mosaic.total < 0.45) return null;
    return mosaic;
  } catch {
    return null;
  }
}

async function loadSurfaces(globe, level, status) {
  const day = await loadOne(DAY, level);
  if (!day) throw new Error(`Day imagery failed at level ${level}`);
  globe.setTexture('day', day.canvas);
  status.dayCanvases.set(level, day.canvas);
  status.dayLevel = Math.max(status.dayLevel, level);
  const [night, water] = await Promise.all([loadOne(NIGHT, level), loadOne(WATER, level)]);
  if (night) globe.setTexture('night', night.canvas);
  if (water) globe.setTexture('water', water.canvas);
}

let cachedJobs = null;
let cachedAt = 0;

async function discoverCloudJobs(force) {
  if (!force && cachedJobs && Date.now() - cachedAt < 20 * 60 * 1000) return cachedJobs;
  const jobs = [];
  for (const source of CLOUD_SOURCES) {
    const dates = await recentDates(source.layer, '250m', 'jpg', { needed: 2, days: 6 });
    for (const date of dates) jobs.push({ ...source, date });
  }
  jobs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  cachedJobs = jobs;
  cachedAt = Date.now();
  return jobs;
}

let appliedCloudKey = '';
let appliedCloudLevel = -1;

async function useStaticClouds(globe, status) {
  if (status.cloudMode === 'live') return;
  const canvas = await loadStaticClouds(`${import.meta.env.BASE_URL}textures/clouds-fallback.jpg`);
  globe.setTexture('cloud', canvas);
  status.cloudMode = 'static';
  status.dates = [];
  status.layers = [];
  status.updated = new Date();
  status.note = 'Live cloud imagery didn’t load. Showing a static NASA Blue Marble cloud map.';
}

async function loadCloudDeck(globe, level, status, { force = false } = {}) {
  const jobs = await discoverCloudJobs(force);
  const key = jobs.map((job) => `${job.layer}@${job.date}`).join('|');
  if (!jobs.length) {
    await useStaticClouds(globe, status);
    return;
  }
  if (!force && key === appliedCloudKey && level <= appliedCloudLevel) return;
  const day = status.dayCanvases.get(level);
  if (!day) {
    await useStaticClouds(globe, status);
    return;
  }
  const frames = [];
  const dates = [];
  const labels = [];
  for (const job of jobs) {
    const mosaic = await loadOne(
      { layer: job.layer, matrix: '250m', date: job.date, ext: 'jpg' },
      level,
    );
    if (!mosaic) continue;
    frames.push(mosaic.canvas);
    dates.push(job.date);
    if (!labels.includes(job.label)) labels.push(job.label);
  }
  if (!frames.length) {
    await useStaticClouds(globe, status);
    return;
  }
  const clouds = await buildCloudMap(day, frames);
  if (cloudCoverage(clouds) < 0.015) {
    await useStaticClouds(globe, status);
    return;
  }
  globe.setTexture('cloud', clouds);
  appliedCloudKey = key;
  appliedCloudLevel = level;
  status.cloudLevel = level;
  status.cloudMode = 'live';
  status.dates = [...new Set(dates)].sort();
  status.layers = labels;
  status.updated = new Date();
  status.note = '';
}

export function beginImagery(globe, hooks = {}) {
  const status = {
    dayLevel: 0,
    cloudMode: 'loading',
    dates: [],
    layers: [],
    updated: null,
    note: '',
    cloudLevel: 0,
    dayCanvases: new Map(),
  };
  const detail = detailLevel(globe.renderer.capabilities.maxTextureSize);
  const cloudLevel = Math.min(2, detail);
  const publish = () => hooks.onStatus?.(snapshot(status));

  const task = (async () => {
    hooks.onProgress?.(0.06);
    await loadSurfaces(globe, 0, status);
    publish();
    hooks.onProgress?.(0.35);
    await Promise.all([
      loadCloudDeck(globe, 0, status).then(publish),
      loadSurfaces(globe, 2, status).then(() => {
        publish();
        hooks.onProgress?.(0.72);
      }),
    ]);
    try {
      await loadCloudDeck(globe, cloudLevel, status);
    } catch {
      await useStaticClouds(globe, status);
    }
    publish();
    hooks.onProgress?.(1);
    if (detail >= 3) {
      try {
        await loadSurfaces(globe, 3, status);
        publish();
      } catch {
        // Level 2 day imagery stays on screen.
      }
    }
    return snapshot(status);
  })();

  return {
    status,
    task,
    refresh: async () => {
      try {
        await loadCloudDeck(globe, Math.max(appliedCloudLevel, 0), status, { force: true });
      } catch {
        await useStaticClouds(globe, status);
      }
      publish();
      return snapshot(status);
    },
  };
}
