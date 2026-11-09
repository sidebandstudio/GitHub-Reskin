// GitHub Reskin appearance, renderer 1: the ten parametric effects, the eighteen bundled fonts
// and the owned decoration nodes for flavor slots. One implementation serves the GitHub content
// adapter, the shared preview, the userscript and the site. See README.md.
export { compileAppearance, TARGETS } from "./compile.js";
export { mountAppearance, usableAnchors, OWNED_ATTRIBUTE } from "./mount.js";
export { fontFaceCss, fontStack, isFontResourceUrl, roleFontFaceCss, roleFontIds, UNICODE_RANGE } from "./fonts.js";
export { extensionResources, siteResources, embeddedResources, noResources, isAssetPath } from "./resources.js";
export { effectiveAppearance, planAppearance, ownedNodePlan, SLOT_KINDS } from "./plan.js";
export { effectCss, effectNodes, boundedParams, motionMs, rgba, BOX_EFFECTS } from "./effects.js";
export { EFFECTS, FONTS, FONT_BY_ID, LIMITS, BOX, SYSTEM_MONO, SYSTEM_SANS, registryProblems } from "./registry.js";
export { imageAssets, convertRaster, createRasterQueue, browserRasterEnv, fitSize, setRasterLayer, removeRasterLayer, COMPRESS_QUALITIES } from "./raster.js";
