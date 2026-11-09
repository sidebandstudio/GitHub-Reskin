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
const renderer = createRenderer({ github, resources });
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
  // Calm keeps colors and drops decoration; disabled leaves GitHub native.
  const calm = renderer.compile(resolved, plan, prefs({ appearance: "calm", extras: false }));
  assert.match(calm.css, /--bgColor-default:#0a0a17 !important/);
  assert.doesNotMatch(calm.css, /GitHub Reskin appearance/);
  assert.notEqual(calm.fingerprint, full.fingerprint);
  assert.equal(renderer.compile(resolved, plan, prefs({ enabled: false })).css, "");
  // High contrast stays native.
  const contrast = renderer.plan({ native: { colorMode: "dark", lightTheme: "light", darkTheme: "dark_high_contrast", systemDark: true } }, "dark");
  assert.equal(contrast.plan.policy, "native-high-contrast");
  assert.equal(contrast.seed, null);
});

test("a bundled accent font is loaded from the packaged path only when Full and Fonts allow it", () => {
  const document = catalog.document("anime.solo-leveling");
  const { plan, seed } = renderer.plan(renderer.readPage(null, null), document.base);
  const resolved = renderer.resolve(document, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
  assert.notEqual(resolved.font, "system");
  fontUrls.length = 0;
  assert.match(renderer.compile(resolved, plan, prefs()).css, /@font-face/);
  assert.deepEqual(fontUrls, [resolved.font]);
  fontUrls.length = 0;
  assert.doesNotMatch(renderer.compile(resolved, plan, prefs({ fonts: false })).css, /@font-face/);
  assert.doesNotMatch(renderer.compile(resolved, plan, prefs({ appearance: "calm", extras: false })).css, /@font-face/);
  assert.deepEqual(fontUrls, []);
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
