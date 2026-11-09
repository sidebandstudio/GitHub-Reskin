// Deterministic test art for embedded-image tests, screenshots and traces: a neon skyline drawn on
// a canvas, converted through the same local conversion the theme builder uses. Nothing is
// fetched. `paintArt` returns PNG bytes; `artTheme` returns a theme that carries the art as its
// page wallpaper, profile banner and header image, with each conversion's note.
import { convertRaster } from "../../../packages/appearance/index.js";

// A small seeded generator, so every run draws the same pixels.
function random(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** PNG bytes of the skyline at width x height. `kind` picks the composition. */
export async function paintArt(width, height, kind = "wallpaper") {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d");
  const rand = random(kind === "banner" ? 7 : kind === "header" ? 11 : 3);
  const horizon = height * (kind === "header" ? 0.9 : kind === "banner" ? 0.72 : 0.62);
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#07061a");
  sky.addColorStop(0.55, "#2a0b4a");
  sky.addColorStop(1, "#b0186a");
  c.fillStyle = sky;
  c.fillRect(0, 0, width, horizon);
  // The sun, cut by bands that widen toward the horizon.
  const r = Math.min(width, height) * (kind === "header" ? 0.5 : 0.26);
  const sx = width * (kind === "banner" ? 0.7 : 0.5);
  const sun = c.createLinearGradient(0, horizon - 2 * r, 0, horizon);
  sun.addColorStop(0, "#fcee0a");
  sun.addColorStop(1, "#ff3d81");
  c.save();
  c.beginPath();
  c.arc(sx, horizon - r * 0.35, r, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = sun;
  c.fillRect(sx - r, horizon - 2 * r, 2 * r, 2 * r);
  for (let i = 0; i < 7; i++) c.clearRect(sx - r, horizon - r * 0.9 + i * i * r * 0.03, 2 * r, 2 + i * 1.6);
  c.restore();
  // Skyline: two rows of towers with lit windows.
  for (const [row, shade, scale] of [[0, "#14102e", 1], [1, "#0b0920", 0.7]]) {
    let x = -10;
    while (x < width) {
      const w = (24 + rand() * 70) * (kind === "header" ? 0.5 : 1);
      const h = (horizon * (0.18 + rand() * 0.42)) * scale * (kind === "header" ? 0.6 : 1);
      c.fillStyle = shade;
      c.fillRect(x, horizon - h, w, h + 2);
      if (row === 1) {
        for (let wy = horizon - h + 8; wy < horizon - 6; wy += 9) {
          for (let wx = x + 5; wx < x + w - 5; wx += 8) if (rand() < 0.22) {
            c.fillStyle = rand() < 0.5 ? "#00f0ff" : "#fcee0a";
            c.fillRect(wx, wy, 3, 4);
          }
        }
      }
      x += w + 2 + rand() * 6;
    }
  }
  // Ground: a dark plane with a cyan perspective grid.
  const ground = c.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, "#1a0630");
  ground.addColorStop(1, "#05040f");
  c.fillStyle = ground;
  c.fillRect(0, horizon, width, height - horizon);
  c.strokeStyle = "rgba(0,240,255,0.55)";
  c.lineWidth = 2;
  for (let i = -24; i <= 24; i++) {
    c.beginPath();
    c.moveTo(width / 2 + i * 30, horizon);
    c.lineTo(width / 2 + i * width * 0.12, height);
    c.stroke();
  }
  for (let i = 1; i < 12; i++) {
    const y = horizon + (height - horizon) * (i / 12) ** 2;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(width, y);
    c.stroke();
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * A dark neon theme with the art as wallpaper, banner and header image. `size` is the wallpaper's
 * size; `max` builds the trace's maximum set instead: one 2048x1024 image in all three places,
 * 6,291,456 decoded pixels counting repeats.
 */
export async function artTheme({ max = false } = {}) {
  const convert = async (width, height, kind, others) => {
    const result = await convertRaster(await paintArt(width, height, kind), { compress: true, quality: 0.85, others });
    if (!result.ok) throw new Error(`${kind}: ${result.message}`);
    return result;
  };
  const notes = [];
  let wallpaper;
  let banner;
  let header;
  if (max) {
    wallpaper = banner = header = await convert(2048, 1024, "wallpaper", { bytes: 2 * 87381, pixels: 2 * 2048 * 1024 });
  } else {
    wallpaper = await convert(1600, 900, "wallpaper", { bytes: 0, pixels: 0 });
    banner = await convert(1280, 280, "banner", { bytes: wallpaper.after.bytes, pixels: 1600 * 900 });
    header = await convert(1280, 64, "header", { bytes: wallpaper.after.bytes + banner.after.bytes, pixels: 1600 * 900 + 1280 * 280 });
  }
  for (const r of [wallpaper, banner, header]) notes.push(r.note);
  const theme = {
    schemaVersion: 1,
    name: max ? "Neon Skyline max" : "Neon Skyline",
    base: "dark",
    description: "Test theme for embedded images: a skyline wallpaper, banner and header image.",
    colors: { background: "#07061a", text: "#f2f4ff", accent: "#ff3d81", contribution: "#00f0ff" },
    overrides: { mutedText: "#c3c6ea", link: "#7fe9ff", surface: "#100c2a", border: "#3a2f6b" },
    backgrounds: {
      page: { color: "#07061a", layers: [{ image: { ...wallpaper.image, fit: "cover", position: "top" } }] },
      profileBanner: { color: "#100c2a", layers: [{ image: { ...banner.image, fit: "cover", position: "center" } }] },
      header: { color: "#07061a", layers: [{ image: { ...header.image, fit: "cover", position: "center" } }] },
    },
    shape: { corners: { style: "rounded", radius: 8 }, avatar: { shape: "circle", frame: { style: "neon", width: 2, color: "#ff3d81" } } },
  };
  return { theme, notes, bytes: [wallpaper, banner, header].map((r) => r.after.bytes) };
}
