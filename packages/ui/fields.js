// The builder's controls as data: each field's theme path, label, kind and bounds (from
// theme-v1.schema.json), and for colors where the preview's current value comes from when the
// theme leaves the field to the engine. builder.js turns these into native labeled controls.
import { ANSI_ROLES, DIFF_ROLES, EFFECT_IDS, FLAVOR_SLOT_IDS, THEME_SYNTAX_ROLES } from "../contracts/index.js";
import { FLAVOR_SLOTS, FONT_ROLES } from "../format/index.js";

const words = (id) => id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
const capital = (text) => text[0].toUpperCase() + text.slice(1);
const options = (values, labels = {}) => [["", "Theme default"], ...values.map((value) => [value, labels[value] ?? capital(words(value))])];

/** The three colors every theme starts from. */
export const CORE_COLORS = Object.freeze([
  { path: "/colors/background", label: "Background", required: true },
  { path: "/colors/text", label: "Text", required: true },
  { path: "/colors/accent", label: "Accent", required: true },
]);

export const GRAPH_LEVEL_LABELS = Object.freeze(["No contributions", "Level 1", "Level 2", "Level 3", "Most contributions"]);

export const CODE_COLORS = Object.freeze([
  { path: "/code/background", label: "Code background", current: (r) => r.tokens.codeBackground },
  { path: "/code/text", label: "Code text", current: (r) => r.tokens.codeText },
]);

const syntaxCurrent = (role) => (r) => r.syntax?.[role] ?? r.appearance?.colors?.syntax?.[role] ?? r.tokens.codeText;
export const SYNTAX_COLORS = Object.freeze(
  THEME_SYNTAX_ROLES.map((role) => ({ path: `/code/syntax/${role}`, alias: `/overrides/syntax/${role}`, label: capital(words(role)), current: syntaxCurrent(role) })),
);

export const DIFF_COLORS = Object.freeze(
  DIFF_ROLES.map((role) => ({ path: `/code/diff/${role}`, label: capital(words(role)), current: (r) => r.tokens[`diff${role[0].toUpperCase()}${role.slice(1)}`] ?? r.tokens.codeText })),
);

export const ANSI_COLORS = Object.freeze(ANSI_ROLES.map((role) => ({ path: `/code/ansi/${role}`, label: capital(words(role)), current: (r) => r.ansi?.[role] ?? r.tokens.text })));

const pill = (name, label) => [
  { path: `/details/${name}/background`, label: `${label} background`, current: (r) => r.appearance?.colors?.[name]?.background ?? r.tokens.labelBackground },
  { path: `/details/${name}/text`, label: `${label} text`, current: (r) => r.appearance?.colors?.[name]?.text ?? r.tokens.labelText },
  { path: `/details/${name}/border`, label: `${label} border`, current: (r) => r.appearance?.colors?.[name]?.border ?? r.tokens.labelBorder },
];
export const DETAIL_COLORS = Object.freeze([
  { path: "/details/headerText", label: "Header text", current: (r) => r.appearance?.colors?.header?.text ?? r.tokens.text },
  { path: "/details/selection/background", label: "Selection background", alias: "/overrides/selectionBackground", current: (r) => r.tokens.selectionBackground },
  { path: "/details/selection/text", label: "Selection text", alias: "/overrides/selectionText", current: (r) => r.tokens.selectionText },
  { path: "/details/scrollbar/thumb", label: "Scrollbar thumb", current: (r) => r.appearance?.colors?.scrollbar?.thumb ?? r.tokens.controlBorder },
  { path: "/details/scrollbar/track", label: "Scrollbar track", current: (r) => r.appearance?.colors?.scrollbar?.track ?? r.tokens.inset },
  ...pill("labels", "Label"),
  ...pill("topics", "Topic"),
]);

export const DETAIL_FIELDS = Object.freeze([
  { path: "/details/scrollbar/width", label: "Scrollbar width", kind: "select", options: options(["auto", "thin"]) },
  { path: "/details/labels/style", label: "Label shape", kind: "select", options: options(["sharp", "rounded", "bevel", "pill"]) },
  { path: "/details/labels/fill", label: "Label fill", kind: "select", options: options(["solid", "tinted", "outline"]) },
  { path: "/details/topics/style", label: "Topic shape", kind: "select", options: options(["sharp", "rounded", "bevel", "pill"]) },
  { path: "/details/topics/fill", label: "Topic fill", kind: "select", options: options(["solid", "tinted", "outline"]) },
]);

