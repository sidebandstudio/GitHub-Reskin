// The content script's sanitizer arrives only when a page needs it. Its bundle leaves out
// packages/format/authoring.js (packages/ui/bundle.mjs), so this file loads the lifecycle the same
// way and installs the sanitizer the way extension/content/index.mjs does. The tests run in order:
// the sanitizer, once installed, stays.
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
const { catalog, CLASSICS, fakePage, memoryStorage, testRenderer } = await import("./helpers.mjs");

const nord = CLASSICS.find((theme) => theme.id === "nord").document;
const SAVED = "local:00000000-0000-4000-8000-000000000001";
const withCss = { ...nord, name: "Mine", css: ".AppHeader { box-shadow: 0 1px 0 var(--reskin-accent); }" };

function settingsWith({ selected }) {
  const settings = defaultSettings(catalog);
  settings.customThemes = [{ id: SAVED, document: withCss }];
  settings.selectedThemeId = selected;
  return { [STORAGE_KEYS.settings]: settings };
}

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

test("a sanitizer that fails to load leaves GitHub native rather than drawing unchecked CSS", async () => {
  const { page, events, content } = start(settingsWith({ selected: SAVED }), async () => {
    throw new Error("the parser chunk is missing");
  });
  assert.equal(await content.ready, "native");
  assert.equal(page.style(), null);
  assert.ok(events.some((e) => e.type === "error"));
  content.destroy();
});

test("the selected saved theme's CSS loads the sanitizer once, before the page reads its settings again", async () => {
  const { page, content } = start(settingsWith({ selected: SAVED }), install);
  assert.equal(await content.ready, "ready");
  assert.ok(page.style());
  assert.deepEqual(loads, ["load"]);
  const again = start(settingsWith({ selected: SAVED }), install);
  assert.equal(await again.content.ready, "ready");
  assert.deepEqual(loads, ["load"], "installed once for the page's lifetime");
  content.destroy();
  again.content.destroy();
});
