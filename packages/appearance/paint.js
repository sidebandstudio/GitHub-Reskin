// Structured appearance on GitHub's own page: the page, profile-banner and header paints, opaque
// backings under reading panels, avatar shape and frame, and the heading/body type roles. Colors
// of GitHub's elements, buttons, borders, radii and shadows on GitHub elements, the graph, labels
// and syntax belong to the Primer adapter; this file draws only the layers listed here, from the
// engine's resolved appearance record, never from theme strings other than admitted gradientCss.
//
// Full draws every requested layer. Calm keeps the solid page and header colors, simple avatar
// corners and the role fonts, and drops paint layers, the banner, neon frames and every glow.
// Effects off drops the same decoration inside Full. Fonts off removes both roles, tracking and
// case. Native, high-contrast and forced-color resolutions get nothing, and on the page every rule
// follows the Primer adapter's decision for the subject's nearest mode island.
import { contrast, oklab } from "../engine/color.js";
import { ATTRIBUTED } from "../primer/selectors.js";
import { FONT_BY_ID } from "./registry.js";
import { num, rgba } from "./effects.js";

const HEX = /^#[0-9a-f]{6}$/;

// GitHub's elements this file styles. The preview fixture uses the same class names, so both
// targets share one selector list. Each selector also steps out of native and protected islands,
// and never styles a mode island's own element, whose mode is its own, not its parent's.
export const GUARD = ":not([data-color-mode],[data-reskin-native],[data-reskin-native] *,[data-reskin-protected],[data-reskin-protected] *)";
// The Primer adapter's compiled CSS raises this inherited switch on the mode islands it themes and
// clears it on native, high-contrast, unknown and suppressed ones. A container style query reads
// it from the subject's parent, so every structured rule follows the subject's nearest island, as
// the adapter's own component rules do. An engine without container style queries (Gecko before
// Firefox 151) draws none of these rules, and GitHub keeps its own look there.
export const THEMED_SWITCH = "--reskin-on";
const THEMED = `@container style(${THEMED_SWITCH}: 1)`;
export const SURFACES = Object.freeze({
  page: "body",
  header: [".AppHeader", "header.Header", ".HeaderMktg"],
  banner: ".rs-banner",
  // Panels that hold authored or code text. Each gets an opaque canvas backing at no specificity,
  // so GitHub's own fill wins wherever it has one and a transparent panel never shows wallpaper.
  reading: [".Box", ".markdown-body", ".comment-body", ".timeline-comment", ".blob-wrapper", ".diff-table", ".blankslate", ".react-code-view", ".file"],
  avatar: [".avatar-user"],
  headings: ["h1", "h2", "h3", ".h1", ".h2", ".h3"],
  // GitHub-owned chrome that takes the heading role with its tracking, never its case.
  headingChrome: [".UnderlineNav-item", ".AppHeader-context-item", ".HeaderMenu-link", ".btn", ".Button"],
  // Code, diff and editor text keep their native family, tracking and case whatever the roles say.
  code: ["pre", "code", "kbd", "samp", "tt", "var", "textarea", ".text-mono", ".blob-code", ".blob-num", ".diff-table", ".react-code-text", ".react-code-lines", ".cm-editor", ".CodeMirror"],
  // Authored prose: a heading inside it is the author's, so the heading role does not reach it.
  authored: [".markdown-body", ".comment-body", ".js-comment-body"],
});

// GitHub's own body stack, for a page that does not define its variable.
const GITHUB_SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif';

const list = (selectors) => selectors.map((s) => `${s}${GUARD}`).join(",");

/** What the structured layers may show under the effective preferences. */
export function structuredEffective(resolved, prefs) {
  const on = resolved?.policy === "themed" && Boolean(resolved.appearance) && Boolean(prefs?.enabled);
  const full = on && Boolean(prefs.extras);
  return Object.freeze({ on, full, decorative: full && Boolean(prefs.effects), fonts: on && Boolean(prefs.fonts) });
}

// ---- Layers ----

// Named gradient positions as CSS positions.
const POSITION = { center: "center", top: "top", bottom: "bottom", left: "left", right: "right", "top-left": "left top", "top-right": "right top", "bottom-left": "left bottom", "bottom-right": "right bottom" };

