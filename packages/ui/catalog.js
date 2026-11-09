// The bundled catalog as the extension runtime carries it. The build (bundle.mjs catalogData)
// validates every document once, proves its CSS with the sanitizer and resolves each theme for
// the picker miniatures; at runtime the content script, background and pages wrap that data
// without validating or hashing 25 documents again on every GitHub page load.
import { registerCssProofs } from "../format/viewer.js";
import { deepFreeze } from "../settings/catalog.js";

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
