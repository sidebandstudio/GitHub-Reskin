// The bundled catalog as the extension runtime carries it. The build (bundle.mjs catalogData)
// validates every document once, proves its CSS with the sanitizer and resolves each theme for
// the picker miniatures; at runtime the background and pages wrap that data without validating
// 25 documents again. The content script carries only the catalog's index (bundle.mjs
// catalogIndex) and gets the one theme a page shows from storage (contentCatalog).
import { sha256 } from "../engine/sha256.js";
import { registerCssProofs } from "../format/viewer.js";
import { deepFreeze } from "../settings/catalog.js";

/**
 * A bundled theme's record for the content script, as JSON text: its document and the sanitizer's
 * proofs for its CSS. The background stores it beside the settings (STORAGE_KEYS.selected), and
 * the build hashes the same text for the content script's index, so both must come from here.
 * @returns {string|null} null for an ID the catalog lacks
 */
export function catalogRecord(data, id) {
  if (!Object.hasOwn(data.documents, id)) return null;
  const [start, end] = data.proofRanges[id];
  return JSON.stringify({ document: data.documents[id], cssProofs: data.cssProofs.slice(start, end) });
}

/** The SHA-256 of a record's UTF-8 text, as the index keeps it. */
export const recordHash = (text) => sha256(new TextEncoder().encode(text));

/**
 * Runtime: a CatalogSource (packages/settings) over embedded build data. Same shape and values
 * as createCatalogSource over the same entries; the build proved the documents valid. Registers
 * the build's sanitizer proofs, so the viewer entries admit the bundled CSS without a parser.
 */
export function catalogFromData(data) {
  registerCssProofs(data.cssProofs);
  const documents = new Map(data.ids.map((id) => [id, deepFreeze(data.documents[id])]));
  const ids = Object.freeze([...data.ids]);
  return Object.freeze({
    hash: data.hash,
    ids,
    has: (id) => documents.has(id),
    document: (id) => documents.get(id) ?? null,
    sourceHash: (id) => (documents.has(id) ? data.hashes[id] : null),
    record: (id) => (documents.has(id) ? catalogRecord(data, id) : null),
  });
}

/**
 * The content script's CatalogSource, over the build's index (bundle.mjs catalogIndex): every
 * bundled theme's ID, source hash and record hash, with the document of only the theme the page
 * shows. That theme's record comes from storage, and `admit` keeps it only when its text hashes to
 * the build's record for a bundled theme, so the document is exactly the one the build validated
 * and its CSS is admitted from the build's proofs, with no parser.
 */
export function contentCatalog(index) {
  const ids = Object.freeze([...index.ids]);
  const known = new Set(ids);
  const byRecord = new Map(ids.map((id) => [index.records[id], id]));
  const documents = new Map();
  let last = null;
  return Object.freeze({
    hash: index.hash,
    ids,
    has: (id) => known.has(id),
    document: (id) => documents.get(id) ?? null,
    sourceHash: (id) => (known.has(id) ? index.hashes[id] : null),
    /** Whether `id` is a bundled theme whose record has not arrived. */
    pending: (id) => known.has(id) && !documents.has(id),
    /** Keeps a stored record that is a bundled theme's, and ignores anything else. */
    admit(text) {
      if (typeof text !== "string" || text === last) return;
      last = text;
      const id = byRecord.get(recordHash(text));
      if (id === undefined || documents.has(id)) return;
      const record = JSON.parse(text);
      registerCssProofs(record.cssProofs);
      documents.set(id, deepFreeze(record.document));
    },
  });
}

/**
 * The picker's card for a theme: labels from the document and a miniature from its resolution.
 * The anime title is the primary label; a Classic, which has no inspiration, leads with its name.
 * @param {{id:string, group:string, document:object}} entry
 * @param {object} resolved ResolvedTheme against the theme's standard seed
 */
export function themeCard({ id, group, document }, resolved) {
  const t = resolved.tokens;
  const appearance = resolved.appearance ?? {};
  const header = appearance.colors?.header ?? {};
  const heading = appearance.fonts?.heading ?? {};
  const slots = resolved.flavor?.enabled ? (resolved.flavor.slots ?? {}) : {};
  const effects = Object.keys(resolved.effects ?? {});
  return {
    id,
    group,
    name: document.name,
    show: document.inspiredBy ?? null,
    base: document.base,
    mini: {
      canvas: t.canvas,
      surface: t.surface,
      border: t.border,
      text: t.text,
      muted: t.mutedText,
      link: t.link,
      button: t.primaryBackground,
      buttonText: t.primaryText,
      header: header.background ?? t.inset,
      headerText: header.text ?? t.mutedText,
      graph: [...resolved.graph],
      // What Full adds on GitHub, drawn at miniature scale: the page wallpaper, the heading face,
      // the profile tag and the pinned heading's addition, and the glow and rail effects.
      wallpaper: miniWallpaper(appearance.paints?.page),
      font: heading.family ? { id: heading.source === "bundled" ? heading.id : null, stack: `"${heading.family}", ${heading.fallback}` } : null,
      tag: slots["profile.tag"] ?? null,
      flourish: slots["profile.pinned.heading"] ?? null,
      glow: effects.includes("glow"),
      rail: effects.includes("rail"),
    },
  };
}

// A page paint's gradient layers with their tile sizes scaled to the miniature, which draws
// about a sixth of GitHub's width; a viewport-tall layer becomes miniature-tall.
const MINI_SCALE = 6;
function miniWallpaper(paint) {
  const layers = (paint?.layers ?? []).filter((layer) => layer.kind === "gradientCss");
  if (!layers.length) return null;
  const size = (value) =>
    String(value ?? "auto")
      .replace(/100vh/g, "100%")
      .replace(/(\d+(?:\.\d+)?)px/g, (_, n) => `${Math.max(2, Math.round(Number(n) / MINI_SCALE))}px`);
  return { image: layers.map((layer) => layer.value).join(","), size: layers.map((layer) => size(layer.size)).join(",") };
}

/** Lowercase, accent-free text for search. */
export const searchText = (text) =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Cards whose theme name or show contains every word of the query. */
export function searchCards(cards, query) {
  const words = searchText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return cards;
  return cards.filter((card) => {
    const text = searchText(`${card.show ?? ""} ${card.name}`);
    return words.every((word) => text.includes(word));
  });
}
