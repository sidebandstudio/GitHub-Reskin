import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_THEME_ID, LEGACY_CLASSIC_THEME_IDS } from "../../packages/contracts/index.js";
import { run } from "../../packages/format/checks.mjs";
import { ANIME_CATALOG, CLASSICS_CATALOG, catalogProblems, validateTheme } from "../../packages/format/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const catalog = JSON.parse(readFileSync(`${ROOT}themes/catalog.json`, "utf8"));

test("the catalog holds all thirteen Anime followed by the twelve Classics in 1.x order", () => {
  assert.deepEqual(catalogProblems(catalog), []);
  assert.deepEqual(catalog, [...ANIME_CATALOG, ...CLASSICS_CATALOG]);
  assert.deepEqual(catalog.filter((e) => e.group === "classics").map((e) => e.id), LEGACY_CLASSIC_THEME_IDS);
  for (const entry of catalog) assert.ok(validateTheme(JSON.parse(readFileSync(`${ROOT}${entry.file}`, "utf8"))).ok, entry.file);
});

test("the full anime-then-Classics catalog satisfies the contract", () => {
  assert.deepEqual(catalogProblems([...ANIME_CATALOG, ...CLASSICS_CATALOG]), []);
  assert.equal(ANIME_CATALOG[0].id, DEFAULT_THEME_ID);
  assert.equal(ANIME_CATALOG[0].slug, "choom-circuit");
  assert.equal(ANIME_CATALOG.length, 13);
});

test("catalog problems are reported for each broken rule", () => {
  const [a, b] = ANIME_CATALOG;
  const [c] = CLASSICS_CATALOG;
  const cases = [
    [{ entries: true }, /JSON array/],
    [[c, a], /Anime come first/],
    [[{ ...a, order: 2 }], /no gaps/],
    [[a, { ...b, order: 1 }], /no gaps/],
    [[{ ...a, group: "Anime" }], /must be anime or classics/],
    [[{ ...a, file: "/themes/anime/choom-circuit.reskin.json" }], /file/],
    [[{ ...a, file: "themes/anime/../classics/x.reskin.json" }], /file/],
    [[{ ...a, file: "themes/anime/choom-circuit.json" }], /file/],
    [[a, { ...b, id: a.id }], /repeats id/],
    [[a, { ...b, slug: a.slug, file: a.file }], /repeats slug/],
    [[{ ...a, name: "Choom" }], /keys/],
    [[{ ...a, slug: "Choom Circuit" }], /slug/],
    [[{ ...a, order: 1.5 }], /integer/],
  ];
  for (const [value, pattern] of cases) assert.match(catalogProblems(value).join("\n"), pattern, JSON.stringify(value));
});

test("the routed format checks return exit codes and test counts", async () => {
  for (const command of ["schema", "prompt", "classic-themes"]) {
    const result = await run({ command, args: [], root: ROOT, outDir: `${ROOT}dist` });
    assert.equal(result.exitCode, 0, command);
    assert.ok(result.testCount > 10, command);
  }
  assert.equal((await run({ command: "nope", args: [], root: ROOT })).exitCode, 2);
  assert.equal((await run({ command: "schema", args: ["--x"], root: ROOT })).exitCode, 2);
});
