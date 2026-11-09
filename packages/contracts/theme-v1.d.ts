// Theme format v1. Mirrors theme-v1.schema.json, which is authoritative. This is the only
// definition of ThemeV1; index.d.ts re-exports it. Revision 4 added every group from backgrounds
// down; all are optional and closed, so every earlier v1 document keeps its meaning.
import type { AnsiRole, Base, BodyFontId, DiffRole, FlavorSlotId, FontId, Hex, OverrideColorKey, ThemeSyntaxRole } from "./theme-engine.js";

export interface ThemeV1 {
  $schema?: "https://sidebandstudio.github.io/GitHub-Reskin/schemas/theme-v1.schema.json";
  schemaVersion: 1;
  /** 1-64 characters, no markup, control or bidi characters. */
  name: string;
  author?: string;
  /** Theme revision `major.minor.patch`, separate from schemaVersion. */
  version?: string;
  description?: string;
  /** Up to 8 unique kebab-case tags. */
  tags?: string[];
  base: Base;
  colors: {
    background: Hex;
    text: Hex;
    accent: Hex;
    /** Maximum-activity graph color; defaults to accent. */
    contribution?: Hex;
  };
  /** `syntax` may name all 22 roles; `code.syntax` wins per role when both are present. */
  overrides?: Partial<Record<OverrideColorKey, Hex>> & { syntax?: Partial<Record<ThemeSyntaxRole, Hex>> };
  /** `heading` wins over the legacy `accent`, which remains a heading alias. No field changes code fonts. */
  fonts?: { accent?: FontId; heading?: FontId; body?: BodyFontId };
  /** At most three. Presence requests the effect; omitted parameters use engine defaults. */
  effects?: Partial<EffectRequests>;
  flavor?: {
    enabled?: boolean;
    locale?: "en";
    slots?: Partial<Record<FlavorSlotId, string>>;
  };
  contributions?: ThemeContributions;
  /** Displayed as `inspired by <value>`. Descriptive credit only. */
  inspiredBy?: string;
  backgrounds?: { page?: ThemeBackground; profileBanner?: ThemeBackground; header?: ThemeBackground };
  shape?: ThemeShape;
  typography?: { uppercaseHeadings?: boolean; headingLetterSpacing?: number; bodyLetterSpacing?: number };
  code?: {
    background?: Hex;
    text?: Hex;
    syntax?: Partial<Record<ThemeSyntaxRole, Hex>>;
    ansi?: Partial<Record<AnsiRole, Hex>>;
    diff?: Partial<Record<DiffRole, Hex>>;
  };
  details?: {
    headerText?: Hex;
    selection?: { background?: Hex; text?: Hex };
    scrollbar?: { thumb?: Hex; track?: Hex; width?: "auto" | "thin" };
    labels?: ThemePill;
    topics?: ThemePill;
  };
  /** Advanced CSS, at most 32768 UTF-8 bytes. Sanitized before any use; never inserted as received. */
  css?: string;
}

export interface ThemeContributions {
  levels: [Hex, Hex, Hex, Hex, Hex];
  cellStyle?: "square" | "round" | "glow" | "diamond";
  /** 0..2 px. */
  cellRadius?: number;
  cellBoundary?: Hex;
  glow?: { radius?: number; opacity?: number; levels?: (1 | 2 | 3 | 4)[]; color?: Hex };
}

/** A solid color and up to four layers, nearest first, as CSS backgrounds are ordered. */
export interface ThemeBackground {
  color?: Hex;
  layers?: ThemePaintLayer[];
}
export type ThemePaintLayer =
  | { gradient: ThemeGradient }
  | { pattern: ThemePattern }
  | { image: ThemeRaster }
  | { gradientCss: { value: string; size?: string } };
export interface ThemeGradient {
  type: "linear" | "radial";
  angle?: number;
  position?: "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** 2-8 stops with nondecreasing positions 0..100. */
  stops: { color: Hex; position: number }[];
  opacity?: number;
}
export interface ThemePattern {
  kind: "grid" | "scanlines" | "dots" | "diagonal" | "grain";
  color: Hex;
  opacity?: number;
  size?: number;
}
/** A canonical base64 PNG, JPEG, WebP or GIF data URL whose header matches width and height. */
export interface ThemeRaster {
  data: string;
  width: number;
  height: number;
  fit?: "cover" | "contain" | "tile" | "stretch";
  position?: "center" | "top" | "bottom" | "left" | "right";
  opacity?: number;
}
export interface ThemeShape {
  corners?: { style?: "sharp" | "rounded" | "bevel" | "pill"; radius?: number };
  borders?: { width?: number; style?: "solid" | "dashed" | "double"; color?: Hex };
  shadows?: { style?: "none" | "soft" | "hard" | "neon"; color?: Hex; opacity?: number; blur?: number; offset?: number };
  buttons?: { style?: "filled" | "outline" | "soft" | "bevel"; radius?: number };
  avatar?: {
    shape?: "circle" | "square" | "rounded" | "bevel" | "arch";
    frame?: { style?: "none" | "solid" | "double" | "neon"; width?: number; color?: Hex };
  };
}
export interface ThemePill {
  style?: "sharp" | "rounded" | "bevel" | "pill";
  fill?: "solid" | "tinted" | "outline";
  background?: Hex;
  text?: Hex;
  border?: Hex;
}

export type EffectId = "glow" | "grid" | "scanlines" | "paper" | "rail" | "rules" | "orbit" | "seal" | "drift" | "echo";

/** Effect requests as a theme file writes them. ResolvedEffects is the same with every default filled. */
export interface EffectRequests {
  glow: { strength?: number };
  grid: { opacity?: number; size?: number };
  scanlines: { opacity?: number; spacing?: number };
  paper: { texture?: "grain" | "halftone"; opacity?: number; scale?: number };
  rail: { shape?: "slash" | "notch" | "tooth" | "wave" | "route"; opacity?: number; thickness?: number };
  rules: { style?: "ruled" | "margin" | "ticks"; opacity?: number; spacing?: number };
  orbit: { shape?: "circle" | "ellipse" | "arc"; count?: number; opacity?: number };
  seal: { shape?: "diamond" | "brackets" | "compass" | "sprig" | "rosette"; size?: number; opacity?: number };
  drift: { shape?: "ember" | "petal" | "mote" | "wisp"; count?: number; durationMs?: number; distance?: number; opacity?: number };
  echo: { offset?: number; durationMs?: number; opacity?: number };
}
