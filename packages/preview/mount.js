// mountPreview: the one reusable preview for the extension UI, the userscript, the site and the
// films. A trusted controller in the host page resolves and compiles the theme with the same
// resolver, Primer compiler and appearance code as github.com, lays the fixture out in a hidden
// layout document that holds only trusted layers, and writes the result as one complete, safely
// serialized srcdoc. The styled document runs in a frame sandboxed without scripts or same-origin
// access, so it has an opaque origin; there is no message protocol with it, and the controller
// never reaches into it. Every coalesced update replaces that frame. View and Before/After
// controls stay in the host. Paint order: native mode CSS, then the compiled theme, then owned
// decoration.
import { PREVIEW_VIEWS, RENDERER_VERSION } from "../contracts/index.js";
import { repairTheme, resolveTheme } from "../engine/index.js";
import { escapeCssForHtml, validateTheme } from "../format/index.js";
import { FONT_BY_ID, compileAppearance, fontFaceCss, mountAppearance, noResources } from "../appearance/index.js";
import { motionMs } from "../appearance/effects.js";
import { LIMITS } from "../appearance/registry.js";
import { fixtureBody, serializeFixture } from "./serialize.js";
import { FIXTURE_CSS } from "./styles.js";
import { variableDeclarations } from "./variables.js";
import { VIEWS, builder } from "./views.js";

// Slots without evidence on current GitHub markup stay dormant in the preview too, so it never
// demonstrates something the extension cannot do. C3's slot evidence decides (its dormantSlots());
// hosts pass the current list to configurePreview. The capture has no Contribution activity
// section, so that slot has no anchor in the profile view.
export const DEFAULT_DORMANT_SLOTS = Object.freeze(["empty.issues.caption"]);
export const VIEW_LABELS = Object.freeze({ profile: "GitHub profile", repo: "GitHub repository", diff: "GitHub file changes", empty: "GitHub empty states", 404: "GitHub page not found" });
// The styled frame's sandbox grants nothing: no scripts, no same-origin access, no forms,
// popups or navigation of the host.
export const PREVIEW_SANDBOX = "";

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

/**
 * GitHub's native stylesheet for one mode, as a rule on the document root. The ModeIndex stores
 * each mode's native CSS as a declaration list without a selector, and only for the variables
 * the Primer compiler does not write itself; the variables the fixture reads, which the compiler
 * does write, take the mode's frozen seed colors, which record GitHub's own values for them.
 */
export function nativeBaseline(index, modeId) {
  const declarations = index.nativeCss[modeId];
  const seed = index.modes[modeId];
  if (typeof declarations !== "string" || !declarations || /[{}<]/.test(declarations) || !["light", "dark"].includes(seed?.base)) throw new Error(`The ModeIndex has no usable native CSS for ${modeId}`);
  return `:root{color-scheme:${seed.base};${declarations};${variableDeclarations(seed.colors)}}`;
}

function checkOptions({ theme, preferences }) {
  const result = validateTheme(theme);
  if (!result.ok) throw new TypeError(`The preview needs a valid theme: ${(result.issues || []).map((i) => i.message).join("; ")}`);
  for (const key of ["enabled", "extras", "text", "motion", "fonts", "effects"]) if (typeof preferences?.[key] !== "boolean") throw new TypeError(`preferences.${key} must be a boolean`);
}
const checkCssAllowed = (value) => {
  if (value !== undefined && typeof value !== "boolean") throw new TypeError("cssAllowed must be a boolean");
  return value === true;
};
// The scope marker the host issues where a theme's admitted CSS may apply; compiled owned rules
// require it on an ancestor. On github.com the content host sets it on the document root.
const CSS_SCOPE = "data-reskin-css";

const LAYERS = ["fixture", "native", "theme", "fonts", "appearance"];
const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8">${LAYERS.map((name) => `<style data-layer="${name}"></style>`).join("")}</head><body></body></html>`;

