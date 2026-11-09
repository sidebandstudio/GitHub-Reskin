// Mode-island selectors. GitHub applies a mode to any element carrying data-color-mode and the
// matching theme attribute, so islands nest. These helpers mirror GitHub's own selectors, which
// check:primer compares against the frozen stylesheets, and never match a mode by substring.
import POLICY from "./mode-policy.json" with { type: "json" };

/**
 * Every reviewed mode's GitHub selectors with that mode's policy. `prefersDark` entries apply only
 * inside @media (prefers-color-scheme: dark). Unlisted modes are unknown and stay native.
 * @returns {{selector:string, mode:string, policy:string, prefersDark:boolean}[]}
 */
export function modeSelectors() {
  const out = [];
  for (const [mode, entry] of Object.entries(POLICY.modes)) {
    const { always, prefersDark } = githubModeSelectors(mode, entry.base);
    for (const selector of always) out.push({ selector, mode, policy: entry.policy, prefersDark: false });
    for (const selector of prefersDark) out.push({ selector, mode, policy: entry.policy, prefersDark: true });
  }
  return out;
}

/** The GitHub selectors that apply mode `id`, outside and inside a prefers-color-scheme:dark query. */
export function githubModeSelectors(id, base) {
  return {
    always: [`[data-color-mode=${base}][data-${base}-theme=${id}]`, `[data-color-mode=auto][data-light-theme=${id}]`],
    prefersDark: [`[data-color-mode][data-color-mode=auto][data-dark-theme=${id}]`],
  };
}

/**
 * The selectors of elements whose effective mode is one of `modes`, for the light-scheme branch
 * (auto reads data-light-theme) and the dark-scheme branch (auto reads data-dark-theme).
 * `baseOf` gives each mode's base; it defaults to the reviewed policy.
 */
export function scopeSelectors(modes, baseOf = (mode) => POLICY.modes[mode]?.base) {
  const explicit = modes.map((m) => `[data-color-mode=${baseOf(m)}][data-${baseOf(m)}-theme=${m}]`);
  return {
    light: [...explicit, ...modes.map((m) => `[data-color-mode=auto][data-light-theme=${m}]`)],
    dark: [...explicit, ...modes.map((m) => `[data-color-mode=auto][data-dark-theme=${m}]`)],
  };
}

// GitHub's selectors need a color mode and the theme attribute it reads. An island without theme
// attributes matches none of them, so it inherits its parent's mode.
export const ATTRIBUTED = "[data-color-mode]:is([data-light-theme],[data-dark-theme])";
const LOOSE = "[data-color-mode]:not([data-light-theme],[data-dark-theme])";
const CONTENTINFO = 'footer[role="contentinfo"]';
// The marketing footer partial's island without theme attributes, as GitHub renders it on its
// home, 404 and marketing pages (github.com, 2026-11-08).
const BRAND_WRAPPER = `react-partial[partial-name="marketing-footer"] > div > ${LOOSE}`;

/**
 * The Primer Brand marketing footer: the contentinfo footer directly inside the marketing-footer
 * partial's island without theme attributes. Structural only; no hashed class names. That island,
 * and islands without theme attributes nested in the footer (its language menu), are recognized
 * and pass their parent's mode through, as they do natively.
 */
export const BRAND_FOOTER = `:is(${BRAND_WRAPPER} > ${CONTENTINFO})`;

// How many islands with theme attributes, counted from the root, may enclose an element for its
// nearest one to be found. A deeper island is suppressed by any unsafe island inside it, and
// `within` keeps GitHub's styles below it.
const NESTING = 3;

// Elements with at least `n` islands with theme attributes among their ancestors.
const below = (n) => `${`${ATTRIBUTED} `.repeat(n)}*`;
// An island with theme attributes that is the `depth`th, counted from the root, on its path. One
// compound, so an engine tests the depth before any :has() that follows it.
const atDepth = (depth) => `${ATTRIBUTED}${depth > 1 ? `:is(${below(depth - 1)})` : ""}:not(${below(depth)})`;

