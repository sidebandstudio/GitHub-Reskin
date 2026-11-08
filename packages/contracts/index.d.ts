// Interface declarations for GitHub Reskin modules. ARCHITECTURE.md describes their behavior;
// this file fixes their shapes so units can build against them before the implementations land.
// Inputs are immutable. A module reads storage or the DOM only where its interface says so.
// The theme format is in theme-v1.d.ts and the frozen engine types in theme-engine.d.ts; this
// file re-exports both, so `import type { ... } from "packages/contracts/index.js"` reaches all.
import type {
  Base,
  EffectivePreferences,
  Family,
  FlavorSlotId,
  FontId,
  Hex,
  ModeId,
  ModeIndex,
  ModePlan,
  OverrideColorKey,
  Policy,
  PreviewHandle,
  PreviewOptions,
  PreviewView,
  Repair,
  ResolvedTheme,
  SyntaxRole,
} from "./theme-engine.js";
import type { EffectId, ThemeV1 } from "./theme-v1.js";

// ---------------------------------------------------------------------------------------------
// Constants (values in index.js)

export declare const THEME_FORMAT_VERSION: 1;
export declare const SETTINGS_VERSION: 2;
export declare const RENDERER_VERSION: 1;
export declare const ENGINE_VERSION: 1;
export declare const PAIR_MATRIX_VERSION: 1;
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
export declare const SHARED_BUILD_SCOPES: readonly SharedScope[];
export declare const GECKO_ID: "github-reskin@sideband.studio";
export declare const SUPPORTED_ORIGINS: readonly ["https://github.com", "https://gist.github.com"];
export declare const HEX_COLOR: RegExp;

// ---------------------------------------------------------------------------------------------
// Theme format and frozen engine types. Each is defined once, in theme-v1.d.ts or
// theme-engine.d.ts, and re-exported here.

export type { ThemeV1, EffectId, EffectRequests } from "./theme-v1.js";
export type {
  AnsiRole,
  Base,
  ColorPath,
  ColorSet,
  DeepReadonly,
  EffectivePreferences,
  EngineModule,
  Family,
  FlavorSlotId,
  FontId,
  GraphRamp,
  Hex,
  ModeId,
  ModeIndex,
  ModePlan,
  ModeSeed,
  NativeResolved,
  OverrideColorKey,
  PairMatrix,
  PairRecord,
  PairResult,
  Policy,
  PreviewHandle,
  PreviewOptions,
  PreviewView,
  Repair,
  ResolveContext,
  ResolvedEffects,
  ResolvedFlavor,
  ResolvedTheme,
  SeedOrigin,
  SemanticColors,
  SemanticRole,
  SourceColorPath,
  SyntaxRole,
  ThemedResolved,
  UiTokens,
} from "./theme-engine.js";

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
export type CoreColorRole = "background" | "text" | "accent" | "contribution";
/** The schema's override keys under another name. */
export type OverrideColorRole = OverrideColorKey;
/** Every color role the theme format names. A schema registry; it says nothing about editing. */
export type ColorRole = CoreColorRole | OverrideColorRole | "syntax";
export type EffectTarget = "owned-badge" | "owned-margin-strip" | "owned-caption-edge";
export type PreferenceKey = "extras" | "text" | "motion" | "fonts" | "effects";
export type Preferences = Record<PreferenceKey, boolean>;
export type InternalPage = "onboarding" | "settings";
export type BrowserTarget = "chrome" | "firefox";
export type BuildTarget = BrowserTarget | "userscript" | "shared" | "site";
/** Shared build scopes. Each bundles its prerequisites: engine, then primer, then preview. */
export type SharedScope = "engine" | "primer" | "preview";

export interface Disposable {
  destroy(): void;
}
export type Unsubscribe = () => void;

/**
 * One record of themes/catalog.json, a JSON array serialized Anime first, then Classics, each by
 * order. Palettes and display names live only in the referenced document.
 */
