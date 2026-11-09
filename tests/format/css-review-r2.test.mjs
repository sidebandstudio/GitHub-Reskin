// Regressions from the second C2b review (reviews/c2b-r2.md): blockers 1-3, each probe beside its
// valid controls. Blocker 4, the prompt, is in prompt.test.mjs; the browser geometry of blockers 1
// and 3 is in css-browser.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileCss, sanitizeCss, validateTheme } from "../../packages/format/index.js";
import { cssVariables, resolveTheme } from "../../packages/engine/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const SLOT = '[data-reskin-slot="profile.tag"]';

const ok = (css) => {
  const result = sanitizeCss(css);
  assert.ok(result.ok, `${css}: ${JSON.stringify(result.issues)}`);
  return result.value;
};
const reasons = (css) => {
  const result = sanitizeCss(css);
  assert.equal(result.ok, false, `${css} should be rejected`);
  return result.issues.map((i) => i.message).join(" | ");
};

// ---------------------------------------------------------------------------------------------
// Blocker 1: a supplied shadow blur or spread is proved in range, never read as omitted.

test("c2b r2 blocker 1: a variable shadow blur or spread is refused, directly or through a local alias", () => {
  // A valid theme exports --reskin-radius as 999px.
  const seed = JSON.parse(readFileSync(`${ROOT}tests/fixtures/seeds/colorblind-dark.json`, "utf8"));
  const theme = { schemaVersion: 1, name: "Shadow", base: "dark", colors: { background: "#111111", text: "#ffffff", accent: "#ffcc00" }, shape: { corners: { radius: 999 } } };
  assert.ok(validateTheme(theme).ok);
  assert.equal(cssVariables(resolveTheme(theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false }))["--reskin-radius"], "999px");

  for (const value of ["0 0 var(--reskin-radius) rgb(0 0 0/.8)", "0 0 var(--theme-b) rgb(0 0 0/.8)", "0 0 var(--theme-c) rgb(0 0 0/.8)", "0 0 2px rgb(0 0 0/.8),0 0 var(--reskin-radius) rgb(0 0 0/.8)"]) {
    assert.match(reasons(`${SLOT}{--theme-b:var(--reskin-radius);--theme-c:var(--theme-b);box-shadow:${value}}`), /Shadow blur stays within 0-24px/, value);
  }
  assert.match(reasons(`${SLOT}{box-shadow:0 0 0 var(--reskin-radius) rgb(0 0 0/.8)}`), /Shadow spread stays within -8 to 4px/);
  assert.match(reasons(`${SLOT}{--theme-s:var(--reskin-radius);box-shadow:0 0 0 var(--theme-s) rgb(0 0 0/.8)}`), /Shadow spread stays within -8 to 4px/);
  assert.match(reasons(`${SLOT}{text-shadow:0 0 var(--reskin-radius) rgb(0 0 0/.8)}`), /Shadow blur stays within 0-24px/);
  assert.match(reasons(`${SLOT}{--theme-b:var(--reskin-radius);text-shadow:0 0 var(--theme-b) rgb(0 0 0/.8)}`), /Shadow blur stays within 0-24px/);
  assert.match(reasons(".AppHeader{box-shadow:0 0 var(--reskin-radius) var(--reskin-accent)}"), /Shadow blur stays within 0-24px/);
});

