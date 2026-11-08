import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalize, decodeShare, encodeShare, exportTheme, parseImport, validateTheme } from "../../packages/format/index.js";
import { repairTheme, resolveTheme } from "../../packages/engine/index.js";

const TESTS = new URL("../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const cases = json(`${TESTS}fixtures/roundtrip/cases.json`);
const at = (doc, pointer) => pointer.split("/").slice(1).reduce((v, k) => v?.[k], doc);
const themed = (seed) => ({ seed, policy: "themed", reducedMotion: false, forcedColors: false });
const RENDER_ONLY = /"(?:rendererVersion|sourceHash|seedId|seedHash|pairAudit|repairs|policy|tokens|semantics|ansi|graph|motionAllowed)"/;

for (const spec of cases.cases) {
  test(`round trip: ${spec.id}`, () => {
    const source = json(`${TESTS}fixtures/${spec.file}`);
    const standard = json(`${TESTS}fixtures/${spec.standardSeed}`);
    const previews = spec.previewSeeds.map((file) => json(`${TESTS}fixtures/${file}`));
    const pristine = { source: structuredClone(source), standard: structuredClone(standard), previews: structuredClone(previews) };

    // Source repair writes exactly the expected fields and reaches a fixed point.
    const { theme, repairs } = repairTheme(source, standard);
    assert.deepEqual(repairs.map((r) => r.path).sort(), [...spec.expectSourceChanges].sort());
    assert.ok(repairs.every((r) => r.persistence === "source" && r.before !== r.after && r.reason));
    assert.deepEqual(repairTheme(theme, standard).repairs, []);
    assert.equal(canonicalize(repairTheme(theme, standard).theme), canonicalize(theme));
    for (const pointer of spec.mustRemainAbsent) assert.equal(at(theme, pointer), undefined, pointer);
    assert.ok(validateTheme(theme).ok);
    assert.doesNotMatch(canonicalize(theme), RENDER_ONLY);

    // Fields outside the expected list are untouched.
    const changed = new Set(spec.expectSourceChanges);
    const walk = (a, b, path) => {
      if (a && typeof a === "object") for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b?.[key], `${path}/${key}`);
      else if (!changed.has(path)) assert.equal(b, a, path);
    };
    walk(source, theme, "");

    // Export and share are byte-stable through reimport and repeated repair.
    const bytes = exportTheme(theme).bytes;
    const reimported = parseImport(bytes, "file");
    assert.ok(reimported.ok);
    const again = repairTheme(reimported.normalized, standard);
    assert.deepEqual(again.repairs, []);
    assert.deepEqual(exportTheme(again.theme).bytes, bytes);
    const code = encodeShare(theme);
    const decoded = decodeShare(code);
    assert.ok(decoded.ok);
    assert.equal(encodeShare(repairTheme(decoded.normalized, standard).theme), code);

    // Every preview context resolves readably and identically after the round trip.
    for (const seed of previews) {
      const before = resolveTheme(theme, themed(seed));
      const after = resolveTheme(again.theme, themed(seed));
      assert.equal(JSON.stringify(after), JSON.stringify(before), seed.id);
      for (const id of spec.pairIds) {
        const results = after.pairAudit.filter((r) => r.id === id);
        assert.ok(results.length && results.every((r) => r.passed), `${id} on ${seed.id}`);
      }
      assert.deepEqual(after.pairAudit.filter((r) => !r.passed), [], seed.id);
    }

    // Other display policies never change the portable source or its codes.
    for (const policy of spec.alsoPolicies ?? []) {
      const context = policy === "forced-colors" ? { ...themed(previews[0]), forcedColors: true } : { seed: null, policy, reducedMotion: false, forcedColors: false };
      const resolved = resolveTheme(theme, context);
      assert.equal(resolved.tokens, null);
      assert.equal(resolved.policy, policy);
    }
    assert.deepEqual(exportTheme(theme).bytes, bytes);
    assert.equal(encodeShare(theme), code);

    // Inputs and seeds were never mutated.
    assert.deepEqual({ source, standard, previews }, pristine);
  });
}

test("repair fixtures: unreadable text and a collapsed graph are fixed in source, visibly", () => {
  const standard = json(`${TESTS}fixtures/seeds/standard-light.json`);
  const invisible = json(`${TESTS}fixtures/schema/repair/text-equals-background.reskin.json`);
  const text = repairTheme(invisible, standard);
  assert.deepEqual(text.repairs.map((r) => [r.path, r.before]), [["/colors/text", "#f6f2e8"]]);
  assert.equal(invisible.colors.text, "#f6f2e8", "source is unchanged until the caller uses the result");

  const collapsed = json(`${TESTS}fixtures/schema/repair/graph-collapses.reskin.json`);
  const graph = repairTheme(collapsed, standard);
  assert.deepEqual(graph.repairs.map((r) => r.path), ["/contributions/levels"]);
  assert.deepEqual(graph.repairs[0].before, collapsed.contributions.levels);
  assert.deepEqual(resolveTheme(graph.theme, themed(standard)).graph, graph.theme.contributions.levels);
  assert.ok(validateTheme(graph.theme).ok);
});

test("repair accepts only a same-base standard seed and never adds omitted fields", () => {
  const theme = json(`${TESTS}fixtures/schema/valid/minimal-light.reskin.json`);
  assert.throws(() => repairTheme(theme, json(`${TESTS}fixtures/seeds/tritanopia-light.json`)), /standard/);
  assert.throws(() => repairTheme(theme, json(`${TESTS}fixtures/seeds/standard-dark.json`)), /light seed/);
  const { theme: repaired, repairs } = repairTheme({ ...theme, colors: { ...theme.colors, accent: theme.colors.background } }, json(`${TESTS}fixtures/seeds/standard-light.json`));
  assert.deepEqual(repairs, []);
  assert.deepEqual(Object.keys(repaired).sort(), Object.keys(theme).sort());
  assert.equal(repaired.colors.accent, theme.colors.background, "the decorative accent is preserved");
});