export interface CatalogEntry {
  id: ThemeId;
  /** Stable after publication; not regenerated when a display name changes. */
  slug: string;
  group: "anime" | "classics";
  /** Repository-root-relative POSIX path to the public theme document, no leading slash or `..`. */
  file: string;
  /** 1-based, unique and contiguous within the group. */
  order: number;
}

// ---------------------------------------------------------------------------------------------
// Issues and import

export type IssueSeverity = "error" | "warning" | "info";
export type IssueCode = string;
export interface Issue {
  code: IssueCode;
  /** JSON Pointer into the document or input, "" for the whole input. */
  path: string;
  message: string;
  severity: IssueSeverity;
}

export type ImportKind = "text" | "file" | "code";
/** One of several plausible theme objects found in the input, for a local choice. */
export interface ImportCandidate {
  name: string;
  /** The candidate's own text, to parse again once chosen. */
  input: string;
}
/**
 * Parsing normalizes and validates only. It never repairs, resolves or saves: the caller passes
 * `normalized` and a standard seed to repairTheme, then resolves the repaired source to preview.
 */
export type ImportResult =
  | {
      ok: true;
      /** Retained only in the local draft, never in exports or logs. */
      source: string;
      normalized: ThemeV1;
      /** Normalization changes, one Issue each. */
      notes: Issue[];
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
  normalizeTheme(value: unknown): { theme: unknown; notes: Issue[] };
  /** UTF-8, LF, recursively sorted keys, array order kept, compact, no BOM or trailing newline. */
  canonicalize(theme: ThemeV1): string;
  exportTheme(theme: ThemeV1): ExportedFile;
  /** `RS1.<base64url(zlib(canonical))>.<crc32 hex>`. */
  encodeShare(theme: ThemeV1): string;
  decodeShare(code: string): ImportResult;
  makeAiPrompt(idea?: string): string;
}

// ---------------------------------------------------------------------------------------------
// GitHub modes. C3 supplies the frozen ModeIndex; nothing assumes how many modes exist.
// Dimmed is an exact upstream mode ID in the standard family, not a family of its own.

export type ModeFamily = Family;
/** The mode-plan policy. Forced colors adds the resolved `forced-colors` policy, not a plan input. */
export type ModePolicy = Policy;

export interface NativeMode {
  colorMode: "light" | "dark" | "auto";
  lightTheme: ModeId;
  darkTheme: ModeId;
  systemDark: boolean;
}
export interface ModeSelector {
  selector: string;
  mode: ModeId;
  policy: ModePolicy;
}

// ---------------------------------------------------------------------------------------------
// Primer adapter, appearance and preview

export interface OwnedNodePlan {
  slot: FlavorSlotId | EffectTarget;
  animated: boolean;
}

export interface CompiledStyle {
  css: string;
  /** From canonical source, engine and pair-matrix versions, seed sourceHash, mode plan and effective preferences. */
  fingerprint: string;
  warnings: Issue[];
  ownedNodePlan: OwnedNodePlan[];
}

export interface SlotAnchor {
  slot: FlavorSlotId;
  host: Element;
  insert: "after" | "append" | "before";
  nativeSignature: string;
}

export interface PrimerModule {
  /** The caller supplies the frozen index; the selector does no lookup of its own. */
  selectMode(native: NativeMode, base: Base, index: ModeIndex): ModePlan;
  compileGitHub(resolved: ResolvedTheme, modePlan: ModePlan, prefs: EffectivePreferences): CompiledStyle;
  modeSelectors(): ModeSelector[];
}

export interface AppearanceModule {
  compileAppearance(resolved: ResolvedTheme, prefs: EffectivePreferences, target: "github" | "preview"): string;
  mountAppearance(root: Element, resolved: ResolvedTheme, prefs: EffectivePreferences, anchors: SlotAnchor[]): Disposable;
  /** Only the target's URL adapter supplies resourceUrl. Theme files never do. */
  fontFaceCss(fontId: FontId, resourceUrl: string): string;
}