test("c2b r2 blocker 1: literal blur and spread keep their bounds, list sum and blur metadata", () => {
  const blurOf = (css) => ok(css).rules[0].declarations[0].blur;
  assert.equal(blurOf(`${SLOT}{box-shadow:0 0 24px 4px rgb(0 0 0/.8)}`), true);
  assert.equal(blurOf(`${SLOT}{box-shadow:0 0 24px var(--reskin-accent),0 0 24px -8px var(--reskin-accent)}`), true);
  assert.equal(blurOf(`${SLOT}{--theme-b:12px;box-shadow:0 0 var(--theme-b) rgb(0 0 0/.8)}`), true);
  assert.equal(blurOf(`${SLOT}{box-shadow:0 1px var(--reskin-accent)}`), false);
  assert.equal(blurOf(`${SLOT}{box-shadow:0 1px 0 0 var(--reskin-accent)}`), false);
  assert.equal(blurOf(`${SLOT}{text-shadow:0 0 24px rgb(0 0 0/.8)}`), true);
  assert.match(reasons(`${SLOT}{box-shadow:0 0 24px var(--reskin-accent),0 0 24px var(--reskin-accent),0 0 1px var(--reskin-accent)}`), /blurs at most 48px in total/);
  assert.match(reasons(`${SLOT}{box-shadow:0 0 25px rgb(0 0 0/.8)}`), /Shadow blur stays within 0-24px/);
  assert.match(reasons(`${SLOT}{box-shadow:0 0 0 5px rgb(0 0 0/.8)}`), /Shadow spread stays within -8 to 4px/);
});

// ---------------------------------------------------------------------------------------------
// Blocker 2: fallbacks inside theme-local variables are checked against each consuming property.

test("c2b r2 blocker 2: indirect and transitive local fallbacks are checked against the property at each use", () => {
  const bad = [
    `${SLOT}{--theme-x:var(--reskin-accent,999999px);border-color:var(--theme-x)}`,
    `${SLOT}{--theme-y:var(--reskin-accent,999999px);--theme-x:var(--theme-y);border-color:var(--theme-x)}`,
    `${SLOT}{--theme-z:var(--reskin-accent,999999px);--theme-y:var(--theme-z);--theme-x:var(--theme-y);border-color:var(--theme-x)}`,
    `${SLOT}{--theme-y:var(--reskin-accent,999999px);--theme-x:var(--reskin-text,var(--theme-y));border-color:var(--theme-x)}`,
    `${SLOT}{--theme-y:var(--reskin-accent,999999px);border-color:var(--reskin-text,var(--theme-y))}`,
    `${SLOT}{--theme-y:var(--reskin-accent,999999px);box-shadow:0 0 2px var(--theme-y)}`,
  ];
  for (const css of bad) assert.match(reasons(css), /In a var\(\) fallback: (This is not a valid border-color value|Each shadow names its color)/, css);
  const radius = [
    `${SLOT}{--theme-x:var(--reskin-radius,999999px);border-radius:var(--theme-x)}`,
    `${SLOT}{--theme-y:var(--reskin-radius,999999px);--theme-x:var(--theme-y);border-radius:var(--theme-x)}`,
    `${SLOT}{--theme-z:var(--reskin-radius,999999px);--theme-y:var(--theme-z);--theme-x:var(--theme-y);border-radius:var(--theme-x)}`,
    `${SLOT}{--theme-x:var(--reskin-radius,999.01px);border-top-left-radius:var(--theme-x)}`,
  ];
  for (const css of radius) assert.match(reasons(css), /In a var\(\) fallback: This border-(top-left-)?radius value is outside its allowed range/, css);
  // A fallback that is not a scalar of the consuming local's kind is refused where it is used.
  assert.match(reasons(`${SLOT}{--theme-y:var(--reskin-accent,5px);--theme-x:color-mix(in srgb,var(--theme-y),red);border-color:var(--theme-x)}`), /A var\(\) fallback in --theme-x is not a valid color/);
  // The same value is fine where the property admits it.
  assert.equal(ok(`${SLOT}{--theme-x:var(--reskin-radius,999999px);opacity:1}`).css, `${SLOT}{opacity:1}`);
});

