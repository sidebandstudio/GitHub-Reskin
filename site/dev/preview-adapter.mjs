// TEMPORARY site-owned preview adapter. It implements the frozen PreviewOptions/PreviewHandle
// contract (spec ARCHITECTURE.md, packages/contracts theme-engine.d.ts) over the site's own
// pre-rendered fixture markup, so the shell can be built before C5's preview and C2's resolver
// exist. Its color derivation is a rough stand-in, not the shared engine: no Primer seeds, no pair
// audit, no accessibility modes. Never ships; site/checks.mjs --production rejects ADAPTER_ID.

export const ADAPTER_ID = "reskin-dev-adapter";

export const VIEWS = Object.freeze(["profile", "repo", "diff", "empty", "404"]);

export const DEFAULT_PREFERENCES = Object.freeze({ enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true });

// Slots the site fixture does not demonstrate until C3's evidence enables them (site-fixture README).
export const DORMANT_SLOTS = Object.freeze(["profile.activity.heading", "profile.organizations.heading"]);

// GitHub's default colors for each base, used for Before and for a disabled theme.
const NATIVE = {
  dark: {
    canvas: "#0d1117", surface: "#151b23", inset: "#010409", raised: "#212830", hover: "#262c36", text: "#f0f6fc",
    muted: "#9198a1", link: "#4493f8", border: "#3d444d", controlBorder: "#656c76", accent: "#4493f8", accentMuted: "#15233a",
    primaryBg: "#238636", primaryText: "#ffffff", focus: "#1f6feb", success: "#3fb950", danger: "#f85149", warning: "#d29922",
    graph: ["#151b23", "#033a16", "#196c2e", "#2ea043", "#56d364"],
    addBg: "#12261e", addWord: "#1d4428", delBg: "#25171c", delWord: "#5c2328", codeBg: "#151b23",
    synKeyword: "#ff7b72", synString: "#a5d6ff", synComment: "#9198a1", synFunction: "#d2a8ff", synNumber: "#79c0ff",
  },
  light: {
    canvas: "#ffffff", surface: "#f6f8fa", inset: "#f6f8fa", raised: "#ffffff", hover: "#eff2f5", text: "#1f2328",
    muted: "#59636e", link: "#0969da", border: "#d1d9e0", controlBorder: "#818b98", accent: "#0969da", accentMuted: "#ddf4ff",
    primaryBg: "#1f883d", primaryText: "#ffffff", focus: "#0969da", success: "#1a7f37", danger: "#d1242f", warning: "#9a6700",
    graph: ["#eff2f5", "#aceebb", "#4ac26b", "#2da44e", "#116329"],
    addBg: "#dafbe1", addWord: "#aceebb", delBg: "#ffebe9", delWord: "#ffcecb", codeBg: "#f6f8fa",
    synKeyword: "#cf222e", synString: "#0a3069", synComment: "#59636e", synFunction: "#8250df", synNumber: "#0550ae",
  },
};

// Native fallbacks for each accent font ID. The fonts themselves arrive with C5; nothing is fetched.
const FONT_STACKS = {
  system: "system-ui, sans-serif",
  rajdhani: '"Rajdhani", "Arial Narrow", system-ui, sans-serif',
  "barlow-condensed": '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif',
  fraunces: '"Fraunces", Georgia, serif',
  alegreya: '"Alegreya", Georgia, serif',
  "cormorant-garamond": '"Cormorant Garamond", Garamond, Georgia, serif',
  "josefin-sans": '"Josefin Sans", system-ui, sans-serif',
  bungee: '"Bungee", Impact, system-ui, sans-serif',
  "space-grotesk": '"Space Grotesk", system-ui, sans-serif',
};

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
/** Mixes a toward b by t in sRGB. */
export const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two hex colors. */
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// Moves fg toward the readable end until it reaches min against every background in bg.
const ensure = (fg, bg, min, toward) => {
  const backgrounds = [bg].flat();
  const ok = (color) => backgrounds.every((b) => contrast(color, b) >= min);
  let out = fg;
  for (let t = 0.05; !ok(out) && t <= 1.001; t += 0.05) out = mix(fg, toward, t);
  return out;
};

// Rough readability pass for text roles over the surfaces the fixture puts them on.
function readable(c) {
  const ink = luminance(c.canvas) < 0.2 ? "#ffffff" : "#000000";
  const panels = [c.canvas, c.surface];
  const code = [c.canvas, c.addBg, c.delBg];
  return {
    ...c,
    muted: ensure(c.muted, [...panels, c.accentMuted, c.addBg, c.delBg, c.raised], 4.5, ink),
    link: ensure(c.link, [...panels, c.raised], 4.5, ink),
    success: ensure(c.success, panels, 4.5, ink),
    danger: ensure(c.danger, panels, 4.5, ink),
    synKeyword: ensure(c.synKeyword, code, 4.5, ink),
    synString: ensure(c.synString, code, 4.5, ink),
    synComment: ensure(c.synComment, code, 4.5, ink),
    synFunction: ensure(c.synFunction, code, 4.5, ink),
    synNumber: ensure(c.synNumber, code, 4.5, ink),
  };
}

