// C4's check route: check:migrations and check:boot, dispatched by scripts/check-routes.mjs to this
// module's run({command, args, root, outDir}), which resolves to {exitCode, testCount}. testCount is
// the number of assertions and tests actually run. Node only. Direct use:
//   node packages/settings/checks.mjs <migrations|boot>
//
// migrations  replays tests/fixtures/settings/migrations.json through a real background host on
//             in-memory storage, then runs the settings unit tests for migration and the repository.
// boot        runs the boot record and lifecycle unit tests, then measures the boot gate in real
//             Chromium and Firefox: a stalled boot (CSS only, and the JavaScript watchdog) must
//             release GitHub within 120 ms plus one frame, a healthy boot must end the gate in the
//             same frame its stylesheet lands, and forced colors must bypass the gate.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "../..");
const GATE_MS = 120;

function tally(name) {
  const failures = [];
  let count = 0;
  const check = (ok, message) => {
    count++;
    if (!ok) failures.push(message);
    return ok;
  };
  const done = () => {
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    console.log(`${name}: ${count} checks, ${failures.length} failed`);
    return { exitCode: failures.length ? 1 : 0, testCount: count };
  };
  return { check, done };
}

// Runs unit test files in a child node --test and counts its TAP totals. Any failure, skip, todo or
// file that runs nothing fails.
function unitTests(root, files) {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const total = (name) => Number(result.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN);
  const [tests, pass, fail, skipped, todo] = ["tests", "pass", "fail", "skipped", "todo"].map(total);
  const failures = result.stdout.split("\n").filter((line) => /^\s*not ok /.test(line));
  for (const line of failures) console.error(`  ${line.trim()}`);
  if (result.status !== 0 && !failures.length) console.error(result.stderr || result.stdout.slice(-2000));
  console.log(`unit tests (${files.join(", ")}): ${tests} tests, ${pass} passed, ${fail} failed, ${skipped + todo} skipped`);
  const ok = result.status === 0 && tests > 0 && pass === tests && fail === 0 && skipped === 0 && todo === 0;
  return { exitCode: ok ? 0 : 1, testCount: Number.isFinite(tests) ? tests : 0 };
}

const combine = (...results) => ({ exitCode: results.find((r) => r.exitCode)?.exitCode ?? 0, testCount: results.reduce((n, r) => n + r.testCount, 0) });

async function checkMigrations(root) {
  const { check, done } = tally("check:migrations golden table");
  const { STORAGE_KEYS, LEGACY_STORAGE_KEYS } = await import("../contracts/index.js");
  const { validateSettings, bootRecordProblems, RECOVERY_KEY } = await import("./index.js");
  const { createBackground } = await import("../../extension/background/host.js");
  const { catalog, context, fakeApi, memoryStorage } = await import(pathToFileURL(join(root, "tests/settings/helpers.mjs")).href);
  const { cases } = JSON.parse(readFileSync(join(root, "tests/fixtures/settings/migrations.json"), "utf8"));
  // The spec's table rows, each covered by at least one case.
  const rows = {
    fresh: (c) => c.expect.firstRun,
    "enabled false": (c) => c.raw.enabled === false,
    "legacy palette ID": (c) => typeof c.raw.theme === "string" && catalog.has(c.raw.theme) && !c.raw.custom,
    cyberpunk: (c) => c.raw.theme === "cyberpunk",
    "four-color custom with theme": (c) => c.expect.selectedThemeId === "local" && c.raw.theme,
    "custom without theme": (c) => c.expect.selectedThemeId === "local" && c.raw.theme === undefined,
    "invalid custom, enabled or ID": (c) => c.expect.recovery.length > 0,
  };
  for (const [row, matches] of Object.entries(rows)) check(cases.some(matches), `no case covers the migration row "${row}"`);

  for (const { name, raw, expect } of cases) {
    const storage = memoryStorage(raw);
    const api = fakeApi();
    const background = createBackground({ api, storage, ...context() });
    const opened = await background.handleInstalled({ reason: expect.firstRun ? "install" : "update" });
    const stored = storage.snapshot();
    const result = validateSettings(stored[STORAGE_KEYS.settings], catalog);
    if (!check(result.ok, `${name}: migrated settings do not validate`)) continue;
    const { settings } = result;
    const local = settings.customThemes[0];
    check(settings.enabled === expect.enabled, `${name}: enabled ${settings.enabled}`);
    check(expect.selectedThemeId === "local" ? settings.selectedThemeId === local?.id && local.basedOn === expect.basedOn : settings.selectedThemeId === expect.selectedThemeId, `${name}: selected ${settings.selectedThemeId}`);
    if (local) check(JSON.stringify(local.document.colors) === JSON.stringify(expect.colors) && local.document.base === expect.base, `${name}: local colors or base`);
    check(JSON.stringify(settings.migration.notices) === JSON.stringify(expect.notices), `${name}: notices ${settings.migration.notices}`);
    const recovery = stored[RECOVERY_KEY];
    check(JSON.stringify(recovery ? Object.keys(recovery).filter((k) => k !== "from").sort() : []) === JSON.stringify(expect.recovery), `${name}: recovery keys`);
    check(LEGACY_STORAGE_KEYS.every((key) => !(key in stored)), `${name}: legacy keys remain`);
    check(settings.enabled ? bootRecordProblems(stored[STORAGE_KEYS.boot]).length === 0 : stored[STORAGE_KEYS.boot] === null, `${name}: boot record`);
    check(opened === expect.firstRun && api.tabs.opened.length === (expect.firstRun ? 1 : 0), `${name}: first-run tab`);
    check(!JSON.stringify(stored).includes("github-reskin-css"), `${name}: page cache key leaked into extension storage`);
  }
  return combine(done(), unitTests(root, ["tests/settings/migrate.test.mjs", "tests/settings/repository.test.mjs", "tests/settings/background.test.mjs"]));
}

