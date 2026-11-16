// scripts/capture.mjs without a browser: the PNG size check every store file goes through, the five
// captions, the brand icons it copies, and the AI answer screenshot 5 imports. The run itself is
// npm run capture:release.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MODE_INDEX, standardSeed as seedOf } from "../../packages/primer/index.js";
import { analyzeImport } from "../../packages/ui/importer.js";
import { AI_ANSWER, CAPTIONS, ICON_SIZES, pngSize } from "../../scripts/capture.mjs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url));

test("pngSize reads a PNG's width and height and refuses anything else", () => {
  for (const size of ICON_SIZES) assert.deepEqual(pngSize(read(`assets/brand/icon-${size}.png`)), { width: size, height: size });
  assert.equal(pngSize(Buffer.alloc(0)), null);
  assert.equal(pngSize(read("assets/brand/icon.svg")), null);
});

test("there is one store caption per screenshot", () => {
  assert.equal(CAPTIONS.length, 5);
  for (const caption of CAPTIONS) assert.match(caption, /^\S.*\.$/);
});

test("the AI answer imports with Advanced CSS the sanitizer admits, so screenshot 5 shows its note", () => {
  const result = analyzeImport(read(AI_ANSWER).toString("utf8"), "text", { standardSeed: (base) => seedOf(MODE_INDEX, base) });
  assert.equal(result.ok, true, JSON.stringify(result.details));
  assert.equal(result.css?.ok, true);
});
