// Frozen renderer 1 declarations, copied from ARCHITECTURE.md "Frozen engine declarations".
// This is the only definition of these types; index.d.ts re-exports them. Changing one is a
// contract change that needs owner review before consumers change.
//
// Inputs are immutable: deep-freeze them before use. Hex strings are validated at runtime; the
// template type alone is insufficient. No extra color keys are allowed.
//
// The specification writes the engine functions as `declare function`. This package does not
// export them at runtime, so they are the EngineModule interface below; packages/engine (C2)
// exports functions with exactly these signatures.
import type { ThemeV1 } from "./theme-v1.js";

export type Hex = `#${string}`;
export type ModeId = string; // Exact frozen upstream ID.
export type Base = "light" | "dark";
export type Family = "standard" | "colorblind" | "tritanopia";
export type Policy = "themed" | "native-high-contrast" | "native-unknown";
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type GraphRamp = readonly [Hex, Hex, Hex, Hex, Hex];
export type SyntaxRole = "comment" | "keyword" | "string" | "function" | "number" | "variable" | "type";
export type SemanticRole = "success" | "danger" | "warning" | "done" | "sponsor";
export type AnsiRole =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite";

export interface UiTokens {
  canvas: Hex;
  surface: Hex;
  inset: Hex;
  raised: Hex;
  hover: Hex;
  active: Hex;
  text: Hex;
  mutedText: Hex;
  link: Hex;
  border: Hex;
  controlBorder: Hex;
  accent: Hex;
  accentMuted: Hex;
  accentEmphasis: Hex;
  emphasisText: Hex;
  primaryBackground: Hex;
  primaryHoverBackground: Hex;
  primaryPressedBackground: Hex;
  primaryText: Hex;
  primaryHoverText: Hex;
  primaryPressedText: Hex;
  primaryBorder: Hex;
  primaryIcon: Hex;
  primaryCounterBackground: Hex;
  primaryCounterText: Hex;
  focusOuter: Hex;
  focusInner: Hex;
  selectionBackground: Hex;
  selectionText: Hex;
  codeBackground: Hex;
  codeText: Hex;
  neutralBackground: Hex;
  neutralText: Hex;
  diffAddedBackground: Hex;
  diffAddedText: Hex;
  diffRemovedBackground: Hex;
  diffRemovedText: Hex;
  diffWordAddedBackground: Hex;
  diffWordAddedText: Hex;
  diffWordRemovedBackground: Hex;
  diffWordRemovedText: Hex;
  tooltipBackground: Hex;
  tooltipText: Hex;
  overlayBackground: Hex;
  overlayText: Hex;
  inputBackground: Hex;
  inputText: Hex;
  inputPlaceholder: Hex;
  disabledBackground: Hex;
  disabledText: Hex;
  disabledBorder: Hex;
  counterBackground: Hex;
  counterText: Hex;
  labelBackground: Hex;
  labelText: Hex;
  labelBorder: Hex;
}
export interface SemanticColors {
  text: Hex;
  mutedBackground: Hex;
  emphasisBackground: Hex;
  onEmphasis: Hex;
  border: Hex;
}
export interface ColorSet {
  tokens: UiTokens;
  semantics: Record<SemanticRole, SemanticColors>;
  syntax: Record<SyntaxRole, Hex>;
  ansi: Record<AnsiRole, Hex>;
  graph: GraphRamp;
}
export type ColorPath =
  | `/tokens/${keyof UiTokens}`
  | `/semantics/${SemanticRole}/${keyof SemanticColors}`
  | `/syntax/${SyntaxRole}`
  | `/ansi/${AnsiRole}`
  | `/graph/${0 | 1 | 2 | 3 | 4}`;
export interface SeedOrigin {
  file: string;
  sha256: string;
  variable: `--${string}`;
  fallback: boolean;
  compositeOver: ColorPath | null;
}
export type ModeSeed = DeepReadonly<{
  contractVersion: 1;
  id: ModeId;
  base: Base;
  family: Family;
  highContrast: boolean;
  sourceHash: string;
  colors: ColorSet;
  origins: Record<ColorPath, SeedOrigin>;
}>;
export type ModeIndex = DeepReadonly<{
  contractVersion: 1;
  modes: Record<ModeId, ModeSeed>;
  counterparts: { nativeMode: ModeId; base: Base; seedMode: ModeId }[];
  nativeCss: Record<ModeId, string>;
}>;
export type ModePlan = DeepReadonly<{ seedMode: ModeId | null; policy: Policy; notice?: string }>;
export type ResolveContext = DeepReadonly<{
  seed: ModeSeed | null;
  policy: Policy;
  reducedMotion: boolean;
  forcedColors: boolean;
}>;
export interface PairRecord {
  id: string;
  foreground: ColorPath;
  backgrounds: readonly [ColorPath, ...ColorPath[]];
  minimum: 3 | 4.5;
  purpose: "text" | "boundary" | "focus";
}
export interface PairMatrix {
  version: 1;
  records: readonly PairRecord[];
}
export interface PairResult {
  id: string;
  foreground: ColorPath;
  background: ColorPath;
  ratio: number;
  minimum: 3 | 4.5;
  passed: boolean;
}
export type OverrideColorKey =
  | "surface"
  | "inset"
  | "raised"
  | "hover"
  | "mutedText"
  | "link"
  | "border"
  | "controlBorder"
  | "accentMuted"
  | "primaryBackground"
  | "primaryText"
  | "focus"
  | "selectionBackground"
  | "selectionText"
  | "success"
  | "danger"
  | "warning"
  | "done";