/**
 * Paints the fixture into any trusted document: the preview's layout document, a test page or a
 * build-time DOM. The document gets the fixture's five style layers in its head and the view as
 * its body. paint(state, options) applies { view, theme, preferences, before, cssAllowed }; it resolves only
 * when the theme or preferences changed, and plays motion only when asked to for an explicit
 * selection. options: { play, omit: layer names left empty, fontUrl: overrides the adapter's,
 * layoutOnly: write the style layers only when the body is laid out again }. A paint whose
 * structure (view, base, Before, preferences, flavor, effects, font and width) matches the
 * previous one changes only the style layers and keeps the laid-out body.
 * Returns { resolved, plan, sourceRepairs, compiled, owned, css, decoration, structure, rebuilt }.
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
  // The screen the preview stands for: the page holding the layout frame, whose own height is the
  // whole fixture page.
  const screen = () => {
    const top = win?.parent ?? win;
    return top ? { width: top.innerWidth, height: top.innerHeight } : null;
  };
  let decoration = null;
  let built = null;
  let cacheKey = null;
  let cached = null;

  function resolve(state) {
    const key = JSON.stringify([state.theme, state.preferences]);
    if (key === cacheKey) return cached;
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
    cached = { native, plan, resolved, sourceRepairs: repaired.repairs };
    cacheKey = key;
    return cached;
  }

  /** The bundled face this state shows, or null: { id, url } with the adapter's URL. */
  function font(state) {
    const { resolved } = resolve(state);
    const prefs = state.preferences;
    const themed = prefs.enabled && !state.before && resolved.policy === "themed";
    // The heading role applies in Full and Calm alike while Fonts is on.
    if (!themed || !prefs.fonts || resolved.font === "system") return null;
    const url = rt.resources.fontUrl(resolved.font);
    return url ? { id: resolved.font, url } : null;
  }

  return {
    resolve,
    font,
    paint(state, { play = false, omit = [], fontUrl, layoutOnly = false } = {}) {
      const { native, plan, resolved, sourceRepairs } = resolve(state);
      const prefs = state.preferences;
      const themed = prefs.enabled && !state.before && resolved.policy === "themed";
      const root = fdoc.documentElement;
      root.setAttribute("data-color-mode", native.colorMode);
      root.setAttribute("data-light-theme", native.lightTheme);
      root.setAttribute("data-dark-theme", native.darkTheme);
      const compiled = themed ? rt.primer.compileGitHub(resolved, plan, prefs) : null;
      // Only the selected face gets a rule, so only that one file can load.
      const face = font(state);
      const url = fontUrl === undefined ? face?.url : fontUrl;
      const cssAllowed = Boolean(state.cssAllowed);
      const owned = { css: state.theme.css ?? null, cssAllowed };
      const css = {
        fixture: FIXTURE_CSS,
        native: nativeBaseline(rt.modeIndex, plan.seedMode ?? standardMode(rt.modeIndex, state.theme.base)),
        theme: compiled?.css ?? "",
        fonts: face && url ? fontFaceCss(face.id, url) : "",
        appearance: themed ? escapeCssForHtml(compileAppearance(resolved, prefs, "preview", { ...owned, viewport: screen() })) : "",
      };
      // Colors reach the body only through the style layers, so a color edit keeps the body. The
      // structured appearance can move text (fonts, case, tracking, a banner), so it is structure.
      const a = resolved.appearance;
      const structure = JSON.stringify([state.view, state.theme.base, state.before, themed, prefs, resolved.policy, resolved.flavor, resolved.effects, resolved.font, Boolean(css.fonts), win?.innerWidth ?? 0, cssAllowed, owned.css, a?.fonts ?? null, a?.typography ?? null, Boolean(a?.paints?.profileBanner)]);
      const rebuilt = play || structure !== built?.structure || !fdoc.body.contains(built.root);
      // A layout document needs new styles only for a new layout; colors never move anything.
      if (rebuilt || !layoutOnly) {
        for (const name of LAYERS) {
          const text = omit.includes(name) ? "" : css[name];
          if (layer(name).textContent !== text) layer(name).textContent = text;
        }
      }
      if (rebuilt) {
        decoration?.destroy();
        decoration = null;
        // The view's native markup depends only on the view and the base; a new theme or
        // preference of the same view keeps it and mounts its decoration again.
        const nativeKey = `${state.view}|${state.theme.base}`;
        let view = built?.nativeKey === nativeKey && fdoc.body.contains(built.root) ? built.view : null;
        if (!view) {
          view = VIEWS[state.view](builder(fdoc, rt.resources, state.theme.base));
          fdoc.body.replaceChildren(view.root);
        }
        built = { structure, nativeKey, view, root: view.root };
        if (themed && cssAllowed) view.root.setAttribute(CSS_SCOPE, "active");
        else view.root.removeAttribute(CSS_SCOPE);
        if (themed) {
          decoration = mountAppearance(fdoc.body, resolved, prefs, view.anchors.filter((anchor) => !rt.dormantSlots.includes(anchor.slot)), owned);
          if (play) decoration.play();
        }
      }
      return { resolved, plan, sourceRepairs, compiled, owned: decoration?.owned ?? 0, css, decoration, structure, rebuilt };
    },
    destroy() {
      decoration?.destroy();
      decoration = null;
      built = null;
      fdoc.body.replaceChildren();
      for (const name of LAYERS) layer(name).textContent = "";
    },
  };
}

