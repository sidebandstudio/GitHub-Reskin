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
// PairMatrix.version of packages/engine/pairs.json, recorded in the boot record. Version 2 keeps
// every version 1 record first and unchanged, then adds the Revision 4 appearance pairs.
export const PAIR_MATRIX_VERSION = 2;
// The Revision 4 expansion of the resolved appearance record and the advanced CSS sanitizer
// policy. Both enter the boot record and compiler fingerprints; a snapshot without them is stale.
export const EXPANSION_VERSION = 1;
export const SANITIZER_VERSION = 1;
// The finite native CSS target registry version C3 supplies. Advanced CSS on native GitHub nodes
// compiles only against a registry of this version; without one it fails closed.
export const CSS_REGISTRY_VERSION = 1;
// Which part of the Revision 4 expansion this build admits. 1 is the Choom subset: structured
// paints, shape, type, the full code/graph/details palettes and restricted advanced CSS. Raster
// conversion, the added font files, CSS conveniences and the full editing controls arrive in 2.
export const EXPANSION_INCREMENT = 1;

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
  "accentEmphasis",
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
// The seven core syntax roles every ModeSeed carries. Seed contractVersion 1 keeps exactly these.
export const SYNTAX_ROLES = freeze(["comment", "keyword", "string", "function", "number", "variable", "type"]);
// The fifteen added syntax and markup roles. They live in the resolved appearance record, not in
// ModeSeed, and default from resolved core roles when a theme omits them.
export const EXTENDED_SYNTAX_ROLES = freeze([
  "operator",
  "punctuation",
  "constant",
  "tag",
  "attribute",
  "regex",
  "escape",
  "invalid",
  "inserted",
  "deleted",
  "markupHeading",
  "markupEmphasis",
  "markupLink",
  "markupQuote",
  "markupList",
]);
// All 22 roles a theme's code.syntax or overrides.syntax may name, in schema order.
export const THEME_SYNTAX_ROLES = freeze([...SYNTAX_ROLES, ...EXTENDED_SYNTAX_ROLES]);
export const ANSI_ROLES = freeze([
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
]);
export const DIFF_ROLES = freeze([
  "addedBackground",
  "addedText",
  "removedBackground",
  "removedText",
  "wordAddedBackground",
  "wordAddedText",
  "wordRemovedBackground",
  "wordRemovedText",
]);
// Every color role the theme format names, with syntax as one group. A schema registry only.
export const COLOR_ROLES = freeze([...CORE_COLOR_ROLES, ...OVERRIDE_COLOR_ROLES, "syntax"]);

// The font families this build ships files for: "system", which uses the platform font and ships
// no file, and the eighteen families of the schema's registry, each with C5's files in
// assets/fonts/<id>/. Every heading font has files.
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
  "bebas-neue",
  "cinzel",
  "orbitron",
  "oxanium",
  "ibm-plex-sans",
  "source-sans-3",
  "nunito-sans",
  "atkinson-hyperlegible",
  "roboto-condensed",
  "barlow",
]);
// Every heading and body font ID the schema accepts, in schema order. fonts.accent takes the
// heading list.
export const HEADING_FONT_IDS = FONT_IDS;
export const BODY_FONT_IDS = freeze(["system", "ibm-plex-sans", "source-sans-3", "nunito-sans", "atkinson-hyperlegible", "barlow"]);
// The font inventory of this increment. `bundled` families have files (FONT_IDS); `nativeStack`
// families keep their reviewed native stack in front of their file, which is how Choom keeps the
// owner's condensed display faces; `deferred` families would have no file yet, so a request for
// one resolves to the native font and is reported. Every family is bundled and none is deferred.
export const FONT_INVENTORY = freeze({
  increment: 1,
  bundled: FONT_IDS.filter((id) => id !== "system"),
  nativeStack: ["roboto-condensed"],
  deferred: [],
});
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
  "footer.signoff",
  "profile.achievements.heading",
]);

export const PREFERENCE_KEYS = freeze(["extras", "text", "motion", "fonts", "effects"]);
export const DEFAULT_PREFERENCES = freeze({ extras: true, text: true, motion: true, fonts: true, effects: true });
// The primary Full / Calm switch. Full is the new-install default; the old extras:false means Calm.
export const APPEARANCE_MODES = freeze(["full", "calm"]);
export const DEFAULT_APPEARANCE_MODE = "full";
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
  "setBackground",
  "setImage",
  "setShape",
  "setTypography",
  "setCode",
  "setDetails",
  "setGraphStyle",
  "setGraphLevels",
  "setCss",
]);
// Editor actions this increment does not accept yet: image upload and the Advanced CSS editor.
// Imported images and CSS still arrive through loadImport.
export const DEFERRED_EDITOR_ACTION_TYPES = freeze(["setImage", "setCss"]);
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
  // Revision 4 semantic admission: embedded rasters, gradient stops and advanced CSS.
  imageData: "image-data",
  imageLimit: "image-limit",
  gradientOrder: "gradient-order",
  css: "css",
  cssUnavailable: "css-unavailable",
  cssRegistry: "css-registry",
  deferred: "deferred-capability",
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

