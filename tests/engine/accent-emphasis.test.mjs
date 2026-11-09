import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalize, decodeShare, encodeShare, exportTheme, parseImport } from "../../packages/format/index.js";
import { auditPairs, contrast, cssVariables, repairTheme, resolveTheme } from "../../packages/engine/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const seed = (name) => json(`tests/fixtures/seeds/${name}.json`);
const SEEDS = ["standard-dark", "standard-light", "colorblind-dark", "tritanopia-light"].map(seed);
const [dark, light, colorblind] = SEEDS;
const themed = (s) => ({ seed: s, policy: "themed", reducedMotion: false, forcedColors: false });
const sha = (text) => createHash("sha256").update(text).digest("hex");
const CHOOM = json("tests/fixtures/choom/choom-circuit-faithful.reskin.json");
// The owner's original Cyberpunk selected-state teal.
const TEAL = "#007880";
const withEmphasis = (theme, hex) => ({ ...theme, overrides: { ...(theme.overrides ?? {}), accentEmphasis: hex } });

test("a source without accentEmphasis resolves and repairs exactly as main 6636712 did", () => {
  const { cases } = json("tests/engine/fixtures/main-6636712-resolutions.json");
  assert.equal(cases.length, 78);
  for (const { file, seed: seedId, sha256 } of cases) {
    const theme = json(file);
    assert.equal(theme.overrides?.accentEmphasis, undefined, file);
    if (seedId === "repair") {
      const s = [dark, light].find((x) => x.base === theme.base);
      let got;
      try {
        const rep = repairTheme(theme, s);
        got = sha(canonicalize(rep.theme) + JSON.stringify(rep.repairs));
      } catch (error) {
        got = sha(String(error.code ?? error.message));
      }
      assert.equal(got, sha256, `${file} source repair`);
      continue;
    }
    let value;
    try {
      value = structuredClone(resolveTheme(theme, themed(SEEDS.find((x) => x.id === seedId))));
      if (value.appearance?.css) delete value.appearance.css.policyHash;
    } catch (error) {
      value = { error: String(error.code ?? error.message) };
    }
    assert.equal(sha(JSON.stringify(value)), sha256, `${file} on ${seedId}`);
  }
});

test("without accentEmphasis the emphasis fill still starts from accent and has no canvas pair", () => {
  const r = resolveTheme(CHOOM, themed(dark));
  assert.ok(!r.pairAudit.some((p) => p.id === "accentEmphasis"));
  assert.notEqual(r.tokens.accentEmphasis, TEAL);
  assert.deepEqual(auditPairs(r), r.pairAudit);
});

test("Choom's teal accentEmphasis is kept on every dark seed and exposed to compilers", () => {
  const theme = withEmphasis(CHOOM, TEAL);
  assert.ok(!repairTheme(theme, dark).repairs.some((r) => r.path === "/overrides/accentEmphasis"));
  for (const s of SEEDS.filter((x) => x.base === "dark")) {
    const r = resolveTheme(theme, themed(s));
    assert.equal(r.tokens.accentEmphasis, TEAL, s.id);
    const pairs = r.pairAudit.filter((p) => p.id === "accentEmphasis" || p.id === "emphasisText");
    assert.deepEqual(pairs.map((p) => [p.id, p.foreground, p.background, p.passed]), [
      ["emphasisText", "/tokens/emphasisText", "/tokens/accentEmphasis", true],
      ["accentEmphasis", "/tokens/accentEmphasis", "/tokens/canvas", true],
    ]);
    assert.ok(r.pairAudit.every((p) => p.passed), s.id);
    assert.deepEqual(auditPairs(r), r.pairAudit);
    const vars = cssVariables(r);
    assert.equal(vars["--reskin-accent-emphasis"], TEAL);
    assert.equal(vars["--reskin-accent-emphasis-text"], r.tokens.emphasisText);
  }
});

test("an unreadable accentEmphasis is repaired in source against the emphasis ink and the canvas", () => {
  const cases = [
    [withEmphasis(CHOOM, "#fcee0a"), dark],
    [withEmphasis(CHOOM, "#0b0b18"), dark],
    [withEmphasis(CHOOM, "#ffffff"), dark],
    [{ schemaVersion: 1, name: "Paper", base: "light", colors: { background: "#f6f2e8", text: "#27372d", accent: "#446851" }, overrides: { accentEmphasis: "#fcee0a" } }, light],
  ];
  for (const [theme, s] of cases) {
    const before = theme.overrides.accentEmphasis;
    // Resolving the unrepaired source corrects it as render output.
    const rendered = resolveTheme(theme, themed(s));
    assert.equal(rendered.repairs.find((r) => r.path === "/tokens/accentEmphasis")?.before, before, before);
    const { theme: repaired, repairs } = repairTheme(theme, s);
    const repair = repairs.find((r) => r.path === "/overrides/accentEmphasis");
    assert.deepEqual([repair?.persistence, repair?.before], ["source", before], before);
    assert.equal(repaired.overrides.accentEmphasis, repair.after);
    assert.deepEqual(repairTheme(repaired, s).repairs, [], `${before}: repair is a fixed point`);
    const r = resolveTheme(repaired, themed(s));
    const t = r.tokens;
    assert.equal(t.accentEmphasis, repaired.overrides.accentEmphasis);
    assert.ok(contrast(t.emphasisText, t.accentEmphasis) >= 4.5 && contrast(t.accentEmphasis, t.canvas) >= 3, before);
    assert.ok(r.pairAudit.every((p) => p.passed), before);
  }
});