// A gradientCss size made only of px lengths is a tile and repeats; auto, % and viewport sizes
// paint once from the top left, as the original Cyberpunk bloom does (100% 100vh, no repeat).
const tiled = (size) => /^\d+(?:\.\d+)?px(?: \d+(?:\.\d+)?px)?$/.test(size ?? "auto");

/** One resolved paint layer as CSS background parts, or null for a layer this increment omits. */
export function layerCss(layer) {
  if (layer.kind === "gradient") {
    const stops = layer.stops.map((stop) => `${rgba(stop.color, layer.opacity)} ${num(stop.position)}%`).join(",");
    const image = layer.type === "radial" ? `radial-gradient(circle at ${POSITION[layer.position] ?? "center"},${stops})` : `linear-gradient(${num(layer.angle)}deg,${stops})`;
    return { image, size: "auto", repeat: "no-repeat", position: "0 0" };
  }
  if (layer.kind === "pattern") {
    const c = rgba(layer.color, layer.opacity);
    const s = layer.size;
    switch (layer.pattern) {
      // Two 1px lines per tile, along its top and left edges.
      case "grid":
        return { image: `conic-gradient(from 90deg at 1px 1px,transparent 90deg,${c} 0)`, size: `${s}px ${s}px`, repeat: "repeat", position: "0 0" };
      case "scanlines":
        return { image: `linear-gradient(${c} 1px,transparent 1px)`, size: `${s}px ${s}px`, repeat: "repeat", position: "0 0" };
      case "dots": {
        const r = Math.max(1, Math.round(s / 8));
        return { image: `radial-gradient(circle,${c} 0 ${r}px,transparent ${num(r + 0.5)}px)`, size: `${s}px ${s}px`, repeat: "repeat", position: "0 0" };
      }
      // One corner-to-corner line per tile; neighboring tiles continue it into long diagonals.
      case "diagonal":
        return { image: `linear-gradient(45deg,transparent calc(50% - .5px),${c} calc(50% - .5px) calc(50% + .5px),transparent calc(50% + .5px))`, size: `${s}px ${s}px`, repeat: "repeat", position: "0 0" };
      // One fleck in an oblong tile, so rows and columns do not line up into a grid.
      case "grain":
        return { image: `radial-gradient(circle at 31% 67%,${c} 0 .7px,transparent 1.2px)`, size: `${s}px ${Math.round(s * 1.37)}px`, repeat: "repeat", position: "0 0" };
      default:
        return null;
    }
  }
  if (layer.kind === "gradientCss") {
    // An auto-sized vertical or horizontal repeating gradient paints the same pixels as one period
    // tiled, and a tile costs far less to draw than one image as tall as a long page.
    const period = (layer.size ?? "auto") === "auto" ? repeatPeriod(layer.value) : null;
    if (period) return { image: layer.value, size: period.axis === "y" ? `100% ${num(period.px)}px` : `${num(period.px)}px 100%`, repeat: "repeat", position: "0 0" };
    return { image: layer.value, size: layer.size ?? "auto", repeat: tiled(layer.size) ? "repeat" : "no-repeat", position: "0 0" };
  }
  // Raster layers need the browser decode and conversion path, which arrives after this increment.
  return null;
}

// ---- Readability of text drawn straight on a paint ----

const NAMED = { transparent: null };
const KEYWORDS = new Set(["to", "at", "in", "srgb", "circle", "ellipse", "closest-side", "closest-corner", "farthest-side", "farthest-corner", "left", "right", "top", "bottom", "center", "from"]);
const GRADIENT_FUNCTIONS = new Set(["linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient"]);
const MATH = new Set(["calc", "min", "max", "clamp"]);

