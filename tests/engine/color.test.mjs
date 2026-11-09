import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { bestInk, contrast, fit, luminance, mix, oklab, sha256 } from "../../packages/engine/index.js";

const close = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("relative luminance uses the 0.04045 breakpoint", () => {
  // Channel 10/255 = 0.0392 sits below the breakpoint (linear segment); 11/255 = 0.0431 above it.
  close(luminance("#0a0a0a"), 10 / 255 / 12.92, 1e-12, "#0a0a0a");
  close(luminance("#0b0b0b"), ((11 / 255 + 0.055) / 1.055) ** 2.4, 1e-12, "#0b0b0b");
  assert.equal(luminance("#000000"), 0);
  close(luminance("#ffffff"), 1, 1e-12, "white");
  close(luminance("#ff0000"), 0.2126, 1e-12, "red");
});

test("contrast ratios are unrounded and symmetric", () => {
  close(contrast("#000000", "#ffffff"), 21, 1e-12, "black/white");
  assert.equal(contrast("#767676", "#ffffff"), contrast("#ffffff", "#767676"));
  close(contrast("#767676", "#ffffff"), 4.5422, 1e-4, "#767676");
  assert.ok(contrast("#777777", "#ffffff") < 4.5);
});

test("mix interpolates each sRGB channel and rounds with floor(v + 0.5)", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(mix("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mix("#102030", "#ffffff", 1 / 255), "#112131");
  assert.equal(mix("#010101", "#000000", 0.5), "#010101");
  assert.equal(mix("#ABCDEF", "#abcdef", 0.3), "#abcdef");
});

test("OKLab matches Björn Ottosson's reference values", () => {
  const references = {
    "#ffffff": [1, 0, 0],
    "#000000": [0, 0, 0],
    "#ff0000": [0.627955, 0.224863, 0.125846],
    "#00ff00": [0.86644, -0.233888, 0.179498],
    "#0000ff": [0.452014, -0.032457, -0.311528],
  };
  for (const [hex, expected] of Object.entries(references)) oklab(hex).forEach((v, i) => close(v, expected[i], 1e-4, `${hex}[${i}]`));
});

test("best ink picks the stronger extreme and fit finds the smallest step", () => {
  assert.equal(bestInk("#000000", "light"), "#ffffff");
  assert.equal(bestInk("#ffffff", "dark"), "#000000");
  assert.equal(fit("#27372d", ["#f6f2e8"], 4.5, "light"), "#27372d");
  // The repair is the smallest passing 1/255 step: the step before fails in both directions.
  const fixed = fit("#f6f2e8", ["#f6f2e8"], 4.5, "light");
  const k = Array.from({ length: 256 }, (_, i) => i).find((i) => mix("#f6f2e8", "#000000", i / 255) === fixed);
  assert.ok(k > 0 && contrast(fixed, "#f6f2e8") >= 4.5);
  for (const end of ["#000000", "#ffffff"]) assert.ok(contrast(mix("#f6f2e8", end, (k - 1) / 255), "#f6f2e8") < 4.5);
  // No color reaches 4.6:1 on both white and black, so the search reports a straddle.
  assert.equal(fit("#808080", ["#ffffff", "#000000"], 4.6, "dark"), null);
});

test("SHA-256 matches node:crypto", () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 1000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 131 + 7) & 255);
    assert.equal(sha256(bytes), createHash("sha256").update(bytes).digest("hex"), `length ${length}`);
  }
});
