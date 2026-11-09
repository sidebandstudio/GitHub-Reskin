// Declarations for index.js. Every shared type comes from packages/contracts; the FormatModule
// functions have exactly its signatures, and tests/format/module-types.ts checks that this module
// assigns to FormatModule under strict settings.
import type {
  CatalogEntry,
  EffectId,
  ExportedFile,
  FlavorSlotId,
  FontId,
  Hex,
  ImportKind,
  ImportResult,
  Issue,
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
}>;

export type EffectParameter =
  | { type: "number" | "integer"; minimum: number; maximum: number; default: number }
  | { enum: readonly string[]; default: string };
export declare const EFFECT_PARAMETERS: Readonly<Record<EffectId, Readonly<Record<string, EffectParameter>>>>;
export declare const FONTS: readonly { id: FontId; family: string | null; weight: number | null; minimumAccentPx: number | null }[];
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
