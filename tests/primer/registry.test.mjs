// The finite native target registry, registryVersion 1, as C2b's compiler reads it: a valid
// CssTargetRegistry with reviewed fixtures, policies inside the native allowlist, and Choom's CSS
// for GitHub's own elements compiling against it while unregistered or protected targets fail.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CSS_MARKERS, CSS_VARIABLES } from "../../packages/contracts/index.js";
import { compileCss, registryProblems, sanitizeCss } from "../../packages/format/index.js";
import { ROUTE_SIGNALS } from "../../extension/content/github/routes.js";
import { LIVE_REGIONS } from "../../extension/content/github/selectors.js";
import { ACTIVATORS, AUTHORED, BLOCKING, CSS_TARGET_REGISTRY, HOST_SUBJECTS, INVALIDATION, PROTECTED, ROUTE_CLASSES } from "../../packages/primer/registry.js";
import { PREFS, readJson, readText, ROOT } from "./helpers.mjs";

const FULL = { ...PREFS, appearance: "full" };
// THEME-EXPANSION.md's native-node property allowlist.
const NATIVE = new Set(["color", "background-color", "background-image", "background-size", "background-position", "background-repeat", "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-width", "border-style", "border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius", "corner-shape", "box-shadow", "text-shadow", "font-family", "font-weight", "letter-spacing", "text-transform", "caret-color", "accent-color", "scrollbar-color", "scrollbar-width", "fill", "stroke", "stroke-width"]);
const INHERITED = new Set(["color", "font-family", "font-weight", "letter-spacing", "text-transform", "text-shadow", "caret-color", "accent-color", "scrollbar-color", "scrollbar-width", "fill", "stroke", "stroke-width"]);

function compile(source, registry = CSS_TARGET_REGISTRY, prefs = FULL) {
  const sanitized = sanitizeCss(source, { path: "/css" });
  assert.ok(sanitized.ok, JSON.stringify(sanitized.issues));
  return compileCss(sanitized.value, { registry, cssAllowed: true, preferences: prefs, policy: "themed" });
}

