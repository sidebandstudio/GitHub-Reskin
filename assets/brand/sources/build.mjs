// Original vector artwork and deterministic PNG exports for GitHub Reskin.
// Dependencies are installed in a temporary directory, never in an application repo.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(process.env.BRAND_RENDER_DEPS
  ? join(process.env.BRAND_RENDER_DEPS, 'package.json') : import.meta.url);
const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');
const fontkit = require('fontkit');
const typeface = fontkit.openSync(join(root, 'fonts/Manrope-Variable.ttf'));
const fontCache = new Map();
const C = { canvas: '#0C0F14', tile: '#151A22', coral: '#FF806C', ivory: '#F5F3EE', muted: '#B0B8C5', caption: '#929EAF', light: '#F1F3F5', dark: '#202124' };
const esc = str => str.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

function text(str, x, y, size, weight = 500, fill = C.ivory, tracking = 0) {
  if (!fontCache.has(weight)) fontCache.set(weight, typeface.getVariation({ wght: weight }));
  const font = fontCache.get(weight);
  const run = font.layout(str);
  const scale = size / font.unitsPerEm;
  let cursor = 0;
  const paths = run.glyphs.map((glyph, i) => {
    const p = run.positions[i];
    const path = `<path transform="translate(${cursor + p.xOffset} ${p.yOffset})" d="${glyph.path.toSVG()}"/>`;
    cursor += p.xAdvance + tracking / scale;
    return path;
  }).join('');
  return `<g aria-label="${esc(str)}" fill="${fill}" transform="translate(${x} ${y}) scale(${scale} ${-scale})">${paths}</g>`;
}

function svg(width, height, title, body, desc = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">${esc(desc)}</desc>${body}</svg>\n`;
}

const backing = `<rect width="16" height="16" rx="4" fill="${C.tile}"/>`;
// Each drawing uses a 16-unit grid. Filled paths preserve two-unit structural edges.
const marks = {
  a: `<path fill="${C.coral}" fill-rule="evenodd" d="M4 2H9L14 7V12A2 2 0 0 1 12 14H4A2 2 0 0 1 2 12V4A2 2 0 0 1 4 2ZM4 4V12H12V8H9A1 1 0 0 1 8 7V4Z"/>`,
  b: `<path fill="${C.coral}" d="M7 2H2V11H7V9H4V4H7Z"/><path fill="${C.ivory}" d="M9 5H14V14H9V12H12V7H9Z"/>`,
  c: `<rect x="6" y="2" width="8" height="10" rx="1.5" fill="${C.ivory}"/><rect x="2" y="4" width="10" height="11" rx="2.5" fill="${C.tile}"/><rect x="2" y="5" width="9" height="9" rx="1.5" fill="${C.coral}"/><path d="M4 10H9V12H4Z" fill="${C.tile}"/>`
};
const names = { a: 'Peel', b: 'Offset brackets', c: 'Swatch stack' };
const descriptions = {
  a: 'A coral page frame curls inward at its upper-right corner, suggesting a new skin over a repository page. Original geometry on a charcoal backing.',
  b: 'Two opposing, vertically offset code brackets suggest a change in the appearance of code. Original geometry on a charcoal backing.',
  c: 'Two offset color cards suggest a choice of skins. A broad dark cut in the front card remains legible at toolbar size. Original geometry on a charcoal backing.'
};
const sizes = [16, 32, 48, 128, 512];
const render = (source, size) => new Resvg(source, {
  fitTo: { mode: 'width', value: size },
  font: { loadSystemFonts: false }
}).render().asPng();
mkdirSync(join(root, 'proofs'), { recursive: true });
const assets = {};
for (const key of Object.keys(marks)) {
  const master = svg(16, 16, `GitHub Reskin concept ${key.toUpperCase()}: ${names[key]}`, backing + marks[key], descriptions[key]);
  writeFileSync(join(root, `concept-${key}.svg`), master);
  assets[key] = {};
  for (const size of sizes) {
    const png = render(master, size);
    assets[key][size] = png;
    writeFileSync(join(root, `proofs/concept-${key}-${size}.png`), png);
    for (const tone of ['light', 'dark']) {
      const proof = await sharp({ create: { width: size, height: size, channels: 4, background: C[tone] } })
        .composite([{ input: png }]).png().toBuffer();
      writeFileSync(join(root, `proofs/concept-${key}-${size}-${tone}.png`), proof);
    }
  }
}

