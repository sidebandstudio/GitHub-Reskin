// The content script's sanitizer arrives only when a page needs it. Its bundle leaves out
// packages/format/authoring.js (packages/ui/bundle.mjs), so this file loads the lifecycle the same
// way and installs the sanitizer the way extension/content/index.mjs does. The tests run in order:
// the sanitizer, once installed, stays.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    return result.url.endsWith("/packages/format/authoring.js") ? { url: "data:text/javascript,", shortCircuit: true } : result;
  },
});

const { STORAGE_KEYS } = await import("../../packages/contracts/index.js");
const { cssSanitizerInstalled, installCssSanitizer } = await import("../../packages/format/css/admission.js");
const { admitGradientCss, sanitizeCss, useCssParser } = await import("../../packages/format/css/sanitize.js");
const { defaultSettings } = await import("../../packages/settings/index.js");
const { startContent } = await import("../../extension/content/lifecycle/index.js");
const { catalog, fakePage, memoryStorage, testRenderer } = await import("./helpers.mjs");

// Choom Circuit as a saved theme: Advanced CSS, and backgrounds whose only layers are gradients.
const choom = JSON.parse(readFileSync(new URL("../../themes/anime/choom-circuit.reskin.json", import.meta.url), "utf8"));
const SAVED = "local:00000000-0000-4000-8000-000000000001";
const withCss = { ...choom, name: "Mine" };

function settingsWith({ selected }) {
  const settings = defaultSettings(catalog);
  settings.customThemes = [{ id: SAVED, document: withCss }];
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

test("the selected saved theme's CSS loads the sanitizer once, and the page reads its settings again with it", async () => {
  const { page, events, content } = start(settingsWith({ selected: SAVED }), install);
  assert.equal(await content.ready, "ready");
  for (let i = 0; i < 20 && !cssSanitizerInstalled(); i++) await page.settle();
  await page.settle();
  assert.equal(cssSanitizerInstalled(), true);
  // Drawn twice: without the CSS while the parser loaded, then the whole theme.
  assert.equal(events.filter((e) => e.type === "resolved").length, 2);
  assert.ok(page.style());
  assert.deepEqual(loads, ["load"]);
  const again = start(settingsWith({ selected: SAVED }), install);
  assert.equal(await again.content.ready, "ready");
  assert.deepEqual(loads, ["load"], "installed once for the page's lifetime");
  content.destroy();
  again.content.destroy();
});
