// 1.0's color card: the four colors of the selected theme, saved as an edited copy of a bundled
// theme or in place for a saved one, and Reset to theme back to the bundled theme.
import assert from "node:assert/strict";
import test from "node:test";
import { COPY, colorAction, colorsOf, editedDocument, parseHex, resetTarget } from "../../packages/ui/colors.js";
import { catalog, CHOOM, CLASSICS } from "../settings/helpers.mjs";

const SUITE = CLASSICS.find((theme) => theme.id === "editing-suite").document;
const LOCAL = "local:00000000-0000-4000-8000-000000000001";
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
