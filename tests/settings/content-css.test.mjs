// The content script's sanitizer arrives only when a page needs it. Its bundle leaves out
// packages/format/authoring.js (packages/ui/bundle.mjs), so this file loads the lifecycle the same
// way and installs the sanitizer the way extension/content/index.mjs does. The tests run in order:
// the sanitizer, once installed, stays.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import assert from "node:assert/strict";

registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    return result.url.endsWith("/packages/format/authoring.js") ? { url: "data:text/javascript,", shortCircuit: true } : result;
  },
});

const { LIMITS, STORAGE_KEYS } = await import("../../packages/contracts/index.js");
const { cssSanitizerInstalled, installCssSanitizer } = await import("../../packages/format/css/admission.js");
const { admitGradientCss, sanitizeCss, useCssParser } = await import("../../packages/format/css/sanitize.js");
const { defaultSettings } = await import("../../packages/settings/index.js");
const { startContent } = await import("../../extension/content/lifecycle/index.js");
const { catalog, deferred, fakePage, memoryStorage, testRenderer } = await import("./helpers.mjs");

// Choom Circuit as a saved theme: Advanced CSS, and backgrounds whose only layers are gradients.
const choom = JSON.parse(readFileSync(new URL("../../themes/anime/choom-circuit.reskin.json", import.meta.url), "utf8"));
const SAVED = "local:00000000-0000-4000-8000-000000000001";
const withCss = { ...choom, name: "Mine" };

// Advanced CSS, and backgrounds that are gradients only, without a color.
const gradientsOnly = { ...withCss, backgrounds: Object.fromEntries(Object.entries(choom.backgrounds).map(([target, { layers }]) => [target, { layers }])) };

function settingsWith({ selected, document = withCss }) {
  const settings = defaultSettings(catalog);
  settings.customThemes = [{ id: SAVED, document }];
  settings.selectedThemeId = selected;
  return { [STORAGE_KEYS.settings]: settings };
}

const phase = (page) => page.root.getAttribute("data-reskin-boot");

function start(records, loadCssSanitizer) {
  const page = fakePage();
  const events = [];
  const content = startContent({ storage: memoryStorage(records), document: page.document, view: page.view, catalog, renderer: testRenderer({ clock: page.clock }), loadCssSanitizer, onEvent: (e) => events.push(e) });
  return { page, events, content };
}

