// The content lifecycle: first paint from the extension-owned boot snapshot, the startup watchdog,
// storage-change routing, mode and media changes, Turbo/PJAX/bfcache navigation, the one owned
// style node and complete cleanup. It reads extension storage directly, never the background, and
// never page storage except removing the exact 1.1.0 cache key without reading it.
//
// Rendering is not done here. The caller passes a renderer built from C3's adapter, the engine and
// C5's appearance (C6 assembles it):
//   readPage(document, view) -> {native, forcedColors, reducedMotion}
//   plan(page, base) -> {plan: ModePlan, seed: ModeSeed | null}
//   resolve(theme, context) -> ResolvedTheme
//   compile(resolved, plan, prefs) -> {css, fingerprint}
//   decorate?(document, resolved, prefs) -> {destroy()} | null    owned flavor/effect nodes
//   modeAttributes?: string[]                                       root attributes to observe
import { LEGACY_PAGE_CACHE_KEY, LIMITS, LOCAL_THEME_ID_PREFIX, STORAGE_KEYS } from "../../../packages/contracts/index.js";
import { sourceHash } from "../../../packages/engine/index.js";
import {
  BOOT_ATTRIBUTE,
  effectivePreferences,
  selectedConsent,
  selectedSource,
  STYLE_ID,
  usableSnapshot,
  validateSettings,
} from "../../../packages/settings/index.js";

const MEDIA_QUERIES = ["(prefers-color-scheme: dark)", "(forced-colors: active)", "(prefers-reduced-motion: reduce)"];
const DEFAULT_MODE_ATTRIBUTES = ["data-color-mode", "data-light-theme", "data-dark-theme"];
// A navigation begins once (turbo:visit, pjax:start) and may complete in several events; only the
// beginning opens a new optional-work budget.
const NAVIGATION_VISIT = ["turbo:visit", "pjax:start"];
const NAVIGATION_END = ["turbo:load", "turbo:render", "pjax:end"];
const NAVIGATION_START = ["turbo:before-render", "turbo:before-cache", "pjax:start"];
const REMOVAL_WINDOW_MS = 1000;

/**
 * @param {object} options
 * @param {import("../../../packages/contracts/index.js").StorageAdapter} options.storage
 * @param {Document} options.document
 * @param {Window} options.view the window: timers, frames, media queries, observers, events
 * @param {object} options.catalog CatalogSource
 * @param {object} options.renderer see above
 * @param {(event:object)=>void} [options.onEvent] diagnostics for tests: state changes and budgets
 * @returns {{destroy():void, ready:Promise<string>, status():object}}
 */
