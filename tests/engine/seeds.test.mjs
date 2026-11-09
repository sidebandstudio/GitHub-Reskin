import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SYNTAX_ROLES } from "../../packages/contracts/index.js";
import { ANSI_ROLES, COLOR_PATHS, PAIR_MATRIX, pairMatrixProblems, SEMANTIC_FIELDS, SEMANTIC_ROLES, seedProblems, TOKEN_KEYS } from "../../packages/engine/index.js";

const TESTS = new URL("../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const NAMES = ["standard-dark", "standard-light", "colorblind-dark", "tritanopia-light"];
const seeds = NAMES.map((name) => json(`${TESTS}fixtures/seeds/${name}.json`));

test("the vocabulary has the frozen ColorSet sizes and matches the seeds' key order", () => {
  assert.equal(TOKEN_KEYS.length, 56);
  assert.equal(COLOR_PATHS.length, 109);
  assert.equal(new Set(COLOR_PATHS).size, 109);
  for (const seed of seeds) {
    assert.deepEqual(Object.keys(seed.colors.tokens), TOKEN_KEYS);
    assert.deepEqual(Object.keys(seed.colors.semantics), SEMANTIC_ROLES);
    for (const role of SEMANTIC_ROLES) assert.deepEqual(Object.keys(seed.colors.semantics[role]), SEMANTIC_FIELDS);
    assert.deepEqual(Object.keys(seed.colors.syntax), SYNTAX_ROLES);
    assert.deepEqual(Object.keys(seed.colors.ansi), ANSI_ROLES);
    assert.deepEqual(Object.keys(seed.origins).sort(), [...COLOR_PATHS].sort());
  }
});

test("the four synthetic seeds are valid and their hashes match their CSS sources", () => {
  for (const seed of seeds) {
    assert.deepEqual(seedProblems(seed), [], seed.id);
    const files = new Map(Object.values(seed.origins).map((o) => [o.file, o.sha256]));
    for (const [file, hash] of files) assert.equal(createHash("sha256").update(readFileSync(`${TESTS}${file}`)).digest("hex"), hash, file);
    const pairs = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    assert.equal(createHash("sha256").update(JSON.stringify(pairs)).digest("hex"), seed.sourceHash, seed.id);
  }
  assert.deepEqual(seeds.map((s) => [s.base, s.family, s.highContrast]), [["dark", "standard", false], ["light", "standard", false], ["dark", "colorblind", false], ["light", "tritanopia", false]]);
});

test("malformed seeds are rejected with specific problems", () => {
  const seed = structuredClone(seeds[0]);
  seed.colors.tokens.canvas = "#0D1117";
  delete seed.colors.ansi.brightWhite;
  seed.colors.tokens.extra = "#000000";
  seed.family = "dimmed";
  const problems = seedProblems(seed).join("\n");
  assert.match(problems, /canvas must be a lowercase/);
  assert.match(problems, /missing brightWhite/);
  assert.match(problems, /unknown keys extra/);
  assert.match(problems, /family/);
});

test("pair matrix version 2 keeps the frozen version 1 records first and unchanged, then adds the appearance pairs", () => {
  const v1 = json(`${TESTS}fixtures/contracts/pairs.json`);
  assert.equal(PAIR_MATRIX.version, 2);
  assert.deepEqual(PAIR_MATRIX.records.slice(0, v1.records.length), v1.records);
  assert.deepEqual(pairMatrixProblems(PAIR_MATRIX), []);
  assert.equal(v1.records.length, 67);
  assert.equal(v1.records.reduce((n, r) => n + r.backgrounds.length, 0), 287);
  assert.equal(PAIR_MATRIX.records.length, 92);
  assert.equal(PAIR_MATRIX.records.reduce((n, r) => n + r.backgrounds.length, 0), 387);
  // Every added record names an appearance color; none moves a version 1 background.
  for (const record of PAIR_MATRIX.records.slice(v1.records.length)) assert.ok(record.foreground.startsWith("/appearance/") || record.backgrounds.every((b) => b.startsWith("/appearance/")), record.id);
});

test("broken pair matrices fail validation", () => {
  const records = PAIR_MATRIX.records;
  assert.match(pairMatrixProblems({ version: 2, records: [records[0], records[0]] }).join(), /duplicate/);
  assert.match(pairMatrixProblems({ version: 2, records: [{ ...records[0], foreground: "/tokens/nope" }] }).join(), /not a ColorPath/);
  assert.match(pairMatrixProblems({ version: 2, records: [{ ...records[0], foreground: "/appearance/colors/nope" }] }).join(), /not a ColorPath/);
  assert.match(pairMatrixProblems({ version: 2, records: [{ ...records[0], backgrounds: [] }] }).join(), /at least one background/);
  assert.match(pairMatrixProblems({ version: 2, records: [{ ...records[0], minimum: 7 }] }).join(), /minimum/);
  assert.match(pairMatrixProblems({ version: 1, records }).join(), /version/);
});
