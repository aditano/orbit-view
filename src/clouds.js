export function isNodata(r, g, b) {
  return r + g + b < 18;
}

/**
 * How much a true-color pixel should contribute to the cloud deck.
 * Clouds are brighter than the cloud-free Blue Marble base and nearly white.
 * Deserts and ice stay in the base map because they are already bright there.
 */
export function cloudScore(r, g, b, baseR, baseG, baseB) {
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const baseLuminance = (0.2126 * baseR + 0.7152 * baseG + 0.0722 * baseB) / 255;
  const maxChannel = Math.max(r, g, b) / 255;
  const minChannel = Math.min(r, g, b) / 255;
  const whiteness = maxChannel <= 1e-4 ? 0 : 1 - (maxChannel - minChannel) / maxChannel;
  const delta = luminance - baseLuminance;
  let score = 0;
  if (delta > 0.06 && whiteness > 0.55 && luminance > 0.35) {
    score = clamp01((delta - 0.06) / 0.45) * (0.4 + 0.6 * whiteness);
  }
  return score;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function blurAxis(src, width, height, radius, horizontal) {
  const out = new Uint8Array(src.length);
  const span = radius * 2 + 1;
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  for (let line = 0; line < lines; line += 1) {
    const sample = (index) => {
      const clamped = Math.min(length - 1, Math.max(0, index));
      return horizontal ? src[line * width + clamped] : src[clamped * width + line];
    };
    let sum = 0;
    for (let index = -radius; index <= radius; index += 1) sum += sample(index);
    for (let index = 0; index < length; index += 1) {
      const value = Math.round(sum / span);
      if (horizontal) out[line * width + index] = value;
      else out[index * width + line] = value;
      sum += sample(index + radius + 1) - sample(index - radius);
    }
  }
  return out;
}

/**
 * VIIRS granules are full of thin scan streaks. A wide blur turns that mask
 * into a soft cloud deck instead of a field of hard rectangles.
 */
export function cleanCloudAlpha(alpha, width, height) {
  const radius = Math.max(2, Math.round(width / 200));
  const horizontal = blurAxis(alpha, width, height, radius, true);
  return blurAxis(horizontal, width, height, radius, false);
}

function yieldFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function buildCloudMap(baseCanvas, frames) {
  const width = baseCanvas.width;
  const height = baseCanvas.height;
  const base = baseCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const sources = frames.map((frame) =>
    frame.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data,
  );
  const alpha = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = (row + x) * 4;
      let score = 0;
      for (let source = 0; source < sources.length; source += 1) {
        const data = sources[source];
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        if (isNodata(red, green, blue)) continue;
        score = cloudScore(red, green, blue, base[index], base[index + 1], base[index + 2]);
        break;
      }
      alpha[row + x] = Math.round(score * 255);
    }
    if (y % 28 === 0) await yieldFrame();
  }

  const cleaned = cleanCloudAlpha(alpha, width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let pixel = 0; pixel < cleaned.length; pixel += 1) {
    const offset = pixel * 4;
    image.data[offset] = 255;
    image.data[offset + 1] = 255;
    image.data[offset + 2] = 255;
    image.data[offset + 3] = cleaned[pixel];
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export function cloudCoverage(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let opaque = 0;
  let seen = 0;
  const stride = 16 * 4;
  for (let index = 3; index < data.length; index += stride) {
    seen += 1;
    if (data[index] > 28) opaque += 1;
  }
  return seen ? opaque / seen : 0;
}

export async function loadStaticClouds(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Static cloud map failed to load');
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const output = context.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const luminance = image.data[index];
    const alpha = luminance < 22 ? 0 : Math.min(255, Math.round((luminance - 18) * 1.05));
    output.data[index] = 255;
    output.data[index + 1] = 255;
    output.data[index + 2] = 255;
    output.data[index + 3] = alpha;
  }
  context.putImageData(output, 0, 0);
  return canvas;
}
