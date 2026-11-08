// mountPreview: the one reusable preview for the extension UI, the userscript, the site and the
// films. It renders the inert fixture in a sandboxed same-origin frame (no scripts run inside),
// so GitHub-shaped CSS and the host page's CSS cannot reach each other, and paints it with the
// same resolver, Primer compiler and appearance code as github.com: native mode CSS first, then
// the compiled theme, then owned decoration.
import { PREVIEW_VIEWS, RENDERER_VERSION } from "../contracts/index.js";
import { repairTheme, resolveTheme } from "../engine/index.js";
import { validateTheme } from "../format/index.js";
import { compileAppearance, fontFaceCss, mountAppearance, noResources } from "../appearance/index.js";
import { FIXTURE_CSS } from "./styles.js";
import { VIEWS, builder } from "./views.js";

// Slots without evidence on current GitHub markup stay dormant in the preview too, so it never
// demonstrates something the extension cannot do. C3's slot evidence decides; hosts pass the
// current list to configurePreview.
export const DEFAULT_DORMANT_SLOTS = Object.freeze(["profile.activity.heading", "profile.organizations.heading", "empty.issues.caption"]);
export const VIEW_LABELS = Object.freeze({ profile: "GitHub profile", repo: "GitHub repository", diff: "GitHub file changes", empty: "GitHub empty states", 404: "GitHub page not found" });

let runtime = null;

/**
 * Supplies what differs per host: the Primer adapter module (selectMode, compileGitHub), the
 * frozen ModeIndex, the resource adapter for fonts and fixture images, and the dormant slots.
 * Call once before mountPreview.
 */
export function configurePreview({ primer, modeIndex, resources = noResources, dormantSlots = DEFAULT_DORMANT_SLOTS }) {
  if (typeof primer?.selectMode !== "function" || typeof primer?.compileGitHub !== "function") throw new TypeError("configurePreview needs the Primer adapter's selectMode and compileGitHub");
  if (modeIndex?.contractVersion !== 1 || !modeIndex.modes || !modeIndex.nativeCss) throw new TypeError("configurePreview needs the frozen ModeIndex");
  if (typeof resources?.fontUrl !== "function" || typeof resources?.assetUrl !== "function") throw new TypeError("configurePreview needs a resource adapter");
  for (const base of ["light", "dark"]) if (!standardMode(modeIndex, base)) throw new TypeError(`The ModeIndex has no standard ${base} mode`);
  runtime = Object.freeze({ primer, modeIndex, resources, dormantSlots: Object.freeze([...dormantSlots]) });
}

// The preview shows GitHub's standard mode of the theme's own base: the plain light or dark mode.
function standardMode(index, base) {
  const ids = Object.keys(index.modes)
    .filter((id) => index.modes[id].base === base && index.modes[id].family === "standard" && !index.modes[id].highContrast)
    .sort();
  return ids.includes(base) ? base : (ids[0] ?? null);
}

function checkOptions({ theme, preferences }) {
  const result = validateTheme(theme);
  if (!result.ok) throw new TypeError(`The preview needs a valid theme: ${(result.issues || []).map((i) => i.message).join("; ")}`);
  for (const key of ["enabled", "extras", "text", "motion", "fonts", "effects"]) if (typeof preferences?.[key] !== "boolean") throw new TypeError(`preferences.${key} must be a boolean`);
}

const LAYERS = ["fixture", "native", "theme", "fonts", "appearance"];
const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8">${LAYERS.map((name) => `<style data-layer="${name}"></style>`).join("")}</head><body></body></html>`;

/**
 * Paints the fixture into any document: the preview's frame, a test page or a build-time DOM.
 * The document gets the fixture's five style layers in its head and the view as its body.
 * paint(state, { play }) applies { view, theme, preferences, before }; it resolves only when the
 * theme or preferences changed, and plays motion only when asked to for an explicit selection.
 * Returns the painted result: { resolved, plan, sourceRepairs, compiled, owned }.
 */
export function createFixtureRenderer(fdoc, rt = runtime) {
  if (!rt) throw new Error("Call configurePreview before rendering the fixture");
  const win = fdoc.defaultView;
  for (const name of LAYERS) {
    if (fdoc.head.querySelector(`style[data-layer="${name}"]`)) continue;
    const style = fdoc.createElement("style");
    style.setAttribute("data-layer", name);
    fdoc.head.append(style);
  }
  const layer = (name) => fdoc.head.querySelector(`style[data-layer="${name}"]`);
  layer("fixture").textContent = FIXTURE_CSS;
  let decoration = null;
  let cacheKey = null;
  let cached = null;

  function resolve(state) {
    const { modeIndex: index, primer } = rt;
    const base = state.theme.base;
    const native = { colorMode: base, lightTheme: standardMode(index, "light"), darkTheme: standardMode(index, "dark"), systemDark: base === "dark" };
    const plan = primer.selectMode(native, base, index);
    const repaired = repairTheme(state.theme, index.modes[standardMode(index, base)]);
    const resolved = resolveTheme(repaired.theme, {
      seed: plan.seedMode ? index.modes[plan.seedMode] : null,
      policy: plan.policy,
      reducedMotion: Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
      forcedColors: Boolean(win?.matchMedia?.("(forced-colors: active)").matches),
    });
    return { native, plan, resolved, sourceRepairs: repaired.repairs };
  }

  return {
    paint(state, { play = false } = {}) {
      const key = JSON.stringify([state.theme, state.preferences]);
      if (key !== cacheKey) {
        cached = resolve(state);
        cacheKey = key;
      }
      const { native, plan, resolved, sourceRepairs } = cached;
      const prefs = state.preferences;
      const themed = prefs.enabled && !state.before && resolved.policy === "themed";
      const root = fdoc.documentElement;
      root.setAttribute("data-color-mode", native.colorMode);
      root.setAttribute("data-light-theme", native.lightTheme);
      root.setAttribute("data-dark-theme", native.darkTheme);
      layer("native").textContent = rt.modeIndex.nativeCss[plan.seedMode ?? standardMode(rt.modeIndex, state.theme.base)] ?? "";
      const compiled = themed ? rt.primer.compileGitHub(resolved, plan, prefs) : null;
      layer("theme").textContent = compiled?.css ?? "";
      layer("appearance").textContent = themed ? compileAppearance(resolved, prefs, "preview") : "";
      // Only the selected face gets a rule, so only that one file can load.
      const fontUrl = themed && prefs.extras && prefs.fonts && resolved.font !== "system" ? rt.resources.fontUrl(resolved.font) : null;
      layer("fonts").textContent = fontUrl ? fontFaceCss(resolved.font, fontUrl) : "";

      decoration?.destroy();
      decoration = null;
      const built = VIEWS[state.view](builder(fdoc, rt.resources, state.theme.base));
      fdoc.body.replaceChildren(built.root);
      if (themed) {
        decoration = mountAppearance(fdoc.body, resolved, prefs, built.anchors.filter((anchor) => !rt.dormantSlots.includes(anchor.slot)));
        if (play) decoration.play();
      }
      return { resolved, plan, sourceRepairs, compiled, owned: decoration?.owned ?? 0 };
    },
    destroy() {
      decoration?.destroy();
      decoration = null;
      fdoc.body.replaceChildren();
      for (const name of LAYERS) layer(name).textContent = "";
    },
  };
}