// A diff row tint, lightened toward the canvas until the theme's text stays readable on it.
const diffBackground = (bg, tint, text) => {
  for (let t = 0.14; t > 0; t -= 0.02) if (contrast(text, mix(bg, tint, t)) >= 4.5) return mix(bg, tint, t);
  return bg;
};

function themedColors(theme) {
  const dark = theme.base === "dark";
  const native = NATIVE[theme.base];
  const o = theme.overrides || {};
  const bg = theme.colors.background;
  const text = theme.colors.text;
  const accent = theme.colors.accent;
  const contribution = theme.colors.contribution || accent;
  const ink = dark ? "#ffffff" : "#000000";
  const surface = o.surface || mix(bg, text, 0.05);
  const inset = o.inset || (dark ? mix(bg, "#000000", 0.35) : mix(bg, text, 0.03));
  const success = ensure(o.success || native.success, bg, 4.5, text);
  const danger = ensure(o.danger || native.danger, bg, 4.5, text);
  const primaryBg = o.primaryBackground || accent;
  const primaryText = o.primaryText || (contrast("#ffffff", primaryBg) >= contrast("#111111", primaryBg) ? "#ffffff" : "#111111");
  const levels = theme.contributions?.levels || [mix(bg, text, 0.1), mix(bg, contribution, 0.3), mix(bg, contribution, 0.55), mix(bg, contribution, 0.8), contribution];
  const codeBg = inset;
  const syntax = o.syntax || {};
  return {
    canvas: bg, surface, inset, raised: o.raised || mix(bg, text, 0.09), hover: o.hover || mix(bg, text, 0.13), text,
    muted: ensure(o.mutedText || mix(text, bg, 0.35), surface, 4.5, text),
    link: ensure(o.link || accent, surface, 4.5, text),
    border: o.border || mix(bg, text, 0.2),
    controlBorder: ensure(o.controlBorder || mix(bg, text, 0.4), bg, 3, ink),
    accent: ensure(accent, surface, 3, text), accentMuted: o.accentMuted || mix(bg, accent, 0.2),
    primaryBg, primaryText, focus: o.focus || accent, success, danger, warning: ensure(o.warning || native.warning, bg, 4.5, text),
    graph: levels,
    addBg: diffBackground(bg, success, text), addWord: mix(bg, success, 0.32), delBg: diffBackground(bg, danger, text), delWord: mix(bg, danger, 0.32), codeBg,
    synKeyword: ensure(syntax.keyword || mix(danger, accent, 0.4), codeBg, 4.5, text),
    synString: ensure(syntax.string || mix(text, accent, 0.45), codeBg, 4.5, text),
    synComment: ensure(syntax.comment || mix(text, bg, 0.4), codeBg, 4.5, text),
    synFunction: ensure(syntax.function || accent, codeBg, 4.5, text),
    synNumber: ensure(syntax.number || mix(accent, text, 0.3), codeBg, 4.5, text),
  };
}

const VAR_NAMES = {
  canvas: "canvas", surface: "surface", inset: "inset", raised: "raised", hover: "hover", text: "text", muted: "muted",
  link: "link", border: "border", controlBorder: "control-border", accent: "accent", accentMuted: "accent-muted",
  primaryBg: "primary-bg", primaryText: "primary-text", focus: "focus", success: "success", danger: "danger", warning: "warning",
  addBg: "add-bg", addWord: "add-word", delBg: "del-bg", delWord: "del-word", codeBg: "code-bg",
  synKeyword: "syn-keyword", synString: "syn-string", synComment: "syn-comment", synFunction: "syn-function", synNumber: "syn-number",
};

const EFFECT_PARAMS = {
  glow: (e) => ({ "fx-glow": e.strength }),
  grid: (e) => ({ "fx-grid-o": e.opacity, "fx-grid-s": `${e.size}px` }),
  scanlines: (e) => ({ "fx-scan-o": e.opacity, "fx-scan-s": `${e.spacing}px` }),
  paper: (e) => ({ "fx-paper-o": e.opacity, "fx-paper-s": e.scale ?? 1 }),
  rail: (e) => ({ "fx-rail-o": e.opacity, "fx-rail-t": `${e.thickness}px` }),
  rules: (e) => ({ "fx-rules-o": e.opacity, "fx-rules-s": `${e.spacing}px` }),
  orbit: (e) => ({ "fx-orbit-o": e.opacity }),
  seal: (e) => ({ "fx-seal-o": e.opacity, "fx-seal-s": `${e.size}px` }),
  drift: (e) => ({ "fx-drift-o": e.opacity, "fx-drift-d": `${e.durationMs}ms`, "fx-drift-x": `${e.distance}px` }),
  echo: (e) => ({ "fx-echo-o": e.opacity, "fx-echo-x": `${e.offset}px`, "fx-echo-d": `${e.durationMs}ms` }),
};
const EFFECT_SHAPE = { paper: "texture", rail: "shape", rules: "style", orbit: "shape", seal: "shape", drift: "shape" };

