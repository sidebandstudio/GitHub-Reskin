// The engine without the CSS parser. CSS and gradientCss admission come from build-time proofs
// registered through the format viewer entry, or from the sanitizer once authoring has loaded.
export { resolveTheme, auditPairs, basePolarityIssue, sourceHash, PAIR_MATRIX } from "./resolve.js";
export { repairTheme } from "./repair.js";
export { contrast, luminance, mix, oklab, bestInk, fit } from "./color.js";
export { graphProblems, rampDirection, deriveRamp } from "./graph.js";
export { seedProblems, pairMatrixProblems } from "./seed.js";
export { sha256 } from "./sha256.js";
export { cssVariables } from "./variables.js";
export { ACCESSIBILITY_NOTICE, ANSI_ROLES, APPEARANCE_COLOR_PATHS, COLOR_PATHS, PAIR_PATHS, SEMANTIC_FIELDS, SEMANTIC_ROLES, TOKEN_KEYS } from "./vocabulary.js";
