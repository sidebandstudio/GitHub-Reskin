import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ISSUE_CODES } from "../../packages/contracts/index.js";
import {
  compileCss,
  CSS_POLICY_HASH,
  cssProofs,
  escapeCssForHtml,
  escapeHtmlText,
  installStyleText,
  registryProblems,
  sanitizeCss,
  sanitizeGradientCss,
  styleElementHtml,
  transportEquivalent,
  unsafeForStyleElement,
} from "../../packages/format/index.js";
import { element, append, matchedElements } from "../../packages/format/css/selector-model.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const registry = json("tests/fixtures/css-registry-synthetic.json").registry;
const FULL = { enabled: true, appearance: "full", extras: true, text: true, motion: true, fonts: true, effects: true };
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

test("sanitized CSS is canonical, hashed and a fixed point of the sanitizer", () => {
  const value = ok(".AppHeader , .Header { box-shadow : 0 1px 0 var( --reskin-accent ) ; }\n\n/* note */");
  assert.equal(value.css, ".AppHeader,.Header{box-shadow:0 1px 0 var(--reskin-accent)}");
  assert.equal(value.hash, createHash("sha256").update(value.css).digest("hex"));
  assert.equal(value.policyHash, CSS_POLICY_HASH);
  assert.equal(value.sanitizerVersion, 1);
  const again = ok(value.css);
  assert.deepEqual([again.css, again.hash, again.rules], [value.css, value.hash, value.rules]);
  assert.deepEqual(ok("").rules, []);
});

test("escaped and mixed-case names are decoded before every comparison", () => {
  assert.match(reasons(".AppHeader{background-image:u\\000072l(x)}"), /url\(\) can load/);
  assert.match(reasons("@im\\70ort 'x';"), /@import is not allowed/);
  assert.match(reasons('[data-reskin-slot="profile.tag"]::before{c\\6fntent:"Sign in"}'), /Strings are not allowed/);
  assert.match(reasons(".AppHeader{--r\\65skin-accent:red}"), /cannot redefine --reskin-accent/);
  assert.equal(ok(".AppHeader{border-color:R\\45 D}").css, ".AppHeader{border-color:red}");
});

test("every rejection is located and refuses the whole input, never stripping a rule", () => {
  const result = sanitizeCss(".AppHeader{border-color:red}\n.AppHeader{display:none}");
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((i) => [i.code, i.path, /line 2, column 12/.test(i.message)]), [[ISSUE_CODES.css, "/css", true]]);
  assert.equal(sanitizeCss(".a{color:red}", { path: "/backgrounds/x" }).ok, true);
  assert.match(sanitizeCss(".AppHeader{color:red", {}).issues[0].message, /not closed/);
  assert.match(reasons('.AppHeader{border-color:red}"unclosed'), /string is not closed|not closed/);
  assert.match(reasons(".AppHeader{border-color:red;;}"), /could not be read/);
});

test("author !important is removed with a note, never kept", () => {
  const value = ok(".AppHeader{border-color:var(--reskin-accent)!important}");
  assert.equal(value.css, ".AppHeader{border-color:var(--reskin-accent)}");
  assert.deepEqual(value.notes.map((n) => [n.code, n.severity]), [["css-important", "info"]]);
  assert.match(reasons(".AppHeader{border-color:red !ie}"), /unknown ! flag/);
});

test("theme-local variables are substituted statically, bounded and never left for the page", () => {
  const value = ok(".AppHeader{--theme-edge:var(--reskin-accent);border-color:var(--theme-edge)}");
  assert.equal(value.css, ".AppHeader{border-color:var(--reskin-accent)}");
  assert.deepEqual(value.rules[0].declarations[0].variables, ["--reskin-accent"]);
  assert.match(reasons(".AppHeader{--theme-a:var(--theme-b);--theme-b:var(--theme-a);border-color:var(--theme-a)}"), /depends on itself/);
  assert.match(reasons(".AppHeader{border-color:var(--theme-missing)}"), /never declared/);
  assert.match(reasons(".AppHeader{--theme-x:1px solid red}"), /holds one value/);
  assert.match(reasons(".AppHeader:hover{--theme-x:red}"), /cannot change inside @media, @supports or a state selector/);
  assert.match(reasons(".AppHeader{border-color:var(--color-accent-fg)}"), /not an audited Reskin variable/);
  // Fallbacks are validated, then dropped: the host always defines its variables.
  assert.equal(ok(".AppHeader{border-color:var(--reskin-accent,red)}").css, ".AppHeader{border-color:var(--reskin-accent)}");
  assert.match(reasons(".AppHeader{border-color:var(--reskin-accent,url(x))}"), /url\(\)/);
});

