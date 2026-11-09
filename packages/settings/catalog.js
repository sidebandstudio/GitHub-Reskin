// The catalog as settings and the lifecycle see it: the bundled theme IDs, their validated source
// documents and one hash over both. C6 builds it from themes/catalog.json at build time; tests build
// small ones from fixtures. Nothing here reads files, storage or the DOM.
import { DEFAULT_THEME_ID, LEGACY_EDITED_COLORS_THEME_ID, LOCAL_THEME_ID_PREFIX } from "../contracts/index.js";
import { validateTheme } from "../format/index.js";
import { sha256, sourceHash } from "../engine/index.js";

const utf8 = (text) => new TextEncoder().encode(text);

/**
 * @param {{id:string, document:import("../contracts/index.js").ThemeV1}[]} entries in display order
 * @returns {CatalogSource}
 * @typedef {{hash:string, ids:readonly string[], has(id:string):boolean, document(id:string):object|null, sourceHash(id:string):string|null}} CatalogSource
 */
export function createCatalogSource(entries) {
  const documents = new Map();
  const hashes = new Map();
  for (const { id, document } of entries) {
    if (typeof id !== "string" || !id || id.startsWith(LOCAL_THEME_ID_PREFIX)) throw new TypeError(`Catalog ID ${JSON.stringify(id)} is not a bundled theme ID`);
    if (documents.has(id)) throw new TypeError(`Catalog repeats ${id}`);
    const result = validateTheme(document);
    if (!result.ok) throw new TypeError(`Catalog theme ${id} is invalid: ${result.issues.map((i) => `${i.path || "/"} ${i.code}`).join(", ")}`);
    documents.set(id, deepFreeze(structuredClone(document)));
    hashes.set(id, sourceHash(document));
  }
  const ids = Object.freeze([...documents.keys()]);
  const hash = sha256(utf8(JSON.stringify(ids.map((id) => [id, hashes.get(id)]))));
  return Object.freeze({
    hash,
    ids,
    has: (id) => documents.has(id),
    document: (id) => documents.get(id) ?? null,
    sourceHash: (id) => hashes.get(id) ?? null,
  });
}

/** The theme a fresh or unrecoverable selection uses: Choom Circuit, or Editing Suite while the catalog lacks it. */
export function fallbackThemeId(catalog) {
  if (catalog.has(DEFAULT_THEME_ID)) return DEFAULT_THEME_ID;
  if (catalog.has(LEGACY_EDITED_COLORS_THEME_ID)) return LEGACY_EDITED_COLORS_THEME_ID;
  throw new TypeError(`The catalog has neither ${DEFAULT_THEME_ID} nor ${LEGACY_EDITED_COLORS_THEME_ID}`);
}

/** The selected theme's source document, from the catalog or the saved custom themes, or null. */
export function selectedSource(settings, catalog) {
  const id = settings.selectedThemeId;
  if (id.startsWith(LOCAL_THEME_ID_PREFIX)) return settings.customThemes.find((theme) => theme.id === id)?.document ?? null;
  return catalog.document(id);
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
