// Shared vocabulary for every GitHub Reskin module. Values here are part of the public format,
// stored settings or release gates, so a change is a contract change and needs review before
// dependent units rely on it. Types for everything below, and the module interfaces, are in
// index.d.ts, which re-exports the theme format (theme-v1.d.ts) and the frozen engine types
// (theme-engine.d.ts). Those two files declare types only; executable functions live in their
// real packages.

const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Versions. Theme format and settings format are stored by users; renderer and engine versions
// enter fingerprints and the boot snapshot, so a bump invalidates cached derived state.
export const THEME_FORMAT_VERSION = 1;
export const SETTINGS_VERSION = 2;
export const RENDERER_VERSION = 1;
export const ENGINE_VERSION = 1;
// PairMatrix.version of packages/engine/pairs.json, recorded in the boot record.
export const PAIR_MATRIX_VERSION = 1;

// The first-run theme, Choom Circuit. Always chosen by ID, never by catalog order.
export const DEFAULT_THEME_ID = "anime.cyberpunk-edgerunners";

// The twelve 1.x palettes keep these exact IDs in Classics. 1.x's "cyberpunk" is an alias.
export const LEGACY_CLASSIC_THEME_IDS = freeze([
  "editing-suite",
  "dracula",
  "nord",
  "catppuccin-mocha",
  "gruvbox",
  "tokyo-night",
  "rose-pine",
  "one-dark",
  "solarized-dark",
  "catppuccin-latte",
  "rose-pine-dawn",
  "solarized-light",
]);
export const LEGACY_THEME_ALIASES = freeze({ cyberpunk: DEFAULT_THEME_ID });
// 1.0 saved edited colors without a theme. Those colors belong to Editing Suite.
export const LEGACY_EDITED_COLORS_THEME_ID = "editing-suite";

export const LOCAL_THEME_ID_PREFIX = "local:";
export const THEME_SCHEMA_URL = "https://sidebandstudio.github.io/GitHub-Reskin/schemas/theme-v1.schema.json";
export const SHARE_CODE_PREFIX = "RS1.";

export const STORAGE_KEYS = freeze({
  settings: "reskin.settings",
  boot: "reskin.boot",
  lastGood: "reskin.lastGood",
  draft: "reskin.draft",
  ui: "reskin.ui",
});
// The only 1.x extension keys migration may read.
export const LEGACY_STORAGE_KEYS = freeze(["enabled", "theme", "custom"]);
// 1.x cached compiled CSS in GitHub's page storage under this key. It is removed, never read.
export const LEGACY_PAGE_CACHE_KEY = "github-reskin-css";

export const BASES = freeze(["dark", "light"]);
export const CORE_COLOR_ROLES = freeze(["background", "text", "accent", "contribution"]);
export const OVERRIDE_COLOR_ROLES = freeze([
  "surface",
  "inset",
  "raised",
  "hover",
  "mutedText",
  "link",
  "border",
  "controlBorder",
  "accentMuted",
  "primaryBackground",
  "primaryText",
  "focus",
  "selectionBackground",
  "selectionText",
  "success",
  "danger",
  "warning",
  "done",
]);
export const SYNTAX_ROLES = freeze(["comment", "keyword", "string", "function", "number", "variable", "type"]);
// Every color role the theme format names, with syntax as one group. A schema registry only.
export const COLOR_ROLES = freeze([...CORE_COLOR_ROLES, ...OVERRIDE_COLOR_ROLES, "syntax"]);

// "system" uses the platform font and ships no file.
export const FONT_IDS = freeze([
  "system",
  "rajdhani",
  "barlow-condensed",
  "fraunces",
  "alegreya",
  "cormorant-garamond",
  "josefin-sans",
  "bungee",
  "space-grotesk",
]);
export const EFFECT_IDS = freeze(["glow", "grid", "scanlines", "paper", "rail", "rules", "orbit", "seal", "drift", "echo"]);
export const EFFECT_TARGETS = freeze(["owned-badge", "owned-margin-strip", "owned-caption-edge"]);
// Append-only. A new slot is a schema change.
export const FLAVOR_SLOT_IDS = freeze([
  "profile.pinned.heading",
  "profile.activity.heading",
  "profile.organizations.heading",
  "profile.tag",
  "error.notFound.caption",
  "empty.pinned.caption",
  "empty.issues.caption",
  "contributions.caption",
]);

