// Interface declarations for GitHub Reskin modules. ARCHITECTURE.md describes their behavior;
// this file fixes their shapes so units can build against them before the implementations land.
// Inputs are immutable. A module reads storage or the DOM only where its interface says so.

// ---------------------------------------------------------------------------------------------
// Constants (values in index.js)

export declare const THEME_FORMAT_VERSION: 1;
export declare const SETTINGS_VERSION: 2;
export declare const RENDERER_VERSION: 1;
export declare const ENGINE_VERSION: 1;
export declare const DEFAULT_THEME_ID: "anime.cyberpunk-edgerunners";
export declare const LEGACY_CLASSIC_THEME_IDS: readonly LegacyClassicThemeId[];
export declare const LEGACY_THEME_ALIASES: Readonly<{ cyberpunk: "anime.cyberpunk-edgerunners" }>;
export declare const LEGACY_EDITED_COLORS_THEME_ID: "editing-suite";
export declare const LOCAL_THEME_ID_PREFIX: "local:";
export declare const THEME_SCHEMA_URL: "https://sidebandstudio.github.io/GitHub-Reskin/schemas/theme-v1.schema.json";
export declare const SHARE_CODE_PREFIX: "RS1.";
export declare const STORAGE_KEYS: Readonly<{
  settings: "reskin.settings";
  boot: "reskin.boot";
  lastGood: "reskin.lastGood";
  draft: "reskin.draft";
  ui: "reskin.ui";
}>;
export declare const LEGACY_STORAGE_KEYS: readonly ["enabled", "theme", "custom"];
export declare const LEGACY_PAGE_CACHE_KEY: "github-reskin-css";
export declare const BASES: readonly Base[];
export declare const CORE_COLOR_ROLES: readonly CoreColorRole[];
export declare const OVERRIDE_COLOR_ROLES: readonly OverrideColorRole[];
export declare const SYNTAX_ROLES: readonly SyntaxRole[];
export declare const COLOR_ROLES: readonly ColorRole[];
export declare const FONT_IDS: readonly FontId[];
export declare const EFFECT_IDS: readonly EffectId[];
export declare const EFFECT_TARGETS: readonly EffectTarget[];
export declare const FLAVOR_SLOT_IDS: readonly FlavorSlotId[];
export declare const PREFERENCE_KEYS: readonly PreferenceKey[];
export declare const DEFAULT_PREFERENCES: Readonly<Preferences>;
export declare const COMMIT_ACTION_TYPES: readonly CommitAction["type"][];
export declare const SETTINGS_REQUEST_TYPES: readonly SettingsRequest["type"][];
export declare const EDITOR_ACTION_TYPES: readonly EditorAction["type"][];
export declare const INTERNAL_PAGES: readonly InternalPage[];
export declare const PREVIEW_VIEWS: readonly PreviewView[];
export declare const MODE_POLICIES: readonly ModePolicy[];
export declare const MODE_FAMILIES: readonly ModeFamily[];
export declare const ISSUE_SEVERITIES: readonly IssueSeverity[];
export declare const ISSUE_CODES: Readonly<Record<string, IssueCode>>;
export declare const LIMITS: Readonly<Limits>;
export declare const BUDGETS: Readonly<Budgets>;
export declare const BROWSER_TARGETS: readonly BrowserTarget[];
export declare const BUILD_TARGETS: readonly BuildTarget[];
export declare const GECKO_ID: "github-reskin@sideband.studio";
export declare const SUPPORTED_ORIGINS: readonly ["https://github.com", "https://gist.github.com"];
export declare const HEX_COLOR: RegExp;

// ---------------------------------------------------------------------------------------------
// Vocabulary

/** Local catalog or storage identifier. Never taken from an imported theme's name. */
export type ThemeId = string;
/** Custom theme ID, `local:` plus crypto.randomUUID(). Never exported. */
export type LocalThemeId = `local:${string}`;
export type LegacyClassicThemeId =
  | "editing-suite"
  | "dracula"
  | "nord"
  | "catppuccin-mocha"
  | "gruvbox"
  | "tokyo-night"
  | "rose-pine"
  | "one-dark"
  | "solarized-dark"
  | "catppuccin-latte"
  | "rose-pine-dawn"
  | "solarized-light";
