// Frozen renderer 1 declarations, copied from ARCHITECTURE.md "Frozen engine declarations", with
// the Revision 4 expansion: the resolved appearance record, extended syntax roles, heading/body
// fonts, pair-matrix version 2 and the expansion/sanitizer versions. ModeSeed and ColorSet are
// unchanged. This is the only definition of these types; index.d.ts re-exports them. Changing one
// is a contract change that needs owner review before consumers change.
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
/** The seven core roles every ModeSeed carries. */
export type SyntaxRole = "comment" | "keyword" | "string" | "function" | "number" | "variable" | "type";
/** The fifteen added roles, resolved into the appearance record from core roles when omitted. */
export type ExtendedSyntaxRole =
  | "operator"
  | "punctuation"
  | "constant"
  | "tag"
  | "attribute"
  | "regex"
  | "escape"
  | "invalid"
  | "inserted"
  | "deleted"
  | "markupHeading"
  | "markupEmphasis"
  | "markupLink"
  | "markupQuote"
  | "markupList";
export type ThemeSyntaxRole = SyntaxRole | ExtendedSyntaxRole;
export type DiffRole =
  | "addedBackground"
  | "addedText"
  | "removedBackground"
  | "removedText"
  | "wordAddedBackground"
  | "wordAddedText"
  | "wordRemovedBackground"
  | "wordRemovedText";
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
/** Paired appearance colors. They extend resolved output, never the ModeSeed inventory. */
export interface AppearanceColors {
  syntax: Record<ExtendedSyntaxRole, Hex>;
  page: { background: Hex };
  header: { background: Hex; text: Hex };
  scrollbar: { thumb: Hex; track: Hex };
  labels: { background: Hex; text: Hex; border: Hex };
  topics: { background: Hex; text: Hex; border: Hex };
  graph: { cellBoundary: Hex };
}
export type AppearanceColorPath =
  | `/appearance/colors/syntax/${ExtendedSyntaxRole}`
  | "/appearance/colors/page/background"
  | `/appearance/colors/header/${"background" | "text"}`
  | `/appearance/colors/scrollbar/${"thumb" | "track"}`
  | `/appearance/colors/${"labels" | "topics"}/${"background" | "text" | "border"}`
  | "/appearance/colors/graph/cellBoundary";
