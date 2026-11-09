// Structured appearance on GitHub's own page: the page, profile-banner and header paints, opaque
// backings under reading panels, avatar shape and frame, and the heading/body type roles. Colors
// of GitHub's elements, buttons, borders, radii and shadows on GitHub elements, the graph, labels
// and syntax belong to the Primer adapter; this file draws only the layers listed here, from the
// engine's resolved appearance record, never from theme strings other than admitted gradientCss.
//
// Full draws every requested layer. Calm keeps the solid page and header colors, simple avatar
// corners and the role fonts, and drops paint layers, the banner, neon frames and every glow.
// Effects off drops the same decoration inside Full. Fonts off removes both roles, tracking and
// case. Native, high-contrast and forced-color resolutions get nothing.
import { contrast } from "../engine/color.js";
import { FONT_BY_ID, SYSTEM_SANS } from "./registry.js";
import { num, rgba } from "./effects.js";

const HEX = /^#[0-9a-f]{6}$/;

// GitHub's elements this file styles. The preview fixture uses the same class names, so both
// targets share one selector list. Each selector also steps out of native and protected islands.
export const GUARD = ":not([data-reskin-native],[data-reskin-native] *,[data-reskin-protected],[data-reskin-protected] *)";
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
  code: ["pre", "code", "kbd", "samp", "tt", "textarea", ".blob-code", ".blob-num", ".diff-table", ".react-code-text", ".react-code-lines", ".cm-editor", ".CodeMirror"],
  // Authored prose: a heading inside it is the author's, so the heading role does not reach it.
  authored: [".markdown-body", ".comment-body", ".js-comment-body"],
});

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
    // Premultiplied mixing, as color-mix() interpolates with alpha.
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [ra, rb] = [rgb(ca.hex), rgb(cb.hex)];
    return { hex: toHex(...ra.map((v, i) => (v * ca.alpha * pa + rb[i] * cb.alpha * pb) / alpha)), alpha };
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

/**
 * The colors one gradient value paints over an area, as [{hex, alpha}], or null when a color
 * cannot be evaluated. A hard band of at most 2px is a drawn rule, not a fill, and is left out:
 * text crossing a hairline stays legible, and rules carry no text.
 */
export function gradientFills(value) {
  const fn = args(value);
  if (!fn || !GRADIENT_FUNCTIONS.has(fn.name) || fn.rest.trim()) return null;
  const stops = [];
  for (const arg of fn.args) {
    const s = stop(arg);
    if (s === null) continue;
    if (s.color === undefined) return null;
    stops.push(s);
  }
  const fills = [];
  stops.forEach((s, i) => {
    if (s.color === null) return;
    const end = px(s.positions.at(-1));
    const start = s.positions.length === 2 ? px(s.positions[0]) : i === 0 ? 0 : px(stops[i - 1].positions.at(-1));
    const next = px(stops[i + 1]?.positions[0]);
    const band = end !== null && start !== null && next !== null && next === end && end - start <= 2;
    if (!band) fills.push(s.color);
  });
  return fills;
}

/** The colors a resolved layer paints over an area, or null when they cannot be evaluated. */
export function layerFills(layer) {
  if (layer.kind === "gradient") return layer.stops.map((s) => ({ hex: s.color, alpha: layer.opacity }));
  // Patterns are hairlines and small dots, at most 0.2 opaque by the schema; they still count.
  if (layer.kind === "pattern") return [{ hex: layer.color, alpha: layer.opacity }];
  if (layer.kind === "gradientCss") return gradientFills(layer.value);
  return null;
}

const over = (top, base) => {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [t, b] = [rgb(top.hex), rgb(base)];
  return toHex(...t.map((v, i) => v * top.alpha + b[i] * (1 - top.alpha)));
};

// The lowest contrast of any text color over any stack of one fill (or none) from each layer.
function worstContrast(base, fills, texts) {
  let backgrounds = [base];
  for (const layer of fills) {
    const next = new Set(backgrounds);
    for (const bg of backgrounds) for (const fill of layer) next.add(over(fill, bg));
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
      if (fills.some((f) => f === null)) {
        notes.push({ code: "paint-unverified", path: `/backgrounds/${target}`, message: "A paint color could not be checked against the text over it, so the layers are not drawn." });
        return { color, layers: [], dropped: "unverified" };
      }
      if (worstContrast(color, fills, texts) < 4.5) {
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
  if (plan.fonts?.body || ty?.bodyLetterSpacing) {
    // Islands and protected UI keep GitHub's own type, and code keeps its native metrics.
    rules.push(`:is([data-reskin-native],[data-reskin-protected]){font-family:var(--fontStack-sansSerif,${SYSTEM_SANS})${mark};letter-spacing:normal${mark}}`);
    rules.push(`:is(${SURFACES.code.join(",")}){letter-spacing:normal${mark}}`);
  }
  return rules.join("\n");
}
