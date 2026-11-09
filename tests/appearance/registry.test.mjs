// The appearance registry, effect templates and fonts agree with the schema's x-reskin registries.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EFFECTS, FONTS, LIMITS, registryProblems } from "../../packages/appearance/index.js";
import { FONT_ROLES } from "../../packages/format/index.js";
import { fontAudit, templateAudit } from "../../packages/appearance/audit.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const X = JSON.parse(readFileSync(`${ROOT}packages/format/theme-v1.schema.json`, "utf8"))["x-reskin"];

test("registry matches the contracts and the schema's effect and font registries", () => {
  assert.deepEqual(registryProblems(), []);
  assert.deepEqual(Object.keys(EFFECTS), Object.keys(X.effects));
  for (const [id, effect] of Object.entries(X.effects)) {
    assert.deepEqual(EFFECTS[id].colors.map((role) => `tokens.${role}`), effect.resolvedColorSources, id);
    assert.equal(EFFECTS[id].motion, /once on explicit selection/.test(effect.draws), id);
  }
  assert.deepEqual(
    FONTS.map(({ id, family, weight, minimumAccentPx }) => ({ id, family, weight, minimumAccentPx })),
    // Families whose files arrive later resolve natively and have no renderer entry yet.
    X.fonts.filter(({ id }) => FONT_ROLES.find((role) => role.id === id)?.source === "bundled").map(({ id, family, weight, minimumAccentPx }) => ({ id, family, weight, minimumAccentPx })),
  );
});

test("limits match the schema's global effect limits", () => {
  const g = X.effectGlobalLimits;
  assert.equal(LIMITS.maxOwnedNodes, g.maxOwnedNodesPerDocument);
  assert.equal(LIMITS.maxAnimatedNodes, g.maxAnimatedNodes);
  assert.equal(LIMITS.maxPatchWidthPx, g.maxPatchWidthPx);
  assert.equal(LIMITS.maxPatchHeightPx, g.maxPatchHeightPx);
  assert.equal(LIMITS.maxAnimatedElementPx, g.maxAnimatedElementPx);
  assert.equal(LIMITS.maxAnimationMs, g.maxAnimationTotalMs);
  assert.equal(g.loops, false);
});

test("every effect template at every shape and bound is static or finite, original and role-colored", () => {
  const { problems, count } = templateAudit();
  assert.deepEqual(problems, []);
  assert.ok(count > 1000, `only ${count} template assertions`);
});

test("the bundled fonts pass the font audit within budget", async () => {
  const { problems, total } = await fontAudit(ROOT);
  assert.deepEqual(problems, []);
  assert.ok(total <= X.fontBudget.totalWoff2Bytes);
});
