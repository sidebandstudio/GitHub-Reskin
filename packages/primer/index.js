// GitHub Reskin Primer adapter: GitHub mode selection, the maintained Primer variable mapping and
// the trusted stylesheet compiler. Pure and deterministic; reads no DOM, storage or network.
export { selectMode, nativeModeId, counterpartFor, coveredModes, seedFor, standardSeed, MODE_POLICY, NOTICES } from "./modes.js";
export { modeSelectors, githubModeSelectors, scopeSelectors, scoped, ISLAND } from "./selectors.js";
export { compileGitHub, emittedColors, colorAt, contrast, COMPILER_VERSION } from "./compile.js";
export { MODE_INDEX } from "./data.js";
