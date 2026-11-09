// Regressions from the first C2b review (reviews/c2b-r1.md): each of its probes, with the valid
// controls beside them, and the policy rules its coverage table found without a dedicated test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ISSUE_CODES, LIMITS } from "../../packages/contracts/index.js";
import { compileCss, decodeShare, encodeShare, parseImport, sanitizeCss, sanitizeGradientCss, validateTheme } from "../../packages/format/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const registry = JSON.parse(readFileSync(`${ROOT}tests/fixtures/css-registry-synthetic.json`, "utf8")).registry;
const FULL = { enabled: true, appearance: "full", extras: true, text: true, motion: true, fonts: true, effects: true };
const SLOT = '[data-reskin-slot="profile.tag"]';
const CORNER = '[data-reskin-slot="error.notFound.caption"]';
// The npm registry tarball of css-tree 3.1.0, and the files of it the sanitizer bundles and credits.
const CSS_TREE_INTEGRITY = "sha512-0eW44TGN5SQXU1mWSkKwFstI/22X2bG1nYzZTYMAWjylYURhse752YgbE4Cx46AC+bAvI+/dYTPRk1LqSUnu6w==";
const CSS_TREE_ESM_SHA256 = "498ad7ee5981f22e364d47a89e9bbe3d11758c45b4248ed3fdb1cee975f2b193";
const CSS_TREE_LICENSE_SHA256 = "a7d4ce7343a169d623ba68f98bf7aed9a4e0a3d6730dcf37a40d4fc96879704e";
const MINIMAL = { schemaVersion: 1, name: "Probe", base: "dark", colors: { background: "#111111", text: "#ffffff", accent: "#ffcc00" } };

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
// Sanitized and compiled for its target: owned slots without a registry, native ones with the
// synthetic registry.
const pipeline = (css, { native = false } = {}) => {
  const sanitized = sanitizeCss(css);
  if (!sanitized.ok) return { ok: false, stage: "sanitize", issues: sanitized.issues };
  const compiled = compileCss(sanitized.value, { registry: native ? registry : null, cssAllowed: true, preferences: FULL });
  return compiled.ok ? { ok: true, css: compiled.css } : { ok: false, stage: "compile", issues: compiled.issues };
};
const refused = (css, options) => {
  const result = pipeline(css, options);
  assert.equal(result.ok, false, `${css} should be refused`);
  return result.issues.map((i) => i.message).join(" | ");
};

// The review's branching graph: each level refers to the one below `fanout` times.
const expansionBomb = (fanout, edges = 8) => {
  let css = `${SLOT}{--theme-v0:1px;`;
  for (let n = 1; n <= edges; n++) css += `--theme-v${n}:max(${Array(fanout).fill(`var(--theme-v${n - 1})`).join(",")});`;
  return `${css}opacity:1}`;
};

// ---------------------------------------------------------------------------------------------
// Finding 1: variable expansion is measured before it is allocated.

test("r1 finding 1: branching variable graphs reject on their budget in a 128 MB heap, before allocating", () => {
  const script = `
    import { sanitizeCss } from ${JSON.stringify(`${ROOT}packages/format/index.js`)};
    const css = process.argv[1];
    const started = performance.now();
    const result = sanitizeCss(css);
    process.stdout.write(JSON.stringify({ ms: performance.now() - started, rss: process.memoryUsage().rss, ok: result.ok, issues: result.issues ?? [] }));
  `;
  for (const fanout of [8, 4]) {
    const css = expansionBomb(fanout);
    const child = spawnSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", script, css], { encoding: "utf8", timeout: 20000 });
    assert.equal(child.signal, null, `fanout ${fanout} was killed by ${child.signal}: ${child.stderr.slice(0, 400)}`);
    assert.equal(child.status, 0, child.stderr.slice(0, 400));
    const out = JSON.parse(child.stdout);
    assert.equal(out.ok, false, `fanout ${fanout} (${Buffer.byteLength(css)} bytes) was accepted`);
    assert.match(out.issues.map((i) => i.message).join(" "), /expands to more than \d+ UTF-8 bytes.*\(line 1, column \d+\)/, `fanout ${fanout}`);
    assert.ok(out.ms < 1000, `fanout ${fanout} took ${out.ms} ms`);
    assert.ok(out.rss < 160 * 1024 * 1024, `fanout ${fanout} reached ${out.rss} bytes RSS`);
  }
});

