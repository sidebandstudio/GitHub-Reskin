// The lightweight format entry: everything except the CSS parser. Import, validation,
// normalization, canonical export, RS1 share codes, the AI prompt, the catalog contract, raster
// header admission, the registry CSS compiler and safe sinks. CSS and gradientCss admission come
// from build-time proofs registered here (registerCssProofs) or from the sanitizer that
// authoring.js installs; without either, CSS-bearing themes fail validation rather than render.
// Pure functions; no DOM, storage, network or code evaluation.
export { canonicalize, exportTheme, acceptsFileName, fileStem } from "./canonical.js";
export { catalogProblems, ANIME_CATALOG, CLASSICS_CATALOG, CATALOG_GROUPS } from "./catalog.js";
export { NOTE_CODES } from "./codes.js";
export { parseImport, decodeShare } from "./import.js";
export { normalizeTheme, normalizeHex } from "./normalize.js";
export { makeAiPrompt, MAX_IDEA_LENGTH } from "./prompt.js";
export { encodeShare, crc32, MAX_SHARE_CODE_LENGTH } from "./share.js";
export { validateTheme } from "./validate.js";
export { colorsOnly, withoutForeignSchema } from "./choices.js";
export {
  APPEARANCE_DEFAULTS,
  CSS_POLICY,
  EFFECT_PARAMETERS,
  FONTS,
  FONT_ROLES,
  FLAVOR_SLOTS,
  SCHEMA_ID,
  SCHEMA_SHA256,
  TEXT_LIMITS,
} from "./schema-registry.js";
export { dataUrlBytes, rasterHash, rasterInfo, rasterLayers, rasterSourceInfo, rasterTotals, UPLOAD_SOURCE_BYTES } from "./raster.js";
export { CAPABILITIES, capabilityNotes, editorActionIssues } from "./capabilities.js";
export { admitCss, admitGradientCss, cssSanitizerInstalled, registerCssProofs } from "./css/admission.js";
export { compileCss, registryProblems } from "./css/compile.js";
export { POLICY as CSS_SANITIZER_POLICY, POLICY_HASH as CSS_POLICY_HASH } from "./css/policy.js";
export { escapeCssForHtml, escapeHtmlText, installStyleText, styleElementHtml, unsafeForStyleElement } from "./css/transport.js";
