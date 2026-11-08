// Theme format v1. Mirrors theme-v1.schema.json, which is authoritative. This is the only
// definition of ThemeV1; index.d.ts re-exports it.
import type { Base, FlavorSlotId, FontId, Hex, OverrideColorKey, SyntaxRole } from "./theme-engine.js";

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
  overrides?: Partial<Record<OverrideColorKey, Hex>> & { syntax?: Partial<Record<SyntaxRole, Hex>> };
  fonts?: { accent?: FontId };
  /** At most three. Presence requests the effect; omitted parameters use engine defaults. */
  effects?: Partial<EffectRequests>;
  flavor?: {
    enabled?: boolean;
    locale?: "en";
    slots?: Partial<Record<FlavorSlotId, string>>;
  };
  contributions?: { levels: [Hex, Hex, Hex, Hex, Hex] };
  /** Displayed as `inspired by <value>`. Descriptive credit only. */
  inspiredBy?: string;
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
