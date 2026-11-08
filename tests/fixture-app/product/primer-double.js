// A test double for C3's Primer adapter, implementing the frozen interface (selectMode,
// compileGitHub, modeSelectors) over C2's four synthetic seeds. It maps resolved roles to the
// Primer variables the preview fixture reads, nothing more. When packages/primer lands, the fixture
// app and these tests switch to it; the double is never shipped.
import { sha256 } from "../../../packages/engine/index.js";
import { variableDeclarations } from "../../../packages/preview/variables.js";
import standardDark from "../../fixtures/seeds/standard-dark.json" with { type: "json" };
import standardLight from "../../fixtures/seeds/standard-light.json" with { type: "json" };
import colorblindDark from "../../fixtures/seeds/colorblind-dark.json" with { type: "json" };
import tritanopiaLight from "../../fixtures/seeds/tritanopia-light.json" with { type: "json" };

const SEEDS = [standardDark, standardLight, colorblindDark, tritanopiaLight];
const block = (base, colors) => `:root,[data-color-mode]{color-scheme:${base};${variableDeclarations(colors)}}`;

export const modeIndex = Object.freeze({
  contractVersion: 1,
  modes: Object.fromEntries(SEEDS.map((seed) => [seed.id, seed])),
  counterparts: SEEDS.map((seed) => ({ nativeMode: seed.id, base: seed.base, seedMode: seed.id })),
  nativeCss: Object.fromEntries(SEEDS.map((seed) => [seed.id, block(seed.base, seed.colors)])),
});

export function selectMode(native, base, index) {
  const id = base === "dark" ? native.darkTheme : native.lightTheme;
  const seed = index.modes[id];
  if (!seed || seed.base !== base) return { seedMode: null, policy: "native-unknown" };
  if (seed.highContrast) return { seedMode: null, policy: "native-high-contrast" };
  return { seedMode: id, policy: "themed" };
}

export function compileGitHub(resolved, modePlan, prefs) {
  const fingerprint = sha256(new TextEncoder().encode(JSON.stringify([resolved.sourceHash, resolved.seedHash, modePlan, prefs])));
  if (resolved.policy !== "themed" || !prefs.enabled) return { css: "", fingerprint, warnings: [], ownedNodePlan: [] };
  return { css: block(resolved.base, resolved), fingerprint, warnings: [], ownedNodePlan: [] };
}

export const modeSelectors = () => [];
