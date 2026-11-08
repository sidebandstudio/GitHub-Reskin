// Documented equivalents only: color spelling, metadata whitespace, font display names, a missing
// name, and a missing schemaVersion on an unmistakably v1 shape. Every change becomes a note.
// Anything else, including unknown fields, is left for validation to report.
import { OVERRIDE_COLOR_ROLES, SYNTAX_ROLES } from "../contracts/index.js";
import { NOTE_CODES } from "./codes.js";
import { pointer } from "./json.js";
import { FONTS } from "./schema-registry.js";

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
]);
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
  }
  if (isObject(theme.contributions) && Array.isArray(theme.contributions.levels)) {
    theme.contributions.levels.forEach((_, index) => color(theme.contributions.levels, index, `/contributions/levels/${index}`));
  }

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

  if (isObject(theme.fonts) && typeof theme.fonts.accent === "string") {
    const requested = theme.fonts.accent;
    const wanted = requested.trim().toLowerCase();
    const font = FONTS.find((f) => f.id !== requested && (f.id === wanted || (f.family && f.family.toLowerCase() === wanted)));
    if (font && !FONTS.some((f) => f.id === requested)) {
      theme.fonts.accent = font.id;
      notes.push(note(NOTE_CODES.font, "/fonts/accent", `Using the bundled font ${font.id} for "${requested}".`));
    }
  }

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
