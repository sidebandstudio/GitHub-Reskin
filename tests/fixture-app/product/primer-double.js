// A test double for C3's Primer adapter, implementing the frozen interface (selectMode,
// compileGitHub, emittedColors, modeSelectors, MODE_INDEX) over C2's four synthetic seeds. It maps
// resolved roles to the Primer variables the preview fixture reads, nothing more, and stores
// native CSS the way production does: a declaration list per mode, without a selector. When
// packages/primer is present, build.mjs bundles it instead; the double is never shipped.
import { sha256 } from "../../../packages/engine/index.js";
import { PREVIEW_VARIABLES, colorAt, variableDeclarations } from "../../../packages/preview/variables.js";
import standardDark from "../../fixtures/seeds/standard-dark.json" with { type: "json" };
import standardLight from "../../fixtures/seeds/standard-light.json" with { type: "json" };
import colorblindDark from "../../fixtures/seeds/colorblind-dark.json" with { type: "json" };
import tritanopiaLight from "../../fixtures/seeds/tritanopia-light.json" with { type: "json" };

const SEEDS = [standardDark, standardLight, colorblindDark, tritanopiaLight];
const scope = (resolved) => `[data-color-mode][data-${resolved.base}-theme]`;

export const MODE_INDEX = Object.freeze({
  contractVersion: 1,
  modes: Object.fromEntries(SEEDS.map((seed) => [seed.id, seed])),
  counterparts: SEEDS.map((seed) => ({ nativeMode: seed.id, base: seed.base, seedMode: seed.id })),
  nativeCss: Object.fromEntries(SEEDS.map((seed) => [seed.id, variableDeclarations(seed.colors).slice(0, -1)])),
});

export function selectMode(native, base, index) {
  const id = base === "dark" ? native.darkTheme : native.lightTheme;
  const seed = index.modes[id];
  if (!seed || seed.base !== base) return { seedMode: null, policy: "native-unknown" };
  if (seed.highContrast) return { seedMode: null, policy: "native-high-contrast" };
  return { seedMode: id, policy: "themed" };
}

/** The emitted value of every mapped variable, as a Map. The double has no readable fallbacks. */
export const emittedColors = (resolved) => new Map(Object.entries(PREVIEW_VARIABLES).map(([name, path]) => [name, colorAt(resolved, path)]));

export function compileGitHub(resolved, modePlan, prefs) {
  const fingerprint = sha256(new TextEncoder().encode(JSON.stringify([resolved.sourceHash, resolved.seedHash, modePlan, prefs])));
  if (resolved.policy !== "themed" || !prefs.enabled) return { css: "", fingerprint, warnings: [], ownedNodePlan: [] };
  return { css: `${scope(resolved)}{color-scheme:${resolved.base};${variableDeclarations(resolved)}}`, fingerprint, warnings: [], ownedNodePlan: [] };
}

export const modeSelectors = () => [];