// The background's boot record for `settings`, built in a worker, which loads the settings package
// with its sanitizer as the background does. This thread keeps it uninstalled.
async function backgroundBoot(settings) {
  const code = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      const { buildBootRecord } = await import(workerData.settings);
      const { catalog, snapshot } = await import(workerData.helpers);
      parentPort.postMessage(buildBootRecord(workerData.value, { catalog, snapshot }));
    })();`;
  const at = (path) => new URL(path, import.meta.url).href;
  const worker = new Worker(code, { eval: true, workerData: { settings: at("../../packages/settings/index.js"), helpers: at("./helpers.mjs"), value: settings } });
  const [record] = await once(worker, "message");
  await worker.terminate();
  return record;
}

const loads = [];
const install = async () => {
  loads.push("load");
  useCssParser(await import("css-tree/dist/csstree.esm"));
  installCssSanitizer({ sanitizeCss, admitGradientCss });
};

test("a bundled theme, beside a saved theme with CSS, needs no sanitizer", async () => {
  assert.equal(cssSanitizerInstalled(), false);
  const { content } = start(settingsWith({ selected: "nord" }), install);
  assert.equal(await content.ready, "ready");
  assert.deepEqual(loads, []);
  content.destroy();
});

test("while the sanitizer loads, the page gets the saved theme without its CSS; one that fails to load leaves it so, never with unchecked CSS", async () => {
  let fail;
  const { page, events, content } = start(settingsWith({ selected: SAVED }), () => new Promise((_resolve, reject) => (fail = reject)));
  assert.equal(await content.ready, "ready", "themed before the parser arrives");
  assert.ok(page.style());
  assert.ok(events.some((e) => e.type === "without-css"));
  fail(new Error("the parser chunk is missing"));
  await page.settle();
  assert.ok(events.some((e) => e.type === "error"));
  assert.equal(phase(page), "ready", "still themed");
  assert.ok(page.style());
  assert.equal(cssSanitizerInstalled(), false);
  content.destroy();
});

test("a saved theme whose backgrounds are only gradients is painted without them while the parser loads, and stays so if it fails", { timeout: 5000 }, async () => {
  for (const outcome of ["pending", "failed"]) {
    let fail;
    const { page, events, content } = start(settingsWith({ selected: SAVED, document: gradientsOnly }), () => new Promise((_resolve, reject) => (fail = reject)));
    assert.equal(await content.ready, "ready", outcome);
    assert.ok(events.some((e) => e.type === "without-css"), outcome);
    if (outcome === "failed") {
      fail(new Error("the parser chunk is missing"));
      await page.settle();
    }
    await page.advance(200);
    assert.equal(phase(page), "ready", `${outcome}: still themed past the watchdog`);
    assert.ok(page.style(), outcome);
    content.destroy();
  }
});

test("settings too malformed to read release GitHub, even with a parser to load", { timeout: 5000 }, async () => {
  const records = settingsWith({ selected: SAVED });
  records[STORAGE_KEYS.settings] = { ...records[STORAGE_KEYS.settings], enabled: false, customThemes: { find: 42 } };
  const { page, content } = start(records, install);
  assert.equal(await content.ready, "native");
  assert.equal(page.style(), null);
  assert.deepEqual(loads, []);
  content.destroy();
});

test("the selected saved theme's CSS loads the sanitizer once, the page reads its settings again with it, and decorates again", async () => {
  // Both paints draw the boot snapshot of the whole theme, and the pass without the CSS, run before
  // the parser arrives, spends the whole decoration budget.
  const records = settingsWith({ selected: SAVED });
  records[STORAGE_KEYS.boot] = await backgroundBoot(records[STORAGE_KEYS.settings]);
  assert.ok(records[STORAGE_KEYS.boot]);
  const parser = deferred();
  const page = fakePage({ idleCallbacks: true });
  const renderer = testRenderer({ clock: page.clock });
  // As in the extension's renderer, the stylesheet and admission follow whether the CSS is drawn.
  const drawn = (context) => typeof context?.source?.css === "string";
  const { compile } = renderer;
  renderer.compile = (resolved, plan, prefs, context) => {
    const compiled = compile(resolved, plan, prefs);
    return { ...compiled, fingerprint: `${compiled.fingerprint}:${drawn(context)}` };
  };
  const decorated = [];
  renderer.decorate = (_document, _resolved, _prefs, context) => {
    decorated.push(drawn(context));
    page.clock.now += LIMITS.maxNavigationMs;
    return { destroy() {} };
  };
  const events = [];
  const content = startContent({ storage: memoryStorage(records), document: page.document, view: page.view, catalog, renderer, loadCssSanitizer: () => parser.promise.then(install), onEvent: (e) => events.push(e) });
  assert.equal(await content.ready, "ready");
  page.document.readyState = "interactive";
  page.fire("document", "DOMContentLoaded");
  await page.idle();
  await page.frame();
  assert.deepEqual(decorated, [false], "decorated without the CSS while the parser loads");
  parser.resolve();
  for (let i = 0; i < 20 && !cssSanitizerInstalled(); i++) await page.settle();
  await page.settle();
  assert.equal(cssSanitizerInstalled(), true);
  // Drawn twice: without the CSS while the parser loaded, then the whole theme.
  assert.deepEqual(events.filter((e) => e.type === "resolved").map((e) => e.from), ["snapshot", "snapshot"]);
  await page.idle();
  await page.frame();
  assert.deepEqual(decorated, [false, true], "decorated again with the CSS");
  assert.ok(page.style());
  assert.deepEqual(loads, ["load"]);
  const again = start(settingsWith({ selected: SAVED }), install);
  assert.equal(await again.content.ready, "ready");
  assert.deepEqual(loads, ["load"], "installed once for the page's lifetime");
  content.destroy();
  again.content.destroy();
});
