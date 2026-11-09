// Compiles a resolved theme into the trusted stylesheet GitHub actually reads: the family seed's
// native baseline, then every mapped Primer variable from its resolved role, scoped to the GitHub
// mode islands the plan covers. Native and forced-color resolutions emit nothing. Pure: no DOM.
import { ENGINE_VERSION, PAIR_MATRIX_VERSION, RENDERER_VERSION } from "../contracts/index.js";
import { MODE_INDEX } from "./data.js";
import MAPPINGS from "./mappings.json" with { type: "json" };
import { coveredModes } from "./modes.js";
import { ATTRIBUTED, islandScope } from "./selectors.js";

export const COMPILER_VERSION = 1;
const HEX6 = /^#[0-9a-f]{6}$/;
const NATIVE_DECLARATION = /^--[A-Za-z0-9_-]+:[^;{}<>\\@]+$/;
const PREFERENCE_KEYS = ["enabled", "extras", "text", "motion", "fonts", "effects"];
// The activity overview's highlight shape, whose seasonal color is an attribute, and the profile
// timeline's commit-share bars, which GitHub paints with an inline green. Only an explicit rule
// recolors them. Widths, labels and content stay GitHub's.
const GRAPH_TARGET = ':is(.js-highlight-blob,.Progress-item:is(main #js-contribution-activity .Progress[role="img"] > *):not(.markdown-body *))';

// GitHub's own issue-label formulas, copied from its application stylesheet. GitHub picks one by
// the native theme name, so a light theme over a native dark mode would get translucent labels
// with lightened text. The compiler applies the formula for the theme's base instead.
const ISSUE_LABEL = {
  light: "--lightness-threshold:.453;--border-threshold:.96;--border-alpha:max(0, min(calc((var(--perceived-lightness) - var(--border-threshold)) * 100), 1));color:hsl(0deg, 0%, calc(var(--lightness-switch) * 100%));background:rgb(var(--label-r), var(--label-g), var(--label-b));border-color:hsla(var(--label-h), calc(var(--label-s) * 1%), calc((var(--label-l) - 25) * 1%), var(--border-alpha))",
  dark: "--lightness-threshold:.6;--background-alpha:.18;--border-alpha:.3;--lighten-by:calc(((var(--lightness-threshold) - var(--perceived-lightness)) * 100) * var(--lightness-switch));color:hsl(var(--label-h), calc(var(--label-s) * 1%), calc((var(--label-l) + var(--lighten-by)) * 1%));background:rgba(var(--label-r), var(--label-g), var(--label-b), var(--background-alpha));border-color:hsla(var(--label-h), calc(var(--label-s) * 1%), calc((var(--label-l) + var(--lighten-by)) * 1%), var(--border-alpha))",
};
// Reskin-owned inherited properties. Themed islands set them and native islands clear them, so
// every element sees its nearest island's: whether it is themed, and its selection colors.
const ON = "--reskin-on";
const SELECTION_TEXT = "--reskin-selection-text";
const SELECTION_BACKGROUND = "--reskin-selection-background";
// Gecko matches these selectors; other engines use the style queries below.
const GECKO = "selector(:-moz-focusring)";
const important = (declarations) => declarations.replace(/;/g, " !important;") + " !important";

const checkedBaselines = new WeakMap();

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
}

/**
 * @param {object} resolved ResolvedTheme from the engine
 * @param {{seedMode:string|null, policy:string}} modePlan from selectMode
 * @param {object} prefs EffectivePreferences
 * @param {object} [index] the ModeIndex the plan came from; defaults to the frozen production index
 * @returns {{css:string, fingerprint:string, warnings:object[], ownedNodePlan:[]}}
 */
