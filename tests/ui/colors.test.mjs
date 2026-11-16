// 1.0's color card: the four colors of the selected theme, saved as an edited copy of a bundled
// theme or in place for a saved one, and Reset to theme back to the bundled theme.
import assert from "node:assert/strict";
import test from "node:test";
import { COPY, colorAction, colorsOf, editedDocument, parseHex, resetTarget } from "../../packages/ui/colors.js";
import { readFileSync } from "node:fs";
import { catalog, CHOOM, CLASSICS } from "../settings/helpers.mjs";

const SUITE = CLASSICS.find((theme) => theme.id === "editing-suite").document;
const LOCAL = "local:00000000-0000-4000-8000-000000000001";
// The bundled Choom Circuit, with its own levels, overrides and backdrops.
const BUNDLED_CHOOM = JSON.parse(readFileSync(new URL("../../themes/anime/choom-circuit.reskin.json", import.meta.url), "utf8"));
const settings = (patch = {}) => ({ revision: 3, enabled: true, selectedThemeId: "editing-suite", customThemes: [], cssConsent: {}, ...patch });

test("hex fields take six digits, with or without the #, and nothing else", () => {
  assert.equal(parseHex("#F2A93B"), "#f2a93b");
  assert.equal(parseHex(" f2a93b "), "#f2a93b");
  for (const bad of ["#f2a93", "#f2a93bb", "f2a93g", "", "amber"]) assert.equal(parseHex(bad), null, bad);
});

test("the card shows a theme's four colors, the graph following the accent unless set", () => {
  assert.deepEqual(colorsOf(SUITE), { background: "#0a0a0b", text: "#ededea", accent: "#f2a93b", contribution: "#f2a93b" });
  const { contribution: _, ...colors } = SUITE.colors;
  assert.equal(colorsOf({ ...SUITE, colors: { ...colors, accent: "#88c0d0" } }).contribution, "#88c0d0");
});

test("a bundled theme's color change saves an edited copy based on it and selects it", () => {
  const action = colorAction(settings(), catalog, "contribution", "#33cc66");
  assert.deepEqual({ ...action, document: undefined }, { type: "saveCustom", document: undefined, basedOn: "editing-suite", select: true });
  assert.equal(action.document.name, COPY.edited("Editing Suite"));
  assert.equal(action.document.colors.contribution, "#33cc66");
  assert.equal(action.document.colors.background, "#0a0a0b");
  // The bundled theme itself is untouched.
  assert.equal(SUITE.colors.contribution, "#f2a93b");
});

test("a saved theme's color change saves it in place, keeping its name and what it was based on", () => {
  const saved = { id: LOCAL, document: { ...structuredClone(SUITE), name: "Mine" }, basedOn: "editing-suite" };
  const action = colorAction(settings({ selectedThemeId: LOCAL, customThemes: [saved] }), catalog, "accent", "#ff5577");
  assert.equal(action.id, LOCAL);
  assert.equal(action.basedOn, "editing-suite");
  assert.equal(action.document.name, "Mine");
  assert.equal(action.document.colors.accent, "#ff5577");
});

test("a background that no longer suits the base switches it, as 1.0 took it from the background", () => {
  assert.equal(editedDocument(SUITE, "background", "#f6f2e8", { copy: false }).base, "light");
  assert.equal(editedDocument(SUITE, "background", "#101010", { copy: false }).base, "dark");
});

test("with no theme there is nothing to edit, and Reset to theme needs a saved theme with a bundled base", () => {
  assert.equal(colorAction(settings({ selectedThemeId: null }), catalog, "accent", "#ff5577"), null);
  assert.equal(resetTarget(settings(), catalog), null);
  assert.equal(resetTarget(settings({ selectedThemeId: null }), catalog), null);
  const saved = { id: LOCAL, document: CHOOM, basedOn: "anime.cyberpunk-edgerunners" };
  assert.equal(resetTarget(settings({ selectedThemeId: LOCAL, customThemes: [saved] }), catalog), "anime.cyberpunk-edgerunners");
  assert.equal(resetTarget(settings({ selectedThemeId: LOCAL, customThemes: [{ id: LOCAL, document: CHOOM }] }), catalog), null);
});