test("c2b r2 blocker 2: valid colors and 3px radii through local fallbacks remain accepted and removed", () => {
  const cases = [
    [`${SLOT}{--theme-x:var(--reskin-accent,red);border-color:var(--theme-x)}`, `${SLOT}{border-color:var(--reskin-accent)}`],
    [`${SLOT}{--theme-z:var(--reskin-accent,#123456);--theme-y:var(--theme-z);--theme-x:var(--theme-y);border-color:var(--theme-x)}`, `${SLOT}{border-color:var(--reskin-accent)}`],
    [`${SLOT}{--theme-y:var(--reskin-accent,red);--theme-x:var(--reskin-text,var(--theme-y));border-color:var(--theme-x)}`, `${SLOT}{border-color:var(--reskin-text)}`],
    [`${SLOT}{--theme-x:var(--reskin-radius,3px);border-radius:var(--theme-x)}`, `${SLOT}{border-radius:var(--reskin-radius)}`],
    [`${SLOT}{--theme-y:var(--reskin-radius,3px);--theme-x:var(--theme-y);border-radius:var(--theme-x)}`, `${SLOT}{border-radius:var(--reskin-radius)}`],
    [`${SLOT}{--theme-y:var(--reskin-accent,red);box-shadow:0 0 2px var(--theme-y),0 1px var(--theme-y)}`, `${SLOT}{box-shadow:0 0 2px var(--reskin-accent),0 1px var(--reskin-accent)}`],
  ];
  for (const [css, canonical] of cases) assert.equal(ok(css).css, canonical, css);
});

test("c2b r2 blocker 2: checking local fallbacks at every use stays within a budget", () => {
  // Eight locals with one fallback each, used through a chain and many times, check linearly.
  let css = `${SLOT}{--theme-v0:var(--reskin-accent,red);`;
  for (let n = 1; n <= 8; n++) css += `--theme-v${n}:var(--reskin-text,var(--theme-v${n - 1}));`;
  const uses = Array(4).fill("0 0 2px var(--theme-v8)").join(",");
  const start = performance.now();
  ok(`${css}box-shadow:${uses}}`);
  assert.ok(performance.now() - start < 2000);
  // Fallback work past the byte budget is refused, not run.
  const wide = `${SLOT}{--theme-a:var(--reskin-accent,rgb(${"1".repeat(40)} 0 0));${Array.from({ length: 120 }, () => "box-shadow:0 0 2px var(--theme-a),0 0 2px var(--theme-a),0 0 2px var(--theme-a),0 0 2px var(--theme-a)").join(";")}}`;
  assert.match(reasons(wide), /var\(\) fallbacks .*expand to more than/);
});

// ---------------------------------------------------------------------------------------------
// Blocker 3: rotation turns a decoration about its center.

test("c2b r2 blocker 3: a transform-origin away from the center is refused, alone, split or conditional", () => {
  const cases = [
    `${SLOT}{width:20px;height:20px;transform-origin:360px 360px;transform:rotate(8deg)}`,
    `${SLOT}{transform-origin:360px 360px}${SLOT}{transform:rotate(8deg)}`,
    `${SLOT}{transform:rotate(8deg)}@media (min-width:1px){${SLOT}{transform-origin:0 0}}`,
    `${SLOT}{transform:rotate(8deg)}${SLOT}::before{transform-origin:left top}`,
    `${SLOT}{transform-origin:50% 50% 100px;transform:rotate(8deg)}`,
    `${SLOT}{transform-origin:100%}`,
    `${SLOT}{transform-origin:center 0}`,
    `${SLOT}{transform-origin:calc(50% + 1%) 50%}`,
  ];
  for (const css of cases) assert.match(reasons(css), /transform-origin stays at the center/, css);
});

test("c2b r2 blocker 3: centered origins with the bounded translation and rotation still compile", () => {
  for (const origin of ["center", "center center", "50%", "50% 50%", "50% 50% 0", "50% center"]) {
    const value = ok(`${SLOT}{width:360px;height:96px;transform-origin:${origin};transform:translate(8px,-8px) rotate(8deg)}`);
    assert.ok(compileCss(value, { cssAllowed: true }).ok, origin);
  }
});
