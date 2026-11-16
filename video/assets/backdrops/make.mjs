// Blurred, saturated full-frame backdrops derived from the real captures, so the theme's colors
// fill the frame behind the product window without readable text in the platform's reserved
// areas. Made offline with FFmpeg rather than a CSS filter at render time.
//   node video/assets/backdrops/make.mjs
// Writes <capture id>.jpg here for every phone-size (V) and desktop-size (D) page capture.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURES = join(HERE, "../captures");

// The FFmpeg filter for a capture's preset: a top crop, a small blur pass and a resize to the frame.
export const FILTERS = Object.freeze({
  V: "crop=iw:iw*1.7949:0:0,scale=390:700,gblur=sigma=14,eq=saturation=1.35,scale=1080:1938",
  D: "crop=iw:iw*0.5625:0:0,scale=960:540,gblur=sigma=12,eq=saturation=1.35,scale=1920:1080",
});

export function backdropSources() {
  return readdirSync(CAPTURES)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(CAPTURES, name), "utf8")))
    .filter((record) => record.file?.endsWith(".png") && ["V", "D"].includes(record.preset))
    .map((record) => ({ id: record.id, file: record.file, filter: FILTERS[record.preset === "V" ? "V" : "D"] }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const { id, file, filter } of backdropSources()) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(CAPTURES, file), "-vf", filter, "-q:v", "3", join(HERE, `${id}.jpg`)]);
    console.log(`${id}.jpg`);
  }
}