test("accessibility seeds keep a supplied accentEmphasis, which is not a status color", () => {
  const r = resolveTheme(withEmphasis(CHOOM, TEAL), themed(colorblind));
  assert.equal(r.tokens.accentEmphasis, TEAL);
});

test("a repaired accentEmphasis survives export, share and reimport", () => {
  const { theme } = repairTheme(withEmphasis(CHOOM, "#fcee0a"), dark);
  const bytes = exportTheme(theme).bytes;
  const file = parseImport(bytes, "file");
  assert.ok(file.ok);
  assert.equal(file.normalized.overrides.accentEmphasis, theme.overrides.accentEmphasis);
  const code = encodeShare(theme);
  const share = decodeShare(code);
  assert.ok(share.ok);
  assert.equal(encodeShare(repairTheme(share.normalized, dark).theme), code);
  const [again, original] = [file.normalized, theme].map((t) => resolveTheme(t, themed(dark)));
  assert.equal(again.sourceHash, original.sourceHash);
  assert.deepEqual(again.tokens, original.tokens);
});

// C2c review round 1: repairing the fill for the shared ink and then for the canvas, one record at
// a time, alternated until the passes ran out and left white text at 1.90:1 on #bbbcbc.
const MID_GRAY = { schemaVersion: 1, name: "Mid gray", base: "dark", colors: { background: "#666666", text: "#ffffff", accent: TEAL }, overrides: { accentEmphasis: TEAL } };
const FALLBACK = /^No emphasis fill reaches/;

// Every pair of every seed of the base passes, and a fill that cannot pass both pairs falls back to
// the fill a theme without the override gets, with a note. Source repair is a readable fixed point.
function assertReadable(theme) {
  const s = [dark, light].find((x) => x.base === theme.base);
  const label = `${theme.colors.background} ${theme.overrides.accentEmphasis}`;
  const outcomes = new Set();
  const repaired = repairTheme(theme, s).theme;
  assert.deepEqual(repairTheme(repaired, s).repairs, [], `${label}: repair is a fixed point`);
  for (const source of [theme, repaired]) {
    for (const seedRecord of SEEDS.filter((x) => x.base === theme.base)) {
      const r = resolveTheme(source, themed(seedRecord));
      const at = `${label} on ${seedRecord.id}`;
      assert.deepEqual(r.pairAudit.filter((p) => !p.passed), [], at);
      assert.deepEqual(auditPairs(r), r.pairAudit, at);
      const t = r.tokens;
      assert.ok(contrast(t.emphasisText, t.accentEmphasis) >= 4.5, at);
      if (r.pairAudit.some((p) => p.id === "accentEmphasis")) {
        assert.ok(contrast(t.accentEmphasis, t.canvas) >= 3, at);
        outcomes.add("fitted");
      } else {
        const { overrides, ...plain } = source;
        assert.equal(t.accentEmphasis, resolveTheme(plain, themed(seedRecord)).tokens.accentEmphasis, at);
        assert.match(r.repairs.find((x) => x.path === "/tokens/accentEmphasis")?.reason ?? "", FALLBACK, at);
        outcomes.add("fallback");
      }
    }
  }
  return outcomes;
}

test("the review's mid-gray case fits the fill against the emphasis ink and the canvas together", () => {
  const r = resolveTheme(MID_GRAY, themed(dark));
  const t = r.tokens;
  assert.notEqual(t.accentEmphasis, "#bbbcbc");
  assert.equal(t.emphasisText, "#ffffff");
  assert.ok(contrast(t.emphasisText, t.accentEmphasis) >= 4.5 && contrast(t.accentEmphasis, t.canvas) >= 3, t.accentEmphasis);
  assert.ok(r.pairAudit.every((p) => p.passed));
  const { theme: repaired, repairs } = repairTheme(MID_GRAY, dark);
  assert.equal(repairs.find((x) => x.path === "/overrides/accentEmphasis")?.after, t.accentEmphasis);
  assert.deepEqual(repairTheme(repaired, dark).repairs, []);
  assert.deepEqual(resolveTheme(repaired, themed(dark)).tokens, t);
  assert.deepEqual([...assertReadable(MID_GRAY)], ["fitted"]);
});

test("a sweep of light, dark and mid-gray canvases and override hues passes every pair", () => {
  const CANVASES = [
    ["light", "#ffffff", "#1f2328"],
    ["light", "#f6f2e8", "#27372d"],
    ["light", "#888888", "#000000"],
    ["light", "#777777", "#000000"],
    ["dark", "#666666", "#ffffff"],
    ["dark", "#555555", "#ffffff"],
    ["dark", "#3a3a3a", "#ffffff"],
    ["dark", "#22272e", "#e6edf3"],
    ["dark", "#0a0a17", "#e4f3ff"],
  ];
  const HUES = [TEAL, "#fcee0a", "#ff0055", "#3355ff", "#7fff00", "#808080", "#ffffff", "#000000"];
  const outcomes = new Set();
  for (const [base, background, text] of CANVASES) {
    for (const hue of HUES) {
      const theme = { schemaVersion: 1, name: "Sweep", base, colors: { background, text, accent: TEAL }, overrides: { accentEmphasis: hue } };
      for (const outcome of assertReadable(theme)) outcomes.add(outcome);
    }
  }
  // White emphasis text cannot reach 4.5:1 on a fill that is 3:1 from a #3a3a3a or #555555 canvas.
  assert.deepEqual([...outcomes].sort(), ["fallback", "fitted"]);
});
