// Safe sinks for generated CSS and fixture text. Live pages get CSS through a style node's
// textContent only. The scriptless preview frame gets a complete HTML document, so its CSS is
// transport-escaped: every literal "<" becomes the CSS escape \3c, which leaves no way to close
// the style element, and any remaining delimiter rejects. Sanitized CSS has "<" only inside
// strings and identifiers, where the escape is equivalent; authoring proves that by parsing both
// (transportEquivalent in sanitize.js). Consent hashes always use the canonical text before
// escaping. Imported names and flavor text are escaped as HTML text and never become markup.

/** Puts CSS into a dedicated style node as text. Never HTML, never innerHTML. */
export function installStyleText(node, css) {
  if (typeof css !== "string") throw new TypeError("installStyleText takes CSS text");
  node.textContent = css;
  return node;
}

/** CSS with each "<" written as \3c, for use inside an HTML style element. */
export function escapeCssForHtml(css) {
  if (typeof css !== "string") throw new TypeError("escapeCssForHtml takes CSS text");
  return css.replace(/</g, "\\3c ");
}

/** True when text placed inside a style element could end it or start markup. */
export function unsafeForStyleElement(text) {
  return typeof text !== "string" || text.includes("<") || text.includes("\u0000");
}

/** A complete style element for the preview document, or a thrown error when it cannot be safe. */
export function styleElementHtml(css) {
  const escaped = escapeCssForHtml(css);
  if (unsafeForStyleElement(escaped)) throw new Error("This CSS cannot be placed in the preview document safely.");
  return `<style>${escaped}</style>`;
}

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text for an HTML text node or quoted attribute: it can never become an element. */
export function escapeHtmlText(text) {
  return String(text).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