export const SHAPE_FIELDS = Object.freeze([
  { path: "/shape/corners/style", label: "Corners", kind: "select", options: options(["sharp", "rounded", "bevel", "pill"]) },
  { path: "/shape/corners/radius", label: "Corner radius (px)", kind: "number", min: 0, max: 999, step: 1 },
  { path: "/shape/borders/width", label: "Border width (px)", kind: "number", min: 0, max: 4, step: 0.5 },
  { path: "/shape/borders/style", label: "Border style", kind: "select", options: options(["solid", "dashed", "double"]) },
  { path: "/shape/borders/color", label: "Border color", kind: "color", current: (r) => r.tokens.border },
  { path: "/shape/shadows/style", label: "Shadows", kind: "select", options: options(["none", "soft", "hard", "neon"]) },
  { path: "/shape/shadows/color", label: "Shadow color", kind: "color", current: (r) => r.tokens.accent },
  { path: "/shape/shadows/opacity", label: "Shadow opacity (0 to 0.8)", kind: "number", min: 0, max: 0.8, step: 0.05 },
  { path: "/shape/shadows/blur", label: "Shadow blur (px)", kind: "number", min: 0, max: 24, step: 1 },
  { path: "/shape/shadows/offset", label: "Shadow offset (px)", kind: "number", min: 0, max: 8, step: 1 },
  { path: "/shape/buttons/style", label: "Buttons", kind: "select", options: options(["filled", "outline", "soft", "bevel"]) },
  { path: "/shape/buttons/radius", label: "Button radius (px)", kind: "number", min: 0, max: 999, step: 1 },
  { path: "/shape/avatar/shape", label: "Avatar shape", kind: "select", options: options(["circle", "square", "rounded", "bevel", "arch"]) },
  { path: "/shape/avatar/frame/style", label: "Avatar frame", kind: "select", options: options(["none", "solid", "double", "neon"]) },
  { path: "/shape/avatar/frame/width", label: "Avatar frame width (px)", kind: "number", min: 0, max: 4, step: 0.5 },
  { path: "/shape/avatar/frame/color", label: "Avatar frame color", kind: "color", current: (r) => r.tokens.accent },
  { path: "/typography/uppercaseHeadings", label: "Uppercase headings", kind: "check" },
  { path: "/typography/headingLetterSpacing", label: "Heading letter spacing (em, -0.02 to 0.2)", kind: "number", min: -0.02, max: 0.2, step: 0.01 },
  { path: "/typography/bodyLetterSpacing", label: "Body letter spacing (em, 0 to 0.08)", kind: "number", min: 0, max: 0.08, step: 0.01 },
]);

export const GRAPH_FIELDS = Object.freeze([
  { path: "/contributions/cellStyle", label: "Square style", kind: "select", options: options(["square", "round", "glow", "diamond"]) },
  { path: "/contributions/cellRadius", label: "Square corner radius (px, 0 to 2)", kind: "number", min: 0, max: 2, step: 0.5 },
  { path: "/contributions/cellBoundary", label: "Square outline", kind: "color", current: (r) => r.appearance?.colors?.graph?.cellBoundary ?? r.tokens.controlBorder },
  { path: "/contributions/glow/radius", label: "Glow radius (px, 0 to 9)", kind: "number", min: 0, max: 9, step: 1 },
  { path: "/contributions/glow/opacity", label: "Glow opacity (0 to 0.85)", kind: "number", min: 0, max: 0.85, step: 0.05 },
  { path: "/contributions/glow/color", label: "Glow color", kind: "color", current: (r) => r.tokens.accent },
]);

export const EFFECTS = Object.freeze(
  EFFECT_IDS.map((id) => ({
    id,
    label: { glow: "Glow", grid: "Grid", scanlines: "Scanlines", paper: "Paper texture", rail: "Notched rail", rules: "Ruled lines", orbit: "Orbits", seal: "Seal", drift: "Drift", echo: "Echo" }[id],
  })),
);

const SLOT_LABELS = {
  "profile.tag": "Profile tag",
  "profile.pinned.heading": "Beside Pinned",
  "profile.activity.heading": "Beside Contribution activity",
  "profile.organizations.heading": "Beside Organizations",
  "profile.achievements.heading": "Beside Achievements",
  "contributions.caption": "Under the contribution graph",
  "empty.pinned.caption": "No pinned repositories",
  "empty.issues.caption": "No issues yet",
  "error.notFound.caption": "Page not found",
  "footer.signoff": "Footer sign-off",
};
/** Every flavor slot after the profile tag, with its limit. */
export const FLAVOR_FIELDS = Object.freeze(
  FLAVOR_SLOT_IDS.map((id) => ({ id, label: SLOT_LABELS[id] ?? capital(words(id.replaceAll(".", " "))), maxLength: FLAVOR_SLOTS[id]?.maxLength ?? 40 })),
);

/** The fonts a role can pick now: bundled families, the native stack and GitHub's own. */
export function fontChoices(role) {
  return FONT_ROLES.filter((font) => font.roles.includes(role) && font.source !== "deferred").map((font) => ({
    id: font.id,
    label: font.id === "system" ? "GitHub's own font" : font.family ?? font.id,
    family: font.family,
    fallback: font.fallback,
    bundled: font.source === "bundled",
  }));
}

export const GRADIENT_TYPES = Object.freeze([["linear", "Linear"], ["radial", "Radial"]]);
export const PATTERN_KINDS = Object.freeze([["grid", "Grid"], ["scanlines", "Scanlines"], ["dots", "Dots"], ["diagonal", "Diagonal"], ["grain", "Grain"]]);
export const IMAGE_FITS = Object.freeze([["cover", "Cover"], ["contain", "Contain"], ["tile", "Tile"], ["stretch", "Stretch"]]);
export const IMAGE_POSITIONS = Object.freeze([["center", "Center"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]]);
export const BACKGROUND_TARGETS = Object.freeze({ page: "Page", profileBanner: "Profile banner", header: "Header" });
