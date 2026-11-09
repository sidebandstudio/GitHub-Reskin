// The GitHub content adapter: route guards, native mode reading, safe slot anchors and native CSS
// admission. Lifecycle, style ownership and decoration belong to C4 and C5. Only admission writes
// to the document, and only Reskin's own marker attributes.
export { authenticationRoute, classifyRoute, classifyRouteLazily, ROUTES } from "./routes.js";
export { locateSlots, rejectReason, ownText, insideAuthored, insideInteractive, enabledSlots, dormantSlots } from "./slots.js";
export { readNativeMode, forcedColorsActive, reducedMotion, compileOptions, LARGE_PAGE_ELEMENTS, MODE_ATTRIBUTES } from "./modes.js";
export { SLOTS, CANDIDATE_SLOTS, AUTHORED_ROOTS, INTERACTIVE, LIVE_REGIONS } from "./selectors.js";
export { startAdmission, PASS_CANDIDATES, PASS_MS, CLASSIFICATION_MS } from "./admission.js";
export { HOST_SUBJECTS, BLOCKING } from "../../../packages/primer/registry.js";