export const PREFERENCE_KEYS = freeze(["extras", "text", "motion", "fonts", "effects"]);
export const DEFAULT_PREFERENCES = freeze({ extras: true, text: true, motion: true, fonts: true, effects: true });
export const COMMIT_ACTION_TYPES = freeze([
  "selectTheme",
  "setEnabled",
  "setPreference",
  "saveCustom",
  "deleteCustom",
  "resetPreferences",
  "resetAll",
]);
export const SETTINGS_REQUEST_TYPES = freeze(["get", "commit", "draft", "open-page"]);
// Builder edits, exactly. One previous document backs undo; there is no history stack.
export const EDITOR_ACTION_TYPES = freeze([
  "setColor",
  "setBase",
  "setFont",
  "toggleEffect",
  "setFlavorEnabled",
  "setFlavorSlot",
  "undo",
  "reset",
  "loadImport",
]);
export const INTERNAL_PAGES = freeze(["onboarding", "settings"]);
export const PREVIEW_VIEWS = freeze(["profile", "repo", "diff", "empty", "404"]);
export const MODE_POLICIES = freeze(["themed", "native-high-contrast", "native-unknown"]);
// Families of GitHub's native modes. Dimmed is a mode ID in the standard family. C3 supplies the
// actual mode IDs from the frozen mode index; nothing may assume how many there are.
export const MODE_FAMILIES = freeze(["standard", "colorblind", "tritanopia"]);
export const ISSUE_SEVERITIES = freeze(["error", "warning", "info"]);

// Stable machine codes for Issue.code. Messages are for people and may change; codes may not.
export const ISSUE_CODES = freeze({
  // Bounds and parsing, before any schema check.
  inputTooLarge: "input-too-large",
  tooDeep: "too-deep",
  invalidUtf8: "invalid-utf8",
  duplicateKey: "duplicate-key",
  forbiddenKey: "forbidden-key",
  nonFiniteNumber: "non-finite-number",
  parseError: "parse-error",
  noCandidate: "no-candidate",
  ambiguousCandidates: "ambiguous-candidates",
  // Share codes.
  shareFormat: "share-format",
  shareChecksum: "share-checksum",
  decompressLimit: "decompress-limit",
  // Schema and content.
  unsupportedVersion: "unsupported-version",
  unknownField: "unknown-field",
  missingField: "missing-field",
  invalidValue: "invalid-value",
  outOfBounds: "out-of-bounds",
  markup: "markup",
  controlText: "control-text",
  resourceString: "resource-string",
  // Semantic repair.
  contrastRepaired: "contrast-repaired",
  graphRepaired: "graph-repaired",
  basePolarity: "base-polarity",
  // Settings.
  conflict: "conflict",
  storage: "storage",
  invalid: "invalid",
  capacity: "capacity",
});

// Input and runtime limits. Byte limits count UTF-8 bytes.
export const LIMITS = freeze({
  fileUtf8Bytes: 65536,
  pastedUtf8Bytes: 131072,
  compressedBytes: 16384,
  expandedBytes: 65536,
  maxDepth: 12,
  maxCustomThemes: 50,
  maxCustomSourceBytes: 1048576,
  maxDraftBytes: 131072,
  maxEffectsPerTheme: 3,
  maxOwnedNodesPerDocument: 24,
  maxAnimatedNodes: 6,
  maxPatchWidthPx: 360,
  maxPatchHeightPx: 96,
  maxAnimatedElementPx: 96,
  maxAnimationTotalMs: 1200,
  maxEchoMs: 200,
  fontFamilies: 8,
  fontWeightsPerFamily: 1,
  fontTotalWoff2Bytes: 245760,
  fontMaxPerFamilyBytes: 30720,
  startupGateMs: 120,
  maxInitialRootQueries: 6,
  maxContainerObservers: 2,
  maxCandidateNodesPerPass: 200,
  maxPassMs: 4,
  maxNavigationMs: 10,
  styleRemovalCircuitBreaker: 3,
});

// Release gates from ARCHITECTURE.md. check:budgets measures against these; it never raises them.
export const BUDGETS = freeze({
  runtimeZipBytes: 1572864,
  unpackedRuntimeBytes: 3145728,
  contentEngineGzipBytes: 102400,
  contentEngineRawBytes: 256000,
  modeDataRawBytes: 819200,
  userscriptBytes: 2097152,
  siteInitialJsGzipBytes: 66560,
  siteInitialTransferBytes: 512000,
  siteFilmBytes: 12582912,
  tiktokMasterBytes: 36700160,
  previewResolveP95Ms: 12,
  settingsToStyleP95Ms: 50,
  longTaskMs: 50,
  idleCpuPercent: 1,
});

export const BROWSER_TARGETS = freeze(["chrome", "firefox"]);
export const BUILD_TARGETS = freeze(["chrome", "firefox", "userscript", "shared", "site"]);
// build:shared -- --scope=<scope>. Each scope includes the ones before it.
export const SHARED_BUILD_SCOPES = freeze(["engine", "primer", "preview"]);
export const GECKO_ID = "github-reskin@sideband.studio";
export const SUPPORTED_ORIGINS = freeze(["https://github.com", "https://gist.github.com"]);

// A normalized color: lowercase, six digits, with the hash. Import normalization produces this form.
export const HEX_COLOR = /^#[0-9a-f]{6}$/;