export function startContent({ storage, document, view, catalog, renderer, onEvent = () => {} }) {
  const root = document.documentElement;
  const now = () => view.performance.now();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.setAttribute("data-reskin-owned", "style");

  let destroyed = false;
  let settled = false;
  let generation = 0;
  let state = null; // {settings, boot} from the latest completed read
  let fingerprint = null;
  let resolvedNow = null;
  let prefsNow = null;
  let decorations = null;
  let revisionNow = null;
  // The optional-work budget: what decoration passes have spent since it opened, and whether
  // they reached the limit.
  let budgetSpent = false;
  let navigationSpent = 0;
  let frame = 0;
  const pending = new Set();
  const removals = [];
  let styleBroken = false;
  let phase = "pending";
  let legacyTimer = null;
  const cleanups = [];
  let resolveReady;
  const ready = new Promise((resolve) => (resolveReady = resolve));

  const setPhase = (next) => {
    phase = next;
    // Any value ends the CSS gate. Written in the same turn as the stylesheet.
    if (root.getAttribute(BOOT_ATTRIBUTE) !== next) root.setAttribute(BOOT_ATTRIBUTE, next);
    onEvent({ type: "phase", phase: next });
  };

  let watchdog = view.setTimeout(() => {
    watchdog = null;
    // Degraded startup: storage has not answered in time, so GitHub shows natively and a later
    // successful read still applies the theme.
    if (!settled && !destroyed) setPhase("timeout");
  }, LIMITS.startupGateMs);

  function settle(next) {
    if (watchdog !== null) {
      view.clearTimeout(watchdog);
      watchdog = null;
    }
    if (!settled) {
      settled = true;
      // The only page-storage operation: remove 1.1.0's cached CSS without reading it, off the
      // first-paint path. Denied page storage is ignored.
      legacyTimer = view.setTimeout(() => {
        legacyTimer = null;
        try {
          view.localStorage.removeItem(LEGACY_PAGE_CACHE_KEY);
        } catch {
          // Site data blocked; nothing to remove.
        }
      }, 0);
      resolveReady(next);
    }
  }

  function clearStyle() {
    fingerprint = null;
    style.textContent = "";
    style.remove();
  }

  function dropDecorations() {
    if (!decorations) return;
    try {
      decorations.destroy();
    } finally {
      decorations = null;
    }
  }

  // Native leaves nothing placed, so the themed page that follows (forced colors or GitHub's own
  // mode switching back) gets a pass of its own instead of keeping an empty spent budget.
  function goNative(reason) {
    clearStyle();
    dropDecorations();
    openBudget();
    resolvedNow = null;
    setPhase("native");
    onEvent({ type: "native", reason });
    settle("native");
  }

  // Policy first, then the snapshot rule, then resolution. All synchronous, so the stylesheet and
  // the end of the gate land in one turn.
  function render() {
    const settings = state?.settings;
    if (!settings) return goNative("unreadable");
    // A change the user makes (a new settings revision: a theme or preference) opens a fresh
    // budget, so flavor follows it within a frame or two instead of waiting for a reload.
    if (settings.revision !== revisionNow) {
      if (revisionNow !== null) openBudget();
      revisionNow = settings.revision;
    }
    if (!settings.enabled) return goNative("disabled");
    const source = selectedSource(settings, catalog);
    if (!source) return goNative("missing-source");
    const page = renderer.readPage(document, view);
    const prefs = effectivePreferences(settings);
    const { plan, seed } = renderer.plan(page, source.base);
    const policy = page.forcedColors ? "forced-colors" : plan.policy;
    if (policy !== "themed") return goNative(policy);
    const current = {
      settingsRevision: settings.revision,
      catalogHash: catalog.hash,
      selectedSourceHash: settings.selectedThemeId.startsWith(LOCAL_THEME_ID_PREFIX) ? sourceHash(source) : catalog.sourceHash(settings.selectedThemeId),
      effectivePreferences: prefs,
      cssConsent: selectedConsent(settings),
      policy,
      base: source.base,
      seedId: seed?.id ?? null,
      seedHash: seed?.sourceHash ?? null,
      motionAllowed: !page.reducedMotion,
    };
    const snapshot = usableSnapshot(state.boot, current);
    const resolved = snapshot ?? renderer.resolve(source, { seed, policy, reducedMotion: page.reducedMotion, forcedColors: page.forcedColors });
    onEvent({ type: "resolved", from: snapshot ? "snapshot" : "source" });
    const compiled = renderer.compile(resolved, plan, prefs);
    if (compiled.fingerprint !== fingerprint || !style.isConnected) {
      if (compiled.fingerprint !== fingerprint) style.textContent = compiled.css;
      fingerprint = compiled.fingerprint;
      if (!style.isConnected && !styleBroken) root.append(style);
      if (resolvedNow !== resolved || prefsNow?.extras !== prefs.extras) schedule("decorate");
    }
    resolvedNow = resolved;
    prefsNow = prefs;
    setPhase("ready");
    settle("ready");
  }

  function renderSafely() {
    try {
      render();
    } catch (error) {
      onEvent({ type: "error", error });
      goNative("error");
    }
  }

  // Last read wins: a slow older read never overwrites a newer one.
  async function read() {
    const mine = ++generation;
    let raw;
    try {
      raw = await storage.get([STORAGE_KEYS.settings, STORAGE_KEYS.boot]);
    } catch {
      if (!destroyed && mine === generation) {
        state = null;
        renderSafely();
      }
      return;
    }
    if (destroyed || mine !== generation) return onEvent({ type: "stale-read" });
    const result = raw[STORAGE_KEYS.settings] === undefined ? { ok: false } : validateSettings(raw[STORAGE_KEYS.settings], catalog);
    state = { settings: result.ok ? result.settings : null, boot: raw[STORAGE_KEYS.boot] ?? null };
    renderSafely();
  }

  // Each page navigation and each change the user makes opens a budget of its own.
  function openBudget() {
    navigationSpent = 0;
    budgetSpent = false;
  }

  function decorate() {
    // Optional work stops once the passes of one budget together reach it. What they placed
    // stays: a later pass under a spent budget neither redraws nor removes it.
    if (budgetSpent) return;
    dropDecorations();
    if (!renderer.decorate || !resolvedNow || document.readyState === "loading") return;
    const start = now();
    decorations = renderer.decorate(document, resolvedNow, prefsNow) ?? null;
    navigationSpent += now() - start;
    if (navigationSpent >= LIMITS.maxNavigationMs) {
      budgetSpent = true;
      onEvent({ type: "budget", spent: navigationSpent });
    }
  }

  // Theme, mode and navigation work coalesces into at most one pass per animation frame. Hidden
  // tabs get no frames, so their work waits until they are shown.
  function schedule(kind) {
    if (destroyed) return;
    pending.add(kind);
    if (!frame) frame = view.requestAnimationFrame(flush);
  }

  function flush() {
    frame = 0;
    const kinds = new Set(pending);
    pending.clear();
    if (kinds.has("read")) read();
    else if (kinds.has("recompute") && state) renderSafely();
    if (kinds.has("decorate") && phase === "ready") decorate();
  }

  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  // Storage routing: only this extension's records start a read.
  cleanups.push(storage.subscribe((changes) => {
    if (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.boot]) schedule("read");
  }));

  // GitHub's own mode attributes and media state change the plan, not the settings.
  const modeObserver = new view.MutationObserver(() => schedule("recompute"));
  modeObserver.observe(root, { attributes: true, attributeFilter: renderer.modeAttributes ?? DEFAULT_MODE_ATTRIBUTES });
  cleanups.push(() => modeObserver.disconnect());
  for (const query of MEDIA_QUERIES) {
    const list = view.matchMedia(query);
    if (typeof list?.addEventListener === "function") listen(list, "change", () => schedule("recompute"));
  }

  // Style lifetime: put a removed style back once per mutation burst, and stop after three
  // removals in a second so a page that keeps removing it does not loop.
  const styleObserver = new view.MutationObserver(() => {
    if (fingerprint === null || style.isConnected || styleBroken) return;
    const at = now();
    removals.push(at);
    while (removals.length && at - removals[0] > REMOVAL_WINDOW_MS) removals.shift();
    if (removals.length >= LIMITS.styleRemovalCircuitBreaker) {
      styleBroken = true;
      onEvent({ type: "style-circuit-open" });
      return;
    }
    root.append(style);
  });
  styleObserver.observe(root, { childList: true });
  cleanups.push(() => styleObserver.disconnect());

  // Navigation: owned nodes leave before Turbo caches or swaps the body, and are placed again once
  // the new page is in. Each navigation gets a fresh optional-work budget.
  for (const type of NAVIGATION_START) listen(document, type, dropDecorations);
  const navigated = () => schedule("decorate");
  for (const type of NAVIGATION_VISIT) listen(document, type, openBudget);
  for (const type of NAVIGATION_END) listen(document, type, navigated);
  listen(view, "popstate", () => {
    openBudget();
    navigated();
  });
  if (document.readyState === "loading") listen(document, "DOMContentLoaded", navigated, { once: true });
  // bfcache: drop queued work on the way out, and re-read on return because storage may have
  // changed while the page was frozen.
  listen(view, "pagehide", () => {
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
  });
  listen(view, "pageshow", (event) => {
    if (event.persisted) {
      schedule("read");
      openBudget();
      navigated();
    } else if (pending.size && !frame) frame = view.requestAnimationFrame(flush);
  });
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible" && pending.size && !frame) frame = view.requestAnimationFrame(flush);
  });

  read();

  return {
    ready,
    status: () => ({ phase, fingerprint, styleBroken, decorated: Boolean(decorations), pending: [...pending] }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (watchdog !== null) view.clearTimeout(watchdog);
      if (legacyTimer !== null) view.clearTimeout(legacyTimer);
      if (frame) view.cancelAnimationFrame(frame);
      frame = 0;
      pending.clear();
      for (const cleanup of cleanups.splice(0)) cleanup();
      dropDecorations();
      clearStyle();
      // "off", not removal: an unset attribute would restart the CSS gate.
      setPhase("off");
      resolveReady("off");
    },
  };
}