export function compileGitHub(resolved, modePlan, prefs, index = MODE_INDEX) {
  assertPreferences(prefs);
  if (!resolved || typeof resolved.policy !== "string") throw new TypeError("compileGitHub needs a ResolvedTheme");
  if (!modePlan || typeof modePlan.policy !== "string") throw new TypeError("compileGitHub needs a ModePlan");
  const fingerprint = digest(JSON.stringify([
    COMPILER_VERSION, RENDERER_VERSION, ENGINE_VERSION, PAIR_MATRIX_VERSION,
    resolved.sourceHash ?? null, resolved.policy, resolved.seedHash ?? null,
    modePlan.seedMode ?? null, modePlan.policy, PREFERENCE_KEYS.map((k) => prefs[k]),
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

  const colors = emittedColors(resolved, MAPPINGS.emit, warnings);
  const brand = emittedColors(resolved, MAPPINGS.brandFooter, warnings);
  const blob = colorAt(resolved, "/graph/4");
  const bar = colorAt(resolved, "/graph/3");
  const selectionText = colorAt(resolved, "/tokens/selectionText");
  const selectionBackground = colorAt(resolved, "/tokens/selectionBackground");
  const dark = seed.base === "dark";
  const declarations = [
    ...nativeBaseline(index, seed.id).map((d) => `${d} !important`),
    ...[...colors].map(([name, value]) => `${name}:${value} !important`),
    // primer.css derives some light-dark() values from these switches; they follow color-scheme.
    `--lightningcss-light:${dark ? " " : "initial"} !important`,
    `--lightningcss-dark:${dark ? "initial" : " "} !important`,
    `color-scheme:${seed.base} !important`,
    `${ON}:1 !important`,
    `${SELECTION_TEXT}:${selectionText} !important`,
    `${SELECTION_BACKGROUND}:${selectionBackground} !important`,
  ].join(";");
  const brandDeclarations = [...brand].map(([name, value]) => `${name}:${value} !important`).join(";");

  const covered = coveredModes(index, seed.id);
  const baseOf = (mode) => index.modes[mode]?.base;
  // Fill and stroke paint the blob, background-color the bar.
  const graph = `fill:${blob} !important;stroke:${blob} !important;background-color:${bar} !important`;
  const label = important(ISSUE_LABEL[seed.base]);
  const branch = (name) => {
    const scope = islandScope(covered, Object.keys(index.modes), baseOf, name);
    // Rules that are not inherited custom properties, for elements whose nearest island is
    // eligible. A graph or label that is itself an island follows its own mode, below.
    const component = (target) => [
      [`${GRAPH_TARGET}:not([data-color-mode])`, graph],
      [".hx_IssueLabel:not([data-color-mode])", label],
      [scope.brand, brandDeclarations],
    ].map(([selector, body]) => `${target(selector)}{${body}}`).join("\n");
    return [
      // Every island with theme attributes clears the Reskin switches, at no specificity, and
      // eligible islands raise them again: native, unknown and suppressed islands stay cleared.
      `:where(${ATTRIBUTED}){${ON}:initial !important;${SELECTION_TEXT}:initial !important;${SELECTION_BACKGROUND}:initial !important}`,
      `${scope.eligible}{${declarations}}`,
      // Only a themed island's own descendants can suppress it, and a graph or label holds no
      // islands, so for these subjects no unsafe descendant at all is the same, shorter test.
      `${GRAPH_TARGET}${scope.themed}:not(:has(${scope.unsafe})){${graph}}`,
      `.hx_IssueLabel${scope.themed}:not(:has(${scope.unsafe})){${label}}`,
      `@supports ${GECKO}{`,
      component(scope.within),
      "}",
      // Outside Gecko the other component rules read the nearest island's switch with a style
      // query, which reads the parent's, so it never sees a subject's own island. An engine with
      // neither keeps GitHub's components.
      `@supports not ${GECKO}{`,
      `@container style(${ON}: 1){`,
      component((selector) => selector),
      "}",
      // Chromium's highlight styles inherit from the parent's, and only an element whose
      // ancestors have no selection rule paints the browser's own selection, whose dark-scheme and
      // inactive-window colors no keyword reproduces. So the themed selection is set once on the
      // body of a themed root, for the page to inherit, and only while every island is the
      // plan's or the Brand footer's: no native, unknown or unsafe island, so none is suppressed. It is gated by selector: Chromium does not pass a style-queried highlight
      // rule on to children when the stylesheet changes.
      `:root${scope.themed} > body:not(:has(${scope.others}))::selection{color:${selectionText};background-color:${selectionBackground}}`,
      "}",
    ].join("\n");
  };
  const css = [
    `/* GitHub Reskin: ${seed.id} seed for ${covered.join(", ")} */`,
    "@media not all and (forced-colors: active){",
    "@media not all and (prefers-color-scheme: dark){",
    branch("light"),
    "}",
    "@media (prefers-color-scheme: dark){",
    branch("dark"),
    "}",
    // Gecko matches selection per element and paints HighlightText on Highlight by default, which
    // an element outside every themed island keeps.
    `@supports ${GECKO}{::selection{color:var(${SELECTION_TEXT},HighlightText);background-color:var(${SELECTION_BACKGROUND},Highlight)}}`,
    "}",
    "",
  ].join("\n");
  return { css, fingerprint, warnings, ownedNodePlan: [] };
}
