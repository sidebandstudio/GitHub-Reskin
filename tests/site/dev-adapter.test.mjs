// TEMPORARY: the site/dev stand-ins keep the frozen contract shapes while the shell is built.
// Phase 2 deletes this file with site/dev.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_PREFERENCES, DORMANT_SLOTS, VIEWS, contrast, mountPreview, resolvePreview } from "../../site/dev/preview-adapter.mjs";
import { SAMPLE_ANSWER, parseImport } from "../../site/dev/importer.mjs";
import { CATALOG } from "../../site/dev/catalog.mjs";

const choom = CATALOG.find((t) => t.slug === "choom-circuit").doc;

describe("preview adapter", () => {
  test("uses the frozen views and preference keys", () => {
    assert.deepEqual([...VIEWS], ["profile", "repo", "diff", "empty", "404"]);
    assert.deepEqual(Object.keys(DEFAULT_PREFERENCES).sort(), ["effects", "enabled", "extras", "fonts", "motion", "text"]);
  });

  test("themes the preview from the document and keeps text readable", () => {
    for (const { slug, doc } of CATALOG) {
      const { vars, attrs } = resolvePreview(doc);
      assert.equal(vars["--pv-canvas"], doc.colors.background, slug);
      assert.equal(attrs["data-state"], "themed");
      assert.ok(contrast(vars["--pv-text"], vars["--pv-canvas"]) >= 4.5, `${slug} text`);
      assert.ok(contrast(vars["--pv-muted"], vars["--pv-surface"]) >= 4.5, `${slug} muted`);
      assert.ok(contrast(vars["--pv-link"], vars["--pv-surface"]) >= 4.5, `${slug} link`);
    }
  });

  test("Before shows GitHub's default colors without extras", () => {
    const state = resolvePreview(choom, DEFAULT_PREFERENCES, { before: true });
    assert.equal(state.vars["--pv-canvas"], "#0d1117");
    assert.equal(state.attrs["data-fx"], "");
    assert.deepEqual(state.flavor, {});
  });

  test("Flavor extras off keeps colors and removes text, effects and accent font", () => {
    const off = resolvePreview(choom, { ...DEFAULT_PREFERENCES, extras: false });
    assert.equal(off.vars["--pv-canvas"], choom.colors.background);
    assert.deepEqual(off.flavor, {});
    assert.equal(off.attrs["data-fx"], "");
    assert.match(off.vars["--pv-accent-font"], /^system-ui/);
  });

  test("dormant slots stay out of the preview", () => {
    const { flavor } = resolvePreview(choom);
    assert.equal(flavor["profile.tag"], "// choom view");
    for (const slot of DORMANT_SLOTS) assert.equal(flavor[slot], undefined);
  });

  test("reduced motion turns motion off", () => {
    assert.equal(resolvePreview(choom, DEFAULT_PREFERENCES, { reducedMotion: true }).attrs["data-motion"], "off");
  });

  test("mountPreview returns the PreviewHandle methods and rejects unknown views", () => {
    assert.throws(() => mountPreview({}, { view: "settings", theme: choom, preferences: DEFAULT_PREFERENCES }), /Unknown preview view/);
  });
});

describe("importer stand-in", () => {
  test("reads a fenced JSONC chatbot answer", () => {
    const result = parseImport(SAMPLE_ANSWER);
    assert.equal(result.ok, true);
    assert.equal(result.normalized.name, "Harbor Dawn");
    assert.deepEqual(Object.keys(result).sort(), ["normalized", "notes", "ok", "source"]);
  });

  test("normalizes short hex and reports it", () => {
    const result = parseImport('{"schemaVersion":1,"name":"X","base":"dark","colors":{"background":"#000","text":"#FFFFFF","accent":"#f80"}}');
    assert.equal(result.normalized.colors.background, "#000000");
    assert.ok(result.notes.length >= 2);
  });

  test("offers a choice between two themes instead of guessing", () => {
    const one = '{"name":"A","base":"dark","colors":{"background":"#000000","text":"#ffffff","accent":"#ff0000"}}';
    const result = parseImport(`${one}\n${one.replace('"A"', '"B"')}`);
    assert.equal(result.ok, false);
    assert.deepEqual(result.candidates.map((c) => c.name), ["A", "B"]);
  });

  test("explains missing fields in plain words", () => {
    const result = parseImport('{"name":"A","colors":{"background":"blue"}}');
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.path === "/base"));
    assert.ok(result.issues.some((i) => /hex color/.test(i.message)));
  });

  test("ignores braces inside strings and comments", () => {
    const result = parseImport('Sure! // {not this}\n```json\n{"name":"Brace } test","base":"light","colors":{"background":"#ffffff","text":"#111111","accent":"#0055aa"}}\n```');
    assert.equal(result.ok, true);
    assert.equal(result.normalized.name, "Brace } test");
  });
});