/** Any color a pair record or render repair can name. */
export type PairPath = ColorPath | AppearanceColorPath;
export interface PairRecord {
  id: string;
  foreground: PairPath;
  backgrounds: readonly [PairPath, ...PairPath[]];
  minimum: 3 | 4.5;
  purpose: "text" | "boundary" | "focus";
}
/** Version 2 keeps every version 1 record, first and unchanged, and adds the appearance pairs. */
export interface PairMatrix {
  version: 2;
  records: readonly PairRecord[];
}
export interface PairResult {
  id: string;
  foreground: PairPath;
  background: PairPath;
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
/** Every portable color field source repair may write. */
export type SourceColorPath =
  | `/colors/${"background" | "text" | "accent" | "contribution"}`
  | `/overrides/${OverrideColorKey}`
  | `/overrides/syntax/${ThemeSyntaxRole}`
  | `/code/syntax/${ThemeSyntaxRole}`
  | `/code/${"background" | "text"}`
  | `/code/ansi/${AnsiRole}`
  | `/code/diff/${DiffRole}`
  | "/details/headerText"
  | `/details/selection/${"background" | "text"}`
  | `/details/scrollbar/${"thumb" | "track"}`
  | `/details/${"labels" | "topics"}/${"background" | "text" | "border"}`
  | "/contributions/cellBoundary";
export type Repair =
  | {
      persistence: "source";
      path: SourceColorPath | "/contributions/levels";
      before: Hex | GraphRamp;
      after: Hex | GraphRamp;
      reason: string;
    }
  | { persistence: "render"; path: PairPath; before: Hex; after: Hex; reason: string };
/** Every heading font the schema names. FONT_INVENTORY says which ship files in this build. */
export type FontId =
  | "system"
  | "rajdhani"
  | "barlow-condensed"
  | "fraunces"
  | "alegreya"
  | "cormorant-garamond"
  | "josefin-sans"
  | "bungee"
  | "space-grotesk"
  | "bebas-neue"
  | "cinzel"
  | "orbitron"
  | "oxanium"
  | "ibm-plex-sans"
  | "source-sans-3"
  | "nunito-sans"
  | "atkinson-hyperlegible"
  | "roboto-condensed"
  | "barlow";
/** Readable families that may also style body text and rendered prose. */
export type BodyFontId = "system" | "ibm-plex-sans" | "source-sans-3" | "nunito-sans" | "atkinson-hyperlegible" | "barlow";
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
export type GradientPosition = "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
/**
 * One resolved background layer, nearest first. Images carry the SHA-256 of their decoded bytes
 * and the source pointer of their data, never base64; gradientCss carries its canonical admitted
 * value.
 */
export type ResolvedPaintLayer =
  | { kind: "gradient"; type: "linear" | "radial"; angle: number; position: GradientPosition; stops: { color: Hex; position: number }[]; opacity: number }
  | { kind: "pattern"; pattern: "grid" | "scanlines" | "dots" | "diagonal" | "grain"; color: Hex; opacity: number; size: number }
  | {
      kind: "image";
      asset: string;
      source: string;
      mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      width: number;
      height: number;
      fit: "cover" | "contain" | "tile" | "stretch";
      position: "center" | "top" | "bottom" | "left" | "right";
      opacity: number;
    }
  | { kind: "gradientCss"; value: string; size: string | null };
export interface ResolvedPaint {
  color: Hex | null;
  layers: ResolvedPaintLayer[];
}
export interface ResolvedFontRole {
  /** The font that renders. A deferred family resolves to "system". */
  id: FontId;
  requested: FontId;
  /** "bundled" loads the family's file; "native-stack" and "system" load none. */
  source: "system" | "bundled" | "native-stack";
  family: string | null;
  /**
   * The reviewed native font-family list. A compiler puts its own @font-face family first for a
   * bundled face; for "native-stack" this is the whole list. null for "system": keep GitHub's font.
   */
  fallback: string | null;
  weights: number[];
}
/** A resolution note: a deferred font, for example. Notes never change portable source. */
export interface AppearanceNote {
  code: string;
  path: string;
  message: string;
}
/**
 * The closed Revision 4 record. Groups a theme omits are null, so a v1 document keeps GitHub's
 * native shape, type and paints. Preferences (Full/Calm, Fonts, Effects) and CSS consent apply
 * when compiling, never here.
 */
export interface ResolvedAppearance {
  colors: AppearanceColors;
  paints: { page: ResolvedPaint | null; profileBanner: ResolvedPaint | null; header: ResolvedPaint | null };
  shape: {
    corners: { style: "sharp" | "rounded" | "bevel" | "pill"; radius: number } | null;
    borders: { width: number; style: "solid" | "dashed" | "double"; color: Hex } | null;
    shadows: { style: "none" | "soft" | "hard" | "neon"; color: Hex; opacity: number; blur: number; offset: number } | null;
    buttons: { style: "filled" | "outline" | "soft" | "bevel"; radius: number } | null;
    avatar: { shape: "circle" | "square" | "rounded" | "bevel" | "arch"; frame: { style: "none" | "solid" | "double" | "neon"; width: number; color: Hex } | null } | null;
  };
  fonts: { heading: ResolvedFontRole; body: ResolvedFontRole };
  typography: { uppercaseHeadings: boolean; headingLetterSpacing: number; bodyLetterSpacing: number } | null;
  graph: {
    cellStyle: "square" | "round" | "glow" | "diamond";
    cellRadius: number | null;
    glow: { radius: number; opacity: number; levels: (1 | 2 | 3 | 4)[]; color: Hex | null } | null;
  };
  details: {
    scrollbarWidth: "auto" | "thin";
    labels: { style: "sharp" | "rounded" | "bevel" | "pill" | null; fill: "solid" | "tinted" | "outline" } | null;
    topics: { style: "sharp" | "rounded" | "bevel" | "pill" | null; fill: "solid" | "tinted" | "outline" } | null;
  };
  /** Identity of the admitted advanced CSS. The canonical text stays in the source document. */
  css: { hash: string; bytes: number; sanitizerVersion: 1; policyHash: string } | null;
  notes: AppearanceNote[];
}
export type ThemedResolved = DeepReadonly<
  ColorSet & {
    rendererVersion: 1;
    expansionVersion: 1;
    sanitizerVersion: 1;
    sourceHash: string;
    seedId: ModeId;
    seedHash: string;
    base: Base;
    policy: "themed";
    font: FontId;
    effects: ResolvedEffects;
    flavor: ResolvedFlavor;
    motionAllowed: boolean;
    appearance: ResolvedAppearance;
    repairs: Repair[];
    pairAudit: PairResult[];
  }
>;
export type NativeResolved = DeepReadonly<{
  rendererVersion: 1;
  expansionVersion: 1;
  sanitizerVersion: 1;
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
  appearance: null;
  repairs: readonly [];
  pairAudit: readonly [];
}>;
export type ResolvedTheme = ThemedResolved | NativeResolved;
export type PreviewView = "profile" | "repo" | "diff" | "empty" | "404";
export type AppearanceMode = "full" | "calm";
export type EffectivePreferences = DeepReadonly<{
  enabled: boolean;
  /** The primary Full / Calm switch. Absent means the old extras flag decides: false is Calm. */
  appearance?: AppearanceMode;
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
