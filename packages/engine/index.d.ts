// Declarations for index.js. Every type comes from packages/contracts; resolveTheme, repairTheme
// and auditPairs have exactly the EngineModule signatures, and tests/engine/module-types.ts checks
// that this module assigns to EngineModule under strict settings.
import type {
  AnsiRole,
  Base,
  ColorPath,
  Hex,
  Issue,
  ModeSeed,
  PairMatrix,
  PairResult,
  Repair,
  ResolveContext,
  ResolvedTheme,
  SemanticColors,
  SemanticRole,
  ThemedResolved,
  ThemeV1,
  UiTokens,
} from "../contracts/index.js";

export declare function resolveTheme(theme: ThemeV1, context: ResolveContext): ResolvedTheme;
export declare function repairTheme(theme: ThemeV1, standardSeed: ModeSeed): { theme: ThemeV1; repairs: readonly Repair[] };
export declare function auditPairs(resolved: ThemedResolved): readonly PairResult[];
/**
 * A base-polarity Issue at /base when readable text must sit on the other side of the background
 * from what `base` says, or null. resolveTheme (themed) and repairTheme throw an Error with this
 * `code` and `issue` instead of resolving such a theme.
 */
export declare function basePolarityIssue(theme: ThemeV1): Issue | null;
/** SHA-256 hex of the canonical portable source. */
export declare function sourceHash(theme: ThemeV1): string;
export declare const PAIR_MATRIX: PairMatrix;

export declare function contrast(a: Hex, b: Hex): number;
export declare function luminance(hex: Hex): number;
export declare function mix(a: Hex, b: Hex, t: number): Hex;
export declare function oklab(hex: Hex): [l: number, a: number, b: number];
export declare function bestInk(background: Hex, base: Base): "#000000" | "#ffffff";
export declare function fit(color: Hex, backgrounds: readonly Hex[], minimum: number, base: Base): Hex | null;

export declare function graphProblems(levels: readonly Hex[], canvas: Hex, direction: "up" | "down", options?: { first?: boolean }): string[];
export declare function rampDirection(base: Base): "up" | "down";
export declare function deriveRamp(canvas: Hex, text: Hex, seed: Hex): [Hex, Hex, Hex, Hex, Hex];

export declare function seedProblems(seed: unknown): string[];
export declare function pairMatrixProblems(matrix: unknown): string[];
export declare function sha256(bytes: Uint8Array): string;

export declare const ACCESSIBILITY_NOTICE: "GitHub accessibility colors are active";
export declare const ANSI_ROLES: readonly AnsiRole[];
export declare const COLOR_PATHS: readonly ColorPath[];
export declare const SEMANTIC_FIELDS: readonly (keyof SemanticColors)[];
export declare const SEMANTIC_ROLES: readonly SemanticRole[];
export declare const TOKEN_KEYS: readonly (keyof UiTokens)[];
