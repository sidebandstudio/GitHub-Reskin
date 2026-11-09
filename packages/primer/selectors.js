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
// An island without theme attributes with one of the two values the marketing footer gives them
// (github.com, 2026-11-08). Any other value is unsafe.
const BRAND_LOOSE = `${LOOSE}:is([data-color-mode=light],[data-color-mode=dark])`;
// The marketing footer partial's island without theme attributes, as GitHub renders it on its
// home, 404 and marketing pages (github.com, 2026-11-08).
const BRAND_WRAPPER = `react-partial[partial-name="marketing-footer"] > div > ${BRAND_LOOSE}`;

/**
 * The Primer Brand marketing footer: the contentinfo footer directly inside the marketing-footer
 * partial's island without theme attributes. Structural only; no hashed class names. That island,
 * and islands without theme attributes nested in the footer (its language menu), are recognized
 * and pass their parent's mode through, as they do natively, while their value is light or dark.
 */
export const BRAND_FOOTER = `:is(${BRAND_WRAPPER} > ${CONTENTINFO})`;
/**
 * A Primer Brand marketing page: the island without theme attributes directly inside the marketing
 * React app root, as GitHub renders its home, Features, Pricing and Sponsors pages (github.com,
 * 2026-11-08). It and the islands without theme attributes nested in it pass their parent's mode
 * through, as they do natively, while their value is light or dark. Primer Brand declares its
 * variables on each of them, so each one takes the page's Brand mapping itself.
 */
export const BRAND_PAGE = `:is(main.font-mktg > react-app > div > ${BRAND_LOOSE})`;
/**
 * GitHub's logged-out marketing header, a Primer Brand component that reads Brand variables on
 * every route (github.com, 2026-11-08). It is usually its own island with theme attributes.
 */
export const BRAND_HEADER = 'header.HeaderMktg[role="banner"]';
const BRAND_INNER = `${BRAND_FOOTER} ${BRAND_LOOSE}`;
const BRAND_PAGE_INNER = `${BRAND_PAGE} ${BRAND_LOOSE}`;
// Every recognized Brand island without theme attributes: footer and page.
const BRAND_KNOWN = `${BRAND_WRAPPER},${BRAND_INNER},${BRAND_PAGE},${BRAND_PAGE_INNER}`;

// How many islands with theme attributes, counted from the root, may enclose an element for its
// nearest one to be found exactly. A selector cannot name the nearest of any number of ancestors,
// so each depth has its own selectors, and deeper elements take the narrowest sound tests below.
const NESTING = 6;

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
 *   mode, a color mode without the theme attribute it reads, a stray value, and any island without
 *   theme attributes, empty and text-only ones included, but the Brand footer's and Brand pages'
 *   light or dark islands, which pass their parent's mode through.
 * - `eligible` matches the plan's islands that no unsafe boundary depends on. An unsafe boundary
 *   inherits from its nearest island with theme attributes; when that island is themed it is
 *   suppressed and keeps GitHub's own declarations for its mode, and when it is a native island
 *   its reset already protects the boundary and nothing above it is suppressed. Other islands
 *   stay themed. Through six islands from the root the nearest island is exact; a deeper island
 *   is suppressed by an unsafe island inside it that no deeper native island separates from it.
 *   Browsers without :has() drop every rule that names `eligible`, which leaves GitHub native.
 * - `themed` matches the plan's islands, suppressed or not.
 * - `native` matches islands of the other known modes and unknown attributed islands.
 * - `others` matches every island but the plan's and the Brand footer's, in one compound that
 *   starts with the color-mode attribute, so a :has() of it is one cheap walk.
 * - `brand` matches the Brand footer and its recognized islands without theme attributes, each
 *   while it holds no island of `others`: GitHub's mode files do not reset Brand properties, so a
 *   native, unknown or unsafe island must not inherit them. A Brand island beside one keeps them.
 * - `brandPage` matches a Brand page's recognized islands without theme attributes the same way.
 * - `within(target)` matches `target`, a compound selector without theme attributes of its own,
 *   when its nearest island with theme attributes is eligible: exactly through six islands from
 *   the root, and below that while the islands above it form at most three runs of themed and
 *   native islands, ending themed, and no deeper themed island above it could be suppressed.
 *   A native island is its own boundary, and a themed island nested in it starts a fresh scope.
 *   For rules that are not inherited custom properties, in Gecko before container style queries.
 *   `nearest` is the same test for any element without theme attributes, for a nested rule.
 *
 * Chromium re-runs each :has() after a DOM change below the element it is anchored on, walking
 * that subtree, so the compiler anchors them only on islands and the body, and keeps them few.
 */
