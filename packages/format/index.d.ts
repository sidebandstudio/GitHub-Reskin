// Declarations for index.js. Every shared type comes from packages/contracts; the FormatModule
// functions have exactly its signatures, and tests/format/module-types.ts checks that this module
// assigns to FormatModule under strict settings.
import type {
  CatalogEntry,
  CssAdmission,
  CssCompileResult,
  CssTargetRegistry,
  EditorAction,
  EffectId,
  EffectivePreferences,
  ExportedFile,
  FlavorSlotId,
  FontId,
  GradientCssAdmission,
  Hex,
  ImportKind,
  ImportResult,
  Issue,
  ResolvedFontRole,
  SanitizedCss,
  ThemeRaster,
  ThemeV1,
  THEME_SCHEMA_URL,
  ValidationResult,
} from "../contracts/index.js";

export declare function parseImport(input: string | Uint8Array, kind: ImportKind): ImportResult;
export declare function validateTheme(value: unknown): ValidationResult;
export declare function normalizeTheme(value: unknown): { theme: unknown; notes: Issue[] };
export declare function canonicalize(theme: ThemeV1): string;
export declare function exportTheme(theme: ThemeV1): ExportedFile;
export declare function encodeShare(theme: ThemeV1): string;
export declare function decodeShare(code: string): ImportResult;
export declare function makeAiPrompt(idea?: string): string;

/** Lowercase #rrggbb for an accepted spelling (#RGB, #RRGGBB, RRGGBB), or null. */
export declare function normalizeHex(value: unknown): Hex | null;
/** Lowercase ASCII words joined by hyphens, or "theme". */
export declare function fileStem(name: unknown): string;
/** Import accepts .json and .reskin.json files. */
export declare function acceptsFileName(name: unknown): boolean;
/** CRC32 of the bytes as eight lowercase hex digits. */
export declare function crc32(bytes: Uint8Array): string;
export declare const MAX_IDEA_LENGTH: 500;
export declare const MAX_SHARE_CODE_LENGTH: number;

/** "Preview colors only": a separately validated minimal theme and the top-level fields left out. */
export declare function colorsOnly(value: unknown): { ok: true; theme: ThemeV1; omitted: string[] } | { ok: false; issues: Issue[] };
/** Removes a `$schema` hint that is not Reskin's. */
export declare function withoutForeignSchema(value: unknown): { value: unknown; removed: boolean };

export declare function catalogProblems(catalog: unknown): string[];
export declare const CATALOG_GROUPS: readonly CatalogEntry["group"][];
export declare const ANIME_CATALOG: readonly Readonly<CatalogEntry & { group: "anime" }>[];
export declare const CLASSICS_CATALOG: readonly Readonly<CatalogEntry & { group: "classics" }>[];

/** Issue codes for informational import and normalization notes. */
export declare const NOTE_CODES: Readonly<{
  wrapper: "wrapper";
  jsonc: "jsonc";
  color: "normalized-color";
  text: "normalized-text";
  font: "font-name";
  defaultName: "default-name";
  defaultVersion: "default-schema-version";
  bom: "bom";
  css: "css-canonical";
  important: "css-important";
  deferred: "deferred-capability";
}>;

export type EffectParameter =
  | { type: "number" | "integer"; minimum: number; maximum: number; default: number }
  | { enum: readonly string[]; default: string };