/**
 * The preview's static state for a theme: CSS variables, data attributes and flavor text.
 * @returns {{ vars: Record<string,string>, attrs: Record<string,string>, flavor: Record<string,string>, policy: 'themed' }}
 */
export function resolvePreview(theme, preferences = DEFAULT_PREFERENCES, { before = false, reducedMotion = false } = {}) {
  const prefs = { ...DEFAULT_PREFERENCES, ...preferences };
  const themed = !before && prefs.enabled;
  const colors = readable(themed ? themedColors(theme) : NATIVE[theme.base === "light" ? "light" : "dark"]);
  const vars = {};
  for (const [key, name] of Object.entries(VAR_NAMES)) vars[`--pv-${name}`] = colors[key];
  colors.graph.forEach((value, i) => (vars[`--pv-g${i}`] = value));
  const extras = themed && prefs.extras;
  const font = extras && prefs.fonts ? theme.fonts?.accent || "system" : "system";
  vars["--pv-accent-font"] = FONT_STACKS[font] || FONT_STACKS.system;

  const attrs = { "data-base": theme.base === "light" ? "light" : "dark", "data-state": themed ? "themed" : "native" };
  const effects = extras && prefs.effects ? theme.effects || {} : {};
  const ids = Object.keys(effects).filter((id) => EFFECT_PARAMS[id]);
  attrs["data-fx"] = ids.join(" ");
  attrs["data-motion"] = extras && prefs.motion && !reducedMotion ? "on" : "off";
  for (const id of ids) {
    for (const [name, value] of Object.entries(EFFECT_PARAMS[id](effects[id]))) vars[`--${name}`] = String(value);
    if (EFFECT_SHAPE[id]) attrs[`data-fx-${id}`] = effects[id][EFFECT_SHAPE[id]];
  }
  if (ids.includes("drift")) attrs["data-fx-drift-count"] = String(Math.min(12, effects.drift.count || 0));

  const flavor = {};
  if (extras && prefs.text && theme.flavor?.enabled !== false) {
    for (const [slot, text] of Object.entries(theme.flavor?.slots || {})) if (!DORMANT_SLOTS.includes(slot)) flavor[slot] = text;
  }
  return { vars, attrs, flavor, policy: "themed" };
}

/** CSS declarations for a resolved state, for a style attribute or rule. */
export const declarations = (vars) => Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";");

const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Mounts the preview on a container holding the site's pre-rendered fixture views
 * ([data-pv-view] panels and [data-slot] flavor nodes).
 * @param {HTMLElement} container
 * @param {{view:string, theme:object, preferences:object, onState?:Function}} options
 */
export function mountPreview(container, options) {
  if (!VIEWS.includes(options.view)) throw new Error(`Unknown preview view ${options.view}`);
  let { view, theme, preferences } = options;
  let before = false;
  let applied = [];
  container.dataset.adapter = ADAPTER_ID;

  function render() {
    const state = resolvePreview(theme, preferences, { before, reducedMotion: prefersReducedMotion() });
    for (const name of applied) container.style.removeProperty(name);
    applied = Object.keys(state.vars);
    for (const [name, value] of Object.entries(state.vars)) container.style.setProperty(name, value);
    for (const name of container.getAttributeNames()) if (name.startsWith("data-fx")) container.removeAttribute(name);
    for (const [name, value] of Object.entries(state.attrs)) container.setAttribute(name, value);
    for (const node of container.querySelectorAll("[data-slot]")) {
      const text = state.flavor[node.dataset.slot];
      node.textContent = text || "";
      node.hidden = !text;
    }
    for (const panel of container.querySelectorAll("[data-pv-view]")) panel.hidden = panel.dataset.pvView !== view;
    container.dataset.view = view;
    // Restart one-shot effect motion on every change.
    container.classList.remove("pv-fx-run");
    void container.offsetWidth;
    container.classList.add("pv-fx-run");
    options.onState?.({ policy: state.policy, repairs: [] });
  }

  render();
  return {
    update(next) {
      theme = next.theme;
      preferences = next.preferences;
      render();
    },
    setView(next) {
      if (!VIEWS.includes(next)) throw new Error(`Unknown preview view ${next}`);
      view = next;
      render();
    },
    setBefore(next) {
      before = Boolean(next);
      render();
    },
    destroy() {
      for (const name of applied) container.style.removeProperty(name);
      delete container.dataset.adapter;
      applied = [];
    },
  };
}

