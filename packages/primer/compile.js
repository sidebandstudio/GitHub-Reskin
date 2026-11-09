// Compiles a resolved theme into the trusted stylesheet GitHub actually reads: the family seed's
// native baseline, then every mapped Primer variable from its resolved role, scoped to the GitHub
// mode islands the plan covers. Native and forced-color resolutions emit nothing. Pure: no DOM.
import { CSS_MARKERS, CSS_VARIABLES, ENGINE_VERSION, PAIR_MATRIX_VERSION, RENDERER_VERSION } from "../contracts/index.js";
import { cssVariables } from "../engine/variables.js";
import { appearanceMode, componentRules, scrollbarDeclarations } from "./components.js";
import { MODE_INDEX } from "./data.js";
import MAPPINGS from "./mappings.json" with { type: "json" };
import { coveredModes } from "./modes.js";
import { PROTECTED } from "./registry.js";
import { ATTRIBUTED, BRAND_HEADER, islandScope } from "./selectors.js";

export const COMPILER_VERSION = 2;
export const TARGETS = Object.freeze(["github", "preview"]);
const HEX6 = /^#[0-9a-f]{6}$/;
const NATIVE_DECLARATION = /^--[A-Za-z0-9_-]+:[^;{}<>\\@]+$/;
const PREFERENCE_KEYS = ["enabled", "extras", "text", "motion", "fonts", "effects"];
// The activity overview's highlight shape, whose seasonal color is an attribute, and the profile
// timeline's commit-share bars, which GitHub paints with an inline green. Only an explicit rule
// recolors them. Widths, labels and content stay GitHub's.
const GRAPH_TARGET = '.js-highlight-blob,.Progress-item:is(main #js-contribution-activity .Progress[role="img"] > *):not(.markdown-body *)';
// Protected UI, as the registry lists it and as admission marks it, keeps GitHub's own components
// with everything inside it, and clears the Reskin switches its descendants' rules read.
const PROTECTED_UI = `${PROTECTED},[${CSS_MARKERS.protected}]`;
const UNPROTECTED = `:not(${PROTECTED_UI},:is(${PROTECTED_UI}) *)`;
// Under a style query a descendant of protected UI already fails, since protected UI clears the
// switch, so a rule there tests only the subject itself.
const NOT_PROTECTED = `:not(${PROTECTED_UI})`;
// Scrollbar colors inherit. Set on an island they would restyle every element in it, which on a
// large diff costs more than a frame, so an island's children start from the browser's again and
// only the viewport, through the root island, and GitHub's own scroll containers take them.
const SCROLLERS = "pre,.overflow-auto,.overflow-x-auto,.overflow-y-auto,.overflow-scroll";

// GitHub's own issue-label formulas, copied from its application stylesheet. GitHub picks one by
// the native theme name, so a light theme over a native dark mode would get translucent labels
// with lightened text. The compiler applies the formula for the theme's base instead.
const ISSUE_LABEL = {
  light: "--lightness-threshold:.453;--border-threshold:.96;--border-alpha:max(0, min(calc((var(--perceived-lightness) - var(--border-threshold)) * 100), 1));color:hsl(0deg, 0%, calc(var(--lightness-switch) * 100%));background:rgb(var(--label-r), var(--label-g), var(--label-b));border-color:hsla(var(--label-h), calc(var(--label-s) * 1%), calc((var(--label-l) - 25) * 1%), var(--border-alpha))",
  dark: "--lightness-threshold:.6;--background-alpha:.18;--border-alpha:.3;--lighten-by:calc(((var(--lightness-threshold) - var(--perceived-lightness)) * 100) * var(--lightness-switch));color:hsl(var(--label-h), calc(var(--label-s) * 1%), calc((var(--label-l) + var(--lighten-by)) * 1%));background:rgba(var(--label-r), var(--label-g), var(--label-b), var(--background-alpha));border-color:hsla(var(--label-h), calc(var(--label-s) * 1%), calc((var(--label-l) + var(--lighten-by)) * 1%), var(--border-alpha))",
};
// Reskin-owned inherited properties. Themed islands set them and native islands clear them, so
// every element sees its nearest island's: whether it is themed, its selection colors and the
// audited scalar variables advanced CSS and owned decorations read.
const ON = "--reskin-on";
const SELECTION_TEXT = "--reskin-selection-text";
const SELECTION_BACKGROUND = "--reskin-selection-background";
const CLEARED = [ON, ...Object.keys(CSS_VARIABLES)].map((name) => `${name}:initial !important`).join(";");
// Gecko matches these selectors. Before Firefox 151 it has no container style queries, and
// Chromium's selection needs its own rule. Firefox 151 also first accepts position-anchor:normal,
// so the selector fallback runs only in the Gecko versions without style queries.
const GECKO = "selector(:-moz-focusring)";
const GECKO_FALLBACK = `${GECKO} and (not (position-anchor: normal))`;
// Engines that draw corner-shape. Gecko never does, so its selector rules are always square.
const BEVEL = `(corner-shape: bevel) and (not ${GECKO})`;
const important = (declarations) => declarations.replace(/;/g, " !important;") + " !important";