test("r1 finding 1: unused variables count toward the expansion budget, with a located error", () => {
  // Unused levels, no declaration uses any of them.
  const unused = expansionBomb(4).replace("opacity:1", "border-color:red");
  assert.match(reasons(unused), /--theme-v\d expands to more than 32768 UTF-8 bytes.*line 1/);
  // Many small expansions that pass one by one but not together.
  let together = `${SLOT}{--theme-a:max(1px,1px,1px,1px,1px,1px,1px,1px);`;
  for (let i = 0; i < 400; i++) together += `--theme-b${i}:max(var(--theme-a),var(--theme-a),var(--theme-a));`;
  assert.match(reasons(`${together}opacity:1}`), /Theme-local variables expand to more than 32768 UTF-8 bytes or 20000 syntax nodes together/);
  // Intermediate syntax trees are bounded too: a lowered node budget stops a graph under the byte budget.
  const nodes = sanitizeCss(expansionBomb(2, 6), { budgets: { astNodes: 200 } });
  assert.equal(nodes.ok, false);
  assert.match(nodes.issues[0].message, /syntax nodes/);
  // A modest chain of eight is still accepted and fully substituted.
  let chain = `${SLOT}{--theme-c0:2px;`;
  for (let n = 1; n <= 8; n++) chain += `--theme-c${n}:var(--theme-c${n - 1});`;
  assert.equal(ok(`${chain}padding:var(--theme-c8)}`).css, `${SLOT}{padding:2px}`);
});

// ---------------------------------------------------------------------------------------------
// Finding 2: clamp() follows CSS, where MIN wins, and every range is finite and ordered.

test("r1 finding 2: reversed clamp() bounds cannot carry 100000px through lengths, translations, shadows or gradientCss sizes", () => {
  for (const decl of [
    "width:calc(clamp(100000px,10px,1px))",
    "border-width:calc(clamp(100000px,10px,1px));border-style:solid",
    "transform:translateX(calc(clamp(100000px,0px,8px)))",
    "box-shadow:0 0 calc(clamp(100000px,10px,1px)) rgb(0 0 0 / .8)",
  ]) {
    assert.match(refused(`${SLOT}{${decl}}`), /outside its allowed range|moves at most 8px|Shadow blur stays within/, decl);
  }
  const size = sanitizeGradientCss({ value: "linear-gradient(red,blue)", size: "calc(clamp(100000px,10px,1px))" }, "/backgrounds/page/layers/0/gradientCss");
  assert.equal(size.ok, false);
  assert.equal(size.issues[0].path, "/backgrounds/page/layers/0/gradientCss/size");
  // Units must agree across all three arguments, not just the outer two.
  assert.match(reasons(`${SLOT}{width:calc(clamp(1px,50%,8px))}`), /cannot be checked for a finite range/);
});

test("r1 finding 2: in-range calc(), min(), max() and clamp() remain accepted", () => {
  for (const [decl, canonical] of [
    ["width:calc(clamp(10px,20px,30px))", "width:calc(clamp(10px,20px,30px))"],
    ["width:calc(clamp(1px,100000px,360px))", "width:calc(clamp(1px,100000px,360px))"],
    ["padding:calc(4px * 2)", "padding:calc(4px*2)"],
    ["padding:calc(min(8px,32px))", "padding:calc(min(8px,32px))"],
    ["padding:calc(max(1px,4px))", "padding:calc(max(1px,4px))"],
    ["transform:translateX(calc(clamp(-8px,20px,8px)))", "transform:translatex(calc(clamp(-8px,20px,8px)))"],
    ["box-shadow:0 0 calc(clamp(0px,30px,24px)) rgb(0 0 0 / .8)", "box-shadow:0 0 calc(clamp(0px,30px,24px)) rgb(0 0 0/.8)"],
  ]) {
    assert.equal(pipeline(`${SLOT}{${decl}}`).ok, true, decl);
    assert.equal(ok(`${SLOT}{${decl}}`).css, `${SLOT}{${canonical}}`);
  }
  assert.ok(sanitizeGradientCss({ value: "linear-gradient(red,blue)", size: "calc(clamp(10px,20px,30px))" }, "").ok);
});

