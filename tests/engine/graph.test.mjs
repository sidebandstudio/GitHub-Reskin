import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contrast, deriveRamp, graphProblems, oklab, rampDirection, repairTheme, resolveTheme } from "../../packages/engine/index.js";

const TESTS = new URL("../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const dark = json(`${TESTS}fixtures/seeds/standard-dark.json`);
const light = json(`${TESTS}fixtures/seeds/standard-light.json`);
const themed = (seed) => ({ seed, policy: "themed", reducedMotion: false, forcedColors: false });
const base = (b, colors, extra = {}) => ({ schemaVersion: 1, name: "Graph", base: b, colors, ...extra });

test("each graph constraint is detected on its own", () => {
  const canvas = "#0d1117";
  const good = ["#1b2129", "#4f8a5c", "#6aa877", "#8cc898", "#b6f0c0"];
  assert.deepEqual(graphProblems(good, canvas, "up"), []);
  assert.match(graphProblems([good[0], good[1], good[1], good[3], good[4]], canvas, "up").join(), /distinct/);
  assert.match(graphProblems([good[0], good[2], good[1], good[3], good[4]], canvas, "up").join(), /not lighter/);
  assert.match(graphProblems(good, canvas, "down").join(), /not darker/);
  assert.match(graphProblems(["#1b2129", "#2a2e33", "#4f8a5c", "#6fc07f", "#a6f0b0"], canvas, "up").join(), /below 3:1/);
  assert.match(graphProblems(["#1b2129", "#4f8a5c", "#529060", "#8cc898", "#b6f0c0"], canvas, "up").join(), /too close/);
});

test("OKLab steps and contrast order hold on every resolved ramp", () => {
  for (const theme of [
    base("dark", { background: "#091312", text: "#f0f7ed", accent: "#d5ff35" }),
    base("light", { background: "#f6f2e8", text: "#27372d", accent: "#446851" }),
    base("dark", { background: "#202020", text: "#e0e0e0", accent: "#212121" }),
    base("light", { background: "#ffffff", text: "#000000", accent: "#fefefe", contribution: "#ffffff" }),
  ]) {
    const seed = theme.base === "dark" ? dark : light;
    const { graph, tokens } = resolveTheme(theme, themed(seed));
    assert.deepEqual(graphProblems(graph, tokens.canvas, rampDirection(theme.base, tokens.canvas)), [], theme.colors.accent);
    for (let i = 1; i < 5; i++) {
      assert.ok(Math.abs(oklab(graph[i])[0] - oklab(graph[i - 1])[0]) >= 0.04);
      assert.ok(contrast(graph[i], tokens.canvas) >= 3);
    }
  }
});

test("a valid supplied ramp is kept exactly; a collapsed one is regenerated in source", () => {
  const levels = ["#24372f", "#4e8c60", "#78b94d", "#a9dc3b", "#d5ff35"];
  const theme = base("dark", { background: "#091312", text: "#f0f7ed", accent: "#d5ff35" }, { contributions: { levels } });
  assert.deepEqual(resolveTheme(theme, themed(dark)).graph, levels);
  assert.deepEqual(repairTheme(theme, dark).repairs, []);
  for (const collapse of [
    ["#010101", "#020202", "#030303", "#040404", "#050505"],
    ["#091312", "#0a1413", "#0b1514", "#0c1615", "#0d1716"],
    ["#ffffff", "#eeeeee", "#dddddd", "#cccccc", "#bbbbbb"],
  ]) {
    const broken = { ...theme, contributions: { levels: collapse } };
    const resolved = resolveTheme(broken, themed(dark));
    assert.notDeepEqual(resolved.graph, collapse);
    assert.ok(resolved.repairs.some((r) => r.path.startsWith("/graph/")));
    const { theme: fixed, repairs } = repairTheme(broken, dark);
    assert.deepEqual(repairs.map((r) => r.path), ["/contributions/levels"]);
    assert.deepEqual(resolveTheme(fixed, themed(dark)).graph, fixed.contributions.levels);
  }
});

test("the derived ramp starts from mix(canvas, text, 0.09) and the contribution seed", () => {
  assert.deepEqual(deriveRamp("#000000", "#ffffff", "#ffffff"), ["#171717", "#595959", "#8c8c8c", "#c7c7c7", "#ffffff"]);
  // Level 1 at 35% reaches only 2.998:1 on black, so levels 1-4 are spread evenly from the first
  // mix that reaches 3:1, keeping level 0 and the seed endpoint.
  const resolved = resolveTheme(base("dark", { background: "#000000", text: "#ffffff", accent: "#ff0000", contribution: "#ffffff" }), themed(dark));
  assert.equal(resolved.graph[0], "#171717");
  assert.equal(resolved.graph[4], "#ffffff");
  assert.ok(contrast(resolved.graph[1], "#000000") >= 3 && contrast(resolved.graph[1], "#000000") < 3.1);
  assert.deepEqual(graphProblems(resolved.graph, "#000000", "up"), []);
  assert.deepEqual(resolved.repairs.filter((r) => r.path.startsWith("/graph/")).map((r) => r.path), ["/graph/1", "/graph/2", "/graph/3"]);
});

test("a base that contradicts the canvas still gets a visible ramp", () => {
  assert.equal(rampDirection("dark", "#ffffff"), "down");
  assert.equal(rampDirection("light", "#000000"), "up");
  const resolved = resolveTheme(base("dark", { background: "#ffffff", text: "#111111", accent: "#ffff00" }), themed(dark));
  assert.deepEqual(graphProblems(resolved.graph, "#ffffff", "down"), []);
});
