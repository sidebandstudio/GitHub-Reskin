// Safe whole-document serialization for the preview's scriptless, opaque-origin frame. The
// controller paints the fixture into a trusted layout document, then this module writes that
// document out as one complete srcdoc. It never concatenates a theme string into markup: text and
// attribute values are escaped here, element and attribute names come from fixed allowlists, and
// anything outside them is refused rather than dropped. Style text is the trusted compilers'
// output and may not contain "<" at all, so no style element can be closed early. Images and
// fonts travel embedded, so the frame's policy allows no network request of any kind.

const HTML_ELEMENTS = new Set([
  "a", "article", "aside", "blockquote", "br", "code", "col", "colgroup", "div", "em", "header", "i", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "img", "li", "main", "nav", "ol", "p", "pre", "section", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
]);
const SVG_ELEMENTS = new Set(["svg", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "g"]);
const VOID = new Set(["br", "col", "hr", "img"]);
const HTML_ATTRIBUTE = /^(?:class|style|role|title|alt|width|height|loading|decoding|colspan|rowspan|lang|dir|(?:aria|data)-[a-z0-9-]+)$/;
const SVG_ATTRIBUTE = /^(?:class|width|height|viewBox|fill|stroke|stroke-width|stroke-linejoin|stroke-linecap|d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|points|transform|aria-hidden|focusable)$/;
const ROOT_ATTRIBUTE = /^(?:lang|data-color-mode|data-light-theme|data-dark-theme)$/;
const ROOT_VALUE = /^[A-Za-z0-9_.-]+$/;
const DATA_IMAGE = /^data:image\/(?:webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
export const PREVIEW_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";

const escapeText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text) => escapeText(text).replace(/"/g, "&quot;");

/** Style text for a style element of the srcdoc. Throws unless it is free of "<". */
export function styleText(css) {
  if (typeof css !== "string") throw new TypeError("Preview style text must be a string");
  if (css.includes("<")) throw new Error("Preview style text contains '<' and cannot be written into the frame safely");
  return css;
}

function element(node, out, embed) {
  const svg = node.namespaceURI === SVG_NS;
  const name = svg ? node.localName : node.localName.toLowerCase();
  if (svg ? !SVG_ELEMENTS.has(name) : node.namespaceURI !== HTML_NS || !HTML_ELEMENTS.has(name)) throw new Error(`The preview cannot serialize a <${node.localName}> element`);
  out.push("<", name);
  for (const attribute of node.attributes) {
    const key = attribute.name;
    let value = attribute.value;
    if (key === "src" && name === "img") {
      // The embedded copy of a packaged image; without one the image keeps only its alt text.
      value = embed(value);
      if (value === null) continue;
      if (!DATA_IMAGE.test(value)) throw new Error("A preview image must be embedded image data");
    } else if (!(svg ? SVG_ATTRIBUTE : HTML_ATTRIBUTE).test(key)) throw new Error(`The preview cannot serialize the ${key} attribute of <${name}>`);
    out.push(" ", key, '="', escapeAttribute(value), '"');
  }
  out.push(">");
  if (!svg && VOID.has(name)) {
    if (node.firstChild) throw new Error(`<${name}> cannot have children`);
    return;
  }
  children(node, out, embed);
  out.push("</", name, ">");
}

function children(parent, out, embed) {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3) out.push(escapeText(node.data));
    else if (node.nodeType === 1) element(node, out, embed);
    else if (node.nodeType !== 8) throw new Error("The preview can serialize only elements and text");
  }
}

/** The serialized children of a painted fixture document's body. */
export function fixtureBody(doc, embed = () => null) {
  const body = [];
  children(doc.body, body, embed);
  return body.join("");
}

/**
 * The complete srcdoc for a painted fixture document: its root attributes, a no-network content
 * security policy, the given style layers in order and the serialized body.
 * @param {Document} doc the painted layout document
 * @param {{name:string, css:string}[]} styles
 * @param {(src:string) => string|null} embed the embedded data URL for an image's src, or null
 * @param {string} [body] fixtureBody(doc, embed), when the caller already has it
 */
export function serializeFixture(doc, styles, embed = () => null, body = fixtureBody(doc, embed)) {
  const root = [];
  for (const attribute of doc.documentElement.attributes) {
    if (!ROOT_ATTRIBUTE.test(attribute.name) || !ROOT_VALUE.test(attribute.value)) throw new Error(`The preview cannot serialize the root attribute ${attribute.name}`);
    root.push(` ${attribute.name}="${attribute.value}"`);
  }
  const head = [
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    ...styles.map(({ name, css }) => `<style data-layer="${escapeAttribute(name)}">${styleText(css)}</style>`),
  ];
  return `<!doctype html><html${root.join("")}><head>${head.join("")}</head><body>${body}</body></html>`;
}