export declare const EFFECT_PARAMETERS: Readonly<Record<EffectId, Readonly<Record<string, EffectParameter>>>>;
/** The bundled families, the ones with files in this build, plus "system". */
export declare const FONTS: readonly { id: FontId; family: string | null; weight: number | null; minimumAccentPx: number | null }[];
/** Every heading and body font ID: roles, reviewed weights, this increment's source and native fallback list. */
export declare const FONT_ROLES: readonly {
  id: FontId;
  family: string | null;
  roles: readonly ("heading" | "body")[];
  weights: readonly number[];
  source: ResolvedFontRole["source"] | "deferred";
  fallback: string | null;
}[];
/** Schema defaults for omitted members of supplied Revision 4 groups. */
export declare const APPEARANCE_DEFAULTS: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
/** x-reskin.cssPolicy: the advanced CSS bounds. */
export declare const CSS_POLICY: Readonly<Record<string, string | number | boolean>>;
export declare const FLAVOR_SLOTS: Readonly<Record<FlavorSlotId, { maxLength: number }>>;
export declare const TEXT_LIMITS: Readonly<{
  name: { maxLength: number };
  author: { maxLength: number };
  description: { maxLength: number };
  inspiredBy: { maxLength: number };
  tags: { maxItems: number; maxLength: number };
}>;
export declare const SCHEMA_ID: typeof THEME_SCHEMA_URL;
export declare const SCHEMA_SHA256: string;

// ---------------------------------------------------------------------------------------------
// Revision 4: rasters, capabilities and advanced CSS.

/** Header facts of one embedded raster data URL, checked before any decode. */
export declare function rasterInfo(
  data: unknown,
): { ok: true; mime: string; bytes: Uint8Array; width: number; height: number } | { ok: false; code: string; message: string };
/** Every raster layer of a theme with its JSON pointer, in document order. */
export declare function rasterLayers(theme: unknown): { path: string; image: ThemeRaster }[];
/** This increment's positive capability inventory and its deferred constructs. */
export declare const CAPABILITIES: Readonly<{ increment: 1; admitted: readonly string[]; deferred: readonly string[] }>;
/** Warning notes for requests this increment renders another way, such as a deferred font. */
export declare function capabilityNotes(theme: unknown): Issue[];
/** Errors for an editor action this increment cannot apply. */
export declare function editorActionIssues(action: EditorAction | { type: string }): Issue[];

/** CSS admission through the installed sanitizer or a build-time proof; fails closed otherwise. */
export declare function admitCss(source: string, path?: string): CssAdmission;
export declare function admitGradientCss(layer: { value: string; size?: string }, path: string): GradientCssAdmission;
export declare function cssSanitizerInstalled(): boolean;
/** Registers build-time proofs made by cssProofs; refuses proofs from another policy. */
export declare function registerCssProofs(proofs: readonly CssProof[]): number;
export type CssProof =
  | { kind: "css"; source: string; value: SanitizedCss }
  | { kind: "gradientCss"; value: string; size: string | null; sanitizerVersion: 1; policyHash: string; result: { value: string; size: string | null } };
/** Compiles sanitized CSS against C3's registry; native rules fail closed without one. */
export declare function compileCss(
  sanitized: SanitizedCss,
  options: { registry?: CssTargetRegistry | null; cssAllowed: boolean; preferences?: EffectivePreferences; policy?: string },
): CssCompileResult;
/** Problems with a CssTargetRegistry. Empty means it can be used. */
export declare function registryProblems(registry: unknown): string[];
export declare const CSS_SANITIZER_POLICY: Readonly<Record<string, unknown>>;
export declare const CSS_POLICY_HASH: string;
/** Sets a style node's textContent; never HTML. */
export declare function installStyleText<T extends { textContent: string | null }>(node: T, css: string): T;
export declare function escapeCssForHtml(css: string): string;
export declare function unsafeForStyleElement(text: unknown): boolean;
/** A complete style element for the scriptless preview document; throws when it cannot be safe. */
export declare function styleElementHtml(css: string): string;
export declare function escapeHtmlText(text: unknown): string;

// The authoring entry (also part of this full entry).
export declare function sanitizeCss(source: string, options?: { path?: string; budgets?: { sourceBytes?: number; astNodes?: number } }): CssAdmission;
export declare function sanitizeGradientCss(layer: { value: string; size?: string }, path?: string): GradientCssAdmission;
/** True when transport-escaped CSS decodes to the same AST as the canonical CSS. */
export declare function transportEquivalent(canonical: string, escaped: string): boolean;
/** Build-time proofs for bundled themes' css and gradientCss, for registerCssProofs. */
export declare function cssProofs(themes: readonly ThemeV1[]): CssProof[];
