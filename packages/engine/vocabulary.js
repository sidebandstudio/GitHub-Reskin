// The frozen ColorSet keys from ARCHITECTURE.md, in declaration order, and the Revision 4
// appearance color paths that extend resolved output without changing ModeSeed. Families,
// policies, syntax and ANSI roles and the pair-matrix version come from packages/contracts.
// TODO(C1): packages/contracts declares the token and semantic key sets as types only
// (theme-engine.d.ts). Move these runtime lists there; until then they are defined here and checked
// against the synthetic seeds in tests/engine.
import { ANSI_ROLES, EXTENDED_SYNTAX_ROLES, SYNTAX_ROLES } from "../contracts/index.js";

export const TOKEN_KEYS = Object.freeze([
  "canvas", "surface", "inset", "raised", "hover", "active",
  "text", "mutedText", "link", "border", "controlBorder",
  "accent", "accentMuted", "accentEmphasis", "emphasisText",
  "primaryBackground", "primaryHoverBackground", "primaryPressedBackground",
  "primaryText", "primaryHoverText", "primaryPressedText",
  "primaryBorder", "primaryIcon", "primaryCounterBackground", "primaryCounterText",
  "focusOuter", "focusInner", "selectionBackground", "selectionText",
  "codeBackground", "codeText", "neutralBackground", "neutralText",
  "diffAddedBackground", "diffAddedText", "diffRemovedBackground", "diffRemovedText",
  "diffWordAddedBackground", "diffWordAddedText", "diffWordRemovedBackground", "diffWordRemovedText",
  "tooltipBackground", "tooltipText", "overlayBackground", "overlayText",
  "inputBackground", "inputText", "inputPlaceholder",
  "disabledBackground", "disabledText", "disabledBorder",
  "counterBackground", "counterText", "labelBackground", "labelText", "labelBorder",
]);
export const SEMANTIC_ROLES = Object.freeze(["success", "danger", "warning", "done", "sponsor"]);
export const SEMANTIC_FIELDS = Object.freeze(["text", "mutedBackground", "emphasisBackground", "onEmphasis", "border"]);
export { ANSI_ROLES };
export const GRAPH_LEVELS = 5;
export const ACCESSIBILITY_NOTICE = "GitHub accessibility colors are active";

/** Every ColorPath, in ColorSet order. */
export const COLOR_PATHS = Object.freeze([
  ...TOKEN_KEYS.map((key) => `/tokens/${key}`),
  ...SEMANTIC_ROLES.flatMap((role) => SEMANTIC_FIELDS.map((field) => `/semantics/${role}/${field}`)),
  ...SYNTAX_ROLES.map((role) => `/syntax/${role}`),
  ...ANSI_ROLES.map((role) => `/ansi/${role}`),
  ...[0, 1, 2, 3, 4].map((level) => `/graph/${level}`),
]);

/** The paired appearance colors, in AppearanceColors order. */
export const APPEARANCE_COLOR_PATHS = Object.freeze([
  ...EXTENDED_SYNTAX_ROLES.map((role) => `/appearance/colors/syntax/${role}`),
  "/appearance/colors/page/background",
  "/appearance/colors/header/background",
  "/appearance/colors/header/text",
  "/appearance/colors/scrollbar/thumb",
  "/appearance/colors/scrollbar/track",
  ...["labels", "topics"].flatMap((pill) => ["background", "text", "border"].map((field) => `/appearance/colors/${pill}/${field}`)),
  "/appearance/colors/graph/cellBoundary",
]);

/** Every path a pair record or render repair may name. */
export const PAIR_PATHS = Object.freeze([...COLOR_PATHS, ...APPEARANCE_COLOR_PATHS]);