// ---------------------------------------------------------------------------------------------
// Finding 4: audited pair properties need positive proof of the right variable.

test("r1 finding 4: CSS-wide keywords never replace an audited foreground or backing", () => {
  for (const property of ["color", "background-color"]) {
    for (const keyword of ["inherit", "initial", "unset", "revert", "revert-layer"]) {
      assert.match(refused(`.AppHeader{${property}:${keyword}}`, { native: true }), /not allowed; a theme sets values/, `${property}:${keyword}`);
    }
  }
  assert.match(reasons(`${SLOT}{border-width:initial}`), /initial is not allowed/);
  // The right pair variable compiles; the wrong one does not.
  assert.equal(pipeline(".AppHeader{color:var(--reskin-header-text);background-color:var(--reskin-header-background)}", { native: true }).ok, true);
  assert.match(refused(".AppHeader{color:var(--reskin-text)}", { native: true }), /must use --reskin-header-text, not --reskin-text/);
});

test("r1 finding 4: the compiler requires an audited color on pair properties even from hand-built IR", () => {
  const sanitized = ok(".AppHeader{color:var(--reskin-header-text)}");
  const withValue = (value, variables) => ({ ...sanitized, rules: [{ ...sanitized.rules[0], declarations: [{ ...sanitized.rules[0].declarations[0], value, variables, literalColor: false }] }] });
  for (const keyword of ["inherit", "initial", "unset", "revert", "revert-layer", "INHERIT"]) {
    const result = compileCss(withValue(keyword, []), { registry, cssAllowed: true, preferences: FULL });
    assert.equal(result.ok, false, keyword);
    assert.match(result.issues[0].message, /cannot hand its value back to the cascade/);
  }
  const none = compileCss(withValue("none", []), { registry, cssAllowed: true, preferences: FULL });
  assert.match(none.issues[0].message, /color on header-chrome targets must use --reskin-header-text/);
  assert.ok(compileCss(sanitized, { registry, cssAllowed: true, preferences: FULL }).ok);
});

// ---------------------------------------------------------------------------------------------
// Finding 5: the transform as a whole stays within 8px and 8deg.

test("r1 finding 5: repeated, mixed-axis, cancelling and rotate-first transforms are refused", () => {
  for (const transform of [
    "translateX(8px) translateX(8px)",
    "rotate(8deg) rotate(8deg)",
    "translateX(8px) translateY(8px)",
    "translate(4px) translate(4px)",
    "translateX(8px) translateX(-8px)",
    "rotate(8deg) rotate(-8deg)",
    "rotate(8deg) translate(8px,8px)",
  ]) {
    assert.match(refused(`${SLOT}{transform:${transform}}`), /one (translation|rotation)|translates before it rotates/, transform);
  }
});

test("r1 finding 5: one translation, then one rotation, at the 8px and 8deg boundaries still compiles", () => {
  for (const transform of ["translateX(8px)", "translate(-8px,8px)", "rotate(-8deg)", "translate(8px,8px) rotate(8deg)", "translateY(-8px) rotate(8deg)"]) {
    assert.equal(pipeline(`${SLOT}{transform:${transform}}`).ok, true, transform);
  }
  assert.match(reasons(`${SLOT}{transform:translateX(8.01px)}`), /moves at most 8px/);
  assert.match(reasons(`${SLOT}{transform:rotate(8.01deg)}`), /rotates at most 8deg/);
  assert.match(reasons(`${SLOT}{transform:scale(2)}`), /scale\(\) is not an allowed/);
});

// ---------------------------------------------------------------------------------------------
// Finding 6: unused values and discarded fallbacks get the full checks.