/** Also the contract for C7's temporary site adapter. */
export interface PreviewModule {
  mountPreview(container: HTMLElement, options: PreviewOptions): PreviewHandle;
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
  onboardingCompleted: boolean;
  migration: { from?: "1.1.0"; notices: string[] };
}

/**
 * `reskin.boot`, saved with settings in the same storage.set call. No user identifiers, page
 * content or CSS.
 *
 * Reuse rule: first decide native, high-contrast or forced-colors policy from the current page,
 * before applying any cached themed colors. Then reuse the snapshot only if it validates as a
 * complete ResolvedTheme branch (bounds and hex types), its sourceHash equals selectedSourceHash
 * and the current selected source's canonical hash, rendererVersion, engineVersion and
 * pairMatrixVersion equal the running ones, and its seedId and seedHash are those of the current
 * mode plan's seed. Any mismatch discards it and resolves the source again.
 */
export interface BootRecord {
  settingsRevision: number;
  rendererVersion: 1;
  engineVersion: 1;
  pairMatrixVersion: 1;
  catalogHash: string;
  selectedSourceHash: string;
  validatedTokenSnapshot: ResolvedTheme;
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

/**
 * Builder edits. The editor keeps one previous document: each completed valid edit replaces it,
 * undo restores it and clears it. Reset and loadImport are undoable the same way. Edits keep
 * imported overrides, graph levels and effect parameters they do not touch.
 */
export type EditorAction =
  | { type: "setColor"; role: "background" | "text" | "accent"; value: Hex }
  | { type: "setBase"; base: Base }
  | { type: "setFont"; font: FontId }
  /** Enabling a present effect keeps its parameters; a newly added one gets the schema defaults. */
  | { type: "toggleEffect"; effect: EffectId; enabled: boolean }
  | { type: "setFlavorEnabled"; enabled: boolean }
  | { type: "setFlavorSlot"; slot: FlavorSlotId; text: string | null }
  | { type: "undo" }
  | { type: "reset" }
  /** A validated import. */
  | { type: "loadImport"; theme: ThemeV1 };

export interface EditorState {
  document: ThemeV1;
  baseline: ThemeV1;
  repairs: readonly Repair[];
  fieldErrors: Issue[];
  dirty: boolean;
  canUndo: boolean;
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
  /** Upstream license notices the package carries. Every frozen file is covered by one. */
  notices: LicenseNotice[];
}

export interface LicenseNotice {
  /** Repository-relative notice file, packaged at the same path. */
  file: string;
  /** SPDX identifier. */
  license: string;
  /** Entry files, relative to the entry root, that contain upstream material under this notice. */
  covers: string[];
  upstream: string;
}

export interface BuildOptions {
  target: BuildTarget;
  outDir: string;
  releaseConfig: ReleaseConfig;
  /** For target "shared". Omitted, every shared package is built. */
  scope?: SharedScope;
  /** Test-only extra content-script matches for local fixtures. Never in production output. */
  testFixture?: { matches: string[] };
}

/** site/build.mjs (C7) exports build(options). It writes the static site into outDir, which is empty. */
export interface SiteBuildOptions {
  outDir: string;
  config: ReleaseConfig;
}
export type SiteBuild = (options: SiteBuildOptions) => Promise<void>;

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

// ---------------------------------------------------------------------------------------------
// Checks. scripts/check-routes.mjs routes each check command to a named export of a unit-owned
// module with this signature; see scripts/README.md.

export interface CheckOptions {
  /** The check command, such as "schema" or "a11y". */
  command: string;
  /** Arguments after the command, forwarded unchanged. */
  args: string[];
  /** The repository root. */
  root: string;
  /** Directory for this run's reports, artifacts/reports under root. */
  outDir: string;
}
export interface CheckResult {
  /** 0 passes. Nonzero fails the command with this exit code. */
  exitCode: number;
  /** Tests or assertions actually run. Zero where tests should run fails the command. */
  testCount: number;
}
export type CheckRunner = (options: CheckOptions) => Promise<CheckResult>;
