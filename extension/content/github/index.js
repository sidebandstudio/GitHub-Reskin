// The GitHub content adapter: route guards, native mode reading and safe slot anchors. Lifecycle,
// style ownership and decoration belong to C4 and C5; this module only reads the document.
export { classifyRoute, ROUTES } from "./routes.js";
export { locateSlots, rejectReason, ownText, insideAuthored, insideInteractive, enabledSlots, dormantSlots } from "./slots.js";
export { readNativeMode, forcedColorsActive, reducedMotion, MODE_ATTRIBUTES } from "./modes.js";
export { SLOTS, AUTHORED_ROOTS, INTERACTIVE, LIVE_REGIONS } from "./selectors.js";