test("r1 finding 6: unused theme values are checked as admitted, finite scalars", () => {
  assert.match(reasons(`${SLOT}{--theme-x:rgb(garbage);opacity:1}`), /--theme-x is not a valid color/);
  assert.match(reasons(`${SLOT}{--theme-x:calc(1px / 0);opacity:1}`), /--theme-x is not a valid color, a finite length/);
  assert.match(reasons(`${SLOT}{--theme-x:calc(1px + 1em);opacity:1}`), /--theme-x is not a valid/);
  assert.match(reasons(`${SLOT}{--theme-x:solid;opacity:1}`), /--theme-x is not a valid/);
  // Valid scalars of each kind, used or not.
  const value = ok(`${SLOT}{--theme-a:rgb(10 20 30);--theme-b:calc(2px * 2);--theme-c:50%;--theme-d:1.5;--theme-e:var(--reskin-accent);--theme-f:color-mix(in srgb,var(--reskin-accent) 40%,transparent);--theme-g:#abc;opacity:1}`);
  assert.equal(value.css, `${SLOT}{opacity:1}`);
});

test("r1 finding 6: fallback dependencies are declared, acyclic and within the edge limit", () => {
  assert.match(reasons(`${SLOT}{--theme-x:var(--reskin-accent,var(--theme-missing));border-color:var(--theme-x)}`), /--theme-missing is used but never declared/);
  assert.match(reasons(`${SLOT}{--theme-x:var(--reskin-accent,var(--theme-x));border-color:var(--theme-x)}`), /--theme-x depends on itself/);
  let chain = `${SLOT}{--theme-c0:red;`;
  for (let n = 1; n <= 9; n++) chain += `--theme-c${n}:var(--reskin-accent,var(--theme-c${n - 1}));`;
  assert.match(reasons(`${chain}opacity:1}`), /--theme-c9 depends on more than 8/);
  // A fallback inside a declaration is a scalar too.
  assert.match(reasons(`${SLOT}{--theme-x:var(--reskin-accent,999px solid);border-color:var(--theme-x)}`), /A var\(\) fallback in --theme-x is not a valid/);
  assert.match(reasons(`${SLOT}{--theme-x:var(--reskin-accent,rgb(garbage));opacity:1}`), /A var\(\) fallback in --theme-x is not a valid/);
  assert.match(reasons(`${SLOT}{--theme-x:var(--reskin-accent,calc(1px / 0));opacity:1}`), /A var\(\) fallback in --theme-x is not a valid/);
  // A declared fallback dependency is fine, and the fallback still leaves the output.
  assert.equal(ok(`${SLOT}{--theme-y:red;--theme-x:var(--reskin-accent,var(--theme-y));border-color:var(--theme-x)}`).css, `${SLOT}{border-color:var(--reskin-accent)}`);
});

test("r1 finding 6: every fallback is checked against the property's grammar and bounds at each use", () => {
  assert.match(reasons(`${SLOT}{border-color:var(--reskin-accent,999999px)}`), /In a var\(\) fallback: This is not a valid border-color value/);
  assert.match(reasons(`${SLOT}{border-radius:var(--reskin-radius,999.01px)}`), /In a var\(\) fallback: This border-radius value is outside its allowed range/);
  assert.match(reasons(`${SLOT}{--theme-x:red;border-color:var(--theme-x,999999px)}`), /In a var\(\) fallback/);
  assert.match(reasons(`${SLOT}{border-color:var(--reskin-accent,var(--reskin-text,1px))}`), /In a var\(\) fallback/);
  assert.match(reasons(`${SLOT}{border-color:var(--reskin-accent,var(--theme-missing))}`), /--theme-missing is used but never declared/);
  assert.match(reasons(`${SLOT}{box-shadow:0 0 0 var(--reskin-accent,inherit)}`), /inherit is not allowed/);
  // Fallbacks of the right type are accepted and removed.
  assert.equal(ok(`${SLOT}{border-color:var(--reskin-accent,red)}`).css, `${SLOT}{border-color:var(--reskin-accent)}`);
  assert.equal(ok(`${SLOT}{--theme-x:blue;box-shadow:0 0 2px var(--reskin-accent,var(--theme-x))}`).css, `${SLOT}{box-shadow:0 0 2px var(--reskin-accent)}`);
});