// The top-level alternatives of a selector list.
function alternatives(list) {
  const out = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (quote) quote = c === quote ? null : quote;
    else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && !depth) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  return [...out, list.slice(start)];
}
// Every alternative of `target` with `suffix`, as one list: each keeps its own leading key.
const each = (target, suffix) => alternatives(target).map((t) => `${t}${suffix}`).join(",");

const checkedBaselines = new WeakMap();
// islandScope builds the same long selectors for every compile of a plan, so they are kept.
const scopes = new Map();
function cachedScope(covered, known, baseOf, branch) {
  const key = JSON.stringify([covered, known, known.map(baseOf), branch]);
  if (!scopes.has(key)) scopes.set(key, islandScope(covered, known, baseOf, branch));
  return scopes.get(key);
}

/** Reads a ColorPath such as /tokens/canvas or /graph/3 from a resolved theme. */
export function colorAt(resolved, path) {
  const value = path.split("/").slice(1).reduce((node, key) => (node == null ? undefined : node[key]), resolved);
  if (typeof value !== "string" || !HEX6.test(value)) throw new TypeError(`Resolved ${path} is not a lowercase #rrggbb color`);
  return value;
}

/**
 * The emitted value of every mapped variable. readableWith keeps a background role only while the
 * named foreground reads on it; readableOn keeps a foreground role only while it reads on every
 * named background, otherwise the first fallback role that does. Each fallback is reported.
 */
export function emittedColors(resolved, list = MAPPINGS.emit, warnings = []) {
  const out = new Map();
  const fallback = (entry, role, why, severity = "info") => warnings.push({ code: "primer.readable-fallback", path: entry.role, message: `${entry.variable} uses ${role} because ${why}.`, severity });
  for (const entry of list) {
    let value = colorAt(resolved, entry.role);
    const withRule = entry.readableWith;
    if (withRule && contrast(colorAt(resolved, withRule.foreground), value) < withRule.minimum) {
      value = colorAt(resolved, withRule.otherwise);
      fallback(entry, withRule.otherwise, `${withRule.foreground} does not reach ${withRule.minimum}:1 on ${entry.role}`);
    }
    const onRule = entry.readableOn;
    const readsOn = (color) => onRule.backgrounds.every((bg) => contrast(color, colorAt(resolved, bg)) >= onRule.minimum);
    if (onRule && !readsOn(value)) {
      const role = onRule.otherwise.find((r) => readsOn(colorAt(resolved, r)));
      if (role) {
        value = colorAt(resolved, role);
        fallback(entry, role, `${entry.role} does not reach ${onRule.minimum}:1 on every page and code background`);
      } else fallback(entry, entry.role, `no listed role reaches ${onRule.minimum}:1 on every page and code background`, "warning");
    }
    out.set(entry.variable, value);
  }
  return out;
}