/** Normalized opaque sRGB color, `#rrggbb` in lowercase. */
export type Hex = `#${string}`;
export type Base = "dark" | "light";
export type CoreColorRole = "background" | "text" | "accent" | "contribution";
export type OverrideColorRole =
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
export type SyntaxRole = "comment" | "keyword" | "string" | "function" | "number" | "variable" | "type";
export type ColorRole = CoreColorRole | OverrideColorRole | "syntax";
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
export type EffectId = "glow" | "grid" | "scanlines" | "paper" | "rail" | "rules" | "orbit" | "seal" | "drift" | "echo";
export type EffectTarget = "owned-badge" | "owned-margin-strip" | "owned-caption-edge";
export type FlavorSlotId =
  | "profile.pinned.heading"
  | "profile.activity.heading"
  | "profile.organizations.heading"
  | "profile.tag"
  | "error.notFound.caption"
  | "empty.pinned.caption"
  | "empty.issues.caption"
  | "contributions.caption";
export type PreferenceKey = "extras" | "text" | "motion" | "fonts" | "effects";
export type Preferences = Record<PreferenceKey, boolean>;
export type InternalPage = "onboarding" | "settings";
export type PreviewView = "profile" | "repo" | "diff" | "empty" | "404";
export type BrowserTarget = "chrome" | "firefox";
export type BuildTarget = BrowserTarget | "userscript" | "shared" | "site";

export interface Disposable {
  destroy(): void;
}
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------------------------
// Theme format v1. Mirrors theme-v1.schema.json; the schema is authoritative.

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
  overrides?: Partial<Record<OverrideColorRole, Hex>> & { syntax?: Partial<Record<SyntaxRole, Hex>> };
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

/** A built-in catalog record. Palettes and display names live only in the referenced document. */
export interface CatalogEntry {
  id: ThemeId;
  /** Stable after publication; not regenerated when a display name changes. */
  slug: string;
  group: "anime" | "classics";
  /** Repository-relative path to the public theme document. */
  file: string;
  order: number;
}

// ---------------------------------------------------------------------------------------------
// Issues, repairs and import

export type IssueSeverity = "error" | "warning" | "info";
export type IssueCode = string;
export interface Issue {
  code: IssueCode;
  /** JSON Pointer into the document or input, "" for the whole input. */
  path: string;
  message: string;
  severity: IssueSeverity;
}
export interface Repair {
  path: string;
  before: unknown;
  after: unknown;
  reason: string;
}
export interface Note {
  code: IssueCode;
  path: string;
  message: string;
}

export type ImportKind = "text" | "file" | "code";
export interface ImportCandidate {
  /** A label the chooser can show, such as the candidate's name or position. */
  label: string;
  document: unknown;
}
export type ImportResult =
  | {
      ok: true;
      /** Retained only in the local draft, never in exports or logs. */
      source: string;
      normalized: ThemeV1;
      notes: Note[];
      repairs: Repair[];
      preview: ResolvedTheme;
    }
  | { ok: false; issues: Issue[]; candidates?: ImportCandidate[] };
export type ValidationResult = { ok: true; theme: ThemeV1 } | { ok: false; issues: Issue[] };