test("budgets can be lowered for boundary tests but never raised", () => {
  const css = '[data-reskin-slot="profile.tag"]{opacity:1}';
  assert.equal(sanitizeCss(css, { budgets: { sourceBytes: css.length } }).ok, true);
  assert.equal(sanitizeCss(css, { budgets: { sourceBytes: css.length - 1 } }).ok, false);
  const big = `[data-reskin-slot="profile.tag"]{opacity:1}`.repeat(800);
  assert.ok(big.length > 32768);
  assert.equal(sanitizeCss(big, { budgets: { sourceBytes: 1e9 } }).ok, false);
});

test("shadows: the crisp opaque rule passes, every other native shadow stays bounded", () => {
  ok(".AppHeader{box-shadow:0 1px 0 var(--reskin-accent),0 4px 24px -6px color-mix(in srgb,var(--reskin-accent) 55%,transparent)}");
  ok(".AppHeader{box-shadow:0 1px 4px rgb(255 255 0 / .8)}");
  assert.match(reasons(".AppHeader{box-shadow:0 1px 4px rgb(255 255 0 / .8001)}"), /0.8 opacity/);
  assert.match(reasons(".AppHeader{box-shadow:0 1px .01px var(--reskin-accent)}"), /0.8 opacity/);
  assert.match(reasons(".AppHeader{box-shadow:0 1.01px 0 var(--reskin-accent)}"), /0.8 opacity/);
  assert.match(reasons(".AppHeader{box-shadow:inset 0 1px 0 var(--reskin-accent)}"), /Inset shadows/);
  assert.match(reasons(".AppHeader{box-shadow:0 0 25px rgb(0 0 0 / .5)}"), /blur stays within/);
  // Owned decorations may be opaque and inset, still within the list bounds.
  ok('[data-reskin-slot="profile.tag"]{box-shadow:inset 0 0 8px var(--reskin-accent),0 0 10px var(--reskin-accent)}');
  assert.match(reasons('[data-reskin-slot="profile.tag"]{text-shadow:0 0 6px var(--reskin-accent)}'), /Text shadows stay at or below/);
});

test("gradients and background lists stay within four layers, eight stops and bounded geometry", () => {
  ok(".AppHeader{background-image:radial-gradient(ellipse 80% 50% at 50% -10%,#00f0ff1a,transparent 70%)}");
  ok(".AppHeader{background-image:repeating-linear-gradient(#e4f3ff05 0 1px,transparent 1px 3px)}");
  assert.match(reasons(".AppHeader{background-image:linear-gradient(red,50%,blue)}"), /interpolation hints/);
  assert.match(reasons(".AppHeader{background-image:repeating-linear-gradient(red 0,blue 1px)}"), /repeats every 2-2048px/);
  assert.match(reasons(".AppHeader{background-image:repeating-linear-gradient(red 0%,blue 10%)}"), /every position in px/);
  assert.match(reasons(".AppHeader{background-image:radial-gradient(circle at 250% 50%,red,blue)}"), /centers stay within/);
  assert.match(reasons(".AppHeader{background-image:linear-gradient(400deg,red,blue)}"), /0-360deg/);
  assert.match(reasons(".AppHeader{background-size:5000px}"), /out of bounds/);
  assert.match(reasons(".AppHeader{background-attachment:fixed}"), /not an allowed property/);
});

test("gradientCss admits exactly one bounded gradient value and size, with no variables or resources", () => {
  const at = "/backgrounds/page/layers/0/gradientCss";
  assert.deepEqual(sanitizeGradientCss({ value: "linear-gradient( #00F0FF0D 1px , transparent 1px )", size: "48px  48px" }, at), { ok: true, value: "linear-gradient(#00f0ff0d 1px,transparent 1px)", size: "48px 48px" });
  for (const value of ["image-set('x' 1x)", "linear-gradient(red,blue);color:transparent", "linear-gradient(var(--reskin-accent),red)", "linear-gradient(red,blue),linear-gradient(red,blue)", "url(x)"]) {
    const result = sanitizeGradientCss({ value }, at);
    assert.equal(result.ok, false, value);
    assert.ok(result.issues.every((i) => i.path === `${at}/value`), value);
  }
  assert.deepEqual(sanitizeGradientCss({ value: "linear-gradient(red,blue)", size: "cover" }, at).issues[0].path, `${at}/size`);
  assert.equal(sanitizeGradientCss({ value: "linear-gradient(red,blue)", size: "100% 300vh" }, at).ok, false);
});

