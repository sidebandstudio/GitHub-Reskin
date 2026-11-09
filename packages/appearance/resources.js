// Runtime resource adapters. Each runtime chooses where packaged files live: the extension's own
// URLs, the site's bundled paths, or data embedded in the userscript. Theme documents never
// supply a location. An adapter is { kind, fontUrl(fontId), assetUrl(path) }; either function
// may return null when the runtime has no copy, and callers then use native fallbacks.
import { FONT_BY_ID } from "./registry.js";
import { isFontResourceUrl } from "./fonts.js";

// Packaged paths an adapter may resolve: the bundled fonts and the preview fixture's images.
const ASSET_PATH = /^packages\/preview\/fixture\/assets\/[a-z0-9-]+\.(webp|svg)$/;
export const isAssetPath = (path) => typeof path === "string" && ASSET_PATH.test(path);

const font = (id) => FONT_BY_ID[id]?.path ?? null;

/** Extension pages and content scripts: runtime.getURL of the packaged file. */
export function extensionResources(runtime) {
  if (typeof runtime?.getURL !== "function") throw new Error("extensionResources needs runtime.getURL");
  return Object.freeze({
    kind: "extension",
    fontUrl: (id) => (font(id) ? checked(runtime.getURL(font(id))) : null),
    assetUrl: (path) => (isAssetPath(path) ? runtime.getURL(path) : null),
  });
}

/** The static site: files copied under its base path, for example "/GitHub-Reskin/". */
export function siteResources(base) {
  if (typeof base !== "string" || !/^\/([A-Za-z0-9._-]+\/)*$/.test(base)) throw new Error(`Site base ${base} must be an absolute path ending in /`);
  return Object.freeze({
    kind: "site",
    fontUrl: (id) => (font(id) ? checked(`${base}${font(id)}`) : null),
    assetUrl: (path) => (isAssetPath(path) ? `${base}${path}` : null),
  });
}

/**
 * The userscript: WOFF2 bytes embedded as base64 by its build, keyed by font ID, and images
 * as data URLs keyed by asset path. Missing entries fall back natively.
 */
export function embeddedResources({ fonts = {}, assets = {} } = {}) {
  return Object.freeze({
    kind: "embedded",
    fontUrl: (id) => (font(id) && Object.hasOwn(fonts, id) ? checked(`data:font/woff2;base64,${fonts[id]}`) : null),
    assetUrl: (path) => (isAssetPath(path) && Object.hasOwn(assets, path) && /^data:image\/(webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(assets[path]) ? assets[path] : null),
  });
}

/** No packaged files: system fonts and no fixture images. */
export const noResources = Object.freeze({ kind: "none", fontUrl: () => null, assetUrl: () => null });

function checked(url) {
  if (!isFontResourceUrl(url)) throw new Error(`Resource adapter produced an unusable font URL`);
  return url;
}
