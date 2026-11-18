// node assets/brand/sources/icon.mjs: writes assets/brand/icon.svg, renders icon-{16..512}.png and
// the site's site/public/apple-touch-icon.png.
// The icon is 1.0's three by three contribution grid, with each row drawn in a different theme's
// shades: cyan, pink and yellow. Every size snaps its squares to whole pixels, so the small
// toolbar icons stay sharp. The 128 px file keeps 16 px of clear space on each side, as the Chrome
// Web Store asks; the other sizes fill their square. The 180 px home-screen icon is opaque and square,
// since iOS rounds its corners itself.
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BRAND = join(dirname(fileURLToPath(import.meta.url)), "..");

export const BACKING = "#0A0A0B";
export const EDGE = "#2C2C31";
// Levels 1 to 4 of each row, darkest first.
export const ROWS = [
  ["#0E3B47", "#127A93", "#1BB5D6", "#3FE0FF"],
  ["#4A1631", "#8C2A5C", "#CC3F86", "#FF5FA8"],
  ["#4A3B08", "#8C700F", "#CCA517", "#FFD23F"],
];
// 1.0's pattern of levels, so each row and each column has one busiest day.
export const LEVELS = [
  [1, 4, 2],
  [3, 1, 4],
  [4, 2, 3],
];

// Square, gap and margin in pixels for each size, chosen so the grid lands on whole pixels.
// pad is the clear space around the backing. The master SVG uses the 16 unit grid at 2.5.
const SIZES = {
  16: { pad: 0, square: 3, gap: 1, margin: 2 },
  32: { pad: 0, square: 6, gap: 2, margin: 5 },
  48: { pad: 0, square: 10, gap: 3, margin: 6 },
  64: { pad: 0, square: 12, gap: 4, margin: 10 },
  128: { pad: 16, square: 18, gap: 6, margin: 15 },
  512: { pad: 0, square: 96, gap: 32, margin: 80 },
};
const TOUCH = { size: 180, pad: 0, square: 34, gap: 11, margin: 28, radius: 0, outline: false };

const n = (value) => Number(value.toFixed(3));

export function iconSvg({ size = 16, pad = 0, square = 3, gap = 1, margin = 2.5, radius = 0.211, outline = true, title = true } = {}) {
  const art = size - 2 * pad;
  const edge = outline ? art / 64 : 0;
  const rects = LEVELS.flatMap((row, r) =>
    row.map((level, c) => {
      const x = pad + margin + c * (square + gap);
      const y = pad + margin + r * (square + gap);
      return `<rect x="${n(x)}" y="${n(y)}" width="${square}" height="${square}" rx="${n(square * 0.2)}" fill="${ROWS[r][level - 1]}"/>`;
    }),
  ).join("");
  const label = title
    ? ` role="img" aria-labelledby="title desc"><title id="title">GitHub Reskin</title><desc id="desc">A three by three contribution grid on a near-black rounded square, each row in a different theme's shades: cyan, pink and yellow.</desc`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"${label}><rect x="${n(pad + edge / 2)}" y="${n(pad + edge / 2)}" width="${n(art - edge)}" height="${n(art - edge)}" rx="${n(art * radius)}" fill="${BACKING}" stroke="${EDGE}" stroke-width="${n(edge)}"/><g>${rects}</g></svg>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(join(BRAND, "icon.svg"), iconSvg());
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [size, spec] of Object.entries(SIZES)) {
      const page = await browser.newPage({ viewport: { width: Number(size), height: Number(size) }, deviceScaleFactor: 1 });
      await page.setContent(`<style>*{margin:0}svg{display:block}</style>${iconSvg({ size: Number(size), ...spec, title: false })}`);
      await page.screenshot({ path: join(BRAND, `icon-${size}.png`), omitBackground: true });
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: TOUCH.size, height: TOUCH.size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>*{margin:0}body{background:${BACKING}}svg{display:block}</style>${iconSvg({ ...TOUCH, title: false })}`);
    await page.screenshot({ path: join(BRAND, "../../site/public/apple-touch-icon.png") });
  } finally {
    await browser.close();
  }
}