export function islandScope(covered, known, baseOf, branch) {
  const themed = grouped(covered, baseOf, branch);
  const unknown = `${ATTRIBUTED}:not(${grouped(known, baseOf, branch)})`;
  const unsafe = `:is(${unknown},${LOOSE}:not(${BRAND_KNOWN}))`;
  // An island is suppressed when an unsafe boundary below it has no other island with theme
  // attributes in between: both are at the same depth.
  const sameDepth = (depth) => `:has(${unsafe}:not(${below(depth + 1)}))`;
  const native = `${ATTRIBUTED}:not(${themed})`;
  const suppressed = [];
  for (let depth = 1; depth <= NESTING; depth++) suppressed.push(`${atDepth(depth)}${sameDepth(depth)}`);
  // Deeper, a native island past the first six separates an unsafe island below it from every
  // island above it, but a selector sees such a native island only as an ancestor of the unsafe
  // one, not as below the island being tested. So an island with one above it is suppressed by
  // any unsafe island inside it, and any other island by an unsafe island no such one separates.
  const deepNative = `${native}:is(${below(NESTING)})`;
  suppressed.push(`${ATTRIBUTED}:is(${below(NESTING)}):is(${deepNative} *):has(${unsafe})`);
  suppressed.push(`${ATTRIBUTED}:is(${below(NESTING)}):has(${unsafe}:not(${deepNative} *))`);
  // An element with exactly `depth` islands with theme attributes above it, the innermost themed
  // and not suppressed.
  const nearest = [];
  for (let depth = 1; depth <= NESTING; depth++) nearest.push(`:is(${atDepth(depth)}${themed}:not(${sameDepth(depth)}) *):not(${below(depth + 1)})`);
  // Deeper, the innermost island is themed when the islands above, in order, change between
  // themed and native at most twice and end themed: then the longest alternating sequence of them
  // that ends themed is longer than any that ends native.
  const runs = (count, last) => Array.from({ length: count }, (_, i) => ((count - i) % 2 ? last : last === themed ? native : themed)).join(" ");
  const lastThemed = [1, 2, 3].map((count) => `:is(${runs(count, themed)} *):not(${runs(count, native)} *)`);
  // It is not suppressed when no deeper themed island above the element has an unsafe island
  // inside it that no deeper native island separates, and, with a deeper native island above the
  // element, none has any.
  const deepThemed = `${themed}:is(${below(NESTING)})`;
  nearest.push(`:is(${below(NESTING + 1)}):is(${lastThemed.join(",")}):not(${deepThemed}:has(${unsafe}:not(${deepNative} *)) *):not(${deepNative} ${deepThemed}:has(${unsafe}) *)`);
  const others = `[data-color-mode]:not(${themed},${BRAND_KNOWN})`;
  return {
    themed,
    eligible: `${themed}:not(${suppressed.join(",")})`,
    unsafe,
    native,
    others,
    brand: `:is(${BRAND_FOOTER},${BRAND_INNER}):not(:has(${others}))`,
    brandPage: `:is(${BRAND_PAGE},${BRAND_PAGE_INNER}):not(:has(${others}))`,
    within: (target) => `${target}:not(${ATTRIBUTED}):is(${nearest.join(",")})`,
    // The same test for any element without theme attributes, for a nested rule's parent.
    nearest: `:not(${ATTRIBUTED}):is(${nearest.join(",")})`,
  };
}