// Embedded copies of packaged files, by URL: the selected font and the fixture images. The
// styled frame has an opaque origin and a policy that allows no request at all, so it reads them
// only as data; the controller reads each packaged file once per page and keeps the copy, since
// the set is the fixed, packaged one.
const TYPES = { woff2: "font/woff2", webp: "image/webp", svg: "image/svg+xml" };
const embeddedData = new Map();
const embeddedReady = new Map();
function embedded(win, url) {
  if (url.startsWith("data:")) return Promise.resolve(url);
  if (!embeddedData.has(url)) {
    const type = TYPES[/\.([a-z0-9]+)$/.exec(new URL(url, win.document.baseURI).pathname)?.[1]];
    const job = (type ? win.fetch(url, { credentials: "omit" }) : Promise.reject(new Error(`${url} is not a packaged file`)))
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`${url} returned ${response.status}`))))
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new win.FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, `data:${type};base64,`));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }))
      .catch(() => null)
      .then((data) => {
        // A failed read is not remembered, so a later update tries again.
        if (data === null) embeddedData.delete(url);
        else embeddedReady.set(url, data);
        return data;
      });
    embeddedData.set(url, job);
  }
  return embeddedData.get(url);
}
const embeddedCopy = (src) => (src.startsWith("data:") ? src : (embeddedReady.get(src) ?? null));

// A job's wait that the job can leave. Every wait settles with STOPPED as soon as a newer request
// or destroy stops the job, so the newest job never waits behind an obsolete one. The read
// itself may continue for other consumers of the shared copy, but holds only an emptied cell,
// never the job, so a read that never settles keeps nothing of a stopped job or destroyed preview.
const STOPPED = Symbol("stopped");
function settle(cell, value) {
  cell.waits?.delete(cell);
  cell.resolve?.(value);
  cell.resolve = cell.waits = null;
}
function leavable(waits, promise) {
  return new Promise((resolve) => {
    const cell = { resolve, waits };
    waits.add(cell);
    Promise.resolve(promise).then((value) => settle(cell, value), () => settle(cell, null));
  });
}
function stopWaits(waits) {
  for (const cell of [...waits]) settle(cell, STOPPED);
}