// ---------------------------------------------------------------------------------------------
// Policy coverage the review's table found without dedicated tests.

test("r1 coverage: the aggregate source budget applies before canonicalization, through file, text and RS1", () => {
  const rule = `${SLOT}{border-color:red}`;
  const over = { ...MINIMAL, css: rule + " ".repeat(LIMITS.cssUtf8Bytes - rule.length), backgrounds: { page: { layers: [{ gradientCss: { value: "linear-gradient(red,blue)" } }] } } };
  assert.equal(validateTheme(over).ok, false);
  for (const kind of ["file", "text"]) {
    const result = parseImport(JSON.stringify(over), kind);
    assert.equal(result.ok, false, kind);
    assert.deepEqual(result.issues.map((i) => [i.code, i.path]), [[ISSUE_CODES.outOfBounds, "/css"]]);
  }
  const share = decodeShare(encodeShare({ ...MINIMAL, css: rule }));
  assert.ok(share.ok);
  // At the budget exactly, the padded source still imports and is canonicalized.
  const exact = { ...over, css: rule + " ".repeat(LIMITS.cssUtf8Bytes - rule.length - "linear-gradient(red,blue)".length) };
  const imported = parseImport(JSON.stringify(exact), "file");
  assert.ok(imported.ok, JSON.stringify(imported.issues));
  assert.equal(imported.normalized.css, rule);
});

test("r1 coverage: sender CSS consent cannot travel inside a theme", () => {
  const result = validateTheme({ ...MINIMAL, cssConsent: { hash: "0".repeat(64), sanitizerVersion: 1 } });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.path === "/cssConsent" || i.path === ""), JSON.stringify(result.issues));
});

test("r1 coverage: CSS gradient stops never go backwards, in advanced CSS or gradientCss", () => {
  for (const gradient of ["linear-gradient(red 80%,blue 20%)", "linear-gradient(red 20% 10%,blue)", "linear-gradient(red 40px,blue 0)", "linear-gradient(red,blue 50%,green 40%)"]) {
    assert.match(reasons(`${SLOT}{background-image:${gradient}}`), /must not go backwards/, gradient);
    assert.equal(sanitizeGradientCss({ value: gradient }, "").ok, false, gradient);
  }
  assert.match(reasons(`${SLOT}{background-image:linear-gradient(red 10px,blue 50%)}`), /one unit/);
  for (const gradient of ["linear-gradient(red,blue)", "linear-gradient(red 0,blue 20%)", "linear-gradient(red 10%,green,blue 10%)", "linear-gradient(red 10% 20%,blue 20% 40%)", "repeating-linear-gradient(red 0,blue 8px)"]) {
    assert.ok(ok(`${SLOT}{background-image:${gradient}}`), gradient);
    assert.ok(sanitizeGradientCss({ value: gradient }, "").ok, gradient);
  }
});

test("r1 coverage: gradient angle, stop, radial and repeating bounds at their edges", () => {
  const accept = ["linear-gradient(0deg,red,blue)", "linear-gradient(360deg,red,blue)", "linear-gradient(red -200%,blue 200%)", "linear-gradient(red -2048px,blue 2048px)", "radial-gradient(circle 4096px,red,blue)", "radial-gradient(ellipse 200% 1px,red,blue)", "radial-gradient(circle at -200% 200%,red,blue)", "repeating-linear-gradient(red 0,blue 2px)", "repeating-linear-gradient(red 0,blue 2048px)"];
  const reject = ["linear-gradient(360.01deg,red,blue)", "linear-gradient(red -201%,blue 100%)", "linear-gradient(red 0,blue 2049px)", "radial-gradient(circle 4097px,red,blue)", "radial-gradient(ellipse 201% 1px,red,blue)", "radial-gradient(circle 0px,red,blue)", "radial-gradient(circle at 201% 0,red,blue)", "repeating-linear-gradient(red 0,blue 1.99px)", "repeating-linear-gradient(red 0,blue 2048.01px)", "repeating-linear-gradient(red 0,blue 50%)"];
  for (const gradient of accept) assert.ok(sanitizeGradientCss({ value: gradient }, "").ok, gradient);
  for (const gradient of reject) assert.equal(sanitizeGradientCss({ value: gradient }, "").ok, false, gradient);
});

