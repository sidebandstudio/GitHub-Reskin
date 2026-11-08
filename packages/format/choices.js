// The two explicit choices an import screen can offer after a failed validation. Neither runs
// automatically: the person picks it, and the result is validated again on its own.
import { THEME_SCHEMA_URL } from "../contracts/index.js";
import { normalizeTheme } from "./normalize.js";
import { validateTheme } from "./validate.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * "Preview colors only": a separately validated minimal document with the name, base and the
 * four core colors. `omitted` lists every top-level field left out, so the screen can say which
 * decorations will be missing.
 */
export function colorsOnly(value) {
  const { theme: normalized } = normalizeTheme(value);
  const colors = {};
  if (isObject(normalized) && isObject(normalized.colors)) {
    for (const key of ["background", "text", "accent", "contribution"]) if (key in normalized.colors) colors[key] = normalized.colors[key];
  }
  const theme = { schemaVersion: 1, name: normalized?.name, base: normalized?.base, colors };
  let result = validateTheme(theme);
  if (!result.ok && result.issues.every((issue) => issue.path === "/name")) {
    theme.name = "My theme";
    result = validateTheme(theme);
  }
  if (!result.ok) return result;
  const kept = new Set(["schemaVersion", "name", "base", "colors"]);
  return { ok: true, theme, omitted: Object.keys(normalized).filter((key) => !kept.has(key)).sort() };
}

/** Removes a `$schema` hint that is not Reskin's. It has no meaning for rendering. */
export function withoutForeignSchema(value) {
  if (!isObject(value) || !("$schema" in value) || value.$schema === THEME_SCHEMA_URL) return { value, removed: false };
  const { $schema, ...rest } = value;
  return { value: rest, removed: true };
}
