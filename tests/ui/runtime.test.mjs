// The runtime C6 assembles: the embedded catalog, the picker cards, the GitHub renderer and the
// background's boot callbacks, against the real catalog, engine, Primer data and appearance.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_THEME_ID } from "../../packages/contracts/index.js";
import { resolveTheme } from "../../packages/engine/index.js";
import { MODE_INDEX, selectMode, standardSeed } from "../../packages/primer/index.js";
import { bootRecordProblems, buildBootRecord, createCatalogSource, defaultSettings, effectivePreferences, usableSnapshot } from "../../packages/settings/index.js";
import { catalogCards, catalogData, readCatalogEntries } from "../../packages/ui/bundle.mjs";
import { catalogFromData } from "../../packages/ui/catalog.js";
import { backgroundRendering, createRenderer, standardCard } from "../../packages/ui/renderer.js";
import { ROOT } from "../../scripts/build.mjs";

const entries = await readCatalogEntries(ROOT);
const data = catalogData(entries);
const catalog = catalogFromData(structuredClone(data));
const cards = catalogCards(entries);

const fontUrls = [];
const resources = { kind: "test", fontUrl: (id) => (fontUrls.push(id), `chrome-extension://test/assets/fonts/${id}/${id}.woff2`), assetUrl: () => null };
const github = {
  MODE_ATTRIBUTES: ["data-color-mode", "data-light-theme", "data-dark-theme"],
  readNativeMode: () => ({ colorMode: "dark", lightTheme: "light", darkTheme: "dark", systemDark: true }),
  forcedColorsActive: () => false,
  reducedMotion: () => false,
  classifyRoute: () => "profile",
  locateSlots: () => [],
};
const renderer = createRenderer({ github, resources, catalog });
const prefs = (patch = {}) => ({ enabled: true, appearance: "full", extras: true, text: true, motion: true, fonts: true, effects: true, ...patch });

test("the embedded catalog is the validated catalog: same IDs, order, hashes and documents", () => {
  const source = createCatalogSource(entries);
  assert.equal(catalog.hash, source.hash);
  assert.deepEqual(catalog.ids, source.ids);
  assert.equal(catalog.ids.length, 25);
  assert.equal(catalog.ids[0], DEFAULT_THEME_ID);
  assert.deepEqual(catalog.ids.slice(0, 13).map((id) => id.split(".")[0]), Array(13).fill("anime"));
  for (const id of catalog.ids) {
    assert.equal(catalog.sourceHash(id), source.sourceHash(id), id);
    assert.deepEqual(catalog.document(id), source.document(id), id);
    assert.ok(Object.isFrozen(catalog.document(id)), id);
  }
  assert.equal(catalog.has("nope"), false);
  assert.equal(catalog.sourceHash("nope"), null);
  assert.equal(catalog.document("nope"), null);
  // Every bundled css and gradientCss text has a sanitizer proof, so the parser-free viewer entry
  // admits them at runtime.
  const choom = catalog.document(DEFAULT_THEME_ID);
  const kinds = data.cssProofs.map((proof) => proof.kind);
  assert.ok(kinds.includes("css") && kinds.includes("gradientCss"));
  assert.ok(data.cssProofs.some((proof) => proof.kind === "css" && proof.source === choom.css));
  assert.equal(data.cssProofs.filter((p) => p.kind === "gradientCss").length >= choom.backgrounds.page.layers.length, true);
});

test("each card leads with the anime title and carries colors resolved from its theme, not a handwritten palette", () => {
  assert.deepEqual(cards.map((card) => card.id), [...catalog.ids]);
  for (const card of cards) {
    const document = catalog.document(card.id);
    const resolved = resolveTheme(document, { seed: standardSeed(MODE_INDEX, document.base), policy: "themed", reducedMotion: false, forcedColors: false });
    assert.equal(card.name, document.name);
    assert.equal(card.show, document.inspiredBy ?? null);
    assert.equal(card.group, card.id.startsWith("anime.") ? "anime" : "classics");
    assert.equal(card.mini.canvas, resolved.tokens.canvas);
    assert.equal(card.mini.link, resolved.tokens.link);
    assert.equal(card.mini.button, resolved.tokens.primaryBackground);
    assert.deepEqual(card.mini.graph, [...resolved.graph]);
  }
  assert.ok(cards.filter((card) => card.group === "anime").every((card) => card.show), "every anime card names its show");
  const choom = cards[0];
  assert.deepEqual([choom.show, choom.name, choom.mini.canvas, choom.mini.link, choom.mini.graph[4]], ["Cyberpunk: Edgerunners", "Choom Circuit", "#0a0a17", "#fcee0a", "#00f0ff"]);
  // A saved theme gets its card the same way.
  assert.deepEqual(standardCard({ id: "local:x", group: "mine", document: catalog.document("nord") }).mini, cards.find((c) => c.id === "nord").mini);
});