test("deferred CSS conveniences are rejected with their own reason", () => {
  assert.match(reasons(".AppHeader{ & .x{border-color:red}}"), /nesting is not available/);
});

test("@supports tests permitted properties one declaration at a time, negated or joined, and keeps every rule checked", () => {
  const tag = '[data-reskin-slot="profile.tag"]{border-radius:6px 0;corner-shape:bevel}';
  const admitted = ok(`@supports NOT (Corner-Shape: BEVEL){${tag}}`);
  assert.equal(admitted.css, `@supports not (corner-shape:bevel){${tag}}`);
  assert.deepEqual(admitted.rules[0].conditions, ["@supports not (corner-shape:bevel)"]);
  const nested = ok(`@media (min-width:600px){@supports (corner-shape:bevel) and (border-radius:4px 0){@supports not (corner-shape:notch){${tag}}}}`);
  assert.deepEqual(nested.rules[0].conditions, ["@media (min-width:600px)", "@supports (corner-shape:bevel) and (border-radius:4px 0)", "@supports not (corner-shape:notch)"]);
  ok(`@supports (corner-shape:bevel) or (corner-shape:notch){${tag}}`);
  // The compiler keeps the chain, outermost first.
  const compiled = compileCss(nested, { registry: null, cssAllowed: true, preferences: FULL });
  assert.ok(compiled.ok);
  assert.match(compiled.css, /^@media \(min-width:600px\)\{@supports \(corner-shape:bevel\) and \(border-radius:4px 0\)\{@supports not \(corner-shape:notch\)\{:where/);

  const refused = {
    [`@supports ((corner-shape:bevel) or (border-radius:1px)){${tag}}`]: /could not be read as CSS/,
    [`@supports (not (corner-shape:bevel)) or (border-radius:1px){${tag}}`]: /could not be read as CSS/,
    [`@supports (corner-shape:bevel) and (border-radius:1px) or (color:red){${tag}}`]: /one of and or or, never both/,
    [`@supports not (corner-shape:bevel) and (color:red){${tag}}`]: /not tests one declaration/,
    [`@supports selector(:has(a)){${tag}}`]: /not selectors, fonts or functions/,
    [`@supports (display:grid){${tag}}`]: /display is not one/,
    [`@supports (-moz-appearance:none){${tag}}`]: /-moz-appearance is not one/,
    [`@supports (--theme-edge:1px){${tag}}`]: /cannot test a custom property/,
    [`@supports (color:var(--reskin-accent)){${tag}}`]: /literal values, no variables/,
    [`@supports (background-image:url(https://leak.invalid/x)){${tag}}`]: /url\(\) is not allowed/,
    [`@supports (corner-shape:pointy){${tag}}`]: /not a valid corner-shape value/,
    [`@supports (color:inherit){${tag}}`]: /inherit is not allowed/,
    [`@supports (border-radius:1px !important){${tag}}`]: /no !important/,
    ["@supports (corner-shape:bevel){.AppHeader{display:none}}"]: /display is not an allowed property/,
    ["@supports (corner-shape:bevel){.AppHeader{--theme-edge:red;border-color:var(--theme-edge)}}"]: /cannot change inside @media, @supports/,
  };
  for (const [css, reason] of Object.entries(refused)) assert.match(reasons(css), reason, css);
  // Each refusal is located.
  assert.match(reasons(`@supports (display:grid){${tag}}`), /line 1, column 12/);
});

test("rasters r1 finding 4: an @supports test keeps each property's value bounds", () => {
  const rule = ".AppHeader{border-color:var(--reskin-accent)}";
  const gradient = "linear-gradient(red,blue)";
  const refused = {
    "(border-width:10000px)": /border-width value is outside its allowed range/,
    "(opacity:2)": /opacity value is outside its allowed range/,
    "(border-radius:calc(1px / 0))": /cannot be checked for a finite range/,
    [`(background-image:${Array(5).fill(gradient).join(",")})`]: /at most 4 layers/,
    "(font-family:evil)": /themes cannot request other fonts/,
    "(box-shadow:0 0 30px red)": /blur stays within 0-24px/,
    "(font-weight:900)": /font-weight is 400, 500, 600 or 700/,
    "(transform:rotate(45deg))": /rotates at most 8deg/,
    // Each joined or negated test is bounded alike.
    "not (border-width:10000px)": /border-width value is outside/,
    "(corner-shape:bevel) and (opacity:2)": /opacity value is outside/,
    "(corner-shape:bevel) or (font-family:evil)": /cannot request other fonts/,
  };
  for (const [test, reason] of Object.entries(refused)) assert.match(reasons(`@supports ${test}{${rule}}`), reason, test);
  for (const test of ["(border-width:4px)", "(opacity:0.5)", "(border-radius:calc(4px + 2px))", `(background-image:${Array(4).fill(gradient).join(",")})`, "(font-family:serif)", "(box-shadow:0 0 24px red)", "(font-weight:700)"]) {
    ok(`@supports ${test}{${rule}}`);
  }
});

test("without a registry, native-node CSS fails closed and owned decorations still compile", () => {
  const owned = ok('[data-reskin-slot="profile.tag"]{border:1px solid var(--reskin-accent)}');
  const compiled = compileCss(owned, { registry: null, cssAllowed: true, preferences: FULL });
  assert.ok(compiled.ok);
  assert.equal(compiled.css, ':where([data-reskin-css="active"]) [data-reskin-owned][data-reskin-slot="profile.tag"]:not([data-reskin-native],[data-reskin-native] *,[data-reskin-protected],[data-reskin-protected] *){border:1px solid var(--reskin-accent)}');
  const native = ok(".AppHeader{box-shadow:0 1px 0 var(--reskin-accent)}");
  const closed = compileCss(native, { registry: null, cssAllowed: true, preferences: FULL });
  assert.equal(closed.ok, false);
  assert.match(closed.issues[0].message, /needs the reviewed target registry/);
  const broken = compileCss(native, { registry: { ...registry, registryVersion: 2 }, cssAllowed: true, preferences: FULL });
  assert.match(broken.issues[0].message, /registry is unusable/);
});

test("registry input is validated before any use", () => {
  assert.deepEqual(registryProblems(registry), []);
  assert.match(registryProblems({ ...registry, kinds: { "header-chrome": { ...registry.kinds["header-chrome"], properties: ["display"] } } }).join(), /native allowlist/);
  assert.match(registryProblems({ ...registry, subjects: [{ kind: "header-chrome", classes: ["AppHeader"], routes: [] }] }).join(), /reviewed routes/);
  assert.match(registryProblems({ ...registry, fixtures: {} }).join(), /fixtures/);
  assert.match(registryProblems({ ...registry, subjects: [{ kind: "page-backing", classes: [], routes: ["/"], predicates: [{ name: "data-reskin-slot", value: "x" }] }] }).join(), /must name classes|predicates/);
});

test("compiled native rules need the scope, the native gate and the subject's kind marker", () => {
  const value = ok(":is(.AppHeader,.tabnav-tab){border-color:var(--reskin-accent)}");
  const compiled = compileCss(value, { registry, cssAllowed: true, preferences: FULL });
  assert.ok(compiled.ok, JSON.stringify(compiled.issues));
  const html = element("html", { attrs: { "data-reskin-css": "active", "data-reskin-css-native": "active" } });
  const header = append(html, element("header", { classes: ["AppHeader"], attrs: { "data-reskin-css-kind": "header-chrome" } }));
  const tab = append(html, element("a", { classes: ["tabnav-tab"], attrs: { "data-reskin-css-kind": "control-chrome" } }));
  const unmarked = append(html, element("header", { classes: ["AppHeader"] }));
  const wrongKind = append(html, element("a", { classes: ["tabnav-tab"], attrs: { "data-reskin-css-kind": "header-chrome" } }));
  const island = append(html, element("div", { attrs: { "data-reskin-native": "" } }));
  const inIsland = append(island, element("header", { classes: ["AppHeader"], attrs: { "data-reskin-css-kind": "header-chrome" } }));
  assert.deepEqual(matchedElements(compiled.css, html), [header, tab]);
  delete html.attrs["data-reskin-css-native"];
  assert.deepEqual(matchedElements(compiled.css, html), []);
  void unmarked, wrongKind, inIsland;
});

test("a rule reaching several kinds gets their intersection, or the whole input fails", () => {
  const color = ok(":is(.AppHeader,.tabnav-tab){color:var(--reskin-text)}");
  const result = compileCss(color, { registry, cssAllowed: true, preferences: FULL });
  assert.equal(result.ok, false);
  assert.match(result.issues[0].message, /must use --reskin-header-text/);
  // A state selector cannot reach for an unaudited hover foreground.
  const hover = compileCss(ok("h2.f4{color:var(--reskin-text)}h2.f4:hover{color:var(--reskin-link)}"), { registry, cssAllowed: true, preferences: FULL });
  assert.match(hover.issues[0].message, /must use --reskin-text or --reskin-accent, not --reskin-link/);
  // Inherited properties never reach a kind whose subjects can hold unadmitted descendants.
  const inherited = compileCss(ok(".diff-row{color:var(--reskin-text)}"), { registry, cssAllowed: true, preferences: FULL });
  assert.match(inherited.issues[0].message, /color is inherited/);
  const literal = compileCss(ok(".AppHeader{color:#ffffff}"), { registry, cssAllowed: true, preferences: FULL });
  assert.match(literal.issues[0].message, /audited pair variables, not literal colors/);
});

test("html, body and :root map to the admitted page backing, never the document", () => {
  const compiled = compileCss(ok("body{background-image:linear-gradient(red,blue)}"), { registry, cssAllowed: true, preferences: FULL });
  assert.equal(compiled.css, ':where([data-reskin-css="active"][data-reskin-css-native="active"]) [data-reskin-css-kind="page-backing"]:not([data-reskin-native],[data-reskin-native] *,[data-reskin-protected],[data-reskin-protected] *){background-image:linear-gradient(red,blue)}');
  assert.match(reasons(".Layout body{color:red}"), /stand alone/);
});

test("Calm, Effects off, a disabled extension, native policy and missing consent omit CSS entirely", () => {
  const value = ok('.AppHeader{font-family:var(--reskin-font-heading)}[data-reskin-slot="profile.tag"]{letter-spacing:.2em}');
  const css = (preferences, extra = {}) => compileCss(value, { registry, cssAllowed: true, preferences, ...extra }).css;
  assert.ok(css(FULL).length > 0);
  for (const preferences of [{ ...FULL, appearance: "calm" }, { ...FULL, appearance: undefined, extras: false }, { ...FULL, effects: false }, { ...FULL, enabled: false }]) assert.equal(css(preferences), "", JSON.stringify(preferences));
  assert.equal(css(FULL, { policy: "forced-colors" }), "");
  assert.equal(css(FULL, { cssAllowed: false }), "");
  assert.doesNotMatch(css({ ...FULL, fonts: false }), /font-family|letter-spacing/);
  assert.doesNotMatch(css({ ...FULL, text: false }), /profile\.tag/);
});

test("transport escaping leaves no way out of the style element and proves the same AST", () => {
  const value = ok('.AppHeader:not([data-testid="</StYlE><script>x</script>"]){box-shadow:0 1px 0 var(--reskin-accent)}');
  const escaped = escapeCssForHtml(value.css);
  assert.ok(!escaped.includes("<"));
  assert.ok(transportEquivalent(value.css, escaped));
  assert.ok(!transportEquivalent(value.css, escaped.replace("\\3c ", "\\3e ")));
  assert.equal(styleElementHtml(value.css), `<style>${escaped}</style>`);
  assert.ok(unsafeForStyleElement(value.css));
  assert.equal(escapeHtmlText('</style><img src=x onerror="y">'), "&lt;/style&gt;&lt;img src=x onerror=&quot;y&quot;&gt;");
  const node = { textContent: "" };
  assert.equal(installStyleText(node, value.css).textContent, value.css);
  assert.throws(() => installStyleText(node, null), TypeError);
});

test("build-time proofs carry the sanitizer's result for bundled themes", () => {
  const choom = json("tests/fixtures/choom/choom-circuit-faithful.reskin.json");
  const proofs = cssProofs([choom]);
  assert.deepEqual(proofs.map((p) => p.kind), ["css", "gradientCss", "gradientCss", "gradientCss", "gradientCss"]);
  assert.equal(proofs[0].value.css, sanitizeCss(choom.css).value.css);
  assert.throws(() => cssProofs([{ ...choom, css: ".x{display:none}" }]), /display/);
});

test("escaped control characters cannot reach a predicate or end a compiled string", () => {
  assert.match(reasons('.AppHeader[data-testid="x\\a }body{display:none}"]{border-color:red}'), /cannot contain control characters/);
  const value = ok('.AppHeader[data-testid="reviewed-header"]{border-color:var(--reskin-accent)}');
  const forged = structuredClone(value);
  forged.rules[0].selectors[0].compounds[0].attributes[0].value = "a\n}body{display:none}";
  const local = structuredClone(registry);
  local.subjects[0].predicates.push({ name: "data-testid", value: "a\n}body{display:none}" });
  const compiled = compileCss(forged, { registry: local, cssAllowed: true, preferences: FULL });
  assert.ok(compiled.ok);
  assert.ok(!compiled.css.includes("\n"));
  assert.match(compiled.css, /\[data-testid="a\\a \}body\{display:none\}"\]/);
});