// Contact sheet shows each export at actual pixel size on both toolbar tones.
const columns = [{ size: 16, x: 48, w: 144 }, { size: 32, x: 216, w: 160 }, { size: 48, x: 400, w: 192 }, { size: 128, x: 616, w: 320 }, { size: 512, x: 960, w: 1120 }];
let sheet = `<rect width="2128" height="2072" fill="${C.canvas}"/>`;
sheet += text('GitHub Reskin / original icon studies', 48, 54, 28, 650);
sheet += text('Actual pixel sizes. Each pair: light toolbar / dark toolbar. No theme colors or borrowed symbols.', 48, 86, 16, 450, C.muted);
const composites = [];
for (const [i, key] of Object.keys(marks).entries()) {
  const y = 116 + i * 644;
  sheet += `<path d="M48 ${y}H2080" stroke="#273140"/>`;
  sheet += text(`${key.toUpperCase()} / ${names[key]}`, 48, y + 38, 24, 650, i === 0 ? C.coral : C.ivory);
  for (const col of columns) {
    sheet += text(`${col.size} px`, col.x, y + 70, 14, 550, C.muted);
    const cellw = col.w / 2 - 4;
    const cellh = 528;
    for (const [j, tone] of ['light', 'dark'].entries()) {
      const x = col.x + j * (col.w / 2 + 4);
      const by = y + 84;
      sheet += `<rect x="${x}" y="${by}" width="${cellw}" height="${cellh}" rx="6" fill="${C[tone]}"/>`;
      composites.push({ input: assets[key][col.size], left: Math.round(x + (cellw - col.size) / 2), top: Math.round(by + (cellh - col.size) / 2) });
    }
  }
}
sheet += text('All three marks use a 16-unit grid. Coral #FF806C / charcoal #151A22 / ivory #F5F3EE.', 48, 2044, 16, 500, C.muted);
await sharp(render(svg(2128, 2072, 'Original icon studies', sheet), 2128)).composite(composites).png().toFile(join(root, 'contact-sheet.png'));

// Enlarged nearest-neighbor crops make single-pixel boundaries easy to inspect.
let zoom = `<rect width="1200" height="364" fill="${C.canvas}"/>`;
zoom += text('16 px inspection / actual size and 8x nearest-neighbor detail', 28, 38, 21, 650);
const zooms = [];
for (const [i, key] of Object.keys(marks).entries()) {
  const x = 28 + i * 396;
  zoom += text(`${key.toUpperCase()} / ${names[key]}`, x, 78, 19, 600);
  for (const [j, tone] of ['light', 'dark'].entries()) {
    const bx = x + j * 172;
    zoom += `<rect x="${bx}" y="94" width="160" height="220" rx="6" fill="${C[tone]}"/>`;
    zooms.push({ input: assets[key][16], left: bx + 72, top: 110 });
    zooms.push({ input: await sharp(assets[key][16]).resize(128, 128, { kernel: 'nearest' }).toBuffer(), left: bx + 16, top: 154 });
  }
}
zoom += text('Full-size 16 px exports above each enlarged crop. Pixel shapes shown without interpolation.', 28, 344, 15, 450, C.muted);
await sharp(render(svg(1200, 364, 'Toolbar-size inspection', zoom), 1200)).composite(zooms).png().toFile(join(root, 'proofs/toolbar-inspection.png'));

// Chosen master uses exactly the same geometry at every size, including 16 px.
const final = svg(16, 16, 'GitHub Reskin', backing + marks.a,
  'Original coral Peel mark: a page frame with an inward-folded upper-right corner, on a charcoal rounded square. Created for Sideband Studio, November 8, 2026.');
writeFileSync(join(root, 'icon.svg'), final);
for (const size of [16, 32, 48, 64, 128, 512]) {
  writeFileSync(join(root, `icon-${size}.png`), render(final, size));
}
const markAt = (x, y, size, withBacking = true) => `<g transform="translate(${x} ${y}) scale(${size / 16})">${withBacking ? backing : ''}${marks.a}</g>`;
const outlinedTextNote = 'Typography uses bundled Manrope under SIL OFL 1.1. Text is outlined for portable rendering; editable text and geometry are in sources/build.mjs. No GitHub or franchise artwork.';

const tile = svg(440, 280, 'GitHub Reskin store promo tile draft',
  `<rect width="440" height="280" fill="${C.canvas}"/>` +
  markAt(28, 44, 112) +
  text('GitHub', 163, 91, 38, 650, C.ivory, -0.8) +
  text('Reskin', 163, 137, 38, 650, C.coral, -0.8) +
  text('Anime themes for GitHub', 28, 211, 25, 550, C.ivory, -0.35) +
  text('Sideband Studio', 28, 253, 13, 500, C.muted),
  '440 by 280 pixel artwork draft with the original Peel icon, product name and short descriptive line. No product screenshots. ' + outlinedTextNote);
writeFileSync(join(root, 'tile-440x280.svg'), tile);
writeFileSync(join(root, 'tile-440x280.png'), render(tile, 440));

const marquee = svg(1400, 560, 'GitHub Reskin store marquee draft',
  `<rect width="1400" height="560" fill="${C.canvas}"/>` +
  text('GitHub Reskin', 76, 254, 92, 650, C.ivory, -2.9) +
  text('Anime themes for GitHub', 80, 320, 34, 450, C.muted, -0.4) +
  text('Sideband Studio', 80, 480, 18, 500, C.muted) +
  markAt(940, 80, 400),
  '1400 by 560 pixel artwork draft with the original Peel icon, product name and short descriptive line. No product screenshots. ' + outlinedTextNote);
writeFileSync(join(root, 'marquee-1400x560.svg'), marquee);
writeFileSync(join(root, 'marquee-1400x560.png'), render(marquee, 1400));

console.log('Rendered three concepts, 45 proofs, contact sheet, toolbar inspection, chosen master, six final PNGs and two promo SVG/PNG pairs.');