test("r1 coverage: background list size, position and repeat boundaries", () => {
  for (const decl of ["background-size:4096px 200%", "background-size:200vw 200vh", "background-position:200% -200%", "background-position:4096px -4096px", "background-repeat:no-repeat,repeat-x,repeat-y,repeat", "background-size:1px,2px,3px,4px"]) {
    assert.equal(pipeline(`${SLOT}{${decl}}`).ok, true, decl);
  }
  for (const decl of ["background-size:4096.01px", "background-size:201%", "background-position:201%", "background-position:4097px", "background-size:1px,2px,3px,4px,5px", "background-repeat:repeat,repeat,repeat,repeat,repeat", "background-attachment:fixed"]) {
    assert.equal(pipeline(`${SLOT}{${decl}}`).ok, false, decl);
  }
});

test("r1 coverage: one-past numeric bounds on owned geometry, borders, radii and typography", () => {
  for (const [property, inside, past] of [
    ["border-width", "4px", "4.01px"],
    ["border-radius", "999px", "999.01px"],
    ["padding", "32px", "32.01px"],
    ["margin", "-32px", "-32.01px"],
    ["width", "360px", "360.01px"],
    ["height", "96px", "96.01px"],
    ["max-width", "360px", "360.01px"],
    ["max-height", "96px", "96.01px"],
    ["font-size", "64px", "64.01px"],
    ["line-height", "1.1", "1.09"],
    ["letter-spacing", ".2em", ".201em"],
    ["opacity", "1", "1.01"],
  ]) {
    assert.equal(pipeline(`${SLOT}{${property}:${inside}}`).ok, true, `${property}:${inside}`);
    assert.match(reasons(`${SLOT}{${property}:${past}}`), /outside its allowed range/, `${property}:${past}`);
  }
});

test("r1 coverage: box and text shadow offsets, blur, spread, count and sum", () => {
  for (const shadow of ["9px 0 0 red", "0 9px 0 red", "-9px 0 0 red", "0 0 24.01px red", "0 0 0 4.01px red", "0 0 0 -8.01px red"]) assert.match(reasons(`${SLOT}{box-shadow:${shadow}}`), /Shadow/, shadow);
  for (const shadow of ["9px 0 rgb(0 0 0/.5)", "0 -9px rgb(0 0 0/.5)", "0 0 24.01px rgb(0 0 0/.5)", "0 0 1px 1px rgb(0 0 0/.5)", "0 0 1px rgb(0 0 0/.81)"]) assert.equal(sanitizeCss(`${SLOT}{text-shadow:${shadow}}`).ok, false, shadow);
  const five = Array(5).fill("0 0 1px rgb(0 0 0/.5)").join(",");
  assert.match(reasons(`${SLOT}{text-shadow:${five}}`), /at most 4 entries/);
  assert.match(reasons(`${SLOT}{text-shadow:0 0 24px red,0 0 24px red,0 0 1px red}`), /Text shadows stay at or below|blurs at most 48px/);
  assert.match(reasons(`${SLOT}{text-shadow:0 0 24px rgb(0 0 0/.5),0 0 24px rgb(0 0 0/.5),0 0 1px rgb(0 0 0/.5)}`), /blurs at most 48px in total/);
  assert.ok(ok(`${SLOT}{text-shadow:8px -8px 24px rgb(0 0 0/.8),0 0 24px rgb(0 0 0/.8)}`));
});

