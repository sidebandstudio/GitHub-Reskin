// Site-wide data derived at build time: release configuration, base-aware paths, the catalog as
// pages use it (anime title first) and the preview captures. Pure, so tests can import it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

// site/build.mjs writes the captures before Astro renders; a missing manifest means the build
// skipped that step.
// Astro bundles this file for prerendering, so site/build.mjs passes the repository root.
const MANIFEST = join(process.env.RESKIN_ROOT || fileURLToPath(new URL("../../../", import.meta.url)), "site/.cache/previews/manifest.json");
export const CAPTURES = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null;
const capturesOf = (slug) => {
  const entry = CAPTURES?.themes?.[slug];
  if (!entry) throw new Error(`No preview capture for ${slug}. Build the site with npm run build:site.`);
  const image = (kind) => ({ src: href(`previews/${entry[kind].file}`), width: entry[kind].width, height: entry[kind].height });
  return { phone: image("phone"), desk: image("desk"), card: image("card"), calm: image("calm"), sourceHash: entry.sourceHash, fingerprint: entry.fingerprint };
};

// The lines Full adds to a profile page, as the flavor slots name them, each with the GitHub label
// it sits beside. The 404 and empty-state captions belong to other pages.
const PROFILE_LINES = [
  ["profile.tag", "Name"],
  ["profile.pinned.heading", "Pinned"],
  ["contributions.caption", "Contribution graph"],
  ["profile.activity.heading", "Contribution activity"],
  ["profile.achievements.heading", "Achievements"],
  ["profile.organizations.heading", "Organizations"],
  ["footer.signoff", "Footer"],
];
const profileLines = (doc) => (doc.flavor?.enabled ? PROFILE_LINES.filter(([slot]) => doc.flavor.slots?.[slot]).map(([slot, label]) => [label, doc.flavor.slots[slot]]) : []);

// The anime title is every theme's primary label; the theme's own name comes second. A Classic has
// no anime, so its name is primary.
export const THEMES = CATALOG.map((entry) => ({
  ...entry,
  name: entry.doc.name,
  anime: entry.doc.inspiredBy || null,
  title: entry.doc.inspiredBy || entry.doc.name,
  subtitle: entry.doc.inspiredBy ? entry.doc.name : "Classic theme",
  description: entry.doc.description || "",
  base: entry.doc.base,
  advancedCss: typeof entry.doc.css === "string" && entry.doc.css !== "",
  profileLines: profileLines(entry.doc),
  get captures() {
    return capturesOf(entry.slug);
  },
}));
export const ANIME = THEMES.filter((theme) => theme.group === "anime");
export const CLASSICS = THEMES.filter((theme) => theme.group === "classics");
export const themeBySlug = (slug) => THEMES.find((theme) => theme.slug === slug);

/** "Cyberpunk: Edgerunners theme for GitHub", or the Classic's name. */
export const themeFor = (theme) => (theme.anime ? `${theme.anime} theme for GitHub` : `${theme.name}, a Classic theme for GitHub`);
/** The hero paragraph under a theme page's anime-first heading. */
export const themeLede = (theme) => `${theme.name}, ${theme.anime ? "one of 13 anime themes" : "one of 12 Classics"} in GitHub Reskin, a free extension that re-themes GitHub in your own browser.`;
/** The meta and Open Graph description of a theme page. */
export const themeDescription = (theme) => `${themeFor(theme)}: ${theme.name}. ${theme.description} Preview it on a GitHub profile, then keep it for desktop.`;
/** The document title of a theme page. */
export const pageTitle = (theme) => (theme.anime ? `${theme.anime} theme for GitHub: ${theme.name} · GitHub Reskin` : `${theme.name}, a Classic theme for GitHub · GitHub Reskin`);

// Store states by browser. A null listing is shown as coming soon, never as a link.
export const BROWSERS = [
  { id: "chrome", name: "Chrome", store: STORES.chrome, storeName: "Chrome Web Store", also: "Edge, Brave, Vivaldi and Opera can use the Chrome listing." },
  { id: "firefox", name: "Firefox", store: STORES.firefox, storeName: "Firefox Add-ons", also: "Firefox 140 or later on desktop." },
];