test("the renderer paints Choom Circuit through C3's Primer compiler and C5's appearance", () => {
  const page = renderer.readPage(null, null);
  const { plan, seed } = renderer.plan(page, "dark");
  assert.equal(plan.policy, "themed");
  const choom = catalog.document(DEFAULT_THEME_ID);
  const resolved = renderer.resolve(choom, { seed, policy: plan.policy, reducedMotion: false, forcedColors: false });
  const full = renderer.compile(resolved, plan, prefs());
  assert.match(full.css, /--bgColor-default:#0a0a17 !important/);
  assert.match(full.css, /--fgColor-accent:#fcee0a !important/);
  assert.match(full.css, /GitHub Reskin appearance, renderer 1/);
  // Full: the page grid and header rule as paint layers, owned-node rules, and Choom's own reviewed
  // CSS behind the host scope marker.
  assert.match(full.css, /linear-gradient/);
  assert.match(full.css, /rs-slot--overlay/);
  assert.match(full.css, /\[data-reskin-css="active"\][^{]*\[data-reskin-slot="profile\.tag"\]/);
  // Calm keeps colors and drops layers, decoration and the theme's CSS; disabled leaves GitHub native.
  const calm = renderer.compile(resolved, plan, prefs({ appearance: "calm", extras: false }));
  assert.match(calm.css, /--bgColor-default:#0a0a17 !important/);
  assert.doesNotMatch(calm.css, /linear-gradient|rs-slot--overlay|data-reskin-css=/);
  assert.notEqual(calm.fingerprint, full.fingerprint);
  assert.equal(renderer.compile(resolved, plan, prefs({ enabled: false })).css, "");
  // High contrast stays native.
  const contrast = renderer.plan({ native: { colorMode: "dark", lightTheme: "light", darkTheme: "dark_high_contrast", systemDark: true } }, "dark");
  assert.equal(contrast.plan.policy, "native-high-contrast");
  assert.equal(contrast.seed, null);
});

test("a bundled heading font is loaded from the packaged path in Full and Calm while Fonts is on", () => {
  const document = catalog.document("anime.solo-leveling");
  const { plan, seed } = renderer.plan(renderer.readPage(null, null), document.base);
  const resolved = renderer.resolve(document, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
  assert.notEqual(resolved.font, "system");
  fontUrls.length = 0;
  assert.match(renderer.compile(resolved, plan, prefs()).css, /@font-face/);
  assert.deepEqual(fontUrls, [resolved.font]);
  fontUrls.length = 0;
  assert.doesNotMatch(renderer.compile(resolved, plan, prefs({ fonts: false })).css, /@font-face/);
  assert.doesNotMatch(renderer.compile(resolved, plan, prefs({ appearance: "calm", extras: false, fonts: false })).css, /@font-face/);
  assert.deepEqual(fontUrls, []);
  // Calm keeps role fonts (THEME-EXPANSION.md), so the face its heading rule names is loaded too.
  assert.match(renderer.compile(resolved, plan, prefs({ appearance: "calm", extras: false })).css, /@font-face/);
  assert.deepEqual(fontUrls, [resolved.font]);
});

test("cards carry what Full adds, at miniature scale: wallpaper, heading face, tag, heading addition, glow and rail", () => {
  const choom = cards.find((card) => card.id === DEFAULT_THEME_ID).mini;
  assert.ok(choom.wallpaper.image.includes("linear-gradient"));
  // Choom's 48px grid tiles at 8px; its viewport-tall glow fills the miniature.
  assert.match(choom.wallpaper.size, /^100% 100%,8px 8px,8px 8px,auto$/);
  assert.deepEqual([choom.tag, choom.flourish, choom.glow, choom.rail], ["// choom", "Preem picks", true, true]);
  assert.equal(choom.font.id, null, "a native stack needs no file");
  assert.match(choom.font.stack, /^"Roboto Condensed", /);
  const frieren = cards.find((card) => card.id === "anime.frieren").mini;
  assert.deepEqual([frieren.font.id, frieren.wallpaper, frieren.tag, frieren.glow], ["alegreya", null, "// travel journal", false]);
  for (const card of cards.filter((c) => c.group === "classics")) {
    assert.deepEqual([card.mini.tag, card.mini.flourish, card.mini.wallpaper, card.mini.font], [null, null, null, null], card.id);
  }
});

// Just enough document for decorate's scope marker: the appearance mounts nothing without
// createElement, and forced colors can be flipped as the operating system would.
function forcedColorsPage(forced) {
  const listeners = new Set();
  const attributes = new Map();
  const list = {
    get matches() {
      return forced;
    },
    addEventListener: (type, listener) => listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
  };
  const doc = {
    defaultView: { matchMedia: () => list },
    documentElement: { setAttribute: (name, value) => attributes.set(name, value), removeAttribute: (name) => attributes.delete(name), getAttribute: (name) => attributes.get(name) ?? null },
  };
  doc.body = { ownerDocument: doc, getBoundingClientRect: () => ({}) };
  return {
    doc,
    listeners,
    scope: () => attributes.get("data-reskin-css") ?? null,
    flip(value) {
      forced = value;
      for (const listener of [...listeners]) listener();
    },
  };
}

test("a decoration pass settles style and layout before the adapter's time-limited slot search", () => {
  const order = [];
  const timed = createRenderer({ github: { ...github, locateSlots: () => (order.push("locate"), []) }, resources, catalog });
  const { plan, seed } = timed.plan(renderer.readPage(null, null), "dark");
  const resolved = timed.resolve(catalog.document(DEFAULT_THEME_ID), { seed, policy: plan.policy, reducedMotion: false, forcedColors: false });
  const page = forcedColorsPage(false);
  page.doc.body.getBoundingClientRect = () => (order.push("layout"), {});
  timed.decorate(page.doc, resolved, prefs()).destroy();
  assert.deepEqual(order, ["layout", "locate"]);
});

test("a slot search that gave up on its time limit is tried once more on the next frame, and destroy cancels it", () => {
  let now = 0;
  let calls = 0;
  const slow = createRenderer({
    github: { ...github, locateSlots: () => (calls++, (now += 5), []) },
    resources,
    catalog,
    slotTimeLimitMs: 4,
  });
  const { plan, seed } = slow.plan(renderer.readPage(null, null), "dark");
  const resolved = slow.resolve(catalog.document(DEFAULT_THEME_ID), { seed, policy: plan.policy, reducedMotion: false, forcedColors: false });
  const frames = new Map();
  const page = forcedColorsPage(false);
  Object.assign(page.doc.defaultView, {
    performance: { now: () => now },
    requestAnimationFrame: (callback) => (frames.set(frames.size + 1, callback), frames.size),
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  slow.decorate(page.doc, resolved, prefs());
  assert.equal(calls, 1);
  assert.equal(frames.size, 1, "one retry is queued");
  const queued = [...frames.values()];
  frames.clear();
  for (const callback of queued) callback();
  assert.equal(calls, 2);
  assert.equal(frames.size, 0, "a second give-up is not retried again");

  slow.decorate(page.doc, resolved, prefs()).destroy();
  assert.equal(frames.size, 0, "destroy cancels a queued retry");
  // A fast empty search found nothing to place and is not retried.
  const fast = createRenderer({ github: { ...github, locateSlots: () => (calls++, []) }, resources, catalog, slotTimeLimitMs: 4 });
  fast.decorate(page.doc, resolved, prefs());
  assert.equal(frames.size, 0);
});

test("the theme's CSS scope marker is set only while forced colors are off, and follows them as they change", () => {
  const gated = createRenderer({ github: { ...github, forcedColorsActive: (view) => view.matchMedia("(forced-colors: active)").matches }, resources, catalog });
  const { plan, seed } = gated.plan(renderer.readPage(null, null), "dark");
  const resolved = gated.resolve(catalog.document(DEFAULT_THEME_ID), { seed, policy: plan.policy, reducedMotion: false, forcedColors: false });

  const page = forcedColorsPage(false);
  const decoration = gated.decorate(page.doc, resolved, prefs());
  assert.equal(page.scope(), "active");
  page.flip(true);
  assert.equal(page.scope(), null, "forced colors remove it at once");
  page.flip(false);
  assert.equal(page.scope(), "active", "and it returns with them off");
  decoration.destroy();
  assert.equal(page.scope(), null);
  assert.equal(page.listeners.size, 0, "destroy stops following the mode");

  const forced = forcedColorsPage(true);
  gated.decorate(forced.doc, resolved, prefs()).destroy();
  assert.equal(forced.scope(), null, "never set under forced colors");
  const calm = forcedColorsPage(false);
  gated.decorate(calm.doc, resolved, prefs({ appearance: "calm", extras: false }));
  calm.flip(true);
  calm.flip(false);
  assert.equal(calm.scope(), null, "Calm has no theme CSS to scope");
});

test("the background's boot snapshot is reused by the content script on the common page", () => {
  const { snapshot, repair } = backgroundRendering();
  const settings = defaultSettings(catalog);
  const record = buildBootRecord(settings, { catalog, snapshot });
  assert.deepEqual(bootRecordProblems(record), []);
  const page = renderer.readPage(null, null);
  const { plan, seed } = renderer.plan(page, "dark");
  const current = {
    settingsRevision: settings.revision,
    catalogHash: catalog.hash,
    selectedSourceHash: catalog.sourceHash(settings.selectedThemeId),
    effectivePreferences: effectivePreferences(settings),
    cssConsent: null,
    policy: plan.policy,
    base: "dark",
    seedId: seed.id,
    seedHash: seed.sourceHash,
    motionAllowed: true,
  };
  const reused = usableSnapshot(record, current);
  assert.ok(reused, "the snapshot matches the page");
  assert.equal(renderer.compile(reused, plan, current.effectivePreferences).fingerprint, renderer.compile(renderer.resolve(catalog.document(DEFAULT_THEME_ID), { seed, policy: "themed", reducedMotion: false, forcedColors: false }), plan, current.effectivePreferences).fingerprint);
  // Light themes get the light standard seed; repair uses the same seed.
  const light = catalog.document("anime.frieren");
  assert.equal(snapshot(light).seedId, standardSeed(MODE_INDEX, "light").id);
  assert.equal(repair(light).theme.base, "light");
  assert.equal(selectMode({ colorMode: "light", lightTheme: "light", darkTheme: "dark", systemDark: false }, "light", MODE_INDEX).policy, "themed");
});
