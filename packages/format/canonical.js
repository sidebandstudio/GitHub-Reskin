// Canonical portable source: recursively sorted keys (UTF-16 code unit order), array order kept,
// UTF-8 without BOM. The compact form feeds share codes and hashes; exports use the same order.
import { validateTheme } from "./validate.js";

const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sorted(value[key]);
    return out;
  }
  return value;
};

export const utf8 = (text) => new TextEncoder().encode(text);

/** Compact canonical JSON, no BOM, no trailing newline. */
export function canonicalize(theme) {
  return JSON.stringify(sorted(theme));
}

/** A file-name stem: lowercase ASCII words joined by hyphens, or "theme". */
export function fileStem(name) {
  const stem = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return stem || "theme";
}

/** Import accepts .json and .reskin.json files. */
export const acceptsFileName = (name) => /\.json$/i.test(String(name ?? ""));

/**
 * The downloadable file: canonical key order, two-space indentation, LF line endings and one
 * final newline. Throws on a document that is not a valid theme.
 * @returns {{filename:string, mime:string, bytes:Uint8Array}}
 */
export function exportTheme(theme) {
  const result = validateTheme(theme);
  if (!result.ok) throw new TypeError(`exportTheme needs a valid theme: ${result.issues.map((i) => `${i.path || "/"} ${i.message}`).join("; ")}`);
  return {
    filename: `${fileStem(theme.name)}.reskin.json`,
    mime: "application/json",
    bytes: utf8(`${JSON.stringify(sorted(theme), null, 2)}\n`),
  };
}