// The elements of scopeSelectors(modes)[branch], grouped by attribute into one shorter selector.
function grouped(modes, baseOf, branch) {
  const parts = [];
  for (const base of ["light", "dark"]) {
    const own = modes.filter((m) => baseOf(m) === base);
    if (own.length) parts.push(`[data-color-mode=${base}]:is(${own.map((m) => `[data-${base}-theme=${m}]`).join(",")})`);
  }
  parts.push(`[data-color-mode=auto]:is(${modes.map((m) => `[data-${branch}-theme=${m}]`).join(",")})`);
  return `:is(${parts.join(",")})`;
}

/**
 * Selectors for one color-scheme branch of a themed stylesheet. `covered` are the plan's modes,
 * `known` every mode of the ModeIndex.
 *
 * - `unsafe` matches a boundary whose native reset cannot be proved: an island of an unknown
 *   mode, a color mode without the theme attribute it reads, a stray value, any island without
 *   theme attributes outside the Brand footer, empty and text-only ones included, and a stray
 *   child of the footer's island. Only the Brand footer's island passes its parent's mode through.
 * - `eligible` matches the plan's islands that no unsafe boundary depends on. An unsafe boundary
 *   inherits from its nearest island with theme attributes; when that island is themed it is
 *   suppressed and keeps GitHub's own declarations for its mode, and when it is a native island
 *   its reset already protects the boundary and nothing above it is suppressed. Other islands
 *   stay themed. Browsers without :has() drop every rule that names `eligible`, which leaves
 *   GitHub native.
 * - `themed` matches the plan's islands, suppressed or not.
 * - `native` matches islands of the other known modes and unknown attributed islands.
 * - `others` matches every island but the plan's and the Brand footer's, in one compound that
 *   starts with the color-mode attribute, so a :has() of it is one cheap walk.
 * - `brand` matches the Brand footer and the islands without theme attributes inside it while
 *   no island of an unknown mode is in the footer, the only unsafe boundary it can hold: GitHub's
 *   mode files do not reset Brand properties.
 * - `within(target)` matches `target`, a compound selector without theme attributes of its own,
 *   when its nearest island with theme attributes is eligible. A native island is its own
 *   boundary, and a themed island nested in it starts a fresh scope. For rules that are not
 *   inherited custom properties, in engines without container style queries.
 *
 * Chromium re-runs each :has() after a DOM change below the element it is anchored on, walking
 * that subtree, so the compiler anchors them only on islands and the body, and keeps them few.
 */
export function islandScope(covered, known, baseOf, branch) {
  const themed = grouped(covered, baseOf, branch);
  const unknown = `${ATTRIBUTED}:not(${grouped(known, baseOf, branch)})`;
  const unsafe = `:is(${unknown},${LOOSE}:not(${BRAND_WRAPPER},${BRAND_FOOTER} *))`;
  // An island is suppressed when an unsafe boundary below it has no other island with theme
  // attributes in between: both are at the same depth.
  const sameDepth = (depth) => `:has(${unsafe}:not(${below(depth + 1)}))`;
  const suppressed = [];
  for (let depth = 1; depth <= NESTING; depth++) suppressed.push(`${atDepth(depth)}${sameDepth(depth)}`);
  suppressed.push(`${ATTRIBUTED}:is(${below(NESTING)}):has(${unsafe})`);
  // A target with exactly `depth` islands with theme attributes above it, the innermost themed
  // and not suppressed.
  const nearest = [];
  for (let depth = 1; depth <= NESTING; depth++) nearest.push((target) => `${atDepth(depth)}${themed}:not(${sameDepth(depth)}) ${target}:not(${ATTRIBUTED}):not(${below(depth + 1)})`);
  return {
    themed,
    eligible: `${themed}:not(${suppressed.join(",")})`,
    unsafe,
    native: `${ATTRIBUTED}:not(${themed})`,
    others: `[data-color-mode]:not(${themed},${BRAND_WRAPPER},${BRAND_FOOTER} ${LOOSE})`,
    brand: `:is(${BRAND_FOOTER},${LOOSE}:is(${BRAND_FOOTER} *)):not(:is(${BRAND_WRAPPER}:has(${unknown})) *)`,
    within: (target) => `:is(${nearest.map((at) => at(target)).join(",")})`,
  };
}
