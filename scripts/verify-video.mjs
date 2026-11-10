// C10's check module for the two Hyperframes films: `video` (check:video), `render-video`
// (render:video) and `verify-video` (verify:video), through scripts/check.mjs.
//
//   video          Static checks of both projects (timing, media, fonts, determinism, captures and
//                  rights), then `hyperframes check --json` in video/tiktok and video/site.
//   render-video   Renders both films at 30 fps with the pinned CLI into artifacts/video: the
//                  vertical cut with its CC0 bed and SFX-only (identical picture), the stems, the
//                  site cut with its optional bed and a silent copy, posters and one-frame-per-
//                  second filmstrips, and render-report.json.
//   verify-video   `hyperframes check` in both projects, the static checks, then ffprobe/FFmpeg on
//                  every rendered file: size, 30/1 fps, exact frame count, duration, audio streams,
//                  identical vertical pictures and the SFX master's silence where only music plays.
//
// Rendering needs the network once to fetch hyperframes@0.9.5 and its headless shell through npx;
// the compositions themselves load only local files.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

export const CLI = "hyperframes@0.9.5";
export const FPS = 30;
export const PROJECTS = Object.freeze({
  tiktok: { dir: "video/tiktok", id: "tiktok", width: 1080, height: 1920, frames: 660 },
  site: { dir: "video/site", id: "site", width: 1920, height: 1080, frames: 900 },
});
// Seconds in the vertical cut where only the bed should sound (between the Reskin-on click and the
// first whoosh), used to prove the SFX master carries no music.
export const SFX_QUIET_WINDOW = Object.freeze([2.0, 7.2]);
export const OUTPUTS = Object.freeze({
  tiktokSfx: "github-reskin-tiktok-22s-sfx.mp4",
  tiktokBed: "github-reskin-tiktok-22s-bed.mp4",
  tiktokRelease: "github-reskin-tiktok-22s.mp4",
  tiktokSfxStem: "github-reskin-tiktok-22s-sfx-stem.wav",
  tiktokMusicStem: "github-reskin-tiktok-22s-music-stem.wav",
  tiktokCover: "github-reskin-tiktok-22s-cover.png",
  tiktokFilmstrip: "github-reskin-tiktok-22s-filmstrip.png",
  site: "github-reskin-site-30s.mp4",
  siteSilent: "github-reskin-site-30s-silent.mp4",
  sitePoster: "github-reskin-site-30s-poster.png",
  sitePosterJpg: "github-reskin-site-30s-poster.jpg",
  siteFilmstrip: "github-reskin-site-30s-filmstrip.png",
});
// Poster and cover moments: the settled Choom Circuit result with its title.
export const POSTER_FRAMES = Object.freeze({ site: 105, tiktok: 24 });
const FORBIDDEN = [
  [/Date\.now\s*\(/, "Date.now()"],
  [/Math\.random\s*\(/, "Math.random()"],
  [/\bset(?:Timeout|Interval)\s*\(/, "a timer"],
  [/requestAnimationFrame\s*\(/, "requestAnimationFrame"],
  [/repeat\s*:\s*-1/, "repeat: -1"],
  [/\bfetch\s*\(/, "fetch()"],
  [/\.(?:play|pause)\s*\(\s*\)/, "media play()/pause()"],
  [/@keyframes|animation\s*:/, "a CSS animation clock"],
];
const FONT_FAMILIES = new Set(["manrope", "sans-serif"]);

// ---------------------------------------------------------------------------------------------
// Reading compositions

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].slice(1).map((m) => [m[1], m[2] ?? ""]));
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map((m) => ({ raw: m[0], ...attrs(m[0]) }));

/** The root composition and its scenes, parsed from a project directory. */
export function readProject(dir) {
  const index = readFileSync(join(dir, "index.html"), "utf8");
  const root = tags(index, "div").find((t) => t["data-composition-id"] && !t["data-composition-src"]);
  const hosts = tags(index, "div").filter((t) => t["data-composition-src"]);
  const scenes = hosts.map((host) => {
    const file = join(dir, host["data-composition-src"]);
    const html = existsSync(file) ? readFileSync(file, "utf8") : null;
    return { host, file, html };
  });
  return { dir, index, root, hosts, scenes, audio: tags(index, "audio") };
}

const sources = (html) => [
  ...[...html.matchAll(/(?<![\w-])src="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]),
];
const scripts = (html) => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
const styles = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const onFrame = (seconds) => Math.abs(seconds * FPS - Math.round(seconds * FPS)) < 0.02;

// ---------------------------------------------------------------------------------------------
// Rights

/** A rights pattern, relative to video/assets, with * for any run of characters but /. */
export const globToRegExp = (glob) => new RegExp(`^${glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);

export function loadRights(assets) {
  const ledger = JSON.parse(readFileSync(join(assets, "rights.json"), "utf8"));
  return ledger.entries.map((entry) => ({ ...entry, patterns: entry.files.map(globToRegExp) }));
}

/** The rights entry covering an asset path relative to video/assets, or undefined. */
export const rightsFor = (rights, path) => rights.find((entry) => entry.patterns.some((re) => re.test(path)));

// Every file under video/assets except the ledgers, manifests, scripts and notes.
function assetFiles(assets, sub = "") {
  return readdirSync(join(assets, sub), { withFileTypes: true }).flatMap((item) => {
    const path = sub ? `${sub}/${item.name}` : item.name;
    if (item.isDirectory()) return assetFiles(assets, path);
    return /\.(?:json|mjs|md)$/.test(item.name) ? [] : [path];
  });
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// ---------------------------------------------------------------------------------------------
// Static checks

/**
 * Checks one project without a browser. Returns a list of failure strings and the number of
 * assertions made. `spec` is a PROJECTS entry; `assets` the shared video/assets directory; `checkout`
 * the checkout whose theme files the captures must match.
 */
export function checkProject(dir, spec, assets, checkout = join(assets, "../..")) {
  const failures = [];
  let count = 0;
  const expect = (ok, message) => {
    count++;
    if (!ok) failures.push(`${spec.id}: ${message}`);
  };
  const project = readProject(dir);
  const { root, hosts, scenes } = project;
  const duration = spec.frames / FPS;
  expect(Boolean(root), "index.html has a root composition");
  if (!root) return { failures, count };
  expect(root["data-composition-id"] === spec.id, `root composition id is ${spec.id}`);
  expect(Number(root["data-duration"]) === duration, `root data-duration is ${duration} s (${spec.frames} frames)`);
  expect(Number(root["data-width"]) === spec.width && Number(root["data-height"]) === spec.height, `root is ${spec.width}x${spec.height}`);
  expect(new RegExp(`__timelines\\["${spec.id}"\\]`).test(project.index), `root registers window.__timelines["${spec.id}"]`);

  // Scene hosts tile [0, duration) on frame boundaries, each host id matching its scene.
  let cursor = 0;
  for (const { host, file, html } of [...scenes].sort((a, b) => Number(a.host["data-start"]) - Number(b.host["data-start"]))) {
    const start = Number(host["data-start"]);
    const length = Number(host["data-duration"]);
    expect(Math.abs(start - cursor) < 1e-6, `scene ${host.id} starts at ${cursor} s, where the previous one ends`);
    expect(onFrame(start) && onFrame(length), `scene ${host.id} starts and ends on a frame`);
    cursor = start + length;
    expect(host.id === host["data-composition-id"], `scene host ${host.id} id matches its data-composition-id`);
    expect(html !== null, `scene file ${relative(dir, file)} exists`);
    if (!html) continue;
    expect(/^\s*<template>/.test(html), `${relative(dir, file)} wraps its scene in <template>`);
    expect(new RegExp(`data-composition-id="${host.id}"`).test(html), `${relative(dir, file)} has composition id ${host.id}`);
    expect(new RegExp(`__timelines\\["${host.id}"\\]\\s*=\\s*tl`).test(html), `${relative(dir, file)} registers its paused timeline as ${host.id}`);
    expect(/gsap\.timeline\(\{\s*paused:\s*true\s*\}\)/.test(html), `${relative(dir, file)} builds a paused timeline`);
    for (const clip of tags(html, "div").filter((t) => /\bclip\b/.test(t.class ?? ""))) {
      expect(onFrame(Number(clip["data-start"])) && onFrame(Number(clip["data-duration"])), `${host.id}: clip ${clip.id} starts and ends on a frame`);
      expect(Number(clip["data-start"]) + Number(clip["data-duration"]) <= length + 1e-6, `${host.id}: clip ${clip.id} ends inside its scene`);
    }
  }
  expect(Math.abs(cursor - duration) < 1e-6, `scenes cover the whole ${duration} s`);

  // Audio: ids, CC0 files, inside the film.
  const ids = new Set();
  for (const audio of project.audio) {
    expect(Boolean(audio.id) && !ids.has(audio.id), `audio ${audio.src} has a unique id`);
    ids.add(audio.id);
    expect(/\bclip\b/.test(audio.class ?? ""), `audio ${audio.id} is a timed clip`);
    expect(Number(audio["data-start"]) + Number(audio["data-duration"]) <= duration + 1e-6, `audio ${audio.id} ends by ${duration} s`);
    expect(!("crossorigin" in audio), `audio ${audio.id} has no crossorigin`);
  }
  expect(ids.has("bed"), "the licensed bed is an <audio id=\"bed\"> the SFX master can drop");

  // Every document: local media that exists and has a rights entry, captures with manifests,
  // bundled fonts only, no clock or network.
  const rights = loadRights(assets);
  const docs = [["index.html", project.index], ...scenes.filter((s) => s.html).map((s) => [relative(dir, s.file), s.html])];
  for (const [name, html] of docs) {
    for (const src of sources(html)) {
      expect(!/^(?:[a-z]+:)?\/\//i.test(src) && !src.startsWith("/") && !src.startsWith("data:"), `${name}: ${src} is a relative local path`);
      expect(src.startsWith("assets/"), `${name}: ${src} is under assets/`);
      const file = join(dir, src);
      expect(existsSync(file), `${name}: ${src} exists`);
      const asset = src.replace(/^assets\//, "");
      expect(Boolean(rightsFor(rights, asset)), `${name}: ${src} has a rights entry`);
      if (asset.startsWith("captures/") && existsSync(file)) {
        const manifest = join(assets, asset.replace(/\.png$/, ".json"));
        expect(existsSync(manifest), `${name}: ${src} has a capture manifest`);
        if (existsSync(manifest)) {
          const record = JSON.parse(readFileSync(manifest, "utf8"));
          expect(Boolean(record.url && record.captured && record.viewport && record.extension?.commit), `${src} manifest records URL, date, viewport and extension commit`);
          expect(record.sha256 === sha256(file), `${src} matches the hash in its manifest`);
          expect(!record.theme || Boolean(record.themeSource?.file), `${src} manifest records its theme's source file`);
          if (record.themeSource?.file) {
            const theme = join(checkout, record.themeSource.file);
            expect(existsSync(theme) && sha256(theme) === record.themeSource.sha256, `${src} was captured with ${record.themeSource.file} as it is now. Recapture it`);
          }
        }
      }
    }
    const code = scripts(html);
    for (const [re, what] of FORBIDDEN) expect(!re.test(code) && !(what.startsWith("a CSS") && re.test(styles(html))), `${name}: no ${what}`);
    for (const m of styles(html).matchAll(/font-family\s*:\s*([^;]+);/g)) {
      const families = m[1].split(",").map((f) => f.trim().replace(/^["']|["']$/g, "").toLowerCase());
      expect(families.every((f) => FONT_FAMILIES.has(f)), `${name}: font-family ${m[1].trim()} is the bundled Manrope`);
    }
  }
  expect(/@font-face\s*\{[^}]*font-family:\s*"Manrope"[^}]*url\("assets\/fonts\/Manrope-Variable\.ttf"\)/.test(project.index), "index.html declares Manrope from assets/fonts");
  return { failures, count };
}

/** The asset ledger itself: every entry's files exist, every asset file has an entry. */
export function checkAssets(assets) {
  const failures = [];
  let count = 0;
  const expect = (ok, message) => {
    count++;
    if (!ok) failures.push(`assets: ${message}`);
  };
  const rights = loadRights(assets);
  const files = assetFiles(assets);
  for (const entry of rights) {
    expect(Boolean(entry.license && entry.source), `rights entry ${entry.files.join(", ")} names a license and source`);
    for (const re of entry.patterns) expect(files.some((f) => re.test(f)), `rights pattern ${re} matches a file`);
  }
  for (const file of files) expect(Boolean(rightsFor(rights, file)), `${file} has a rights entry`);
  const audio = JSON.parse(readFileSync(join(assets, "audio/rights.json"), "utf8"));
  const recorded = new Set(audio.assets.map((record) => basename(record.file)));
  for (const file of files.filter((f) => /^audio\/[^/]+\.mp3$/.test(f))) expect(recorded.has(basename(file)), `${file} has its own record in audio/rights.json`);
  for (const record of audio.assets) {
    const file = join(assets, "audio", basename(record.file));
    expect(existsSync(file) && sha256(file) === record.sha256, `${basename(record.file)} matches its CC0 ledger hash`);
    expect(record.spdx_license_id === "CC0-1.0", `${basename(record.file)} is CC0-1.0`);
  }
  for (const font of ["fonts/Manrope-Variable.ttf", "fonts/OFL.txt"]) expect(existsSync(join(assets, font)), `${font} is bundled`);
  return { failures, count };
}

/**
 * Links each project's assets/ to the shared video/assets/. The link is not committed (a project's
 * .gitignore names it), so a fresh checkout gets it from the first check, render or verify.
 */
export function linkAssets(root) {
  for (const spec of Object.values(PROJECTS)) {
    const link = join(root, spec.dir, "assets");
    if (!existsSync(link)) symlinkSync("../assets", link);
  }
}

export function staticChecks(root) {
  linkAssets(root);
  const assets = join(root, "video/assets");
  const results = [checkAssets(assets), ...Object.values(PROJECTS).map((spec) => checkProject(join(root, spec.dir), spec, assets))];
  return { failures: results.flatMap((r) => r.failures), count: results.reduce((n, r) => n + r.count, 0) };
}

// ---------------------------------------------------------------------------------------------
// Tools

const ENV = { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1", DO_NOT_TRACK: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1" };

function sh(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", env: ENV, maxBuffer: 1 << 28, ...options });
  if (result.error) throw result.error;
  return result;
}

function must(cmd, args, options) {
  const result = sh(cmd, args, options);
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${result.status}):\n${(result.stderr || result.stdout).slice(-4000)}`);
  return result.stdout;
}

// npx is a .cmd on Windows, which Node starts only through a shell, so there it runs as one quoted
// command line.
const quote = (arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);
const hf = (args, cwd) =>
  process.platform === "win32" ? sh(["npx.cmd", "--yes", CLI, ...args].map(quote).join(" "), [], { cwd, shell: true }) : sh("npx", ["--yes", CLI, ...args], { cwd });

/** Runs `hyperframes check --json` in a project and returns {ok, errors, warnings}. */
export function hyperframesCheck(dir) {
  const result = hf(["check", "--json"], dir);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return { ok: false, errors: [`check printed no JSON (exit ${result.status}): ${result.stderr.slice(-2000)}`], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.severity === "error") return errors.push(`${node.code}: ${node.message}`);
    if (node.severity === "warning") return warnings.push(`${node.code}: ${node.message}`);
    Object.values(node).forEach(walk);
  };
  walk(report);
  return { ok: result.status === 0 && report.ok === true && errors.length === 0, errors, warnings };
}

export function probe(file) {
  const out = must("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,duration,sample_rate,channels:format=duration", "-of", "json", file]);
  return JSON.parse(out);
}

/** Peak level in dB of a file's audio over [from, to) seconds. */
export function peakDb(file, from, to) {
  const out = sh("ffmpeg", ["-hide_banner", "-nostats", "-ss", String(from), "-t", String(to - from), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"]).stderr;
  const m = out.match(/max_volume:\s*(-?[\d.]+|-inf) dB/);
  return m ? (m[1] === "-inf" ? -Infinity : Number(m[1])) : -Infinity;
}

const videoMd5 = (file) => createHash("sha256").update(must("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "framemd5", "-"])).digest("hex");

// ---------------------------------------------------------------------------------------------
// Render

// A copy of a project for a variant render, with assets linked back to the shared folder.
function stage(root, spec, out, edit) {
  const src = join(root, spec.dir);
  const dir = join(out, "stage", spec.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const item of readdirSync(src)) {
    if (item === "assets" || item.startsWith(".") || item === "renders") continue;
    cpSync(join(src, item), join(dir, item), { recursive: true });
  }
  symlinkSync(realpathSync(join(src, "assets")), join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), edit(readFileSync(join(src, "index.html"), "utf8")));
  return dir;
}

function renderProject(dir, output) {
  const started = Date.now();
  const result = hf(["render", "--fps", String(FPS), "--quality", "delivery", "--output", output, "--quiet"], dir);
  if (result.status !== 0 || !existsSync(output)) throw new Error(`render of ${dir} failed (${result.status}):\n${(result.stderr || result.stdout).slice(-4000)}`);
  return { seconds: Math.round((Date.now() - started) / 100) / 10 };
}

const frameAt = (video, frame, output, scale) => must("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `select=eq(n\\,${frame})${scale ? `,scale=${scale}` : ""}`, "-frames:v", "1", output]);

// One frame per second (frames 0, 30, 60, ...), tiled left to right, top to bottom.
function filmstrip(video, seconds, columns, width, output) {
  const rows = Math.ceil(seconds / columns);
  must("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `select='not(mod(n\\,${FPS}))',scale=${width}:-2,tile=${columns}x${rows}:padding=6:color=0x0c0f14`, "-frames:v", "1", "-fps_mode", "vfr", output]);
}

// The bed exactly as the composition plays it: in-point, gain and edge fades from its <audio>.
function musicStem(root, spec, output) {
  const bed = readProject(join(root, spec.dir)).audio.find((a) => a.id === "bed");
  const start = Number(bed["data-start"]);
  const length = Number(bed["data-duration"]);
  const fadeIn = Number(bed["data-fade-in"] || 0);
  const fadeOut = Number(bed["data-fade-out"] || 0);
  const filter = [`atrim=start=${Number(bed["data-media-start"] || 0)}:duration=${length}`, "asetpts=PTS-STARTPTS", `volume=${Number(bed["data-volume"] || 1)}`, `afade=t=in:d=${fadeIn}`, `afade=t=out:st=${length - fadeOut}:d=${fadeOut}`, `adelay=${Math.round(start * 1000)}:all=1`, `apad=whole_dur=${spec.frames / FPS}`];
  must("ffmpeg", ["-v", "error", "-y", "-i", join(root, spec.dir, bed.src), "-af", filter.join(","), "-t", String(spec.frames / FPS), "-ar", "48000", "-ac", "2", output]);
}

const withoutBed = (html) => html.replace(/\s*<audio id="bed"[^>]*><\/audio>/, "");

export function render(root, out) {
  linkAssets(root);
  mkdirSync(out, { recursive: true });
  const report = { cli: CLI, fps: FPS, quality: "delivery", rendered: new Date().toISOString(), files: {} };
  const tiktok = PROJECTS.tiktok;
  const site = PROJECTS.site;
  const o = (name) => join(out, OUTPUTS[name]);

  // Vertical: the full composition (SFX plus bed), then the same picture with SFX only.
  report.tiktokBed = renderProject(join(root, tiktok.dir), o("tiktokBed"));
  const sfxOnly = join(out, "stage", "tiktok-sfx-render.mp4");
  report.tiktokSfxRender = renderProject(stage(root, tiktok, out, withoutBed), sfxOnly);
  // The SFX master takes its picture stream from the bed master, so the two are identical by
  // construction; the audio is the SFX-only render's own mix.
  must("ffmpeg", ["-v", "error", "-y", "-i", o("tiktokBed"), "-i", sfxOnly, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest", o("tiktokSfx")]);
  cpSync(o("tiktokSfx"), o("tiktokRelease"));
  must("ffmpeg", ["-v", "error", "-y", "-i", sfxOnly, "-vn", "-c:a", "pcm_s16le", o("tiktokSfxStem")]);
  musicStem(root, tiktok, o("tiktokMusicStem"));
  frameAt(o("tiktokBed"), POSTER_FRAMES.tiktok, o("tiktokCover"));
  filmstrip(o("tiktokBed"), 22, 11, 270, o("tiktokFilmstrip"));

  // Site: with the optional bed, a silent copy of the same picture, poster and filmstrip.
  report.site = renderProject(join(root, site.dir), o("site"));
  must("ffmpeg", ["-v", "error", "-y", "-i", o("site"), "-map", "0:v:0", "-c", "copy", "-an", o("siteSilent")]);
  frameAt(o("site"), POSTER_FRAMES.site, o("sitePoster"));
  must("ffmpeg", ["-v", "error", "-y", "-i", o("sitePoster"), "-q:v", "3", o("sitePosterJpg")]);
  filmstrip(o("site"), 30, 6, 384, o("siteFilmstrip"));

  for (const name of Object.values(OUTPUTS)) report.files[name] = { bytes: statSync(join(out, name)).size, sha256: sha256(join(out, name)) };
  writeFileSync(join(out, "render-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  rmSync(join(out, "stage"), { recursive: true, force: true });
  return report;
}

// ---------------------------------------------------------------------------------------------
// Verify the rendered files

export function verifyRenders(out) {
  const failures = [];
  let count = 0;
  const expect = (ok, message) => {
    count++;
    if (!ok) failures.push(`renders: ${message}`);
  };
  const o = (name) => join(out, OUTPUTS[name]);
  for (const name of Object.keys(OUTPUTS)) expect(existsSync(o(name)), `${OUTPUTS[name]} exists`);
  if (failures.length) return { failures, count };

  const film = (name, spec, audio) => {
    const info = probe(o(name));
    const video = info.streams.filter((s) => s.codec_type === "video");
    const sound = info.streams.filter((s) => s.codec_type === "audio");
    const label = OUTPUTS[name];
    expect(video.length === 1, `${label} has one video stream`);
    const [v] = video;
    expect(v?.width === spec.width && v?.height === spec.height, `${label} is ${spec.width}x${spec.height} (got ${v?.width}x${v?.height})`);
    expect(v?.r_frame_rate === "30/1", `${label} is 30/1 fps (got ${v?.r_frame_rate})`);
    expect(Number(v?.nb_read_frames) === spec.frames, `${label} has ${spec.frames} frames (got ${v?.nb_read_frames})`);
    expect(Math.abs(Number(v?.duration) - spec.frames / FPS) < 0.5 / FPS, `${label} video lasts ${spec.frames / FPS} s (got ${v?.duration})`);
    expect(sound.length === (audio ? 1 : 0), `${label} has ${audio ? "one audio stream" : "no audio"}`);
    if (audio && sound[0]) expect(Number(sound[0].duration) <= spec.frames / FPS + 1 / FPS, `${label} audio ends with the picture (${sound[0].duration} s)`);
    expect(Number(info.format.duration) <= spec.frames / FPS + 1 / FPS, `${label} container lasts no longer than its ${spec.frames} frames`);
  };
  film("tiktokSfx", PROJECTS.tiktok, true);
  film("tiktokBed", PROJECTS.tiktok, true);
  film("tiktokRelease", PROJECTS.tiktok, true);
  film("site", PROJECTS.site, true);
  film("siteSilent", PROJECTS.site, false);

  const bedPicture = videoMd5(o("tiktokBed"));
  expect(bedPicture === videoMd5(o("tiktokSfx")), "the SFX and bed vertical masters have identical frames");
  expect(videoMd5(o("site")) === videoMd5(o("siteSilent")), "the silent site copy has the same frames");
  const [from, to] = SFX_QUIET_WINDOW;
  const sfxPeak = peakDb(o("tiktokSfx"), from, to);
  const bedPeak = peakDb(o("tiktokBed"), from, to);
  expect(sfxPeak < -60, `the SFX master is silent from ${from} to ${to} s where only music would play (peak ${sfxPeak} dB)`);
  expect(bedPeak > -45, `the bed master carries music from ${from} to ${to} s (peak ${bedPeak} dB)`);
  expect(peakDb(o("tiktokSfx"), 0.3, 0.6) > -40, "the SFX master carries the snap at frame 11");
  expect(peakDb(o("tiktokBed"), 0, 22) <= -0.9, "the bed master stays under -1 dBFS sample peak");
  expect(peakDb(o("site"), 0, 30) <= -0.9, "the site film stays under -1 dBFS sample peak");
  for (const stem of ["tiktokSfxStem", "tiktokMusicStem"]) {
    const info = probe(o(stem));
    expect(Math.abs(Number(info.format.duration) - 22) < 0.05, `${OUTPUTS[stem]} lasts 22 s`);
  }
  expect(peakDb(o("tiktokMusicStem"), from, to) > -45, "the music stem carries the bed");
  for (const [name, w, h] of [["sitePoster", 1920, 1080], ["tiktokCover", 1080, 1920]]) {
    const [s] = probe(o(name)).streams;
    expect(s.width === w && s.height === h, `${OUTPUTS[name]} is ${w}x${h}`);
  }
  return { failures, count };
}

// ---------------------------------------------------------------------------------------------
// Runner

function report(label, { failures, count }) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.log(`${label}: ${count - failures.length}/${count} passed`);
}

function runChecks(root, label) {
  const results = [staticChecks(root)];
  report(`${label} static`, results[0]);
  for (const spec of Object.values(PROJECTS)) {
    const check = hyperframesCheck(join(root, spec.dir));
    for (const warning of check.warnings) console.log(`  warning ${spec.id}: ${warning}`);
    const result = { failures: check.ok ? [] : [`${spec.id}: hyperframes check failed: ${check.errors.join("; ") || "see output"}`], count: 1 };
    report(`hyperframes check ${spec.dir} (${CLI}), ${check.errors.length} errors, ${check.warnings.length} warnings`, result);
    results.push(result);
  }
  return results;
}

const total = (results) => ({ exitCode: results.some((r) => r.failures.length) ? 1 : 0, testCount: results.reduce((n, r) => n + r.count, 0) });

export async function run({ command, args = [], root }) {
  const out = resolve(root, args.find((a) => a.startsWith("--out="))?.slice(6) ?? "artifacts/video");
  if (command === "video") return total(runChecks(root, "check:video"));
  if (command === "render-video") {
    const result = render(root, out);
    console.log(`rendered ${Object.keys(result.files).length} files to ${relative(root, out)} (tiktok ${result.tiktokBed.seconds}+${result.tiktokSfxRender.seconds} s, site ${result.site.seconds} s)`);
    return { exitCode: 0, testCount: 0 };
  }
  if (command === "verify-video") {
    const results = runChecks(root, "verify:video");
    const renders = verifyRenders(out);
    report(`renders in ${relative(root, out)}`, renders);
    return total([...results, renders]);
  }
  console.error(`verify-video.mjs does not handle ${command}`);
  return { exitCode: 1, testCount: 0 };
}