// ---------------------------------------------------------------------------------------------
// Real-engine boot gate timing.

// Samples every animation frame: document time, the root's computed visibility, the boot marker
// and whether the owned style holds CSS. Records the gate animation's start, and the instant the
// marker changes with whether the style was already there.
const SAMPLER = `
window.__gate = { frames: [], start: null, marks: [] };
new MutationObserver(() => {
  const s = document.getElementById("reskin-style");
  window.__gate.marks.push({ t: performance.now(), boot: document.documentElement.getAttribute("data-reskin-boot"), styled: Boolean(s && s.isConnected && s.textContent) });
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-reskin-boot"] });
(function loop() {
  requestAnimationFrame(() => {
    const g = window.__gate;
    if (g.start === null) {
      const a = document.getAnimations().find((x) => x.animationName === "reskin-boot-gate");
      if (a && a.startTime !== null) g.start = a.startTime;
    }
    const s = document.getElementById("reskin-style");
    g.frames.push({ t: document.timeline.currentTime, visibility: getComputedStyle(document.documentElement).visibility, boot: document.documentElement.getAttribute("data-reskin-boot"), styled: Boolean(s && s.isConnected && s.textContent) });
    if (g.frames.length < 45) loop();
  });
})();`;

function page(bootCss, script) {
  return `<!doctype html><html lang="en" data-color-mode="dark" data-dark-theme="dark" data-light-theme="light"><head><meta charset="utf-8"><title>gate</title>
<style>${bootCss}</style><script>${SAMPLER}</script>${script ? `<script>${script}</script>` : ""}</head>
<body><main><h1>Repository</h1><p>${"Native GitHub text. ".repeat(60)}</p></main></body></html>`;
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function gateScenarios(root, check) {
  const { build } = await import("esbuild");
  const { chromium, firefox } = await import("@playwright/test");
  const { STORAGE_KEYS } = await import("../contracts/index.js");
  const { createRepository } = await import("./index.js");
  const bootCss = readFileSync(join(root, "extension/content/lifecycle/boot.css"), "utf8");
  const bundle = await build({ entryPoints: [join(root, "tests/settings/gate-entry.mjs")], bundle: true, format: "iife", globalName: "ReskinGate", platform: "browser", write: false, logLevel: "silent" });
  const entry = bundle.outputFiles[0].text;
  const { catalog, snapshot } = await import(pathToFileURL(join(root, "tests/settings/gate-entry.mjs")).href);
  const records = {};
  const memory = { get: async (keys) => Object.fromEntries(keys.filter((k) => k in records).map((k) => [k, records[k]])), set: async (r) => Object.assign(records, structuredClone(r)), remove: async () => {}, subscribe: () => () => {} };
  await createRepository(memory, { catalog, snapshot, newId: () => "00000000-0000-4000-8000-000000000001" }).initialize();
  const data = JSON.stringify({ [STORAGE_KEYS.settings]: records[STORAGE_KEYS.settings], [STORAGE_KEYS.boot]: records[STORAGE_KEYS.boot] });

  const scenarios = {
    // Every script stalls or throws: only the finite CSS animation can release GitHub.
    "css-only stall": page(bootCss, "throw new Error('boot script failed');"),
    // Storage never answers: the JavaScript watchdog releases GitHub as well.
    "storage stall": page(bootCss, `${entry}\nwindow.__boot = ReskinGate.boot({}, null);`),
    // Healthy storage answers in 20 ms with a valid snapshot.
    healthy: page(bootCss, `${entry}\nwindow.__boot = ReskinGate.boot(${data}, 20);`),
  };

  for (const type of [chromium, firefox]) {
    const browser = await type.launch();
    try {
      for (const [name, html] of Object.entries(scenarios)) {
        for (const forced of type === chromium ? [false, true] : [false]) {
          if (forced && name !== "css-only stall") continue;
          const label = `${type.name()} ${name}${forced ? " under forced colors" : ""}`;
          const context = await browser.newContext({ ...(forced && { forcedColors: "active" }) });
          const tab = await context.newPage();
          const errors = [];
          tab.on("pageerror", (error) => errors.push(error.message));
          const requests = [];
          await tab.route("**/*", (route) => {
            requests.push(route.request().url());
            return route.request().url() === "http://reskin.test/" ? route.fulfill({ contentType: "text/html", body: html }) : route.abort();
          });
          await tab.goto("http://reskin.test/");
          await tab.waitForFunction(() => window.__gate.frames.length >= 45, null, { timeout: 10000 });
          const gate = await tab.evaluate(() => window.__gate);
          await context.close();
          check(requests.length === 1, `${label}: made ${requests.length - 1} extra requests`);
          const frameMs = median(gate.frames.slice(1).map((f, i) => f.t - gate.frames[i].t));
          const firstVisible = gate.frames.find((f) => f.visibility === "visible");
          if (forced) {
            check(gate.frames[0].visibility === "visible" && gate.start === null, `${label}: the gate ran under forced colors`);
            continue;
          }
          check(firstVisible !== undefined, `${label}: GitHub never became visible`);
          if (name === "healthy") {
            const ready = gate.marks.find((m) => m.boot === "ready");
            check(ready?.styled === true, `${label}: the gate ended before the stylesheet landed`);
            check(gate.frames.every((f) => f.visibility === "hidden" || f.styled), `${label}: a visible frame had no theme`);
            check(ready && gate.start !== null && ready.t - gate.start <= GATE_MS, `${label}: ready after ${ready && (ready.t - gate.start).toFixed(1)} ms`);
            console.log(`  ${label}: ready ${(ready.t - gate.start).toFixed(1)} ms after the gate started, frame ${frameMs.toFixed(1)} ms`);
            continue;
          }
          check(gate.start !== null && gate.frames[0].visibility === "hidden", `${label}: the gate was not active at the first frame`);
          const released = firstVisible.t - gate.start;
          // 120 ms plus one frame, measured on real frames; 1 ms for timer rounding.
          check(released <= GATE_MS + frameMs + 1, `${label}: GitHub released after ${released.toFixed(1)} ms (limit ${(GATE_MS + frameMs).toFixed(1)})`);
          if (name === "storage stall") {
            const timeout = gate.marks.find((m) => m.boot === "timeout");
            check(timeout && !timeout.styled, `${label}: the watchdog did not mark a degraded start`);
            check(timeout && timeout.t - gate.start <= GATE_MS + frameMs + 1, `${label}: watchdog after ${timeout && (timeout.t - gate.start).toFixed(1)} ms`);
          } else check(errors.length === 1, `${label}: expected the deliberate script error`);
          console.log(`  ${label}: visible ${released.toFixed(1)} ms after the gate started, frame ${frameMs.toFixed(1)} ms`);
        }
      }
    } finally {
      await browser.close();
    }
  }
}

async function checkBoot(root) {
  const { check, done } = tally("check:boot browser gate");
  await gateScenarios(root, check);
  return combine(done(), unitTests(root, ["tests/settings/boot.test.mjs", "tests/settings/lifecycle.test.mjs"]));
}

export async function run({ command, args = [], root = DEFAULT_ROOT }) {
  if (args.length) {
    console.error(`${command} takes no arguments (got ${args.join(" ")})`);
    return { exitCode: 1, testCount: 0 };
  }
  if (command === "migrations") return checkMigrations(root);
  if (command === "boot") return checkBoot(root);
  console.error(`packages/settings/checks.mjs does not serve ${command}`);
  return { exitCode: 2, testCount: 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await run({ command: process.argv[2], args: process.argv.slice(3) });
  process.exitCode = result.exitCode;
}