test("r1 coverage: each named at-rule is refused, with valid syntax", () => {
  for (const css of [
    "@layer x{.AppHeader{border-color:red}}",
    "@container (min-width:1px){.AppHeader{border-color:red}}",
    "@scope (.Box){.AppHeader{border-color:red}}",
    '@property --theme-x{syntax:"<color>";inherits:false;initial-value:red}',
    '@charset "UTF-8";',
    "@page{color:red}",
    "@font-face{font-family:X;src:local(Arial)}",
    '@namespace svg "https://leak.invalid";',
    '@import "https://leak.invalid/x.css";',
    '@document url-prefix("https://github.com"){.AppHeader{border-color:red}}',
    '@-moz-document url-prefix("https://github.com"){.AppHeader{border-color:red}}',
    "@keyframes x{to{opacity:0}}",
    "@-webkit-keyframes x{to{opacity:0}}",
    "@unknown{.AppHeader{border-color:red}}",
  ]) {
    assert.equal(sanitizeCss(css).ok, false, css);
  }
});

test("r1 coverage: media features, types, modifiers and the nesting limit", () => {
  const media = (query) => `@media ${query}{${SLOT}{border-color:red}}`;
  for (const query of ["(prefers-reduced-motion:reduce)", "(prefers-reduced-motion:no-preference)", "(hover:hover)", "(hover:none)", "(pointer:fine)", "(pointer:coarse)", "(pointer:none)", "(min-width:10000px)", "(max-width:625em)", "screen and (min-width:1px)", "all and (hover:none)"]) {
    assert.ok(ok(media(query)), query);
  }
  for (const query of ["(min-width:10000.01px)", "(max-width:626em)", "(prefers-color-scheme:dark)", "(orientation:portrait)", "print", "not screen", "only screen", "(hover:hover) or (pointer:fine)", "(pointer:other)"]) {
    assert.equal(sanitizeCss(media(query)).ok, false, query);
  }
  const nested = (depth) => `${"@media (hover:hover){".repeat(depth)}${SLOT}{border-color:red}${"}".repeat(depth)}`;
  assert.ok(ok(nested(8)));
  assert.match(reasons(nested(9)), /nest at most 8/);
});

test("r1 coverage: whitespace, NUL, escaped controls, byte order marks and non-BMP text", () => {
  assert.ok(ok(`${SLOT}{\t\r\nborder-color:red\r\n}`));
  assert.match(reasons(`${SLOT}{border-color:red}\0`), /control or text-direction/);
  assert.match(reasons(`﻿${SLOT}{border-color:red}`), /control or text-direction/);
  assert.match(reasons(`[data-testid="a\\1 b"]{border-color:red}`), /control characters/);
  assert.match(reasons(`${SLOT}{border-color:red}‮`), /control or text-direction/);
  assert.ok(ok(`/* 🦉 */${SLOT}{border-color:red}`));
  assert.equal(sanitizeCss(".🦉{border-color:red}").ok, false);
});

test("r1 coverage: allowed selectors compile, each state pseudo-class and permitted nesting included", () => {
  for (const rule of [".AppHeader{border-color:red}", ".Header>.HeaderMktg{border-color:red}", ".Layout .Header{border-color:red}", "h2.f4{color:var(--reskin-accent)}", '.AppHeader[data-testid="reviewed-header"]{border-color:red}', '.tabnav-tab[aria-current="page"]{color:var(--reskin-link)}', ":is(.Header,.HeaderMktg){border-color:red}", ":where(.Header){border-color:red}"]) {
    assert.equal(pipeline(rule, { native: true }).ok, true, rule);
  }
  for (const state of ["hover", "active", "focus", "focus-visible", "checked", "disabled", "first-child", "last-child"]) {
    assert.ok(ok(`.Header:${state}{border-color:var(--reskin-accent)}`), state);
  }
  for (const selector of ["#main", '[data-component="x"]', ".a:not(.b)", ":is(.a,:where(.b,:is(.c)))"]) assert.ok(ok(`${selector}{border-color:red}`), selector);
});

