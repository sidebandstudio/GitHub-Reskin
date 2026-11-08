// GitHub Reskin color engine, renderer 1. Resolves portable source against one immutable GitHub
// mode seed into readable tokens, repairs portable source and audits the frozen pair matrix.
// Pure and deterministic: no DOM, storage, network, randomness or browser globals.
export { resolveTheme, auditPairs, basePolarityIssue, sourceHash, PAIR_MATRIX } from "./resolve.js";
export { repairTheme } from "./repair.js";
export { contrast, luminance, mix, oklab, bestInk, fit } from "./color.js";
export { graphProblems, rampDirection, deriveRamp } from "./graph.js";
export { seedProblems, pairMatrixProblems } from "./seed.js";
export { sha256 } from "./sha256.js";
export { ACCESSIBILITY_NOTICE, ANSI_ROLES, COLOR_PATHS, FAMILIES, PAIR_MATRIX_VERSION, SEMANTIC_FIELDS, SEMANTIC_ROLES, TOKEN_KEYS } from "./vocabulary.js";
