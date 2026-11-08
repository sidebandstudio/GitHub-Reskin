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
const ATTRIBUTED = "[data-color-mode]:is([data-light-theme],[data-dark-theme])";
const LOOSE = "[data-color-mode]:not([data-light-theme],[data-dark-theme])";
const CONTENTINFO = 'footer[role="contentinfo"]';

/**
 * The Primer Brand marketing footer: a color-mode island without GitHub theme attributes whose
 * direct child is the page's contentinfo footer. Structural only; no hashed class names. That
 * island, and islands without theme attributes nested in the footer (its language menu), are
 * recognized and pass their parent's mode through, as they do natively.
 */
export const BRAND_FOOTER = `:is(${LOOSE} > ${CONTENTINFO})`;

// How many themed and native islands, counted from the root, may enclose a target: themed, native,
// themed. Deeper alternation fails closed and keeps GitHub's styles.
const NESTING = 3;

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
 * - `gate` matches the root only while every island in the document is recognized: a known mode
 *   combination, the Brand footer's island without theme attributes, or one inside that footer.
 *   An island of an unknown mode, a color mode without the theme attribute it reads, a stray value
 *   or any other island without theme attributes leaves the whole document native, because its
 *   native reset cannot be proved and the root is its ancestor. An island without theme
 *   attributes that has no element children is not detected; nothing below it can hold another
 *   mode. Browsers without :has() drop every gated rule, which also leaves GitHub native.
 * - `themed` matches the plan's islands; `islands` matches them behind the gate, for the inherited
 *   custom properties.
 * - `native` matches islands of the other known modes, all that remain while the gate is open, and
 *   `nativeModes` lists the same islands by mode.
 * - `within(target)` matches `target`, a compound selector, when its nearest island with theme
 *   attributes, itself included, is themed. A native island is its own boundary, and a themed
 *   island nested in it starts a fresh scope. For rules that are not inherited custom properties.
 *
 * Chromium re-runs the gate's :has() after any DOM change for every rule whose matched elements
 * depend on it, so the compiler keeps gated rules few and their targets specific.
 */
export function islandScope(covered, known, baseOf, branch) {
  const themed = grouped(covered, baseOf, branch);
  const loose = `${LOOSE}:not(${BRAND_FOOTER} *)`;
  const gate = `:root:not(:has(${ATTRIBUTED}:not(${grouped(known, baseOf, branch)}),${loose} > :not(${CONTENTINFO})))`;
  const native = `${ATTRIBUTED}:not(${themed})`;
  // The same islands listed by mode, without negation, for :has() arguments: Chromium re-checks a
  // :has() whose argument holds :not() after any DOM change, but keys a positive one to attributes.
  const nativeModes = grouped(known.filter((m) => !covered.includes(m)), baseOf, branch);
  // A target's attributed islands, innermost last, alternate between themed and native runs. The
  // innermost is themed exactly when an alternating chain ending in a themed island encloses the
  // target and the same chain followed by a native island does not.
  const chains = [];
  for (let k = 1; k < NESTING; k++) chains.push(Array.from({ length: k }, (_, i) => ((k - i) % 2 ? themed : `:is(${native})`)).join(" "));
  return {
    gate,
    themed,
    islands: `${gate}${themed},${gate} ${themed}`,
    native,
    nativeModes,
    within: (target) => `${gate} :is(${[`${target}${themed}`, ...chains.map((c) => `${c} ${target}:not(${ATTRIBUTED}):not(${c} :is(${native}) ${target})`)].join(",")})`,
  };
}
