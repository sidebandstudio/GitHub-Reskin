// The builder's pure draft: edits touch only their own path, invalid values never replace the last
// valid document, one-change Undo, the base switch and its one-tap fix, effects capped at three,
// and the recoverable draft record.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { basePolarityIssue } from "../../packages/engine/index.js";
import { COPY, addLayer, commitEdit, copyName, createDraft, draftFromRecord, draftRecord, fixBase, freshDocument, removeLayer, setCss, setEffect, setField, setFlavorSlot, setGraphLevel, switchBase, undo, valueAt, withValue } from "../../packages/ui/draft.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/schema/valid/${name}`, import.meta.url), "utf8"));
const RICH = fixture("ai-rich.reskin.json");
const IMAGES = fixture("embedded-images.reskin.json");
const CHOOM = fixture("choom-circuit.reskin.json");
const THREE = { schemaVersion: 1, name: "Moss", base: "dark", colors: { background: "#18212b", text: "#e6edf3", accent: "#7fbf7f" } };

test("withValue sets a nested path and removal prunes the objects it empties", () => {
  const set = withValue(THREE, "/code/syntax/keyword", "#ff00ff");
  assert.equal(valueAt(set, "/code/syntax/keyword"), "#ff00ff");
  assert.equal(THREE.code, undefined, "the input is not mutated");
  assert.deepEqual(withValue(set, "/code/syntax/keyword", undefined), THREE);
  assert.deepEqual(withValue(THREE, "/shape/corners/radius", undefined), THREE);
});

test("changing Background keeps code, images, CSS and every other field exactly", () => {
  for (const theme of [RICH, IMAGES, CHOOM]) {
    const result = setField(theme, "/colors/background", "#101820");
    assert.equal(result.ok, true, result.message);
    const { colors: before, ...restBefore } = theme;
    const { colors: after, ...restAfter } = result.document;
    assert.deepEqual(restAfter, restBefore);
    assert.deepEqual({ ...after, background: before.background }, before);
  }
});

test("an invalid value is refused with a message and the document stays", () => {
  const bad = setField(RICH, "/shape/corners/radius", 5000);
  assert.equal(bad.ok, false);
  assert.match(bad.path, /\/shape\/corners\/radius/);
  assert.equal(setField(THREE, "/colors/accent", "#12").ok, false);
  assert.equal(setField(THREE, "/name", "").ok, false);
});

test("a graph style creates contributions from the levels the preview shows, and levels edit one at a time", () => {
  const levels = ["#111111", "#333333", "#555555", "#777777", "#999999"];
  assert.equal(setField(THREE, "/contributions/cellStyle", "round").ok, false, "no levels to start from");
  const styled = setField(THREE, "/contributions/cellStyle", "round", { levels });
  assert.deepEqual(styled.document.contributions, { levels, cellStyle: "round" });
  const one = setGraphLevel(styled.document, 4, "#ffffff", levels);
  assert.deepEqual(one.document.contributions.levels, [...levels.slice(0, 4), "#ffffff"]);
  // An imported theme's own levels are the starting point, never the preview's.
  const imported = setGraphLevel(CHOOM, 0, "#000001", levels);
  assert.deepEqual(imported.document.contributions.levels, ["#000001", ...CHOOM.contributions.levels.slice(1)]);
  assert.deepEqual({ ...imported.document.contributions, levels: null }, { ...CHOOM.contributions, levels: null });
});

test("one-change Undo restores the previous document once; there is no Redo", () => {
  let draft = createDraft({ document: THREE, basedOn: "anime.frieren" });
  assert.equal(undo(draft), draft);
  draft = commitEdit(draft, setField(draft.document, "/colors/accent", "#ff0000").document);
  draft = commitEdit(draft, setField(draft.document, "/colors/text", "#ffffff").document);
  const undone = undo(draft);
  assert.equal(undone.document.colors.text, THREE.colors.text);
  assert.equal(undone.document.colors.accent, "#ff0000", "only the last change is undone");
  assert.equal(undone.previous, null);
  assert.equal(undo(undone), undone);
  // An edit that changes nothing is not a change.
  assert.equal(commitEdit(undone, undone.document), undone);
  // Undo restores whether CSS was enabled and which saved theme the draft edited.
  const imported = commitEdit({ ...undone, savedId: "local:x", cssEnabled: true }, RICH, { cssEnabled: false, savedId: null });
  assert.deepEqual([undo(imported).savedId, undo(imported).cssEnabled], ["local:x", true]);
});

test("switching Light or Dark proposes a readable variation, and the base fix is one tap", () => {
  const light = switchBase(THREE, "light");
  assert.equal(light.ok, true);
  assert.equal(light.document.base, "light");
  assert.deepEqual([light.document.colors.background, light.document.colors.text], [THREE.colors.text, THREE.colors.background]);
  assert.equal(light.note, COPY.baseSwapped);
  assert.equal(basePolarityIssue(light.document), null);
  // Colors that already suit the other base are only switched.
  const contradicted = { ...THREE, base: "light" };
  assert.ok(basePolarityIssue(contradicted));
  const fixed = fixBase(contradicted);
  assert.deepEqual(fixed.document, THREE);
});