// WCAG 2 contrast with the 0.04045 breakpoint, matching the engine.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// A short deterministic digest for fingerprints (two 32-bit FNV-1a lanes). Not a security hash.
function digest(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

function nativeBaseline(index, seedMode) {
  let cache = checkedBaselines.get(index);
  if (!cache) checkedBaselines.set(index, (cache = new Map()));
  if (cache.has(seedMode)) return cache.get(seedMode);
  const text = index.nativeCss?.[seedMode] ?? "";
  const declarations = text ? text.split(";") : [];
  for (const d of declarations) if (!NATIVE_DECLARATION.test(d)) throw new TypeError(`ModeIndex.nativeCss.${seedMode} has an unsafe declaration: ${d.slice(0, 60)}`);
  cache.set(seedMode, declarations);
  return declarations;
}

function assertPreferences(prefs) {
  if (!prefs || PREFERENCE_KEYS.some((k) => typeof prefs[k] !== "boolean")) throw new TypeError("compileGitHub needs EffectivePreferences with six booleans");
  if (prefs.appearance !== undefined && prefs.appearance !== "full" && prefs.appearance !== "calm") throw new TypeError("EffectivePreferences.appearance must be full or calm");
}

// The preview target: only the named variables and component rules, for a frame whose sole
// island is its root. The root is themed only while it holds no unsafe island at all, and
// component rules skip every element inside another island, so the preview is never themed
// where github.com would not be. Unknown names fail rather than paint a partial preview.
function previewSelection(options) {
  const variables = options.variables;
  if (!Array.isArray(variables) || !variables.length || !variables.every((v) => typeof v === "string")) throw new TypeError("The preview target needs the list of Primer variables its fixture reads");
  const known = new Set([...MAPPINGS.emit.map((m) => m.variable)]);
  const unknown = variables.filter((v) => !known.has(v));
  if (unknown.length) throw new TypeError(`The preview fixture reads variables the compiler does not write: ${unknown.join(", ")}`);
  const components = options.components ?? null;
  if (components !== null && !(Array.isArray(components) && components.every((c) => typeof c === "string"))) throw new TypeError("The preview target's components must be rule IDs");
  return { variables: new Set(variables), components: components && new Set(components) };
}

/**
 * @param {object} resolved ResolvedTheme from the engine
 * @param {{seedMode:string|null, policy:string}} modePlan from selectMode
 * @param {object} prefs EffectivePreferences
 * @param {object} [index] the ModeIndex the plan came from; defaults to the frozen production index
 * @param {{target?:'github'|'preview', variables?:string[], components?:string[]}} [options]
 *   `preview` compiles only `variables` and the component rules in `components` (all when
 *   omitted), without the family baseline the preview frame carries itself.
 * @returns {{css:string, fingerprint:string, warnings:object[], ownedNodePlan:[]}}
 */
export function compileGitHub(resolved, modePlan, prefs, index = MODE_INDEX, options = {}) {
  assertPreferences(prefs);
  if (!resolved || typeof resolved.policy !== "string") throw new TypeError("compileGitHub needs a ResolvedTheme");
  if (!modePlan || typeof modePlan.policy !== "string") throw new TypeError("compileGitHub needs a ModePlan");
  const target = options.target ?? "github";
  if (!TARGETS.includes(target)) throw new TypeError(`compileGitHub target must be github or preview, not ${target}`);
  const preview = target === "preview" ? previewSelection(options) : null;
  const mode = appearanceMode(prefs);
  const fingerprint = digest(JSON.stringify([
    COMPILER_VERSION, RENDERER_VERSION, ENGINE_VERSION, PAIR_MATRIX_VERSION,
    resolved.sourceHash ?? null, resolved.policy, resolved.seedHash ?? null,
    modePlan.seedMode ?? null, modePlan.policy, PREFERENCE_KEYS.map((k) => prefs[k]), mode,
    target, preview && [[...preview.variables], preview.components && [...preview.components]],
  ]));
  const warnings = [];
  // Disabled, native and forced-color resolutions leave GitHub entirely native.
  if (!prefs.enabled || resolved.policy !== "themed" || modePlan.policy !== "themed") {
    return { css: "", fingerprint, warnings, ownedNodePlan: [] };
  }
  const seed = index.modes?.[modePlan.seedMode];
  if (!seed) throw new TypeError(`ModePlan seed ${modePlan.seedMode} is not in the ModeIndex`);
  if (resolved.seedId !== seed.id || resolved.seedHash !== seed.sourceHash) throw new TypeError(`The resolved theme was resolved against ${resolved.seedId}, not the plan's ${seed.id}`);
  if (resolved.base !== seed.base || seed.highContrast) throw new TypeError(`Seed ${seed.id} cannot theme a ${resolved.base} resolution`);
  if (!resolved.appearance) throw new TypeError("compileGitHub needs the resolved appearance record of a themed resolution");
  const wanted = (id) => !preview?.components || preview.components.has(id);

  const colors = emittedColors(resolved, preview ? MAPPINGS.emit.filter((m) => preview.variables.has(m.variable)) : MAPPINGS.emit, warnings);
  const brand = preview ? new Map() : emittedColors(resolved, MAPPINGS.brandFooter, warnings);
  const brandPage = preview ? new Map() : emittedColors(resolved, MAPPINGS.brandPage, warnings);
  const blob = colorAt(resolved, "/graph/4");
  const bar = colorAt(resolved, "/graph/3");
  const selectionText = colorAt(resolved, "/tokens/selectionText");
  const selectionBackground = colorAt(resolved, "/tokens/selectionBackground");
  const dark = seed.base === "dark";
  const declarations = [
    // The preview frame carries the family baseline itself.
    ...(preview ? [] : nativeBaseline(index, seed.id).map((d) => `${d} !important`)),
    ...[...colors].map(([name, value]) => `${name}:${value} !important`),
    // primer.css derives some light-dark() values from these switches; they follow color-scheme.
    `--lightningcss-light:${dark ? " " : "initial"} !important`,
    `--lightningcss-dark:${dark ? "initial" : " "} !important`,
    `color-scheme:${seed.base} !important`,
    `${ON}:1 !important`,
    // The scalar API, selection colors included, from the same repaired output.
    ...Object.entries(cssVariables(resolved)).map(([name, value]) => `${name}:${value} !important`),
    ...(wanted("scrollbar") ? scrollbarDeclarations(resolved).map((d) => `${d} !important`) : []),
  ].join(";");
  const brandDeclarations = [...brand].map(([name, value]) => `${name}:${value} !important`).join(";");
  const brandPageDeclarations = [...brandPage].map(([name, value]) => `${name}:${value} !important`).join(";");

  const covered = coveredModes(index, seed.id);
  const known = Object.keys(index.modes);
  const baseOf = (m) => index.modes[m]?.base;
  // Fill and stroke paint the blob, background-color the bar.
  const graph = `fill:${blob} !important;stroke:${blob} !important;background-color:${bar} !important`;
  const label = important(ISSUE_LABEL[seed.base]);
  // Appearance rules in the engines that draw corner-shape, and in the rest. Rules that are the
  // same in both are written once.
  const bevel = componentRules(resolved, prefs, { variant: "bevel" }).filter((r) => wanted(r.id));
  const square = componentRules(resolved, prefs, { variant: "square" }).filter((r) => wanted(r.id));
  const same = bevel.filter((r, i) => square[i]?.id === r.id && square[i].body === r.body);
  const onlyBevel = bevel.filter((r) => !same.includes(r));
  const onlySquare = square.filter((r) => !same.some((s) => s.id === r.id));
  const scrollbar = wanted("scrollbar") ? scrollbarDeclarations(resolved).map((d) => `${d} !important`).join(";") : "";
  const branch = (name) => {
    const full = cachedScope(covered, known, baseOf, name);
    const scope = preview ? previewScope(full) : full;
    // Rules that are not inherited custom properties, for elements whose nearest island is
    // eligible. A graph, label or Brand island that is itself an island follows its own mode,
    // below; other subjects that are islands themselves stay GitHub's. The Brand selectors carry
    // their own island test.
    const guard = ":not([data-color-mode])";
    const component = (r) => [r.target, r.body, guard];
    const subjects = [
      ...(wanted("graph") ? [[GRAPH_TARGET, graph, guard]] : []),
      ...(wanted("issue-label") ? [[".hx_IssueLabel", label, guard]] : []),
      ...(scrollbar ? [[SCROLLERS, scrollbar, guard]] : []),
      ...(preview ? [] : [[scope.brand, brandDeclarations, `:not(${ATTRIBUTED})`], [scope.brandPage, brandPageDeclarations, `:not(${ATTRIBUTED})`], [BRAND_HEADER, brandPageDeclarations, `:not(${ATTRIBUTED})`]]),
      ...same.map(component),
    ];
    // No nesting: an engine tests a nested rule's parent against every element. Each alternative
    // is matched first by its own key, then by the cheap tests after it.
    const rule = (more) => ([target, body, suffix]) => `${each(target, `${suffix}${more}`)}{${body}}`;
    const variants = [
      ...subjects.map(rule(NOT_PROTECTED)),
      ...(onlyBevel.length ? [`@supports ${BEVEL}{`, ...onlyBevel.map(component).map(rule(NOT_PROTECTED)), "}"] : []),
      ...(onlySquare.length ? [`@supports not (${BEVEL}){`, ...onlySquare.map(component).map(rule(NOT_PROTECTED)), "}"] : []),
    ];
    const geckoRules = [...subjects, ...onlySquare.map(component)];
    return [
      // Every island with theme attributes clears the Reskin switches, at no specificity, and
      // eligible islands raise them again: native, unknown and suppressed islands stay cleared.
      `:where(${ATTRIBUTED}){${CLEARED};scrollbar-color:auto}`,
      ...(scrollbar ? [`:where(${ATTRIBUTED}) > *{scrollbar-color:auto}`] : []),
      `${scope.eligible}{${declarations}}`,
      // Only a themed island's own descendants can suppress it, and a graph or label holds no
      // islands, so for these subjects no unsafe descendant at all is the same, shorter test. A
      // Brand footer holds no island of `others`, unsafe ones included.
      ...(wanted("graph") ? [`${each(GRAPH_TARGET, `${scope.themed}:not(:has(${scope.unsafe}))${UNPROTECTED}`)}{${graph}}`] : []),
      ...(wanted("issue-label") ? [`.hx_IssueLabel${scope.themed}:not(:has(${scope.unsafe}))${UNPROTECTED}{${label}}`] : []),
      ...(preview ? [] : [`${scope.brand}${scope.themed}{${brandDeclarations}}`]),
      // The marketing header, usually an island itself, takes the Brand page mapping by the same
      // shorter test: it holds no islands.
      ...(preview ? [] : [`${BRAND_HEADER}${scope.themed}:not(:has(${scope.unsafe})){${brandPageDeclarations}}`]),
      // The other component rules read the nearest island's switch with a style query, which
      // reads the parent's, so it never sees a subject's own island, through any depth.
      `@container style(${ON}: 1){`,
      ...variants,
      "}",
      // Gecko before Firefox 151 matches selectors instead, once for every subject through one
      // nested rule whose nearest-island test is too long to repeat, and an engine with neither
      // keeps GitHub's components. Gecko draws no corner-shape, so its bevels are square. Gecko
      // tests a nested rule's parent against every element, so the parent first names the
      // subjects themselves and fails at once for any other element.
      `@supports ${GECKO_FALLBACK}{`,
      `:is(${geckoRules.map(([target]) => target).join(",")})${UNPROTECTED}${scope.nearest}{`,
      ...geckoRules.map(rule("&")),
      "}",
      "}",
      ...(wanted("selection")
        ? [
            `@supports not ${GECKO}{`,
            // Chromium's highlight styles inherit from the parent's, and only an element whose
            // ancestors have no selection rule paints the browser's own selection, whose dark-scheme and
            // inactive-window colors no keyword reproduces. So the themed selection is set once on the
            // body of a themed root, for the page to inherit, and only while every island is the
            // plan's or a recognized Brand island: no native, unknown or unsafe island, so none is suppressed. It is gated by selector: Chromium does not pass a style-queried highlight
            // rule on to children when the stylesheet changes.
            `:root${scope.themed} > body:not(:has(${scope.others}))::selection{color:${selectionText};background-color:${selectionBackground}}`,
            "}",
          ]
        : []),
    ].join("\n");
  };
  const css = [
    `/* GitHub Reskin: ${seed.id} seed for ${covered.join(", ")}${preview ? ", preview" : ""} */`,
    "@media not all and (forced-colors: active){",
    "@media not all and (prefers-color-scheme: dark){",
    branch("light"),
    "}",
    "@media (prefers-color-scheme: dark){",
    branch("dark"),
    "}",
    // Last, protected UI clears the Reskin switches for itself and everything in it, as a native
    // island does, so no style-queried rule or Reskin variable reaches inside.
    `${PROTECTED_UI}{${CLEARED}}`,
    // Gecko matches selection per element and paints HighlightText on Highlight by default, which
    // an element outside every themed island keeps.
    ...(wanted("selection") ? [`@supports ${GECKO}{::selection{color:var(${SELECTION_TEXT},HighlightText);background-color:var(${SELECTION_BACKGROUND},Highlight)}}`] : []),
    "}",
    "",
  ].join("\n");
  return { css, fingerprint, warnings, ownedNodePlan: [] };
}

/**
 * The preview target of compileGitHub: only the Primer variables `variables` names, the component
 * rules in `components` (every one when omitted) and the same mappings, fallbacks, island and
 * forced-color guards, for a frame whose only island is its root.
 */
export function compilePreview(resolved, modePlan, prefs, { variables, components, index = MODE_INDEX } = {}) {
  return compileGitHub(resolved, modePlan, prefs, index, { target: "preview", variables, components });
}

/** The component rule IDs compileGitHub can write, for a preview host's `components` list. */
export const COMPONENT_IDS = Object.freeze([
  "selection", "scrollbar", "graph", "issue-label",
  "box", "box-first", "box-last", "box-border", "button", "primary", "primary-hover",
  "label-color", "label-shape", "topic-color", "topic-shape", "issue-label-shape",
  "cell-shape", "svg-cell-shape", "cell-glow-1", "cell-glow-2", "cell-glow-3", "cell-glow-4", "overview-point",
]);

// The preview frame's scope: its root is eligible only while it holds no unsafe island, and
// component subjects must sit inside no island but the root.
function previewScope(full) {
  const eligible = `:root${full.themed}:not(:has(${full.unsafe}))`;
  return {
    ...full,
    eligible,
    nearest: `:is(${eligible} *):not(${ATTRIBUTED}):not(:root ${ATTRIBUTED} *)`,
  };
}
