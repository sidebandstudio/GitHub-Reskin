// GitHub Reskin Primer adapter: GitHub mode selection, the maintained Primer variable mapping and
// the trusted stylesheet compiler. Pure and deterministic; reads no DOM, storage or network.
export { selectMode, nativeModeId, counterpartFor, coveredModes, seedFor, standardSeed, MODE_POLICY, NOTICES } from "./modes.js";
export { modeSelectors, githubModeSelectors, scopeSelectors, islandScope, BRAND_FOOTER, BRAND_PAGE } from "./selectors.js";
export { compileGitHub, compilePreview, emittedColors, colorAt, contrast, COMPILER_VERSION, COMPONENT_IDS, TARGETS } from "./compile.js";
export { appearanceMode, componentRules } from "./components.js";
export { CSS_TARGET_REGISTRY, ROUTE_CLASSES, registryRoutes } from "./registry.js";
export { MODE_INDEX } from "./data.js";