test("a color change drops what the theme set for the colors it derives, as 1.0 derived them", () => {
  // Choom's own levels are regenerated from the new graph color, its cell style kept.
  const graph = editedDocument(BUNDLED_CHOOM, "contribution", "#ff66aa", { copy: true });
  assert.equal(graph.colors.contribution, "#ff66aa");
  assert.equal(graph.contributions.levels.length, 5);
  assert.equal(graph.contributions.levels[4], "#ff66aa");
  assert.notDeepEqual(graph.contributions.levels, BUNDLED_CHOOM.contributions.levels);
  for (const [key, value] of Object.entries(BUNDLED_CHOOM.contributions)) if (key !== "levels") assert.deepEqual(graph.contributions[key], value, key);
  const accent = editedDocument(BUNDLED_CHOOM, "accent", "#ff66aa", { copy: true });
  for (const role of ["link", "focus", "primaryBackground", "primaryText"]) assert.equal(accent.overrides?.[role], undefined, role);
  assert.equal(accent.overrides.surface, BUNDLED_CHOOM.overrides.surface, "the surface follows the background, not the accent");
  const background = editedDocument(BUNDLED_CHOOM, "background", "#101820", { copy: true });
  for (const role of ["surface", "raised", "hover", "inset", "border", "mutedText"]) assert.equal(background.overrides?.[role], undefined, role);
  assert.equal(background.overrides.link, BUNDLED_CHOOM.overrides.link, "the link follows the accent, not the background");
  assert.equal(background.backgrounds.page.color, "#101820");
  assert.equal(background.backgrounds.page.layers.length, BUNDLED_CHOOM.backgrounds.page.layers.length);
  if (BUNDLED_CHOOM.backgrounds.header) assert.equal(background.backgrounds.header?.color, undefined);
});

// A small stand-in for the popup's document: the three parts and the elements mountColors makes.
function fakeDocument() {
  const element = (tag) => {
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      attributes: new Map(),
      value: "",
      disabled: false,
      textContent: "",
      append: (...nodes) => node.children.push(...nodes),
      setAttribute: (name, value) => node.attributes.set(name, String(value)),
      removeAttribute: (name) => node.attributes.delete(name),
      getAttribute: (name) => node.attributes.get(name) ?? null,
      addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      fire: (type) => (listeners.get(type) ?? []).forEach((fn) => fn()),
    };
    return node;
  };
  const parts = { rows: element("div"), reset: element("button"), note: element("p") };
  return { parts, activeElement: null, createElement: element, querySelector: (selector) => parts[/data-rc="(\w+)"/.exec(selector)?.[1]] ?? null };
}

async function mountedCard(storageInit) {
  const { createRepository } = await import("../../packages/settings/index.js");
  const { context, memoryStorage } = await import("../settings/helpers.mjs");
  const { mountColors } = await import("../../packages/ui/colors.js");
  const storage = memoryStorage(storageInit);
  const repository = createRepository(storage, context());
  await repository.initialize();
  let hold = null;
  const host = {
    read: async () => {
      if (hold) await hold.promise;
      return repository.read();
    },
    commit: (action, revision) => repository.commit(action, revision),
    subscribe: () => () => {},
  };
  const doc = fakeDocument();
  const card = mountColors(doc, host, { catalog });
  await card.ready;
  const field = (index) => doc.parts.rows.children[index].children[2];
  return { repository, doc, card, field, holdReads: (deferred) => (hold = deferred), release: () => (hold = null) };
}

test("a change saves on the theme it was made for, and one overtaken by another pick is not saved", async () => {
  const { deferred, picked } = await import("../settings/helpers.mjs");
  const { repository, doc, field, holdReads, release } = await mountedCard(picked("editing-suite"));
  assert.equal(field(0).value, "#0a0a0b");

  // Saved as an edited copy of Editing Suite.
  field(3).value = "#33cc66";
  field(3).fire("change");
  await new Promise((r) => setTimeout(r, 50));
  let { settings } = await repository.read();
  assert.equal(settings.customThemes.length, 1);
  assert.equal(settings.customThemes[0].document.name, "Editing Suite (edited)");
  assert.equal(settings.selectedThemeId, settings.customThemes[0].id);
  assert.equal(doc.parts.note.textContent, "Saved.");

  // A change made on the copy, then Nord is picked elsewhere before the save reads the settings.
  const gate = deferred();
  holdReads(gate);
  field(2).value = "#ff5577";
  field(2).fire("change");
  await repository.commit({ type: "selectTheme", id: "nord" }, settings.revision);
  release();
  gate.resolve();
  await new Promise((r) => setTimeout(r, 50));
  ({ settings } = await repository.read());
  assert.equal(settings.selectedThemeId, "nord");
  assert.equal(settings.customThemes.length, 1, "no Nord copy");
  assert.equal(settings.customThemes[0].document.colors.accent, "#f2a93b", "the copy is unchanged");
  assert.equal(doc.parts.note.textContent, COPY.moved);
});