test("registry version 1 is a valid CssTargetRegistry whose fixture hashes match the reviewed files", () => {
  assert.deepEqual(registryProblems(CSS_TARGET_REGISTRY), []);
  assert.equal(CSS_TARGET_REGISTRY.registryVersion, 1);
  assert.equal(CSS_TARGET_REGISTRY.rootKind, "page-backing");
  assert.ok(Object.isFrozen(CSS_TARGET_REGISTRY) && Object.isFrozen(CSS_TARGET_REGISTRY.kinds["control-chrome"]));
  assert.ok(Object.keys(CSS_TARGET_REGISTRY.fixtures).length >= 2);
  for (const [path, hash] of Object.entries(CSS_TARGET_REGISTRY.fixtures)) assert.equal(createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex"), hash, path);
  assert.deepEqual(CSS_TARGET_REGISTRY.invalidation.attributes, [...INVALIDATION.attributes]);
  for (const name of ["class", "role", "style", "hidden", "open", "inert", "aria-hidden", "aria-modal", "popover", "data-state"]) assert.ok(INVALIDATION.attributes.includes(name), name);
  for (const event of ["turbo:before-render", "turbo:before-cache", "pjax:beforeReplace", "popstate", "pagehide", "pageshow", "beforetoggle", "toggle", "click", "keydown", "focusin"]) assert.ok(INVALIDATION.events.includes(event), event);
});

test("kind policies stay inside the native allowlist, audited variables and the inheritance rule", () => {
  for (const [kind, policy] of Object.entries(CSS_TARGET_REGISTRY.kinds)) {
    for (const property of policy.properties) assert.ok(NATIVE.has(property), `${kind} ${property}`);
    for (const [property, variables] of Object.entries(policy.colors)) {
      assert.ok(policy.properties.includes(property), `${kind} ${property}`);
      for (const v of variables) assert.ok(Object.hasOwn(CSS_VARIABLES, v) && CSS_VARIABLES[v] === "color", `${kind} ${v}`);
    }
    for (const property of policy.literalColors) assert.ok(policy.properties.includes(property) && !/^(color|fill|stroke)$/.test(property), `${kind} literal ${property}`);
    // A kind that is not a leaf or whole reviewed subtree takes nothing that inherits.
    if (!policy.inheritable) for (const property of policy.properties) assert.ok(!INHERITED.has(property), `${kind} ${property} inherits`);
    assert.ok(Number.isInteger(policy.maxTargets) && policy.maxTargets > 0 && policy.maxTargets <= 400, kind);
  }
  // Reading text and code never glow; graph cells never change their level colors.
  assert.equal(CSS_TARGET_REGISTRY.kinds["graph-cell"].properties.some((p) => /color|fill/.test(p)), false);
  assert.equal(CSS_TARGET_REGISTRY.kinds["reading-pair"], undefined, "no reading panel is registered in version 1");
  for (const kind of ["page-backing", "graph-cell", "graph-decoration", "control-chrome"]) assert.equal(CSS_TARGET_REGISTRY.kinds[kind].textShadow, false, kind);
});

test("every host signature is exact, reviewed per route and inside the registry's routes", () => {
  const ids = new Set();
  for (const s of HOST_SUBJECTS) {
    assert.ok(!ids.has(s.id), s.id);
    ids.add(s.id);
    assert.ok(CSS_TARGET_REGISTRY.kinds[s.kind], s.id);
    assert.ok(s.routes.length && s.routes.every((r) => ROUTE_CLASSES.includes(r)), s.id);
    assert.doesNotMatch(s.select, /\*=|~=|\|=/, `${s.id}: no substring matching`);
    // An inheritable subject lists the only descendants it may hold.
    if (CSS_TARGET_REGISTRY.kinds[s.kind].inheritable) assert.ok(typeof s.descendants === "string" && Number.isInteger(s.maxDescendants), s.id);
    // Its compound for theme CSS names an element, a class or a predicate: never a bare `*`.
    assert.ok(s.signature.element || s.signature.classes.length, s.id);
  }
  // Auth, settings, security and billing routes are not route classes at all.
  for (const r of ROUTE_CLASSES) assert.doesNotMatch(r, /login|session|settings|security|billing|auth/);
  for (const selector of ["dialog", '[role="alertdialog"]', '[role="alert"]', "[popover]", ".flash", '[data-component="Banner"]', ".signed-commit-badge", ".merge-pr"]) assert.ok(PROTECTED.includes(selector), selector);
  for (const selector of ["dialog", '[aria-modal="true"]', ".flash-error", ".flash-warn"]) assert.ok(BLOCKING.includes(selector), selector);
  assert.ok(ACTIVATORS.includes("[aria-haspopup]") && ACTIVATORS.includes("summary"));
});

test("every attribute a signature, safety list, layer state or route signal reads is observed", () => {
  // Attribute names in selector text, and the ones the shown-layer test reads by state.
  const names = (text) => [...text.matchAll(/\[([a-z][a-z-]*)/g)].map((m) => m[1]);
  const read = new Set([
    ...HOST_SUBJECTS.flatMap((s) => names(s.select)),
    ...[PROTECTED, BLOCKING, AUTHORED, LIVE_REGIONS, ROUTE_SIGNALS].flatMap(names),
    "hidden", "open", "popover",
  ]);
  // Predicates in the compiled signatures, and the attributes that drive classes and ids.
  for (const s of HOST_SUBJECTS) for (const p of s.signature.predicates ?? []) read.add(p.name);
  read.add("class");
  read.add("id");
  const missing = [...read].filter((name) => !INVALIDATION.attributes.includes(name));
  assert.deepEqual(missing, []);
  for (const name of ["contenteditable", "aria-live", "aria-label", "data-tab-item"]) assert.ok(INVALIDATION.attributes.includes(name), name);
});

test("the primary-button subject is dormant: theme CSS may name it, the host admits none", () => {
  const primary = HOST_SUBJECTS.find((s) => s.id === "button.primary");
  assert.match(primary.dormant, /no reviewed primary-button structure/);
  assert.deepEqual(primary.routes, ["pull-files"]);
  assert.ok(CSS_TARGET_REGISTRY.subjects.some((s) => s.classes.includes("btn-primary")));
  // No other subject is dormant, and none of them is a form control.
  for (const s of HOST_SUBJECTS.filter((d) => d !== primary)) {
    assert.equal(s.dormant, undefined, s.id);
    assert.doesNotMatch(s.select, /\bbutton\b|\bform\b|input|btn/, s.id);
  }
  assert.ok(PROTECTED.includes('a[href^="/join"]'));
});

test("every form is protected UI, whatever its action: no action list can tell a safe one", () => {
  const list = PROTECTED.split(",");
  assert.equal(list[0], "form");
  // No narrower form test remains to suggest some forms are reviewed.
  assert.deepEqual(list.filter((s) => /^form\b/.test(s)), ["form"]);
});

test("the registry evidence records live admissions only on reviewed routes and none on sign-in", () => {
  const evidence = readJson("tests/primer/registry-evidence.json");
  assert.match(evidence.captured, /^\d{4}-\d{2}-\d{2}$/);
  const byKind = Object.fromEntries(evidence.pages.map((p) => [p.kind, p]));
  assert.equal(byKind["sign-in (protected route)"].gate, false);
  assert.deepEqual(byKind["sign-in (protected route)"].admitted, {});
  for (const p of evidence.pages) for (const id of Object.keys(p.admitted)) assert.ok(HOST_SUBJECTS.find((s) => s.id === id).routes.includes(p.route), `${p.url} ${id}`);
  assert.ok(byKind.profile.admitted["graph.day"].count >= 365);
  assert.ok(byKind["repository overview"].admitted["title.repository"]);
});

test("Choom's CSS for GitHub's own elements compiles against registry version 1", () => {
  // S1's file as it stands (header glow, primary button glow at rest and on hover).
  const current = compile(readText("tests/primer/fixtures/choom-native-current.css"));
  assert.ok(current.ok, JSON.stringify(current.issues));
  assert.equal(current.nativeRules, 3);
  // The 1.1.0 rules the registry now admits: repository navigation glow, primary focus glow,
  // selected tabs, the repository title and sidebar headings.
  const proposed = compile(readText("tests/primer/fixtures/choom-native-proposed.css"));
  assert.ok(proposed.ok, JSON.stringify(proposed.issues));
  assert.equal(proposed.nativeRules, 8);
  // Every native rule requires the scope, the separate native gate and the subject's kind
  // marker, and excludes native and protected islands at the subject.
  for (const rule of proposed.css.split("}").filter(Boolean)) {
    assert.match(rule, new RegExp(`\\[${CSS_MARKERS.scope}="active"\\]\\[${CSS_MARKERS.nativeGate}="active"\\]`));
    assert.match(rule, /\[data-reskin-css-kind="(header-chrome|control-chrome|heading-chrome)"\]/);
    assert.match(rule, /:not\(\[data-reskin-native\],\[data-reskin-native\] \*,\[data-reskin-protected\],\[data-reskin-protected\] \*\)/);
  }
  // Calm and Effects off omit it entirely.
  assert.equal(compile(readText("tests/primer/fixtures/choom-native-proposed.css"), CSS_TARGET_REGISTRY, { ...PREFS, appearance: "calm" }).css, "");
});

test("unregistered, protected and mixed targets fail closed", () => {
  const refused = (css, why) => {
    const result = compile(css);
    assert.equal(result.ok, false, `${why}: ${css}`);
  };
  refused(".Box{box-shadow:0 0 8px color-mix(in srgb,var(--reskin-accent) 50%,transparent)}", "a reading panel is not a registered kind");
  refused(".Label{color:var(--reskin-text)}", "a class alone establishes no kind");
  refused(".flash-warn{background-color:var(--reskin-canvas)}", "warnings are not registered");
  refused(".btn-primary{color:#ff0000}", "control chrome takes no literal color or text color");
  refused(".btn-primary{text-shadow:0 0 4px color-mix(in srgb,var(--reskin-accent) 50%,transparent)}", "controls never glow their text");
  refused(".ContributionCalendar-day{background-color:var(--reskin-graph-4)}", "graph cells keep their level colors");
  refused(".HeaderMktg{color:var(--reskin-header-text)}", "nothing inherited reaches the header's menus");
  refused("body{color:var(--reskin-text)}", "the page backing inherits nothing");
  refused('h2.h4.mb-2,.btn-primary{text-shadow:0 0 4px color-mix(in srgb,var(--reskin-accent) 50%,transparent)}', "a mixed rule gets the intersection");
  refused('a[data-testid="repo-name-link"]{color:var(--reskin-accent)}', "a heading's ink stays an audited text role");
  // The same input without a registry compiles owned decorations only.
  const owned = sanitizeCss('[data-reskin-slot="profile.tag"]{color:var(--reskin-link)}.btn-primary{box-shadow:0 0 4px color-mix(in srgb,var(--reskin-accent) 50%,transparent)}', { path: "/css" });
  assert.equal(compileCss(owned.value, { registry: null, cssAllowed: true, preferences: FULL, policy: "themed" }).ok, false);
});
