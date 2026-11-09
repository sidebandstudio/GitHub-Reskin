// @font-face rules and font stacks. A theme names a font ID only; the location of its file comes
// from the runtime's resource adapter (resources.js), never from theme data.
import { FONT_BY_ID, SYSTEM_SANS } from "./registry.js";

// The schema's x-reskin.fontBudget.subset, so a missing glyph falls back without a fetch.
export const UNICODE_RANGE = "U+0020-007E, U+00A0-00FF, U+0152-0153, U+0178, U+2010-2027, U+2030, U+2039-203A, U+20AC";

// Packaged extension URLs, site paths and embedded WOFF2 data. Nothing that reaches another host.
const SEGMENTS = "(?:[A-Za-z0-9_~-][A-Za-z0-9._~-]*\\/)*[A-Za-z0-9_~-][A-Za-z0-9._~-]*\\.woff2";
const EXTENSION_URL = new RegExp(`^(?:chrome|moz|safari-web)-extension:\\/\\/[a-z0-9-]+\\/${SEGMENTS}$`);
const PATH_URL = new RegExp(`^\\/?${SEGMENTS}$`);
const DATA_URL = /^data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}$/;

/** Whether a font resource URL is one a runtime adapter may hand to CSS. Segments cannot start with a dot. */
export function isFontResourceUrl(url) {
  return typeof url === "string" && (EXTENSION_URL.test(url) || PATH_URL.test(url) || DATA_URL.test(url));
}

/** The font stack for a font ID: the bundled face first, then its fallback. System is the platform stack. */
export function fontStack(fontId) {
  const font = FONT_BY_ID[fontId];
  return font ? `"${font.cssFamily}", ${font.fallback}` : SYSTEM_SANS;
}

/**
 * One @font-face rule for one reviewed weight of a bundled font, by default its registry weight,
 * loaded only where something uses that family at that weight. Returns "" for system. Throws for
 * an unknown ID, an unreviewed weight or a URL that is not a packaged resource.
 */
export function fontFaceCss(fontId, resourceUrl, weight = FONT_BY_ID[fontId]?.weight) {
  if (fontId === "system") return "";
  const font = FONT_BY_ID[fontId];
  if (!font) throw new Error(`Unknown font ${fontId}`);
  if (!font.weights.includes(weight)) throw new Error(`Font ${fontId} has no reviewed weight ${weight}`);
  if (!isFontResourceUrl(resourceUrl)) throw new Error(`Font ${fontId} needs a packaged resource URL from the runtime adapter`);
  return `@font-face{font-family:"${font.cssFamily}";src:url("${resourceUrl}") format("woff2");font-weight:${weight};font-style:normal;font-display:swap;unicode-range:${UNICODE_RANGE}}`;
}

/**
 * The bundled families a themed resolution's heading and body roles name, once each: a bundled
 * role's family, and a native stack's own face. Without role fonts, the legacy heading font.
 */
export function roleFontIds(resolved) {
  const roles = resolved?.appearance?.fonts;
  const ids = roles ? ["heading", "body"].filter((role) => ["bundled", "native-stack"].includes(roles[role]?.source)).map((role) => roles[role].id) : [resolved?.font];
  return [...new Set(ids)].filter((id) => FONT_BY_ID[id]);
}

/**
 * Every reviewed weight's @font-face rule for the role families, from the runtime's resource
 * adapter. A browser fetches only the weights its text uses; a file the adapter has no copy of is
 * left out, so its role renders in the fallback stack.
 */
export function roleFontFaceCss(resolved, resources) {
  return roleFontIds(resolved)
    .flatMap((id) => FONT_BY_ID[id].weights.map((weight) => [id, weight, resources.fontUrl(id, weight)]))
    .filter(([, , url]) => url)
    .map(([id, weight, url]) => fontFaceCss(id, url, weight))
    .join("\n");
}
