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

/** Any element that is a GitHub mode island in a branch: color mode plus the theme attribute it reads. */
export const ISLAND = Object.freeze({
  light: "[data-color-mode=light][data-light-theme],[data-color-mode=dark][data-dark-theme],[data-color-mode=auto][data-light-theme]",
  dark: "[data-color-mode=light][data-light-theme],[data-color-mode=dark][data-dark-theme],[data-color-mode=auto][data-dark-theme]",
});

/**
 * A selector for `target` inside a themed island and outside any island of another mode, for
 * rules that are not inherited custom properties. `scope` is the branch's themed selector list.
 */
export function scoped(target, scope, branch) {
  const themed = scope.join(",");
  return `:is(${themed}) ${target}:not(:is(:is(${ISLAND[branch]}):not(${themed})) ${target})`;
}
