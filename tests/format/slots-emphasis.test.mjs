import assert from "node:assert/strict";
import { test } from "node:test";
import { FLAVOR_SLOT_IDS, ISSUE_CODES, OVERRIDE_COLOR_ROLES } from "../../packages/contracts/index.js";
import { decodeShare, encodeShare, exportTheme, FLAVOR_SLOTS, makeAiPrompt, parseImport, validateTheme } from "../../packages/format/index.js";

const MINIMAL = { schemaVersion: 1, name: "Probe", base: "dark", colors: { background: "#0a0a17", text: "#e4f3ff", accent: "#fcee0a" } };
const NEW_SLOTS = ["footer.signoff", "profile.achievements.heading"];
const roundTrip = (theme) => {
  const bytes = exportTheme(theme).bytes;
  const file = parseImport(bytes, "file");
  const code = encodeShare(theme);
  const share = decodeShare(code);
  assert.ok(file.ok && share.ok);
  assert.deepEqual(exportTheme(file.normalized).bytes, bytes);
  assert.equal(encodeShare(share.normalized), code);
  return file.normalized;
};

test("the two new slots are appended after the frozen eight with the heading limit", () => {
  assert.deepEqual(FLAVOR_SLOT_IDS.slice(-2), NEW_SLOTS);
  assert.equal(FLAVOR_SLOT_IDS.length, 10);
  for (const id of NEW_SLOTS) assert.deepEqual(FLAVOR_SLOTS[id], FLAVOR_SLOTS["profile.pinned.heading"], id);
  for (const id of NEW_SLOTS) assert.ok(makeAiPrompt().includes(id), id);
});

test("footer.signoff and profile.achievements.heading are accepted and round-trip", () => {
  const theme = { ...MINIMAL, flavor: { enabled: true, locale: "en", slots: { "footer.signoff": "Stay preem, choom.", "profile.achievements.heading": "x".repeat(40) } } };
  assert.ok(validateTheme(theme).ok);
  assert.deepEqual(roundTrip(theme).flavor, theme.flavor);
});

test("the new slots keep the heading length and charset limits", () => {
  for (const id of NEW_SLOTS) {
    for (const [text, code] of [["x".repeat(41), ISSUE_CODES.outOfBounds], ["", ISSUE_CODES.outOfBounds], ["<b>", null], ["a‮b", null], ["two\nlines", null]]) {
      const result = validateTheme({ ...MINIMAL, flavor: { slots: { [id]: text } } });
      assert.ok(!result.ok, `${id} ${JSON.stringify(text)}`);
      assert.equal(result.issues[0].path, `/flavor/slots/${id}`);
      if (code) assert.equal(result.issues[0].code, code, `${id} ${JSON.stringify(text)}`);
    }
  }
});

test("an unknown slot is still rejected, including the dormant candidates", () => {
  for (const id of ["repository.releases.heading", "profile.followers.heading", "footer.signOff", "footer"]) {
    const result = validateTheme({ ...MINIMAL, flavor: { slots: { [id]: "Plain words" } } });
    assert.ok(!result.ok, id);
    assert.deepEqual([result.issues[0].code, result.issues[0].path], [ISSUE_CODES.unknownField, `/flavor/slots/${id}`]);
  }
});

test("overrides.accentEmphasis is an optional override color that normalizes and round-trips", () => {
  assert.equal(OVERRIDE_COLOR_ROLES[OVERRIDE_COLOR_ROLES.indexOf("accentMuted") + 1], "accentEmphasis");
  const theme = { ...MINIMAL, overrides: { accentEmphasis: "#007880" } };
  assert.ok(validateTheme(theme).ok);
  assert.deepEqual(roundTrip(theme).overrides, { accentEmphasis: "#007880" });
  const pasted = parseImport(JSON.stringify({ ...MINIMAL, overrides: { accentEmphasis: "#00788F" } }), "text");
  assert.ok(pasted.ok);
  assert.equal(pasted.normalized.overrides.accentEmphasis, "#00788f");
  for (const bad of ["teal", "#0078", "#00788080"]) {
    const result = validateTheme({ ...MINIMAL, overrides: { accentEmphasis: bad } });
    assert.deepEqual([result.ok, result.issues[0]?.path], [false, "/overrides/accentEmphasis"], bad);
  }
  // Older documents, without it, stay valid.
  assert.ok(validateTheme({ ...MINIMAL, overrides: { accentMuted: "#2a2a10" } }).ok);
});
