// The bundled catalog contract: themes/catalog.json is a JSON array of CatalogEntry records.
// Groups are lowercase "anime" and "classics". `file` is the repository-root-relative POSIX path
// themes/<group>/<slug>.reskin.json. `order` starts at 1 and is unique and contiguous within its
// group. Anime entries come first, then Classics, each ascending by order. Palettes and display
// names live only in the referenced documents.
import { LEGACY_CLASSIC_THEME_IDS } from "../contracts/index.js";

export const CATALOG_GROUPS = Object.freeze(["anime", "classics"]);
const ENTRY_KEYS = ["file", "group", "id", "order", "slug"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Stable anime catalog IDs and slugs, in display order. The IDs predate the display names.
// TODO(C1): move ANIME_CATALOG into packages/contracts next to DEFAULT_THEME_ID.
export const ANIME_CATALOG = Object.freeze(
  [
    ["anime.cyberpunk-edgerunners", "choom-circuit"],
    ["anime.evangelion", "violet-synchrony"],
    ["anime.dandadan", "occult-orbit"],
    ["anime.solo-leveling", "gatewake-protocol"],
    ["anime.demon-slayer", "wisteria-emberline"],
    ["anime.one-piece", "sunward-voyage"],
    ["anime.black-clover", "fifth-leaf-forge"],
    ["anime.jujutsu-kaisen", "cursed-aperture"],
    ["anime.spy-family", "peanut-dossier"],
    ["anime.attack-on-titan", "wallward-scout"],
    ["anime.frieren", "longroad-petals"],
    ["anime.chainsaw-man", "ripcord-bureau"],
    ["anime.death-note", "shinigami-margins"],
  ].map(([id, slug], index) => Object.freeze({ id, slug, group: "anime", file: `themes/anime/${slug}.reskin.json`, order: index + 1 })),
);

// Classics keep the twelve 1.x IDs, in 1.x order; the slug equals the ID.
export const CLASSICS_CATALOG = Object.freeze(
  LEGACY_CLASSIC_THEME_IDS.map((id, index) => Object.freeze({ id, slug: id, group: "classics", file: `themes/classics/${id}.reskin.json`, order: index + 1 })),
);

/**
 * Structural problems with a catalog, as readable strings. Empty means valid.
 * @param {unknown} catalog
 */
export function catalogProblems(catalog) {
  if (!Array.isArray(catalog)) return ["The catalog must be a JSON array of entries."];
  const problems = [];
  const ids = new Set();
  const slugs = new Set();
  const orders = { anime: [], classics: [] };
  let lastGroup = 0;
  catalog.forEach((entry, index) => {
    const at = `entry ${index}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return problems.push(`${at} is not an object`);
    const keys = Object.keys(entry).sort();
    if (keys.join() !== ENTRY_KEYS.join()) problems.push(`${at} has keys ${keys.join(", ")}; expected ${ENTRY_KEYS.join(", ")}`);
    const { id, slug, group, file, order } = entry;
    if (typeof id !== "string" || !id) problems.push(`${at} needs a string id`);
    else if (ids.has(id)) problems.push(`${at} repeats id ${id}`);
    else ids.add(id);
    if (typeof slug !== "string" || !SLUG.test(slug)) problems.push(`${at} slug ${JSON.stringify(slug)} must be lowercase words joined by hyphens`);
    else if (slugs.has(slug)) problems.push(`${at} repeats slug ${slug}`);
    else slugs.add(slug);
    const groupIndex = CATALOG_GROUPS.indexOf(group);
    if (groupIndex < 0) return problems.push(`${at} group ${JSON.stringify(group)} must be anime or classics`);
    if (groupIndex < lastGroup) problems.push(`${at} is an anime entry after a Classics entry; Anime come first`);
    lastGroup = groupIndex;
    if (file !== `themes/${group}/${slug}.reskin.json`) problems.push(`${at} file ${JSON.stringify(file)} must be themes/${group}/${slug}.reskin.json`);
    if (!Number.isInteger(order) || order < 1) problems.push(`${at} order must be an integer from 1`);
    else orders[group].push(order);
  });
  for (const group of CATALOG_GROUPS) {
    const list = orders[group];
    if (list.some((order, i) => order !== i + 1)) problems.push(`${group} order must run 1, 2, 3... with no gaps or repeats, ascending (found ${list.join(", ")})`);
  }
  return problems;
}