test("effects: schema defaults on, imported parameters kept until removed, at most three", () => {
  let doc = THREE;
  for (const id of ["glow", "grid", "rail"]) doc = setEffect(doc, id, true).document;
  assert.deepEqual(doc.effects, { glow: {}, grid: {}, rail: {} });
  const fourth = setEffect(doc, "echo", true);
  assert.deepEqual([fourth.ok, fourth.message], [false, "Choose up to 3 effects. Turn one off first."]);
  const params = { ...THREE, effects: { scanlines: { opacity: 0.03, spacing: 4 } } };
  assert.deepEqual(setEffect(params, "scanlines", true).document, params);
  assert.equal(setEffect(params, "scanlines", false).document.effects, undefined);
});

test("flavor slots: empty text omits the slot", () => {
  const tagged = setFlavorSlot(THREE, "profile.tag", "// moss");
  assert.deepEqual(tagged.document.flavor, { slots: { "profile.tag": "// moss" } });
  assert.deepEqual(setFlavorSlot(tagged.document, "profile.tag", "  ").document, THREE);
});

test("CSS edits and background layers", () => {
  assert.equal(setCss(THREE, ".AppHeader { box-shadow: 0 1px 0 var(--reskin-accent); }").ok, true);
  assert.equal(setCss(THREE, ".x { background: url(https://example.com/a.png) }").ok, false);
  assert.deepEqual(setCss(RICH, "").document.css, undefined);
  let doc = THREE;
  for (let i = 0; i < 4; i++) doc = addLayer(doc, "page", { pattern: { kind: "grid", color: "#7fbf7f", opacity: 0.05, size: 32 } }).document;
  assert.equal(addLayer(doc, "page", { pattern: { kind: "dots", color: "#7fbf7f" } }).ok, false);
  doc = removeLayer(doc, "page", 0).document;
  assert.equal(doc.backgrounds.page.layers.length, 3);
  for (let i = 0; i < 3; i++) doc = removeLayer(doc, "page", 0).document;
  assert.deepEqual(doc, THREE);
});

test("the recoverable draft record round-trips without Undo history and rejects anything invalid", () => {
  const draft = commitEdit(createDraft({ document: THREE, basedOn: "anime.frieren", cssEnabled: false }), RICH, { cssEnabled: true });
  const record = draftRecord(draft, { baseRevision: 7, now: 1000 });
  assert.deepEqual(Object.keys(record).sort(), ["baseRevision", "basedOn", "cssEnabled", "document", "draftVersion", "updatedAt"]);
  const restored = draftFromRecord(JSON.parse(JSON.stringify(record)));
  assert.deepEqual([restored.document, restored.basedOn, restored.cssEnabled, restored.previous, restored.baseRevision], [RICH, "anime.frieren", true, null, 7]);
  assert.equal(draftFromRecord(null), null);
  assert.equal(draftFromRecord({ ...record, draftVersion: 2 }), null);
  assert.equal(draftFromRecord({ ...record, document: { ...THREE, colors: {} } }), null);
});

test("a copy's suggested name", () => {
  assert.equal(copyName("Choom Circuit"), "My Choom Circuit");
  assert.equal(copyName("My Choom Circuit"), "My Choom Circuit");
  assert.equal(copyName("x".repeat(64)).length, 64);
});

test("a new three-color theme carries only its three colors, so nothing of the theme they came from outweighs them", async () => {
  const { resolveTheme } = await import("../../packages/engine/index.js");
  const seed = JSON.parse(readFileSync(new URL("../fixtures/seeds/standard-dark.json", import.meta.url), "utf8"));
  const fresh = freshDocument(CHOOM);
  assert.deepEqual(fresh, { schemaVersion: 1, name: "My theme", base: CHOOM.base, colors: { background: CHOOM.colors.background, text: CHOOM.colors.text, accent: CHOOM.colors.accent } });
  const mine = withValue(withValue(withValue(fresh, "/colors/background", "#161421"), "/colors/text", "#f5ecff"), "/colors/accent", "#ff9fbf");
  const options = { seed, policy: "themed", reducedMotion: false, forcedColors: false };
  const resolved = resolveTheme(mine, options);
  assert.equal(resolved.tokens.canvas, "#161421");
  assert.equal(resolved.tokens.accent, "#ff9fbf");
  assert.deepEqual(resolved.effects, {});
  // Its graph follows Accent; a remix of Choom keeps Choom's own, whatever Accent says.
  const remix = resolveTheme(withValue(CHOOM, "/colors/accent", "#ff9fbf"), options);
  assert.notDeepEqual(resolved.graph, remix.graph);
  assert.deepEqual(remix.graph, resolveTheme(CHOOM, options).graph);
  assert.notDeepEqual(resolved.graph, resolveTheme(withValue(mine, "/colors/accent", "#33ccaa"), options).graph);
  // The draft remembers it is new through Undo and a kept record.
  const draft = commitEdit(createDraft({ document: fresh, basedOn: "anime.cyberpunk-edgerunners", fresh: true }), CHOOM, { fresh: false });
  assert.equal(undo(draft).fresh, true);
  const record = draftRecord(createDraft({ document: fresh, basedOn: "anime.cyberpunk-edgerunners", fresh: true }), { now: 1 });
  assert.equal(record.fresh, true);
  assert.equal(draftFromRecord(JSON.parse(JSON.stringify(record))).fresh, true);
});
