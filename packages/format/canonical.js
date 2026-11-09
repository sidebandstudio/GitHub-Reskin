// Canonical portable source: recursively sorted keys (UTF-16 code unit order), array order kept,
// UTF-8 without BOM, and admitted advanced CSS and gradientCss values in their canonical sanitized
// form, so exports, share codes and hashes never carry an unreviewed spelling. The compact form
// feeds share codes and hashes; exports use the same order.
import { admitCss, admitGradientCss } from "./css/admission.js";
import { validateTheme } from "./validate.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// The theme with admitted CSS replaced by its canonical text. CSS that is not admitted is left
// alone, for validation to report.
function withCanonicalCss(theme) {
  if (!isObject(theme)) return theme;
  let out = theme;
  if (typeof theme.css === "string") {
    const admitted = admitCss(theme.css, "/css");
    if (admitted.ok && admitted.value.css !== theme.css) out = { ...out, css: admitted.value.css };
  }
  if (isObject(theme.backgrounds)) {
    let backgrounds = theme.backgrounds;
    for (const target of ["page", "profileBanner", "header"]) {
      const layers = backgrounds[target]?.layers;
      if (!Array.isArray(layers) || !layers.some((layer) => isObject(layer?.gradientCss))) continue;
      const next = layers.map((layer, index) => {
        if (!isObject(layer?.gradientCss)) return layer;
        const admitted = admitGradientCss(layer.gradientCss, `/backgrounds/${target}/layers/${index}/gradientCss`);
        if (!admitted.ok) return layer;
        return { gradientCss: { ...layer.gradientCss, value: admitted.value, ...(admitted.size !== null ? { size: admitted.size } : {}) } };
      });
      backgrounds = { ...backgrounds, [target]: { ...backgrounds[target], layers: next } };
    }
    if (backgrounds !== theme.backgrounds) out = { ...out, backgrounds };
  }
  return out;
}

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
  return JSON.stringify(sorted(withCanonicalCss(theme)));
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
    bytes: utf8(`${JSON.stringify(sorted(withCanonicalCss(theme)), null, 2)}\n`),
  };
}