export type SourceColorPath =
  | `/colors/${"background" | "text" | "accent" | "contribution"}`
  | `/overrides/${OverrideColorKey}`
  | `/overrides/syntax/${SyntaxRole}`;
export type Repair =
  | {
      persistence: "source";
      path: SourceColorPath | "/contributions/levels";
      before: Hex | GraphRamp;
      after: Hex | GraphRamp;
      reason: string;
    }
  | { persistence: "render"; path: ColorPath; before: Hex; after: Hex; reason: string };
export type FontId =
  | "system"
  | "rajdhani"
  | "barlow-condensed"
  | "fraunces"
  | "alegreya"
  | "cormorant-garamond"
  | "josefin-sans"
  | "bungee"
  | "space-grotesk";
export interface ResolvedEffects {
  glow?: { strength: number };
  grid?: { opacity: number; size: number };
  scanlines?: { opacity: number; spacing: number };
  paper?: { texture: "grain" | "halftone"; opacity: number; scale: number };
  rail?: { shape: "slash" | "notch" | "tooth" | "wave" | "route"; opacity: number; thickness: number };
  rules?: { style: "ruled" | "margin" | "ticks"; opacity: number; spacing: number };
  orbit?: { shape: "circle" | "ellipse" | "arc"; count: number; opacity: number };
  seal?: { shape: "diamond" | "brackets" | "compass" | "sprig" | "rosette"; size: number; opacity: number };
  drift?: { shape: "ember" | "petal" | "mote" | "wisp"; count: number; durationMs: number; distance: number; opacity: number };
  echo?: { offset: number; durationMs: number; opacity: number };
}
export type FlavorSlotId =
  | "profile.pinned.heading"
  | "profile.activity.heading"
  | "profile.organizations.heading"
  | "profile.tag"
  | "error.notFound.caption"
  | "empty.pinned.caption"
  | "empty.issues.caption"
  | "contributions.caption";
export interface ResolvedFlavor {
  enabled: boolean;
  locale: "en";
  slots: Partial<Record<FlavorSlotId, string>>;
}
export type ThemedResolved = DeepReadonly<
  ColorSet & {
    rendererVersion: 1;
    sourceHash: string;
    seedId: ModeId;
    seedHash: string;
    base: Base;
    policy: "themed";
    font: FontId;
    effects: ResolvedEffects;
    flavor: ResolvedFlavor;
    motionAllowed: boolean;
    repairs: Repair[];
    pairAudit: PairResult[];
  }
>;
export type NativeResolved = DeepReadonly<{
  rendererVersion: 1;
  sourceHash: string;
  seedId: ModeId | null;
  seedHash: string | null;
  base: Base;
  policy: "native-high-contrast" | "native-unknown" | "forced-colors";
  tokens: null;
  semantics: null;
  syntax: null;
  ansi: null;
  graph: null;
  font: "system";
  effects: Record<string, never>;
  flavor: { enabled: false; locale: "en"; slots: Record<string, never> };
  motionAllowed: false;
  repairs: readonly [];
  pairAudit: readonly [];
}>;
export type ResolvedTheme = ThemedResolved | NativeResolved;
export type PreviewView = "profile" | "repo" | "diff" | "empty" | "404";
export type EffectivePreferences = DeepReadonly<{
  enabled: boolean;
  extras: boolean;
  text: boolean;
  motion: boolean;
  fonts: boolean;
  effects: boolean;
}>;
export interface PreviewOptions {
  view: PreviewView;
  theme: ThemeV1;
  preferences: EffectivePreferences;
  onState?: (state: { policy: ResolvedTheme["policy"]; repairs: readonly Repair[] }) => void;
}
export interface PreviewHandle {
  update(options: { theme: ThemeV1; preferences: EffectivePreferences }): void;
  setView(view: PreviewView): void;
  setBefore(before: boolean): void;
  destroy(): void;
}

/** The frozen engine functions. packages/engine exports them; this package does not. */
export interface EngineModule {
  resolveTheme(theme: ThemeV1, context: ResolveContext): ResolvedTheme;
  repairTheme(theme: ThemeV1, standardSeed: ModeSeed): { theme: ThemeV1; repairs: readonly Repair[] };
  auditPairs(resolved: ThemedResolved): readonly PairResult[];
}
