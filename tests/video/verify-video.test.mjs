// C10's static film checks, without a browser, the Hyperframes CLI or FFmpeg: the committed
// projects pass, and each rule fails on a copy that breaks it.
import assert from "node:assert/strict";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkAssets, checkProject, globToRegExp, linkAssets, PROJECTS, readProject, rightsFor, run, staticChecks, verifyRenders } from "../../scripts/verify-video.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ASSETS = join(ROOT, "video/assets");

// A copy of a committed project whose assets link back to the shared folder; edit changes files.
function withCopy(name, edit, fn) {
  const tmp = mkdtempSync(join(tmpdir(), "reskin-video-test-"));
  try {
    const dir = join(tmp, name);
    cpSync(join(ROOT, PROJECTS[name].dir), dir, { recursive: true, filter: (src) => !src.endsWith("/assets") });
    symlinkSync(ASSETS, join(dir, "assets"));
    edit(dir);
    return fn(checkProject(dir, PROJECTS[name], ASSETS));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const replaceIn = (file, from, to) => {
  const text = readFileSync(file, "utf8");
  assert.ok(text.includes(from), `${file} contains ${from}`);
  writeFileSync(file, text.replace(from, to));
};

const failsWith = (result, pattern) => assert.ok(result.failures.some((f) => pattern.test(f)), `expected a failure matching ${pattern}, got:\n${result.failures.join("\n")}`);

test("both committed films and the asset ledger pass every static check", () => {
  const result = staticChecks(ROOT);
  assert.deepEqual(result.failures, []);
  assert.ok(result.count > 500, `ran ${result.count} assertions`);
});

test("the films are 660 and 900 frames at 30 fps, tiled by scenes that start on frames", () => {
  for (const [name, frames] of [["tiktok", 660], ["site", 900]]) {
    const project = readProject(join(ROOT, PROJECTS[name].dir));
    assert.equal(Number(project.root["data-duration"]) * 30, frames);
    const ends = project.hosts.map((h) => Math.round((Number(h["data-start"]) + Number(h["data-duration"])) * 30));
    assert.equal(Math.max(...ends), frames);
    assert.ok(project.audio.some((a) => a.id === "bed"), `${name} has a bed the SFX master can drop`);
  }
});

test("each project's uncommitted assets link is created when missing and points at video/assets", () => {
  const tmp = mkdtempSync(join(tmpdir(), "reskin-video-link-"));
  try {
    mkdirSync(join(tmp, "video/assets"), { recursive: true });
    for (const spec of Object.values(PROJECTS)) mkdirSync(join(tmp, spec.dir), { recursive: true });
    linkAssets(tmp);
    linkAssets(tmp);
    for (const spec of Object.values(PROJECTS)) {
      const link = join(tmp, spec.dir, "assets");
      assert.ok(lstatSync(link).isSymbolicLink());
      assert.equal(realpathSync(link), realpathSync(join(tmp, "video/assets")));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const spec of Object.values(PROJECTS)) assert.match(readFileSync(join(ROOT, spec.dir, ".gitignore"), "utf8"), /^\/assets$/m);
  assert.ok(existsSync(join(ROOT, "video/tiktok/assets/rights.json")));
});

test("rights patterns match within one path segment", () => {
  assert.ok(globToRegExp("captures/*.png").test("captures/P01-V.png"));
  assert.ok(!globToRegExp("captures/*.png").test("captures/ai/x.png"));
  assert.ok(!globToRegExp("fonts/OFL.txt").test("fonts/OFLxtxt"));
  const rights = [{ patterns: [globToRegExp("audio/*.mp3")] }];
  assert.ok(rightsFor(rights, "audio/sfx-snap.mp3"));
  assert.equal(rightsFor(rights, "audio/other.wav"), undefined);
});

test("a remote or missing media source fails", () => {
  withCopy("tiktok", (dir) => replaceIn(join(dir, "compositions/end.html"), 'src="assets/brand/icon.svg"', 'src="https://example.com/icon.svg"'), (r) => failsWith(r, /is a relative local path/));
  withCopy("site", (dir) => replaceIn(join(dir, "compositions/end.html"), 'src="assets/brand/icon.svg"', 'src="assets/brand/missing.svg"'), (r) => failsWith(r, /missing\.svg exists/));
});

test("wall-clock time, randomness, timers and CSS animation clocks fail", () => {
  withCopy("tiktok", (dir) => replaceIn(join(dir, "compositions/end.html"), "const tl = gsap", "const r = Math.random();\n    const tl = gsap"), (r) => failsWith(r, /no Math\.random/));
  withCopy("site", (dir) => replaceIn(join(dir, "compositions/end.html"), "const tl = gsap", "setTimeout(() => {}, 1);\n    const tl = gsap"), (r) => failsWith(r, /no a timer/));
  withCopy("site", (dir) => replaceIn(join(dir, "compositions/end.html"), "#en-mark {", "#en-mark {\n      animation: spin 1s infinite;"), (r) => failsWith(r, /no a CSS animation clock/));
});

test("a gap between scenes, a wrong duration or an off-frame clip fails", () => {
  withCopy("tiktok", (dir) => replaceIn(join(dir, "index.html"), 'data-composition-id="end" data-composition-src="compositions/end.html" data-start="19.5"', 'data-composition-id="end" data-composition-src="compositions/end.html" data-start="19.6"'), (r) => failsWith(r, /starts at 19\.5 s/));
  withCopy("site", (dir) => replaceIn(join(dir, "index.html"), 'data-start="0"\n      data-duration="30"', 'data-start="0"\n      data-duration="31"'), (r) => failsWith(r, /data-duration is 30 s/));
  withCopy("site", (dir) => replaceIn(join(dir, "compositions/end.html"), 'id="en-card" class="clip" data-start="0" data-duration="4"', 'id="en-card" class="clip" data-start="0" data-duration="3.99"'), (r) => failsWith(r, /clip en-card starts and ends on a frame/));
});

test("audio without an id, a font that is not bundled, and a scene id mismatch fail", () => {
  withCopy("tiktok", (dir) => replaceIn(join(dir, "index.html"), '<audio id="sfx-snap" ', "<audio "), (r) => failsWith(r, /has a unique id/));
  withCopy("site", (dir) => replaceIn(join(dir, "index.html"), 'font-family: "Manrope", sans-serif;', 'font-family: "Comic Sans MS", sans-serif;'), (r) => failsWith(r, /is the bundled Manrope/));
  withCopy("site", (dir) => replaceIn(join(dir, "compositions/code.html"), 'window.__timelines["code"] = tl', 'window.__timelines["other"] = tl'), (r) => failsWith(r, /registers its paused timeline as code/));
});

test("an asset without a rights entry, or an entry that matches nothing, fails", () => {
  const tmp = mkdtempSync(join(tmpdir(), "reskin-video-assets-"));
  try {
    mkdirSync(join(tmp, "audio"));
    mkdirSync(join(tmp, "fonts"));
    writeFileSync(join(tmp, "audio/rights.json"), JSON.stringify({ assets: [] }));
    writeFileSync(join(tmp, "fonts/Manrope-Variable.ttf"), "");
    writeFileSync(join(tmp, "fonts/OFL.txt"), "");
    writeFileSync(join(tmp, "stray.png"), "");
    const entries = [
      { files: ["fonts/*"], license: "OFL-1.1", source: "test" },
      { files: ["brand/*.svg"], license: "x", source: "test" },
    ];
    writeFileSync(join(tmp, "rights.json"), JSON.stringify({ entries }));
    const result = checkAssets(tmp);
    failsWith(result, /stray\.png has a rights entry/);
    failsWith(result, /rights pattern .*brand.* matches a file/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("the committed capture manifests record their source and hash", () => {
  const project = readProject(join(ROOT, "video/tiktok"));
  const html = project.scenes.map((s) => s.html).join("\n");
  const captures = [...new Set([...html.matchAll(/assets\/captures\/([\w-]+)\.png/g)].map((m) => m[1]))];
  assert.ok(captures.length > 10);
  for (const id of captures) {
    const record = JSON.parse(readFileSync(join(ASSETS, "captures", `${id}.json`), "utf8"));
    assert.equal(record.id, id);
    assert.match(record.extension.commit, /^[0-9a-f]{40}$/);
    assert.ok(record.viewport.width > 0 && record.viewport.dpr >= 2, `${id} viewport`);
  }
});

test("verify reports missing renders, and unknown commands fail", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "reskin-video-out-"));
  try {
    const result = verifyRenders(tmp);
    failsWith(result, /github-reskin-tiktok-22s-sfx\.mp4 exists/);
    failsWith(result, /github-reskin-site-30s-poster\.png exists/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const { log, error } = console;
  console.error = () => {};
  try {
    assert.deepEqual(await run({ command: "nope", args: [], root: ROOT }), { exitCode: 1, testCount: 0 });
  } finally {
    Object.assign(console, { log, error });
  }
});