// The part of rect that the page can show: clipped by every scrolling or clipping ancestor of el
// and by the top-level viewport. Returns null when nothing is visible.
function visiblePart(rect, el, win) {
  let { left, top, right, bottom } = rect;
  for (let node = el.parentElement; node && node !== el.ownerDocument.documentElement; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const clip = node.getBoundingClientRect();
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  right = Math.min(right, win.innerWidth);
  bottom = Math.min(bottom, win.innerHeight);
  left = Math.max(left, 0);
  top = Math.max(top, 0);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/**
 * Mounts the preview into container. Returns { update, setView, setBefore, destroy }. update and
 * mountPreview throw for an invalid theme and keep the last valid preview. Updates within one
 * animation frame are coalesced into one replacement of the styled frame. The host element
 * carries data-requested and data-completed generations and fires `reskin-preview-complete`
 * (detail { generation, ms }) once a replacement frame has loaded and been shown. A job renders
 * the state as it was when the job started; a newer request stops it at once, even while it
 * waits for a font or image read, and only the newest generation reports completion, with
 * metadata for the document it rendered. destroy releases the frames, their documents and every
 * reference the handle held; a destroyed handle's methods do nothing.
 */
export function mountPreview(container, options) {
  if (!runtime) throw new Error("Call configurePreview before mountPreview");
  if (container?.nodeType !== 1) throw new TypeError("mountPreview needs a container element");
  if (!PREVIEW_VIEWS.includes(options?.view)) throw new TypeError(`Unknown preview view ${options?.view}`);
  checkOptions(options);
  const rt = runtime;
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const state = { view: options.view, theme: options.theme, preferences: options.preferences, before: false, cssAllowed: checkCssAllowed(options.cssAllowed) };

  let host = doc.createElement("div");
  host.className = "reskin-preview";
  host.setAttribute("data-reskin-preview", "");
  host.style.cssText = "display:block;position:relative;width:100%;min-width:0";
  // The layout document: same-origin, scriptless and never shown. It holds only trusted layers
  // (fixture, native, fonts and owned decoration, never the compiled theme), so the controller
  // can measure placement, motion boxes and height without touching the styled frame.
  let layout = doc.createElement("iframe");
  layout.setAttribute("sandbox", "allow-same-origin");
  layout.setAttribute("aria-hidden", "true");
  layout.setAttribute("tabindex", "-1");
  layout.setAttribute("inert", "");
  layout.title = "Preview layout";
  layout.style.cssText = "position:absolute;left:0;top:0;display:block;width:100%;height:320px;border:0;visibility:hidden;pointer-events:none";
  layout.srcdoc = SHELL;
  host.append(layout);
  container.append(host);

  let destroyed = false;
  let ldoc = null;
  let renderer = null;
  let shown = null;
  let shownHtml = "";
  let pending = null;
  let requested = 0;
  let wantPlay = false;
  let since = null;
  let scheduled = 0;
  let running = false;
  let laidWidth = -1;
  let height = 320;
  let motion = null;
  let reported = null;
  let body = null;
  // The running job's waits; a newer request or destroy stops them.
  const waits = new Set();

  const frameStyle = "display:block;width:100%;border:0;background:transparent";
  const setHeight = (value) => {
    height = value;
    layout.style.height = `${value}px`;
    if (shown) shown.style.height = `${value}px`;
  };
  const measure = () => {
    if (!ldoc || destroyed) return;
    const value = Math.ceil(ldoc.documentElement.getBoundingClientRect().height);
    if (value && value !== height) setHeight(value);
  };
  const resizes = new win.ResizeObserver(() => {
    measure();
    // A new width can change where decoration fits, so the frame is laid out again.
    if (ldoc && laidWidth >= 0 && Math.round(host.getBoundingClientRect().width) !== laidWidth) request();
  });

  function endMotion() {
    if (!motion) return;
    win.clearTimeout(motion.timer);
    motion.watcher?.disconnect();
    for (const node of motion.sentinels) node.remove();
    doc.removeEventListener("visibilitychange", motion.onHidden);
    motion = null;
  }

  // A pass in progress stops when a moving box leaves the visible page or the page is hidden:
  // the frame is replaced with its resting state, and the pass does not replay.
  function watchMotion(rects, duration) {
    const sentinels = rects.map((r) => {
      const node = doc.createElement("div");
      node.setAttribute("aria-hidden", "true");
      node.setAttribute("data-reskin-motion", "");
      node.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;visibility:hidden;pointer-events:none`;
      host.append(node);
      return node;
    });
    const cancel = () => {
      endMotion();
      request();
    };
    const onHidden = () => doc.hidden && cancel();
    doc.addEventListener("visibilitychange", onHidden);
    const watcher = typeof win.IntersectionObserver === "function" ? new win.IntersectionObserver((entries) => entries.some((e) => !e.isIntersecting) && cancel()) : null;
    for (const node of sentinels) watcher?.observe(node);
    motion = { sentinels, watcher, onHidden, timer: win.setTimeout(endMotion, duration) };
  }

  function request({ play = false } = {}) {
    if (destroyed) return;
    requested += 1;
    host.setAttribute("data-requested", String(requested));
    wantPlay ||= play;
    since ??= win.performance.now();
    // A job still waiting for an older state is obsolete: its waits stop and its frame, if one
    // is loading, is removed at once.
    stopWaits(waits);
    discardPending();
    if (!scheduled && !running) scheduled = win.requestAnimationFrame(run);
  }

  const obsolete = (generation) => destroyed || requested !== generation;
  const nextFrame = () => new Promise((resolve) => win.requestAnimationFrame(() => resolve()));
  // After the next rendering update: a task queued from an animation frame callback runs after
  // that frame's paint.
  const afterPaint = () => new Promise((resolve) => win.requestAnimationFrame(() => {
    const channel = new win.MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  }));

  function discardPending() {
    if (!pending) return;
    pending.frame.removeEventListener("load", pending.onLoad);
    pending.frame.remove();
    pending.resolve(false);
    pending = null;
  }

  async function run() {
    scheduled = 0;
    if (destroyed || !renderer) return;
    running = true;
    const generation = requested;
    const play = wantPlay;
    wantPlay = false;
    const started = since;
    since = null;
    // The state this job renders and reports, whatever arrives while it waits.
    const snapshot = { ...state };
    let done = false;
    try {
      done = await job(generation, play, started, snapshot);
    } catch (error) {
      // An obsolete job's failure is not reported; the newest request carries on.
      if (obsolete(generation)) return;
      // The last valid preview stays; nothing partial is shown.
      done = true;
      host.setAttribute("data-error", String(error?.message ?? error));
      host.dispatchEvent(new win.CustomEvent("reskin-preview-error", { detail: { generation, message: String(error?.message ?? error) } }));
    } finally {
      running = false;
      if (!done && !destroyed) {
        // Superseded: the newest request carries this one's start time and selection.
        since = Math.min(since ?? Infinity, started);
        wantPlay ||= play;
      }
      if (!destroyed && requested !== generation && !scheduled) scheduled = win.requestAnimationFrame(run);
    }
  }

  async function job(generation, play, started, state) {
    const wait = (promise) => leavable(waits, promise);
    // An embedded copy of the selected face, read once; until then the frame would fall back.
    const face = renderer.font(state);
    const fontUrl = face ? await wait(embedded(win, face.url)) : null;
    if (obsolete(generation)) return false;
    if (fontUrl) {
      // Lay out with the face loaded, so decoration is measured as it will be shown.
      ldoc.head.querySelector('style[data-layer="fonts"]').textContent = fontFaceCss(face.id, fontUrl);
      const font = FONT_BY_ID[face.id];
      await wait(ldoc.fonts.load(`${font.weight} ${font.minimumAccentPx}px "${font.cssFamily}"`));
      if (obsolete(generation)) return false;
    }
    endMotion();
    laidWidth = Math.round(host.getBoundingClientRect().width);
    const painted = renderer.paint(state, { omit: ["theme"], fontUrl, layoutOnly: true });
    const { resolved, compiled, owned, css, decoration, sourceRepairs, structure, rebuilt } = painted;
    // Height follows the layout document through the ResizeObserver.
    // The view's images, embedded; the first update of a view reads them once.
    const missing = [...new Set([...ldoc.images].map((img) => img.getAttribute("src")))].filter((src) => src && !embeddedCopy(src));
    if (missing.length) {
      await wait(Promise.all(missing.map((src) => embedded(win, src))));
      if (obsolete(generation)) return false;
    }
    // Motion: the boxes allowed to move whose place in the frame the page can show now.
    const frameRect = layout.getBoundingClientRect();
    const playing = [];
    if (play) {
      for (const box of decoration?.motionBoxes() ?? []) {
        const r = box.getBoundingClientRect();
        const rect = { left: frameRect.left + r.left, top: frameRect.top + r.top, right: frameRect.left + r.right, bottom: frameRect.top + r.bottom };
        if (r.width > 0 && r.height > 0 && visiblePart(rect, layout, win)) playing.push({ box, left: r.left, top: r.top, width: r.width, height: r.height });
      }
    }
    for (const { box } of playing) box.setAttribute("data-rs-play", "");
    let html;
    try {
      // A body that carries a pass of motion is never reused.
      const reuse = !rebuilt && !playing.length && body?.structure === structure;
      const text = reuse ? body.text : fixtureBody(ldoc, embeddedCopy);
      body = playing.length ? null : { structure, text };
      html = serializeFixture(ldoc, LAYERS.map((name) => ({ name, css: css[name] })), embeddedCopy, text);
    } finally {
      for (const { box } of playing) box.removeAttribute("data-rs-play");
    }
    // One state per resolution: a Before/After or view change does not resolve again.
    if (resolved !== reported) {
      reported = resolved;
      options.onState?.({ policy: resolved.policy, repairs: Object.freeze([...sourceRepairs, ...resolved.repairs]) });
    }

    if (html !== shownHtml) {
      const frame = doc.createElement("iframe");
      frame.setAttribute("sandbox", PREVIEW_SANDBOX);
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("tabindex", "-1");
      frame.setAttribute("scrolling", "no");
      frame.title = `Interactive preview: ${VIEW_LABELS[state.view]}`;
      frame.style.cssText = `${frameStyle};height:${height}px;position:absolute;left:0;top:0;visibility:hidden`;
      const loaded = new Promise((resolve) => {
        const onLoad = () => resolve(true);
        pending = { frame, onLoad, resolve };
        frame.addEventListener("load", onLoad);
      });
      frame.srcdoc = html;
      host.append(frame);
      const ok = await loaded;
      if (!ok || obsolete(generation)) {
        discardPending();
        return false;
      }
      frame.removeEventListener("load", pending.onLoad);
      pending = null;
      // Swap: the new frame takes the old one's place; the old frame and its document go.
      frame.style.cssText = `${frameStyle};height:${height}px`;
      const old = shown;
      shown = frame;
      shownHtml = html;
      old?.remove();
      await wait(afterPaint());
      // A request during that paint makes this document obsolete before it is reported.
      if (obsolete(generation)) return false;
    }
    if (playing.length) watchMotion(playing, Math.min(LIMITS.maxAnimationMs, motionMs(resolved.effects)) + 50);
    host.setAttribute("data-view", state.view);
    host.setAttribute("data-before", String(state.before));
    host.setAttribute("data-policy", resolved.policy);
    host.setAttribute("data-renderer", String(RENDERER_VERSION));
    host.setAttribute("data-source-hash", resolved.sourceHash);
    host.setAttribute("data-seed-hash", resolved.seedHash ?? "");
    host.setAttribute("data-fingerprint", compiled?.fingerprint ?? "");
    host.setAttribute("data-owned-nodes", String(owned));
    host.setAttribute("data-playing", String(playing.length));
    host.removeAttribute("data-error");
    host.setAttribute("data-completed", String(generation));
    host.dispatchEvent(new win.CustomEvent("reskin-preview-complete", { detail: { generation, ms: win.performance.now() - started } }));
    return true;
  }

  const onLayoutLoad = () => {
    if (destroyed || ldoc) return;
    ldoc = layout.contentDocument;
    renderer = createFixtureRenderer(ldoc, rt);
    // Images and fonts change the height after layout; the frames grow to fit and never scroll.
    ldoc.addEventListener("load", measure, true);
    resizes.observe(ldoc.documentElement);
    if (!scheduled && !running) scheduled = win.requestAnimationFrame(run);
  };
  layout.addEventListener("load", onLayoutLoad);
  resizes.observe(host);
  request();

  return {
    update(next) {
      if (destroyed) return;
      checkOptions(next);
      const cssAllowed = checkCssAllowed(next.cssAllowed);
      const selected = JSON.stringify(next.theme) !== JSON.stringify(state.theme);
      state.theme = next.theme;
      state.preferences = next.preferences;
      state.cssAllowed = cssAllowed;
      // A newly selected theme is an explicit selection: its one pass of motion may play.
      request({ play: selected });
    },
    setView(view) {
      if (destroyed) return;
      if (!PREVIEW_VIEWS.includes(view)) throw new TypeError(`Unknown preview view ${view}`);
      state.view = view;
      request();
    },
    setBefore(before) {
      if (destroyed) return;
      state.before = Boolean(before);
      request();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.cancelAnimationFrame(scheduled);
      stopWaits(waits);
      endMotion();
      discardPending();
      renderer?.destroy();
      resizes.disconnect();
      ldoc?.removeEventListener("load", measure, true);
      layout.removeEventListener("load", onLayoutLoad);
      // The frames leave the host first, so clearing their documents navigates nothing.
      const frames = [...host.querySelectorAll("iframe")];
      host.replaceChildren();
      host.remove();
      for (const frame of frames) frame.removeAttribute("srcdoc");
      host = layout = shown = renderer = ldoc = body = reported = null;
      shownHtml = "";
      options = null;
    },
  };
}