export interface ExportedFile {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export interface FormatModule {
  parseImport(input: string | Uint8Array, kind: ImportKind): ImportResult;
  validateTheme(value: unknown): ValidationResult;
  normalizeTheme(value: unknown): { theme: unknown; notes: Note[] };
  /** UTF-8, LF, recursively sorted keys, array order kept, compact, no BOM or trailing newline. */
  canonicalize(theme: ThemeV1): string;
  exportTheme(theme: ThemeV1): ExportedFile;
  /** `RS1.<base64url(zlib(canonical))>.<crc32 hex>`. */
  encodeShare(theme: ThemeV1): string;
  decodeShare(code: string): ImportResult;
  makeAiPrompt(idea?: string): string;
}

// ---------------------------------------------------------------------------------------------
// GitHub modes. C3 supplies the frozen mode index; nothing assumes how many modes exist.

/** An exact GitHub mode ID from the frozen index, such as "dark_dimmed". */
export type ModeId = string;
export type ModeFamily = "standard" | "dimmed" | "colorblind" | "tritanopia";
export type ModePolicy = "themed" | "native-high-contrast" | "native-unknown";

export interface ModeRecord {
  id: ModeId;
  base: Base;
  family: ModeFamily;
  highContrast: boolean;
  /** The same family's mode in the other base, when one exists. */
  counterpart?: ModeId;
  /** Reviewed seed values by Primer variable name, without `--`. */
  seeds: Record<string, string>;
}
export interface ModeIndex {
  version: 1;
  modes: Record<ModeId, ModeRecord>;
}
export interface NativeMode {
  colorMode: "light" | "dark" | "auto";
  lightTheme: ModeId;
  darkTheme: ModeId;
  systemDark: boolean;
}
export interface ModePlan {
  seedMode: ModeId | null;
  policy: ModePolicy;
  notice?: string;
}
export interface ModeSelector {
  selector: string;
  mode: ModeId;
  policy: ModePolicy;
}

// ---------------------------------------------------------------------------------------------
// Engine

export interface ResolveContext {
  semanticMode: ModeId;
  policy: ModePolicy;
  reducedMotion: boolean;
  forcedColors: boolean;
}

export interface ResolvedTokens {
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
  accentEmphasisText: Hex;
  primaryBackground: Hex;
  primaryBackgroundHover: Hex;
  primaryBackgroundActive: Hex;
  primaryText: Hex;
  focusOuter: Hex;
  focusInner: Hex;
  selectionBackground: Hex;
  selectionText: Hex;
  /** Paired code and diff roles, keyed by role name. */
  code: Record<string, Hex>;
}

export interface ResolvedTheme {
  rendererVersion: 1;
  /** sha256 of the canonical source. */
  sourceHash: string;
  base: Base;
  tokens: ResolvedTokens;
  graph: [Hex, Hex, Hex, Hex, Hex];
  syntax: Record<SyntaxRole, Hex>;
  semantics: Record<"success" | "danger" | "warning" | "done" | "sponsors", Hex>;
  /** Requested effects with every parameter filled from engine defaults. */
  effects: Partial<{ [K in EffectId]: Required<EffectRequests[K]> }>;
  flavor: { enabled: boolean; locale: "en"; slots: Partial<Record<FlavorSlotId, string>> } | null;
  fonts: { accent: FontId };
  repairs: Repair[];
  pairAudit: PairResult[];
}

export interface PairResult {
  foreground: string;
  background: string;
  ratio: number;
  minimum: number;
  pass: boolean;
}

export interface RemixOptions {
  /** Unsigned 32-bit seed. Remix has no other source of randomness. */
  seed: number;
  lockedColors: ColorRole[];
}

export interface EngineModule {
  resolveTheme(theme: ThemeV1, context: ResolveContext): ResolvedTheme;
  repairTheme(theme: ThemeV1): { theme: ThemeV1; repairs: Repair[] };
  auditPairs(resolved: ResolvedTheme): PairResult[];
  remixTheme(theme: ThemeV1, options: RemixOptions): ThemeV1;
}

// ---------------------------------------------------------------------------------------------
// Primer adapter and appearance

export interface EffectivePreferences {
  enabled: boolean;
  extras: boolean;
  text: boolean;
  motion: boolean;
  fonts: boolean;
  effects: boolean;
}

export interface OwnedNodePlan {
  slot: FlavorSlotId | EffectTarget;
  animated: boolean;
}

export interface CompiledStyle {
  css: string;
  /** From canonical source, engine version, mode plan and effective preferences. */
  fingerprint: string;
  warnings: Note[];
  ownedNodePlan: OwnedNodePlan[];
}

export interface SlotAnchor {
  slot: FlavorSlotId;
  host: Element;
  insert: "after" | "append" | "before";
  nativeSignature: string;
}

export interface PrimerModule {
  selectMode(native: NativeMode, base: Base): ModePlan;
  compileGitHub(resolved: ResolvedTheme, modePlan: ModePlan, prefs: EffectivePreferences): CompiledStyle;
  modeSelectors(): ModeSelector[];
}

export interface AppearanceModule {
  compileAppearance(resolved: ResolvedTheme, prefs: EffectivePreferences, target: "github" | "preview"): string;
  mountAppearance(root: Element, resolved: ResolvedTheme, prefs: EffectivePreferences, anchors: SlotAnchor[]): Disposable;
  /** Only the target's URL adapter supplies resourceUrl. Theme files never do. */
  fontFaceCss(fontId: FontId, resourceUrl: string): string;
}

export interface PreviewHandle {
  update(next: { theme: ThemeV1; preferences: EffectivePreferences }): void;
  setView(view: PreviewView): void;
  setBefore(before: boolean): void;
  destroy(): void;
}

export interface PreviewModule {
  mountPreview(
    container: Element,
    options: {
      view: PreviewView;
      theme: ThemeV1;
      preferences: EffectivePreferences;
      onState?: (state: { view: PreviewView; before: boolean }) => void;
    },
  ): PreviewHandle;
}

// ---------------------------------------------------------------------------------------------
// Settings

export interface CustomTheme {
  id: LocalThemeId;
  document: ThemeV1;
  basedOn?: ThemeId;
}

export interface SettingsV2 {
  settingsVersion: 2;
  revision: number;
  enabled: boolean;
  selectedThemeId: ThemeId;
  preferences: Preferences;
  customThemes: CustomTheme[];
  favorites: ThemeId[];
  onboardingCompleted: boolean;
  migration: { from?: "1.1.0"; notices: string[] };
}

/** Saved with settings in the same storage.set call. No user identifiers, page content or CSS. */
export interface BootRecord {
  settingsRevision: number;
  rendererVersion: 1;
  catalogHash: string;
  selectedSourceHash: string;
  validatedTokenSnapshot: ResolvedTokens & { graph: [Hex, Hex, Hex, Hex, Hex] };
  effectivePreferences: EffectivePreferences;
}

export type CommitAction =
  | { type: "selectTheme"; id: ThemeId }
  | { type: "setEnabled"; enabled: boolean }
  | { type: "setPreference"; key: PreferenceKey; value: boolean }
  | { type: "saveCustom"; id?: LocalThemeId; document: ThemeV1; basedOn?: ThemeId; select: boolean }
  | { type: "deleteCustom"; id: LocalThemeId }
  | { type: "resetPreferences" }
  | { type: "resetAll" };

export interface Draft {
  document: ThemeV1;
  /** The original import text, kept locally until Use or Discard. */
  source?: string;
  basedOn?: ThemeId;
  savedAt: number;
}

export type ReadResult =
  | { ok: true; settings: SettingsV2; migrated: boolean; notices: string[] }
  | { ok: false; code: "storage" | "invalid"; issues: Issue[]; fallback: SettingsV2 };

export interface MigrationResult {
  settings: SettingsV2;
  notices: string[];
  /** Bounded copy of unusable 1.x data, kept until dismissed or exported. */
  recovery?: unknown;
}

export type SettingsReply =
  | { ok: true; settings: SettingsV2 }
  | { ok: false; code: "conflict" | "storage" | "invalid"; current?: SettingsV2; issues: Issue[] };

export type SafeQuery = Partial<Record<"theme" | "view" | "from", string>>;

export type SettingsRequest =
  | { type: "get"; requestId: string }
  | { type: "commit"; requestId: string; expectedRevision: number; action: CommitAction }
  | { type: "draft"; requestId: string; action: { type: "save"; draft: Draft } | { type: "load" } | { type: "discard" } }
  | { type: "open-page"; requestId: string; action: { page: InternalPage; query?: SafeQuery } };

export interface StorageAdapter {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(record: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  subscribe(listener: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void): Unsubscribe;
}

export interface SettingsRepository {
  read(): Promise<ReadResult>;
  commit(action: CommitAction, expectedRevision: number): Promise<SettingsReply>;
  saveDraft(draft: Draft): Promise<void>;
  subscribe(listener: (settings: SettingsV2) => void): Unsubscribe;
}

export interface SettingsModule {
  readSettings(storage: StorageAdapter): Promise<ReadResult>;
  migrateLegacy(raw: Record<string, unknown>): MigrationResult;
  reduceAction(settings: SettingsV2, action: CommitAction): SettingsV2;
  createRepository(storage: StorageAdapter): SettingsRepository;
}

export interface BackgroundModule {
  dispatch(request: SettingsRequest, sender: { id?: string; url?: string }): Promise<SettingsReply>;
  openPage(page: InternalPage, query?: SafeQuery): Promise<void>;
}

export interface ContentModule {
  startContent(options: { storage: StorageAdapter; runtime: unknown; document: Document; modeSource: unknown }): Disposable;
  locateSlots(document: Document, route: string): SlotAnchor[];
}

// ---------------------------------------------------------------------------------------------
// UI host and editor

export interface UiHostCapabilities {
  durableStorage: boolean;
  clipboard: boolean;
  fileDownload: boolean;
  crossTabUpdates: boolean;
}

/** Platform I/O for shared UI. The UI never assumes a call succeeded. */
export interface UiHost {
  read(): Promise<ReadResult>;
  commit(action: CommitAction, expectedRevision: number): Promise<SettingsReply>;
  loadDraft(): Promise<Draft | null>;
  saveDraft(draft: Draft): Promise<void>;
  discardDraft(): Promise<void>;
  openPage(page: InternalPage, query?: SafeQuery): Promise<void>;
  copyText(text: string): Promise<{ ok: boolean }>;
  downloadFile(file: ExportedFile): Promise<{ ok: boolean }>;
  capabilities: UiHostCapabilities;
}

export type EditorAction =
  | { type: "setColor"; role: Exclude<ColorRole, "syntax">; value: Hex }
  | { type: "setBase"; base: Base }
  | { type: "setFont"; font: FontId }
  | { type: "setEffect"; effect: EffectId; params: EffectRequests[EffectId] | null }
  | { type: "setFlavorSlot"; slot: FlavorSlotId; text: string | null }
  | { type: "setGraph"; levels: [Hex, Hex, Hex, Hex, Hex] | null }
  | { type: "remix"; seed: number; lockedColors: ColorRole[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" }
  /** A validated import is one undo step. */
  | { type: "loadImport"; theme: ThemeV1 };

export interface EditorState {
  document: ThemeV1;
  baseline: ThemeV1;
  repairs: Repair[];
  fieldErrors: Issue[];
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface EditorController {
  getState(): EditorState;
  dispatch(action: EditorAction): void;
  subscribe(listener: (state: EditorState) => void): Unsubscribe;
  destroy(): void;
}

export interface UiModule {
  mountPicker(doc: Document, host: UiHost): Disposable;
  mountBuilder(doc: Document, host: UiHost): Disposable;
  createEditor(theme: ThemeV1): EditorController;
}

export interface UserscriptModule {
  createGmHost(gm: unknown): UiHost;
  openPanel(mode: "picker" | "builder"): void;
}

// ---------------------------------------------------------------------------------------------
// Limits and budgets

export interface Limits {
  fileUtf8Bytes: number;
  pastedUtf8Bytes: number;
  compressedBytes: number;
  expandedBytes: number;
  maxDepth: number;
  maxCustomThemes: number;
  maxCustomSourceBytes: number;
  maxDraftBytes: number;
  maxEffectsPerTheme: number;
  maxOwnedNodesPerDocument: number;
  maxAnimatedNodes: number;
  maxPatchWidthPx: number;
  maxPatchHeightPx: number;
  maxAnimatedElementPx: number;
  maxAnimationTotalMs: number;
  maxEchoMs: number;
  fontFamilies: number;
  fontWeightsPerFamily: number;
  fontTotalWoff2Bytes: number;
  fontMaxPerFamilyBytes: number;
  startupGateMs: number;
  maxInitialRootQueries: number;
  maxContainerObservers: number;
  maxCandidateNodesPerPass: number;
  maxPassMs: number;
  maxNavigationMs: number;
  styleRemovalCircuitBreaker: number;
}

export interface Budgets {
  runtimeZipBytes: number;
  unpackedRuntimeBytes: number;
  contentEngineGzipBytes: number;
  contentEngineRawBytes: number;
  modeDataRawBytes: number;
  userscriptBytes: number;
  siteInitialJsGzipBytes: number;
  siteInitialTransferBytes: number;
  siteFilmBytes: number;
  tiktokMasterBytes: number;
  previewResolveP95Ms: number;
  settingsToStyleP95Ms: number;
  longTaskMs: number;
  idleCpuPercent: number;
}

// ---------------------------------------------------------------------------------------------
// Release

/** release.config.json. Store URLs stay null until real listings exist. */
export interface ReleaseConfig {
  name: string;
  displayName: string;
  version: string;
  toolchain: { node: string; npm: string };
  extension: {
    /** Key into extension/manifests/entries.json. */
    entry: string;
    geckoId: "github-reskin@sideband.studio";
    permissions: string[];
    hostMatches: string[];
  };
  userscript: { builder: string; output: string };
  site: { origin: string; base: string };
  support: { issues: string; source: string };
  stores: { chrome: string | null; firefox: string | null };
  video: { tiktok: string; site: string };
  compatibility: { chromeMin: number; firefoxMin: number; claims: string[] };
}

/** One runtime entry in extension/manifests/entries.json. */
export interface ExtensionEntry {
  description: string;
  /** Repository-relative directory the files are copied from. */
  root: string;
  /** Every runtime file, relative to root. Nothing else enters the package. */
  files: string[];
  /** sha256 of inputs that must not change for this entry. */
  frozen: Record<string, string>;
}

export interface BuildOptions {
  target: BuildTarget;
  outDir: string;
  releaseConfig: ReleaseConfig;
  /** Test-only extra content-script matches for local fixtures. Never in production output. */
  testFixture?: { matches: string[] };
}

export interface BuildResult {
  target: BuildTarget;
  dir: string;
  files: Record<string, string>;
  manifest?: Record<string, unknown>;
}

export interface PackageOptions {
  version: string;
  commit: string | null;
  /** Seconds since the Unix epoch, recorded in build-info. ZIP entry times are fixed. */
  epoch: number | null;
}
