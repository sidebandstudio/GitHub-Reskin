// GitHub Reskin theme format v1: tolerant import, validation, normalization, canonical export,
// RS1 share codes, the AI prompt and the catalog contract. Pure functions; no DOM, storage,
// network or code evaluation.
export { canonicalize, exportTheme, acceptsFileName, fileStem } from "./canonical.js";
export { catalogProblems, ANIME_CATALOG, CLASSICS_CATALOG, CATALOG_GROUPS } from "./catalog.js";
export { NOTE_CODES } from "./codes.js";
export { parseImport, decodeShare } from "./import.js";
export { normalizeTheme, normalizeHex } from "./normalize.js";
export { makeAiPrompt, MAX_IDEA_LENGTH } from "./prompt.js";
export { encodeShare, crc32, MAX_SHARE_CODE_LENGTH } from "./share.js";
export { validateTheme } from "./validate.js";
export { colorsOnly, withoutForeignSchema } from "./choices.js";
export { EFFECT_PARAMETERS, FONTS, FLAVOR_SLOTS, SCHEMA_ID, SCHEMA_SHA256, TEXT_LIMITS } from "./schema-registry.js";
