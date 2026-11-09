// Documented equivalents only: color spelling, metadata whitespace, font display names, a missing
// name, a missing schemaVersion on an unmistakably v1 shape, and admitted advanced CSS written in
// its canonical sanitized form. Every change becomes a note. Anything else, including unknown
// fields, is left for validation to report.
import { ANSI_ROLES, DIFF_ROLES, LIMITS, OVERRIDE_COLOR_ROLES, SYNTAX_ROLES, THEME_SYNTAX_ROLES } from "../contracts/index.js";
import { NOTE_CODES } from "./codes.js";
import { admitCss, admitGradientCss, cssSanitizerInstalled } from "./css/admission.js";
import { pointer } from "./json.js";
import { FONT_ROLES } from "./schema-registry.js";

const TOP_LEVEL_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "name",
  "author",
  "version",
  "description",
  "tags",
  "base",
  "colors",
  "overrides",
  "fonts",
  "effects",
  "flavor",
  "contributions",
  "inspiredBy",
  "backgrounds",
  "shape",
  "typography",
  "code",
  "details",
  "css",
]);
const TARGETS = ["page", "profileBanner", "header"];
const TEXT_KEYS = ["name", "author", "description", "inspiredBy"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const note = (code, path, message) => ({ code, path, message, severity: "info" });

const clone = (value) => (Array.isArray(value) ? value.map(clone) : isObject(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value);

/** Lowercase #rrggbb for the accepted spellings, or null when the value is not one of them. */
export function normalizeHex(value) {
  if (typeof value !== "string") return null;
  let match = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (match) return `#${match[1].toLowerCase()}`;
  match = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(value);
  if (match) return `#${match.slice(1).map((d) => d + d).join("").toLowerCase()}`;
  return null;
}

// ASCII whitespace only; a no-break or other Unicode space is the author's choice.
const collapse = (value) => value.replace(/[\t\n\v\f\r ]+/g, " ").replace(/^ | $/g, "");

function looksLikeV1(theme) {
  const { colors } = theme;
  return (
    Object.keys(theme).every((key) => TOP_LEVEL_KEYS.has(key)) &&
    (theme.base === "dark" || theme.base === "light") &&
    isObject(colors) &&
    ["background", "text", "accent"].every((key) => typeof colors[key] === "string")
  );
}

// The Revision 4 color leaves, by group, in a fixed order.
function normalizeAppearanceColors(theme, color) {
  const group = (holder, keys, path) => {
    if (isObject(holder)) for (const key of keys) if (key in holder) color(holder, key, pointer(path, key));
  };
  if (isObject(theme.contributions)) {
    group(theme.contributions, ["cellBoundary"], "/contributions");
    group(theme.contributions.glow, ["color"], "/contributions/glow");
  }
  if (isObject(theme.backgrounds)) {
    for (const target of TARGETS) {
      const background = theme.backgrounds[target];
      if (!isObject(background)) continue;
      group(background, ["color"], `/backgrounds/${target}`);
      if (!Array.isArray(background.layers)) continue;
      background.layers.forEach((layer, index) => {
        const at = `/backgrounds/${target}/layers/${index}`;
        if (!isObject(layer)) return;
        if (isObject(layer.gradient) && Array.isArray(layer.gradient.stops)) layer.gradient.stops.forEach((stop, i) => group(stop, ["color"], `${at}/gradient/stops/${i}`));
        group(layer.pattern, ["color"], `${at}/pattern`);
      });
    }
  }
  if (isObject(theme.shape)) {
    group(theme.shape.borders, ["color"], "/shape/borders");
    group(theme.shape.shadows, ["color"], "/shape/shadows");
    if (isObject(theme.shape.avatar)) group(theme.shape.avatar.frame, ["color"], "/shape/avatar/frame");
  }
  if (isObject(theme.code)) {
    group(theme.code, ["background", "text"], "/code");
    group(theme.code.syntax, THEME_SYNTAX_ROLES, "/code/syntax");
    group(theme.code.ansi, ANSI_ROLES, "/code/ansi");
    group(theme.code.diff, DIFF_ROLES, "/code/diff");
  }
  if (isObject(theme.details)) {
    group(theme.details, ["headerText"], "/details");
    group(theme.details.selection, ["background", "text"], "/details/selection");
    group(theme.details.scrollbar, ["thumb", "track"], "/details/scrollbar");
    for (const pill of ["labels", "topics"]) group(theme.details[pill], ["background", "text", "border"], `/details/${pill}`);
  }
}

// Admitted CSS is kept in its canonical sanitized form, so exports and consent hashes see one
// spelling. Only with the sanitizer installed: the viewer leaves CSS for validation to judge.
// Source over the shared CSS budget is left as supplied, so validation refuses what was imported
// rather than a shorter canonical form.
function canonicalCss(theme, notes) {
  if (!cssSanitizerInstalled() || cssSourceBytes(theme) > LIMITS.cssUtf8Bytes) return;
  if (typeof theme.css === "string") {
    const result = admitCss(theme.css, "/css");
    if (result.ok) {
      notes.push(...result.value.notes);
      if (result.value.css !== theme.css) {
        theme.css = result.value.css;
        notes.push(note(NOTE_CODES.css, "/css", "Rewrote the advanced CSS in Reskin's checked, canonical form."));
      }
    }
  }
  if (!isObject(theme.backgrounds)) return;
  for (const target of TARGETS) {
    const layers = theme.backgrounds[target]?.layers;
    if (!Array.isArray(layers)) continue;
    layers.forEach((layer, index) => {
      if (!isObject(layer?.gradientCss) || typeof layer.gradientCss.value !== "string") return;
      const at = `/backgrounds/${target}/layers/${index}/gradientCss`;
      const result = admitGradientCss(layer.gradientCss, at);
      if (!result.ok) return;
      const before = JSON.stringify(layer.gradientCss);
      layer.gradientCss.value = result.value;
      if (result.size !== null) layer.gradientCss.size = result.size;
      if (JSON.stringify(layer.gradientCss) !== before) notes.push(note(NOTE_CODES.css, at, "Rewrote this gradient in Reskin's checked, canonical form."));
    });
  }
}

const encoder = new TextEncoder();
const bytes = (value) => (typeof value === "string" ? encoder.encode(value).length : 0);

// UTF-8 bytes of the css text and every gradientCss value and size, as validation counts them.
function cssSourceBytes(theme) {
  let total = bytes(theme.css);
  if (!isObject(theme.backgrounds)) return total;
  for (const target of TARGETS) {
    const layers = theme.backgrounds[target]?.layers;
    if (Array.isArray(layers)) for (const layer of layers) if (isObject(layer?.gradientCss)) total += bytes(layer.gradientCss.value) + bytes(layer.gradientCss.size);
  }
  return total;
}

/**
 * @param {unknown} value
 * @returns {{theme: unknown, notes: import("../contracts/index.js").Issue[]}}
 */
export function normalizeTheme(value) {
  if (!isObject(value)) return { theme: value, notes: [] };
  const theme = clone(value);
  const notes = [];

  const color = (holder, key, path) => {
    const before = holder[key];
    const after = normalizeHex(before);
    if (after && after !== before) {
      holder[key] = after;
      notes.push(note(NOTE_CODES.color, path, `Changed ${before} to ${after}.`));
    }
  };
  if (isObject(theme.colors)) for (const key of Object.keys(theme.colors)) color(theme.colors, key, pointer("/colors", key));
  if (isObject(theme.overrides)) {
    for (const key of OVERRIDE_COLOR_ROLES) if (key in theme.overrides) color(theme.overrides, key, pointer("/overrides", key));
    if (isObject(theme.overrides.syntax)) for (const key of SYNTAX_ROLES) if (key in theme.overrides.syntax) color(theme.overrides.syntax, key, `/overrides/syntax/${key}`);
    if (isObject(theme.overrides.syntax)) for (const key of THEME_SYNTAX_ROLES.slice(SYNTAX_ROLES.length)) if (key in theme.overrides.syntax) color(theme.overrides.syntax, key, `/overrides/syntax/${key}`);
  }
  if (isObject(theme.contributions) && Array.isArray(theme.contributions.levels)) {
    theme.contributions.levels.forEach((_, index) => color(theme.contributions.levels, index, `/contributions/levels/${index}`));
  }
  normalizeAppearanceColors(theme, color);

  const text = (holder, key, path) => {
    const before = holder[key];
    if (typeof before !== "string") return;
    const after = collapse(before);
    if (after !== before && after !== "") {
      holder[key] = after;
      notes.push(note(NOTE_CODES.text, path, "Removed extra spaces and line breaks."));
    }
  };
  for (const key of TEXT_KEYS) text(theme, key, `/${key}`);
  if (isObject(theme.flavor) && isObject(theme.flavor.slots)) for (const key of Object.keys(theme.flavor.slots)) text(theme.flavor.slots, key, pointer("/flavor/slots", key));

  for (const role of ["accent", "heading", "body"]) {
    if (!isObject(theme.fonts) || typeof theme.fonts[role] !== "string") continue;
    const requested = theme.fonts[role];
    const wanted = requested.trim().toLowerCase();
    const choices = FONT_ROLES.filter((f) => f.roles.includes(role === "body" ? "body" : "heading"));
    const font = choices.find((f) => f.id !== requested && (f.id === wanted || (f.family && f.family.toLowerCase() === wanted)));
    if (font && !choices.some((f) => f.id === requested)) {
      theme.fonts[role] = font.id;
      notes.push(note(NOTE_CODES.font, `/fonts/${role}`, `Using the bundled font ${font.id} for "${requested}".`));
    }
  }
  canonicalCss(theme, notes);

  if (!("name" in theme)) {
    theme.name = "My theme";
    notes.push(note(NOTE_CODES.defaultName, "/name", "This theme had no name, so it is called My theme."));
  }
  if (!("schemaVersion" in theme) && looksLikeV1(theme)) {
    theme.schemaVersion = 1;
    notes.push(note(NOTE_CODES.defaultVersion, "/schemaVersion", "This theme had no format version. It matches version 1, so it is read as version 1."));
  }
  return { theme, notes };
}
