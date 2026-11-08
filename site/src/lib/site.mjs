// Site-wide data derived at build time: release configuration, base-aware paths and the catalog
// as pages use it. Pure, so tests can import it.
import release from "../../../release.config.json" with { type: "json" };
import { CATALOG } from "../catalog.mjs";

export const ORIGIN = release.site.origin;
export const BASE = `${release.site.base.replace(/\/+$/, "")}/`;
export const CANONICAL = `${ORIGIN}${BASE}`;
export const SUPPORT = release.support;
export const STORES = release.stores;
export const DEFAULT_SLUG = "choom-circuit";

/** A site path under the base, for links and assets. */
export const href = (path = "") => `${BASE}${path.replace(/^\/+/, "")}`;
/** The canonical public URL of a site path. */
export const canonical = (path = "") => `${ORIGIN}${href(path)}`;
export const themePath = (slug) => `themes/${slug}/`;

export const THEMES = CATALOG.map((entry) => ({
  ...entry,
  name: entry.doc.name,
  inspiredBy: entry.doc.inspiredBy || null,
  description: entry.doc.description || "",
}));
export const ANIME = THEMES.filter((theme) => theme.group === "anime");
export const CLASSICS = THEMES.filter((theme) => theme.group === "classics");
export const themeBySlug = (slug) => THEMES.find((theme) => theme.slug === slug);

/** The line under a theme name: its inspiration, or that it is a Classic. */
export const creditLine = (theme) => (theme.inspiredBy ? `Inspired by ${theme.inspiredBy}` : "Classic palette");
/** The document title of a theme page. */
export const pageTitle = (theme) => (theme.inspiredBy ? `${theme.name}, inspired by ${theme.inspiredBy} · GitHub Reskin` : `${theme.name}, a Classic theme · GitHub Reskin`);

// Store states by browser. A null listing is shown as coming soon, never as a link.
export const BROWSERS = [
  { id: "chrome", name: "Chrome", store: STORES.chrome, storeName: "Chrome Web Store", also: "Edge, Brave, Vivaldi and Opera can use the Chrome listing." },
  { id: "firefox", name: "Firefox", store: STORES.firefox, storeName: "Firefox Add-ons", also: "Firefox 140 or later on desktop." },
];