// Top-level comma-separated arguments of the text between the first "(" and its match.
function args(text) {
  const open = text.indexOf("(");
  const out = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) {
        out.push(text.slice(start, i).trim());
        return { name: text.slice(0, open).trim().toLowerCase(), args: out, rest: text.slice(i + 1) };
      }
      depth--;
    } else if (c === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

const hexAlpha = (hex) => {
  const h = hex.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) return { hex: `#${[1, 2, 3].map((i) => h[i] + h[i]).join("")}`, alpha: 1 };
  if (/^#[0-9a-f]{4}$/.test(h)) return { hex: `#${[1, 2, 3].map((i) => h[i] + h[i]).join("")}`, alpha: parseInt(h[4] + h[4], 16) / 255 };
  if (/^#[0-9a-f]{6}$/.test(h)) return { hex: h, alpha: 1 };
  if (/^#[0-9a-f]{8}$/.test(h)) return { hex: h.slice(0, 7), alpha: parseInt(h.slice(7), 16) / 255 };
  return undefined;
};
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

// A color token as { hex, alpha }, null for transparent, or undefined when it cannot be evaluated.
function color(token) {
  const t = token.trim().toLowerCase();
  if (t in NAMED) return NAMED[t];
  if (t.startsWith("#")) return hexAlpha(t);
  const fn = args(t);
  if (!fn || fn.rest.trim()) return undefined;
  if (fn.name === "rgb" || fn.name === "rgba") {
    const parts = fn.args.join(" ").replace("/", " ").split(/\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return undefined;
    const channel = (p) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p));
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const values = parts.slice(0, 3).map(channel);
    if (![...values, alpha].every(Number.isFinite)) return undefined;
    return { hex: toHex(...values), alpha };
  }
  if (fn.name === "color-mix" && fn.args.length === 3 && fn.args[0] === "in srgb") {
    const side = (text) => {
      const m = /^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/.exec(text);
      return { c: color(m[1]), p: m[2] === undefined ? null : parseFloat(m[2]) / 100 };
    };
    const a = side(fn.args[1]);
    const b = side(fn.args[2]);
    if (a.c === undefined || b.c === undefined) return undefined;
    const pa = a.p ?? (b.p === null ? 0.5 : 1 - b.p);
    const pb = b.p ?? 1 - pa;
    const ca = a.c ?? { hex: "#000000", alpha: 0 };
    const cb = b.c ?? { hex: "#000000", alpha: 0 };
    const alpha = ca.alpha * pa + cb.alpha * pb;
    if (alpha === 0) return null;
    // Premultiplied mixing, as color-mix() interpolates with alpha. The result is not a legacy
    // sRGB color, so a gradient holding it interpolates in OKLab.
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [ra, rb] = [rgb(ca.hex), rgb(cb.hex)];
    return { hex: toHex(...ra.map((v, i) => (v * ca.alpha * pa + rb[i] * cb.alpha * pb) / alpha)), alpha, modern: true };
  }
  return undefined;
}

// Splits one color stop into its color and positions, or null for a direction or shape argument.
function stop(text) {
  // Tokens split at top-level whitespace and after each top-level function, since canonical CSS
  // writes "color-mix(...)0 1px" with no space before a position.
  const tokens = [];
  let depth = 0;
  let current = "";
  for (const c of text) {
    if (/\s/.test(c) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += c;
    if (c === "(") depth++;
    if (c === ")" && --depth === 0) {
      tokens.push(current);
      current = "";
    }
  }
  if (current) tokens.push(current);
  const positions = [];
  let found = null;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (KEYWORDS.has(lower) || /^-?[\d.]+(?:deg|turn|rad|grad)$/.test(lower)) return null;
    if (/^-?\d/.test(lower) || MATH.has(args(lower)?.name)) positions.push(lower);
    else if (found === null) found = lower;
    else return { color: undefined, positions };
  }
  // Positions alone are not a color stop; a color that cannot be evaluated fails the paint closed.
  if (found === null) return positions.length ? null : { color: undefined, positions };
  return { color: color(found), positions };
}

const AXIS = { "to bottom": "y", "180deg": "y", "to right": "x", "90deg": "x" };

/**
 * The period of a repeating-linear-gradient that runs straight down or across with every stop
 * position in px from 0, as { axis, px }, or null. Its pixels repeat exactly at that period.
 */
export function repeatPeriod(value) {
  const fn = args(value);
  if (!fn || fn.name !== "repeating-linear-gradient" || fn.rest.trim()) return null;
  let axis = "y";
  let list = fn.args;
  if (stop(list[0]) === null) {
    axis = AXIS[list[0].toLowerCase().replace(/\s+/g, " ")];
    if (!axis) return null;
    list = list.slice(1);
  }
  const positions = [];
  for (const [i, arg] of list.entries()) {
    const s = stop(arg);
    if (!s || s.color === undefined) return null;
    if (!s.positions.length && i === 0) positions.push(0);
    else if (!s.positions.length) return null;
    for (const position of s.positions) {
      const value = px(position);
      if (value === null || value < (positions.at(-1) ?? 0)) return null;
      positions.push(value);
    }
  }
  return positions[0] === 0 && positions.at(-1) > 0 ? { axis, px: positions.at(-1) } : null;
}

const px = (position) => (position === "0" ? 0 : /^-?\d+(?:\.\d+)?px$/.test(position ?? "") ? parseFloat(position) : null);

// A stop position as { value, unit } for 0, px and %, or null for one that cannot be compared.
const at = (position) => {
  if (position === undefined || position === null) return null;
  if (position === "0") return { value: 0, unit: "px" };
  const m = /^(-?\d+(?:\.\d+)?)(px|%)$/.exec(position);
  return m ? { value: parseFloat(m[1]), unit: m[2] } : null;
};
// Whether the gradient jumps straight from one stop to the next: a later stop at or before an
// earlier one's position takes that position, so nothing is drawn between them.
const hard = (a, b) => a !== null && b !== null && a.unit === b.unit && b.value <= a.value;

// Points sampled between two stops. Luminance along an sRGB segment is convex, so its darkest
// point can lie between the stops, where text over it is least legible; 16 steps find it closely.
const STEPS = 16;

const encode = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
// sRGB hex for an OKLab color, clipped to the sRGB gamut, as a browser paints it.
function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return toHex(
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  );
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const CLEAR = { hex: "#000000", alpha: 0 };

// The color t of the way from a to b, interpolated with premultiplied alpha in sRGB or OKLab.
function between(a, b, t, space) {
  const alpha = a.alpha + (b.alpha - a.alpha) * t;
  if (alpha <= 0) return null;
  const [x, y] = space === "oklab" ? [oklab(a.hex), oklab(b.hex)] : [rgbOf(a.hex), rgbOf(b.hex)];
  const mixed = x.map((v, i) => (v * a.alpha + (y[i] * b.alpha - v * a.alpha) * t) / alpha);
  return { hex: space === "oklab" ? fromOklab(mixed) : toHex(...mixed), alpha };
}

/**
 * Every color a list of stops ({ color, at }) paints: the stops and points sampled between each
 * pair that is not a hard edge, in sRGB and, when a stop is not a legacy sRGB color, also in
 * OKLab, the space a browser then interpolates in.
 */
function stopFills(stops) {
  const spaces = stops.some((s) => s.color?.modern) ? ["srgb", "oklab"] : ["srgb"];
  const out = new Map();
  const add = (c) => {
    if (c && c.alpha > 0) out.set(`${c.hex}/${Math.round(c.alpha * 1000)}`, { hex: c.hex, alpha: c.alpha });
  };
  stops.forEach((s, i) => {
    add(s.color);
    const next = stops[i + 1];
    if (!next || hard(s.at, next.at)) return;
    const [a, b] = [s.color ?? CLEAR, next.color ?? CLEAR];
    for (const space of spaces) for (let k = 1; k < STEPS; k++) add(between(a, b, k / STEPS, space));
  });
  return [...out.values()];
}

/**
 * The colors one gradient value paints over an area, as [{hex, alpha}], or null when a color
 * cannot be evaluated: every stop, every band, repeating or not, and the colors between stops.
 * The one exception is a hard band of at most 2px at the start of a linear gradient painted once,
 * such as a header's bottom rule: a drawn edge at the box's border, which no line of text reaches. `once` says the value is painted once over the whole box, at size auto.
 */
export function gradientFills(value, { once = false } = {}) {
  const fn = args(value);
  if (!fn || !GRADIENT_FUNCTIONS.has(fn.name) || fn.rest.trim()) return null;
  const stops = [];
  for (const arg of fn.args) {
    const s = stop(arg);
    if (s === null) continue;
    if (s.color === undefined) return null;
    for (const position of s.positions.length ? s.positions : [null]) stops.push({ color: s.color, at: at(position) });
  }
  let first = 0;
  if (fn.name === "linear-gradient" && once) {
    let end = 0;
    while (end + 1 < stops.length && stops[end + 1].color === stops[0].color) end++;
    const edge = stops[end].at;
    const leads = stops.slice(0, end).every((s) => s.at === null || s.at.value === 0);
    if (stops[0].color && leads && edge?.unit === "px" && edge.value <= 2 && end + 1 < stops.length && hard(edge, stops[end + 1].at)) first = end + 1;
  }
  return stopFills(stops.slice(first));
}

/** The colors a resolved layer paints over an area, or null when they cannot be evaluated. */
export function layerFills(layer) {
  if (layer.kind === "gradient") return stopFills(layer.stops.map((s) => ({ color: { hex: s.color, alpha: layer.opacity }, at: { value: s.position, unit: "%" } })));
  // Patterns are hairlines and small dots, at most 0.2 opaque by the schema; they still count.
  if (layer.kind === "pattern") return [{ hex: layer.color, alpha: layer.opacity }];
  if (layer.kind === "gradientCss") return gradientFills(layer.value, { once: (layer.size ?? "auto") === "auto" });
  return null;
}

const over = (top, base) => {
  const [t, b] = [rgbOf(top.hex), rgbOf(base)];
  return toHex(...t.map((v, i) => v * top.alpha + b[i] * (1 - top.alpha)));
};

// Distinct backgrounds a stack of layers may show before the check gives up and fails closed.
const MAX_BACKGROUNDS = 50000;

// The lowest contrast of any text color over any stack of one fill (or none) from each layer, or
// null when the stack has too many distinct backgrounds to check.
function worstContrast(base, fills, texts) {
  let backgrounds = [base];
  for (const layer of fills) {
    const next = new Set(backgrounds);
    for (const bg of backgrounds) for (const fill of layer) next.add(over(fill, bg));
    if (next.size > MAX_BACKGROUNDS) return null;
    backgrounds = [...next];
  }
  let worst = Infinity;
  for (const bg of backgrounds) for (const text of texts) worst = Math.min(worst, contrast(text, bg));
  return worst;
}

// ---- Plan ----

/**
 * What the structured layers draw for this resolution and these preferences, before any CSS:
 * { effective, page, header, banner, avatar, fonts, typography, notes }. A paint is
 * { color, layers: [css parts], dropped } with dropped naming why requested layers are not drawn.
 */
export function structuredPlan(resolved, prefs) {
  const effective = structuredEffective(resolved, prefs);
  const notes = [];
  const empty = { effective, page: null, header: null, banner: null, avatar: null, fonts: null, typography: null, notes };
  if (!effective.on) return empty;
  const a = resolved.appearance;
  const t = resolved.tokens;

  const paint = (target, base, texts) => {
    const source = a.paints[target];
    if (!source) return null;
    const color = HEX.test(source.color ?? "") ? source.color : base;
    if (!effective.decorative || !source.layers.length) return { color, layers: [], dropped: source.layers.length ? (effective.full ? "effects-off" : "calm") : null };
    const parts = source.layers.map(layerCss);
    if (parts.some((p) => p === null)) notes.push({ code: "deferred-capability", path: `/backgrounds/${target}`, message: "Image layers arrive in a later version; the other layers are drawn." });
    const drawn = source.layers.filter((_, i) => parts[i] !== null);
    // Text drawn straight on the paint must keep its contrast over every fill of every layer.
    if (texts.length) {
      const fills = drawn.map(layerFills);
      const worst = fills.some((f) => f === null) ? null : worstContrast(color, fills, texts);
      if (worst === null) {
        notes.push({ code: "paint-unverified", path: `/backgrounds/${target}`, message: "A paint color could not be checked against the text over it, so the layers are not drawn." });
        return { color, layers: [], dropped: "unverified" };
      }
      if (worst < 4.5) {
        notes.push({ code: "paint-contrast", path: `/backgrounds/${target}`, message: "Text over these layers would fall below 4.5:1, so they are not drawn." });
        return { color, layers: [], dropped: "contrast" };
      }
    }
    return { color, layers: parts.filter(Boolean), dropped: null };
  };

  const page = paint("page", a.colors.page?.background ?? t.canvas, [t.text, t.mutedText, t.link]);
  const header = paint("header", a.colors.header?.background ?? t.inset, [a.colors.header?.text ?? t.mutedText]);
  // The banner is a decorative region of its own with no text, and only Full draws it.
  const bannerPaint = a.paints.profileBanner && effective.decorative ? paint("profileBanner", a.paints.profileBanner.color ?? t.surface, []) : null;
  const banner = bannerPaint && (bannerPaint.layers.length || a.paints.profileBanner.color) ? bannerPaint : null;

  let avatar = null;
  if (a.shape.avatar) {
    const frame = a.shape.avatar.frame;
    const style = frame && frame.width > 0 ? (frame.style === "neon" && !effective.decorative ? "solid" : frame.style) : "none";
    avatar = { shape: a.shape.avatar.shape, frame: frame ? { style, width: frame.width, color: frame.color } : null };
  }

  let fonts = null;
  let typography = null;
  if (effective.fonts) {
    const stack = (role) => {
      if (role.source === "bundled") return `"${FONT_BY_ID[role.id].cssFamily}", ${role.fallback ?? FONT_BY_ID[role.id].fallback}`;
      if (role.source === "native-stack") return role.fallback;
      return null;
    };
    const heading = stack(a.fonts.heading);
    const body = stack(a.fonts.body);
    if (heading || body) fonts = { heading, body };
    const ty = a.typography;
    if (ty && (ty.uppercaseHeadings || ty.headingLetterSpacing || ty.bodyLetterSpacing)) typography = { ...ty };
  }
  return { effective, page, header, banner, avatar, fonts, typography, notes };
}

// ---- CSS ----

// Viewport units in a layer size as px of the given viewport. The preview's frame grows to fit
// its whole page, so there 100vh would be the page's height, not the screen's.
const atViewport = (size, viewport) =>
  viewport ? size.replace(/(\d+(?:\.\d+)?)(vh|vw)\b/g, (_, n, unit) => `${num((Number(n) * (unit === "vh" ? viewport.height : viewport.width)) / 100)}px`) : size;

function paintRule(selector, paint, mark, viewport) {
  const decl = [`background-color:${paint.color}`];
  if (paint.layers.length) {
    decl.push(
      `background-image:${paint.layers.map((l) => l.image).join(",")}`,
      `background-size:${paint.layers.map((l) => atViewport(l.size, viewport)).join(",")}`,
      `background-repeat:${paint.layers.map((l) => l.repeat).join(",")}`,
      `background-position:${paint.layers.map((l) => l.position).join(",")}`,
      "background-attachment:scroll",
    );
  } else decl.push("background-image:none");
  return `${selector}{${decl.map((d) => d + mark).join(";")}}`;
}

const AVATAR_SHAPE = {
  circle: ["border-radius:50%"],
  square: ["border-radius:0"],
  rounded: ["border-radius:16%"],
  // Bevel needs corner-shape; without it the avatar is square, never a clipped approximation.
  bevel: ["border-radius:0"],
  arch: ["border-radius:50% 50% 0 0/40% 40% 0 0"],
};

function avatarRules(avatar, canvas, mark) {
  const selector = list(SURFACES.avatar);
  const rules = [`${selector}{${AVATAR_SHAPE[avatar.shape].map((d) => d + mark).join(";")}}`];
  if (avatar.shape === "bevel") rules.push(`@supports (corner-shape:bevel){${selector}{border-radius:16%${mark};corner-shape:bevel${mark}}}`);
  const f = avatar.frame;
  if (f) {
    const w = num(f.width);
    const shadow = {
      none: "none",
      solid: `0 0 0 ${w}px ${f.color}`,
      double: `0 0 0 1px ${f.color},0 0 0 ${num(f.width + 1)}px ${canvas},0 0 0 ${num(f.width + 2)}px ${f.color}`,
      neon: `0 0 0 ${w}px ${f.color},0 0 12px ${rgba(f.color, 0.55)}`,
    }[f.style];
    rules.push(`${selector}{box-shadow:${shadow}${mark}}`);
  }
  return rules;
}

/**
 * The structured appearance CSS for one target. Both targets emit the same declarations; github
 * marks them !important so GitHub's own rules cannot undo a paint, a shape or a role. `viewport`
 * ({width, height} in px) resolves viewport units for a host whose document is not the screen.
 */
export function structuredCss(plan, resolved, target, viewport = null) {
  if (!plan.effective.on) return "";
  const mark = target === "github" ? "!important" : "";
  const rules = [];
  if (plan.page) {
    rules.push(paintRule(list([SURFACES.page]), plan.page, mark, viewport));
    // Panels that hold reading text stay opaque over the page's layers.
    if (plan.page.layers.length) rules.push(`:where(${SURFACES.reading.join(",")}):where(${GUARD}){background-color:var(--bgColor-default,${resolved.tokens.canvas})}`);
  }
  if (plan.header) rules.push(paintRule(list(SURFACES.header), plan.header, mark, viewport));
  if (plan.banner) rules.push(paintRule(`${SURFACES.banner}[data-reskin-owned]`, plan.banner, mark, viewport));
  if (plan.avatar) rules.push(...avatarRules(plan.avatar, resolved.tokens.canvas, mark));

  const notAuthored = `:not(${SURFACES.authored.map((s) => `${s} *`).join(",")})`;
  const headings = SURFACES.headings.map((s) => `${s}${notAuthored}${GUARD}`).join(",");
  const chrome = list(SURFACES.headingChrome);
  const ty = plan.typography;
  if (plan.fonts?.heading) rules.push(`${headings},${chrome}{font-family:${plan.fonts.heading}${mark}}`);
  if (ty?.headingLetterSpacing) rules.push(`${headings},${chrome}{letter-spacing:${num(ty.headingLetterSpacing)}em${mark}}`);
  if (ty?.uppercaseHeadings) rules.push(`${headings}{text-transform:uppercase${mark}}`);
  if (plan.fonts?.body) rules.push(`${list([SURFACES.page])}{font-family:${plan.fonts.body}${mark}}`);
  if (ty?.bodyLetterSpacing) rules.push(`${list([SURFACES.page])}{letter-spacing:${num(ty.bodyLetterSpacing)}em${mark}}`);

  // What a role passes down stops at every boundary below it: a mode island, native and protected
  // UI keep GitHub's sans, tracking and case, and code, diff and editor text keep their tracking
  // and case. The resets have no specificity and no !important, so GitHub's own rules for these
  // elements still win; they only replace what would otherwise be inherited.
  const code = SURFACES.code.join(",");
  const boundary = `:where(${ATTRIBUTED},[data-reskin-native],[data-reskin-protected]):where(:not(${code}))`;
  const family = `font-family:var(--fontStack-sansSerif,${GITHUB_SANS})`;
  const reset = (scope, subjects, declarations) => declarations.length && rules.push(`${scope}${subjects}{${declarations.join(";")}}`);
  const under = `:where(${headings},${chrome}) `;
  reset(under, boundary, [plan.fonts?.heading && family, ty?.headingLetterSpacing && "letter-spacing:normal", ty?.uppercaseHeadings && "text-transform:none"].filter(Boolean));
  reset(under, `:where(${code})`, [ty?.headingLetterSpacing && "letter-spacing:normal", ty?.uppercaseHeadings && "text-transform:none"].filter(Boolean));
  reset("", boundary, [plan.fonts?.body && family, ty?.bodyLetterSpacing && "letter-spacing:normal"].filter(Boolean));
  reset("", `:where(${code})`, [ty?.bodyLetterSpacing && "letter-spacing:normal"].filter(Boolean));
  return rules.length ? `${THEMED}{\n${rules.join("\n")}\n}` : "";
}
