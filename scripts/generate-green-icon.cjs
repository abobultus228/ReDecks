// Rebuilds the 3·2·0 green launcher sources from the preserved 3·0·0 PNGs.
const sharp = require('sharp');
const path = require('path');

const assets = path.join(__dirname, '..', 'assets');

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function recolorPurple(data, channels) {
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const dominance = Math.min(b - r, b - g) * 255;
    const weight = clamp((dominance - 10) / 24);
    if (weight <= 0) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    if (lightness > 0.78 && dominance < 30) continue; // keep the white card, recolor the purple edge
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    const newLightness = 0.06 + lightness * 0.35;
    const newSaturation = clamp(saturation * 0.70 + 0.05);
    const chroma = (1 - Math.abs(2 * newLightness - 1)) * newSaturation;
    const hueSection = 143 / 60;
    const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1));
    const match = newLightness - chroma / 2;
    const target = [match, chroma + match, secondary + match];
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.round((data[i + c] / 255 * (1 - weight) + target[c] * weight) * 255);
    }
  }
}

async function replaceUpperZero(file, region, numeral) {
  const { data, info } = await sharp(path.join(assets, file)).raw().toBuffer({ resolveWithObject: true });
  const { left, top, right, bottom, sampleA, sampleB } = region;

  for (let y = top; y <= bottom; y++) {
    const a = (y * info.width + sampleA) * info.channels;
    const b = (y * info.width + sampleB) * info.channels;
    for (let x = left; x <= right; x++) {
      const i = (y * info.width + x) * info.channels;
      const t = (x - sampleA) / (sampleB - sampleA);
      for (let c = 0; c < 3; c++) {
        data[i + c] = Math.max(0, Math.min(255, Math.round(data[a + c] + t * (data[b + c] - data[a + c]))));
      }
      if (info.channels === 4) data[i + 3] = 255;
    }
  }

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <g transform="rotate(11 ${numeral.centerX} ${numeral.centerY})">
      <text x="${numeral.x}" y="${numeral.y}" fill="#ffffff"
        font-family="Arial Black, Arial, sans-serif" font-weight="900" font-style="italic"
        font-size="${numeral.size}">2</text>
    </g>
  </svg>`);

  recolorPurple(data, info.channels);
  const output = file.replace('-purple', '');
  await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .composite([{ input: svg }])
    .png()
    .toFile(path.join(assets, output));
  console.log(output);
}

async function main() {
  await replaceUpperZero('icon-foreground-purple.png',
    { left: 512, top: 353, right: 570, bottom: 419, sampleA: 590, sampleB: 660 },
    { x: 514, y: 411, size: 65, centerX: 542, centerY: 385 });
  await replaceUpperZero('icon-only-purple.png',
    { left: 511, top: 326, right: 580, bottom: 399, sampleA: 600, sampleB: 700 },
    { x: 513, y: 393, size: 72, centerX: 547, centerY: 362 });
  const background = await sharp(path.join(assets, 'icon-background-purple.png'))
    .raw().toBuffer({ resolveWithObject: true });
  recolorPurple(background.data, background.info.channels);
  await sharp(background.data, { raw: {
    width: background.info.width, height: background.info.height, channels: background.info.channels,
  } })
    .png()
    .toFile(path.join(assets, 'icon-background.png'));
  console.log('icon-background.png');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