// Input and runtime limits. Byte limits count UTF-8 bytes. Revision 4 raised the input bounds so a
// theme can carry embedded rasters and advanced CSS; THEME-EXPANSION.md has the full table.
export const LIMITS = freeze({
  fileUtf8Bytes: 524288,
  pastedUtf8Bytes: 786432,
  compressedBytes: 393216,
  expandedBytes: 524288,
  maxDepth: 12,
  maxCustomThemes: 50,
  maxCustomSourceBytes: 4194304,
  maxDraftBytes: 1310720,
  maxStorageBytes: 8388608,
  maxShareLinkCharacters: 8192,
  // Advanced CSS: the css field plus every gradientCss value, as source and as expanded output.
  cssUtf8Bytes: 32768,
  gradientCssUtf8Bytes: 4096,
  gradientCssSizeCharacters: 64,
  // Embedded rasters, after base64 decoding. Document totals count repeated occurrences.
  perImageDecodedBytes: 131072,
  documentImageDecodedBytes: 262144,
  imageMaxDimension: 2048,
  imageMaxPixels: 2097152,
  documentImageDecodedPixels: 6291456,
  maxBackgroundLayers: 4,
  maxEffectsPerTheme: 3,
  maxOwnedNodesPerDocument: 24,
  maxAnimatedNodes: 6,
  maxPatchWidthPx: 360,
  maxPatchHeightPx: 96,
  maxAnimatedElementPx: 96,
  maxAnimationTotalMs: 1200,
  maxEchoMs: 200,
  fontFamilies: 18,
  fontWeightsPerFamily: 4,
  fontTotalWoff2Bytes: 786432,
  fontMaxPerFamilyBytes: 65536,
  fontMaxPerFileBytes: 32768,
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
  runtimeZipBytes: 2621440,
  unpackedRuntimeBytes: 5242880,
  // The content engine and bootstrap including the CSS sanitizer, without mode data or fonts.
  contentEngineGzipBytes: 163840,
  contentEngineRawBytes: 524288,
  // css-tree 3.1.0's parse/walk/generate/lexer, measured as an isolated chunk.
  cssParserGzipBytes: 61440,
  cssParserRawBytes: 225280,
  modeDataRawBytes: 819200,
  userscriptBytes: 3670016,
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

// Advanced CSS target kinds of the finite native registry (ARCHITECTURE.md, "Finite native CSS
// registry and lifetime"). C3 supplies the registry; these names are its vocabulary.
export const CSS_TARGET_KINDS = freeze(["page-backing", "header-chrome", "control-chrome", "heading-chrome", "graph-cell", "graph-decoration", "reading-pair"]);
// Host-issued attributes that admit or exclude imported CSS. Themes can neither write nor match them.
export const CSS_MARKERS = freeze({
  scope: "data-reskin-css",
  nativeGate: "data-reskin-css-native",
  kind: "data-reskin-css-kind",
  native: "data-reskin-native",
  protected: "data-reskin-protected",
  owned: "data-reskin-owned",
  slot: "data-reskin-slot",
});
// The audited scalar variables advanced CSS may read, and the kind of value each holds. The
// compiler sets them from repaired output; no variable exposes page content, attributes or URLs.
const kebab = (role) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
export const CSS_VARIABLES = freeze(
  Object.fromEntries([
    ...[
      "canvas",
      "surface",
      "inset",
      "raised",
      "text",
      "muted-text",
      "link",
      "border",
      "control-border",
      "accent",
      "accent-emphasis",
      "accent-emphasis-text",
      "primary-background",
      "primary-text",
      "header-background",
      "header-text",
      "selection-background",
      "selection-text",
      "code-background",
      "code-text",
      ...["added", "removed", "word-added", "word-removed"].flatMap((d) => [`diff-${d}-background`, `diff-${d}-text`]),
      ...THEME_SYNTAX_ROLES.map((role) => `syntax-${kebab(role)}`),
      ...[0, 1, 2, 3, 4].map((level) => `graph-${level}`),
    ].map((name) => [`--reskin-${name}`, "color"]),
    ["--reskin-font-heading", "font"],
    ["--reskin-font-body", "font"],
    ["--reskin-radius", "length"],
  ]),
);