/**
 * Mounts the preview into container. Returns { update, setView, setBefore, destroy }. update and
 * mountPreview throw for an invalid theme and keep the last valid preview.
 */
export function mountPreview(container, options) {
  if (!runtime) throw new Error("Call configurePreview before mountPreview");
  if (container?.nodeType !== 1) throw new TypeError("mountPreview needs a container element");
  if (!PREVIEW_VIEWS.includes(options?.view)) throw new TypeError(`Unknown preview view ${options?.view}`);
  checkOptions(options);
  const rt = runtime;
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const state = { view: options.view, theme: options.theme, preferences: options.preferences, before: false };

  const host = doc.createElement("div");
  host.className = "reskin-preview";
  host.setAttribute("data-reskin-preview", "");
  host.style.cssText = "display:block;position:relative;width:100%;min-width:0";
  const frame = doc.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("tabindex", "-1");
  frame.setAttribute("scrolling", "no");
  frame.title = `Interactive preview: ${VIEW_LABELS[state.view]}`;
  frame.style.cssText = "display:block;width:100%;height:320px;border:0;background:transparent";
  frame.srcdoc = SHELL;
  host.append(frame);
  container.append(host);

  let fdoc = null;
  let renderer = null;
  let destroyed = false;
  let measureFrame = 0;
  const measure = () => {
    if (!fdoc || destroyed) return;
    const height = Math.ceil(fdoc.documentElement.getBoundingClientRect().height);
    if (height && frame.style.height !== `${height}px`) frame.style.height = `${height}px`;
  };
  const remeasure = () => {
    win.cancelAnimationFrame(measureFrame);
    measureFrame = win.requestAnimationFrame(measure);
  };
  const resizes = new win.ResizeObserver(remeasure);

  function paint(options) {
    if (!renderer || destroyed) return;
    const { resolved, compiled, owned, sourceRepairs } = renderer.paint(state, options);
    frame.title = `Interactive preview: ${VIEW_LABELS[state.view]}`;
    host.setAttribute("data-view", state.view);
    host.setAttribute("data-before", String(state.before));
    host.setAttribute("data-policy", resolved.policy);
    host.setAttribute("data-renderer", String(RENDERER_VERSION));
    host.setAttribute("data-source-hash", resolved.sourceHash);
    host.setAttribute("data-seed-hash", resolved.seedHash ?? "");
    host.setAttribute("data-fingerprint", compiled?.fingerprint ?? "");
    host.setAttribute("data-owned-nodes", String(owned));
    resizes.observe(fdoc.documentElement);
    remeasure();
    options?.onState?.({ policy: resolved.policy, repairs: Object.freeze([...sourceRepairs, ...resolved.repairs]) });
  }

  const onLoad = () => {
    if (destroyed || fdoc) return;
    fdoc = frame.contentDocument;
    renderer = createFixtureRenderer(fdoc, rt);
    // Images and fonts change the height after paint; the frame grows to fit and never scrolls.
    fdoc.addEventListener("load", remeasure, true);
    fdoc.fonts?.addEventListener?.("loadingdone", remeasure);
    paint({ onState: options.onState });
  };
  frame.addEventListener("load", onLoad);
  resizes.observe(host);

  return {
    update(next) {
      if (destroyed) return;
      checkOptions(next);
      const selected = JSON.stringify(next.theme) !== JSON.stringify(state.theme);
      state.theme = next.theme;
      state.preferences = next.preferences;
      // A newly selected theme is an explicit selection: its one pass of motion may play.
      paint({ play: selected, onState: options.onState });
    },
    setView(view) {
      if (destroyed) return;
      if (!PREVIEW_VIEWS.includes(view)) throw new TypeError(`Unknown preview view ${view}`);
      state.view = view;
      paint();
    },
    setBefore(before) {
      if (destroyed) return;
      state.before = Boolean(before);
      paint();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      renderer?.destroy();
      resizes.disconnect();
      win.cancelAnimationFrame(measureFrame);
      frame.removeEventListener("load", onLoad);
      host.remove();
    },
  };
}