test("r1 coverage: sensitive attributes, namespaces, siblings and forbidden pseudo-classes are refused", () => {
  for (const selector of ['input[value="secret"]', 'a[href="/x"]', 'img[src="x"]', 'input[name="token"]', '.AppHeader[title="x"]', '.AppHeader[nonce="x"]', '.AppHeader[token="x"]', '.AppHeader[data-reskin-css-kind="header-chrome"]', '[data-testid^="x"]', '[data-testid*="x"]', '[data-testid="x" i]']) {
    assert.equal(sanitizeCss(`${selector}{border-color:red}`).ok, false, selector);
  }
  for (const selector of ["svg|rect", "*|a", ".a+.AppHeader", ".a~.AppHeader", ".AppHeader:visited", ".AppHeader:has(.a)", ".AppHeader:target", ":host", ".AppHeader::slotted(a)", ".AppHeader::part(foo)", ".AppHeader::before", ".AppHeader::marker", ".AppHeader:unknown"]) {
    assert.equal(sanitizeCss(`${selector}{border-color:red}`).ok, false, selector);
  }
});

test("r1 coverage: every prohibited native property is refused on its own", () => {
  const values = { display: "none", visibility: "hidden", opacity: "0", position: "absolute", inset: "0", top: "0", right: "0", bottom: "0", left: "0", "z-index": "9999", "pointer-events": "auto", transform: "translateX(1px)", overflow: "hidden", clip: "rect(0,0,0,0)", "clip-path": "circle(1px)", mask: "none", filter: "blur(1px)", "backdrop-filter": "blur(1px)", outline: "none", "font-size": "0", "line-height": "0", content: '"Sign in"', animation: "none", transition: "all 1s", direction: "rtl", "unicode-bidi": "bidi-override", appearance: "none", "user-select": "none", zoom: "2", "forced-color-adjust": "none" };
  assert.equal(Object.keys(values).length, 30);
  for (const [property, value] of Object.entries(values)) assert.equal(pipeline(`.AppHeader{${property}:${value}}`, { native: true }).ok, false, property);
});

test("r1 coverage: legacy filters and escaped vendor keywords are refused without a URL", () => {
  assert.match(reasons(`${SLOT}{filter:progid:DXImageTransform.Microsoft.Alpha(opacity=50)}`), /not allowed|could not be read/);
  assert.match(reasons(`${SLOT}{border-style:-\\77 ebkit-box}`), /Vendor keyword|not an allowed keyword/);
  assert.match(reasons(".AppHeader{-moz-binding:none}"), /not an allowed property/);
});

test("r1 coverage: only the illustration corner positions itself, absolutely, within 0-100%", () => {
  assert.equal(pipeline(`${CORNER}{position:absolute;right:100%;bottom:0%}`).ok, true);
  assert.match(reasons(`${CORNER}{position:absolute;right:100.01%}`), /outside its allowed range/);
  assert.match(reasons(`${CORNER}{position:fixed}`), /fixed is not allowed for position/);
  assert.match(reasons(`${CORNER}{top:10px}`), /outside its allowed range/);
  assert.match(reasons(`${SLOT}{position:absolute}`), /allowed only on an exact Reskin decoration/);
});

test("r1 coverage: the published css-tree 3.1.0 distribution is installed unchanged", () => {
  const lock = JSON.parse(readFileSync(`${ROOT}package-lock.json`, "utf8")).packages["node_modules/css-tree"];
  assert.equal(lock.version, "3.1.0");
  assert.equal(lock.resolved, "https://registry.npmjs.org/css-tree/-/css-tree-3.1.0.tgz");
  assert.equal(lock.integrity, CSS_TREE_INTEGRITY);
  const manifest = JSON.parse(readFileSync(`${ROOT}node_modules/css-tree/package.json`, "utf8"));
  assert.deepEqual([manifest.name, manifest.version, manifest.license], ["css-tree", "3.1.0", "MIT"]);
  const sha = (path) => createHash("sha256").update(readFileSync(`${ROOT}${path}`)).digest("hex");
  assert.equal(sha("node_modules/css-tree/dist/csstree.esm.js"), CSS_TREE_ESM_SHA256);
  assert.equal(sha("node_modules/css-tree/LICENSE"), CSS_TREE_LICENSE_SHA256);
});
