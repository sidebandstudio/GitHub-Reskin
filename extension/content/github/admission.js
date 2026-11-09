// Native CSS admission: the host-issued markers that let advanced theme CSS reach GitHub's own
// elements, and their immediate revocation. The registry (packages/primer/registry.js) names the
// subjects; this module finds them, checks each one and writes only Reskin marker attributes,
// never GitHub's. It is the adapter's only writer. Absence of a marker is the safe state.
//
// Lifetime. Classification runs in a frame callback, at most 200 candidates or 4 ms a pass and
// 10 ms from an invalidation to its completion; until it completes the native gate stays off,
// and past 10 ms it stays off for the document. One document-wide subtree MutationObserver
// revokes in its microtask, before the next styled render: an admitted subject whose attributes
// or an ancestor's change, that gains children, or that is reinserted loses its marker; an
// inserted or changed dialog, alert, popover, protected node or island, or more records than one
// pass allows, removes the native gate for the whole document. Route, cache and history events
// strip every admission first. Activating a control that can open a layer, and any toggle,
// removes the gate before the activation lands; it returns only once no layer is open.
import { CSS_MARKERS } from "../../../packages/contracts/index.js";
import { ACTIVATORS, AUTHORED, BLOCKING, CSS_TARGET_REGISTRY, HOST_SUBJECTS, INVALIDATION, PROTECTED } from "../../../packages/primer/registry.js";
import { classifyRouteLazily } from "./routes.js";
import { LIVE_REGIONS } from "./selectors.js";

export const PASS_CANDIDATES = 200;
export const PASS_MS = 4;
export const CLASSIFICATION_MS = 10;

const M = CSS_MARKERS;
const KIND = `[${M.kind}]`;
const MARKERS = new Set([M.scope, M.nativeGate, M.kind, M.native, M.protected]);
// Layers and islands change what the whole document may admit; protected UI changes only the
// subjects around it, which the next pass checks again.
const WIDE = `${BLOCKING},[data-color-mode]`;
const WATCHED = `${WIDE},${PROTECTED}`;
// Attributes whose change anywhere can open a layer or change an island's mode.
const DOCUMENT_ATTRIBUTES = new Set(["open", "aria-modal", "popover", "role", "data-color-mode", "data-light-theme", "data-dark-theme", "inert"]);
const ROUTE_EVENTS = ["turbo:before-render", "turbo:before-cache", "pjax:beforeReplace", "popstate", "pagehide"];
const RESUME_EVENTS = ["turbo:render", "turbo:load", "pageshow"];
const ACTIVATION_EVENTS = ["click", "keydown", "focusin"];
const ACTIVATION_KEYS = new Set(["Enter", " ", "Escape", "ArrowDown", "ArrowUp"]);
const TOGGLE_EVENTS = ["beforetoggle", "toggle"];
const KINDS = CSS_TARGET_REGISTRY.kinds;

// The only attribute writes in the content adapter: Reskin's own markers.
function mark(el, name, value) {
  if (!MARKERS.has(name)) throw new Error(`${name} is not a Reskin marker`);
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
function unmark(el, name) {
  if (!MARKERS.has(name)) throw new Error(`${name} is not a Reskin marker`);
  if (el.hasAttribute(name)) el.removeAttribute(name);
}

// Whether a layer is shown, from structure alone so no style or layout is forced: a dialog by its
// open state, a popover by :popover-open, anything else unless it is hidden or inside something
// closed. On the captured pages this agrees with checkVisibility() for every layer.
const CLOSED = "[hidden],dialog:not([open]),details:not([open]) > :not(summary),[popover]:not(:popover-open)";
const shown = (el) => (el.localName === "dialog" ? el.open : el.hasAttribute("popover") ? el.matches(":popover-open") : !el.closest(CLOSED));

// Candidates for the route's subjects, found by their registry key, each with its definition.
function candidatesFor(document, route) {
  const out = new Map();
  for (const def of HOST_SUBJECTS) {
    if (!def.routes.includes(route)) continue;
    const { className, tag, within, withinId } = def.key;
    let pool = [];
    if (className) pool = document.getElementsByClassName(className);
    else if (tag) pool = document.getElementsByTagName(tag);
    else if (within) pool = document.getElementsByClassName(within)[0]?.querySelectorAll(def.select) ?? [];
    else if (withinId) pool = document.getElementById(withinId)?.querySelectorAll(def.select) ?? [];
    for (const el of pool) if (!out.has(el) && el.matches(def.select)) out.set(el, def);
  }
  return out;
}

/**
 * Starts admission for one document.
 * @param {Document} document
 * @param {{modes:string[], cssAllowed?:boolean, clock?:{now():number}, onEvent?:(event:object)=>void}} options
 *   `modes` are the plan's covered GitHub mode IDs: a subject inside any other island, or inside an
 *   island without theme attributes, is never admitted. `cssAllowed` is false in Calm, Off, under
 *   native policy or without consent, which removes every marker.
 * @returns {{state():object, update(options?:object):void, revoke(reason:string):void, dispose():void}}
 */
export function startAdmission(document, { modes, cssAllowed = true, clock, onEvent = () => {} } = {}) {
  if (!Array.isArray(modes)) throw new TypeError("startAdmission needs the plan's covered mode IDs");
  const view = document.defaultView;
  const root = document.documentElement;
  const time = clock ?? view?.performance ?? globalThis.performance;
  const dark = view?.matchMedia?.("(prefers-color-scheme: dark)");
  const forced = view?.matchMedia?.("(forced-colors: active)");
  let covered = new Set(modes);
  let allowed = cssAllowed;
  let route = "other";
  let reason = "starting";
  // The pending work: null when idle, else what the next pass must do.
  let pending = null;
  let queue = null;
  let spent = 0;
  let exhausted = false;
  let frame = 0;
  let disposed = false;
  // True once a classification has completed since the last strip.
  let ready = false;
  const admitted = new Set();
  const counts = new Map();

  const emit = (type, detail = {}) => onEvent({ type, ...detail });
  const gateOff = (why) => {
    if (root.hasAttribute(M.nativeGate)) emit("revoked", { reason: why });
    unmark(root, M.nativeGate);
    reason = why;
  };
  const revokeSubject = (el) => {
    if (admitted.delete(el)) {
      const kind = el.getAttribute(M.kind);
      counts.set(kind, (counts.get(kind) ?? 1) - 1);
    }
    unmark(el, M.kind);
  };
  const stripAll = (why) => {
    ready = false;
    gateOff(why);
    for (const el of [...admitted]) revokeSubject(el);
    for (const el of document.querySelectorAll(`${KIND},[${M.native}],[${M.protected}]`)) for (const name of [M.kind, M.native, M.protected]) unmark(el, name);
    queue = null;
  };

  // The GitHub mode an island applies under the current system scheme, or null.
  function islandMode(el) {
    const colorMode = el.getAttribute("data-color-mode");
    const scheme = colorMode === "auto" ? (dark?.matches ? "dark" : "light") : colorMode;
    return scheme === "light" || scheme === "dark" ? el.getAttribute(`data-${scheme}-theme`) : null;
  }
  // Every island from the subject up must be one of the plan's, with its theme attributes.
  function inPlanIslands(el) {
    for (let node = el.closest("[data-color-mode]"); node; node = node.parentElement?.closest("[data-color-mode]") ?? null) {
      const mode = islandMode(node);
      if (!mode || !covered.has(mode)) return false;
    }
    return true;
  }
  // Why a candidate cannot be admitted, or null. A protected ancestor it finds is marked.
  function rejection(el, def) {
    if (!def.routes.includes(route)) return "route";
    if (!inPlanIslands(el)) return "island";
    if (def.kind === "page-backing") return null;
    const guard = el.closest(PROTECTED);
    if (guard) {
      mark(guard, M.protected, "");
      return "inside protected UI";
    }
    if (el.closest(AUTHORED) || el.closest(LIVE_REGIONS)) return "inside authored content";
    // Inheritable kinds reach their descendants, so every descendant must be one the registry
    // lists. Other kinds take only properties nothing inherits.
    if (KINDS[def.kind].inheritable) {
      const all = el.getElementsByTagName("*");
      if (all.length > def.maxDescendants) return "too many descendants";
      for (const child of all) {
        if (child.matches(PROTECTED)) mark(child, M.protected, "");
        if (!def.descendants || !child.matches(def.descendants) || child.matches(WATCHED)) return "unreviewed descendant";
      }
    }
    return null;
  }

  // Starts a classification: the route, protected and blocking UI, then the candidate queue.
  function begin(full) {
    route = classifyRouteLazily(document);
    if (!allowed || route === "other") {
      stripAll(allowed ? "unreviewed route" : "css off");
      unmark(root, M.scope);
      return false;
    }
    mark(root, M.scope, "active");
    if (!HOST_SUBJECTS.some((s) => s.routes.includes(route))) {
      stripAll(`no native subjects on ${route}`);
      return false;
    }
    for (const el of admitted) if (!el.isConnected) revokeSubject(el);
    const found = [...candidatesFor(document, route)];
    queue = full ? found : found.filter(([el]) => !admitted.has(el));
    return true;
  }
  const layerOpen = () => [...document.querySelectorAll(BLOCKING)].some(shown);

  // One bounded pass. Returns true when the pending work has finished.
  function pass() {
    const start = time.now();
    const work = pending === "layers" && !ready ? "full" : pending;
    if (work === "layers") {
      // Only a layer could have opened: nothing about the subjects changed.
      if (layerOpen()) {
        gateOff("open layer or alert");
        pending = null;
        return true;
      }
    } else if (!queue) {
      if (!begin(work === "full")) {
        pending = null;
        return true;
      }
      // Only a full classification looks for layers: an incremental one follows mutations that
      // inserted or changed none, and a layer cannot appear without one.
      if (work === "full" && layerOpen()) {
        gateOff("open layer or alert");
        pending = null;
        queue = null;
        return true;
      }
    }
    let handled = 0;
    while (queue?.length) {
      if (handled >= PASS_CANDIDATES || time.now() - start > PASS_MS) break;
      const [el, found] = queue.shift();
      handled++;
      const def = el.isConnected && el.matches(found.select) ? found : null;
      const kind = def?.kind;
      const already = admitted.has(el);
      if (!def || rejection(el, def) || (!already && (counts.get(kind) ?? 0) >= KINDS[kind].maxTargets)) {
        revokeSubject(el);
        continue;
      }
      mark(el, M.kind, kind);
      if (!already) {
        admitted.add(el);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
    spent += time.now() - start;
    if (spent > CLASSIFICATION_MS) {
      exhausted = true;
      pending = null;
      stripAll("classification budget");
      emit("suspended", { reason: "classification budget", ms: spent });
      return true;
    }
    if (queue?.length) return false;
    queue = null;
    pending = null;
    spent = 0;
    ready = true;
    mark(root, M.nativeGate, "active");
    reason = "admitted";
    emit("admitted", { subjects: admitted.size });
    return true;
  }

  // Requests work; stronger work replaces weaker pending work.
  const RANK = { layers: 0, incremental: 1, full: 2 };
  function request(work, why) {
    if (disposed || exhausted) return;
    if (work !== "incremental") gateOff(why);
    // A new mutation restarts a pass in progress, so it sees the candidates the mutation added.
    if (work !== "layers" && pending && pending !== "layers") queue = null;
    if (!pending || RANK[work] > RANK[pending]) {
      if (pending === "layers") queue = null;
      pending = work;
    }
    if (frame) return;
    const run = () => {
      frame = 0;
      if (disposed || exhausted || !pending) return;
      if (!pass()) frame = view.requestAnimationFrame(run);
    };
    frame = view.requestAnimationFrame(run);
  }

  const observer = new view.MutationObserver((records) => {
    if (disposed || exhausted) return;
    const start = time.now();
    let wide = null;
    let changed = false;
    for (const [i, record] of records.entries()) {
      if (i >= PASS_CANDIDATES || time.now() - start > PASS_MS) {
        wide = "mutation budget";
        break;
      }
      const target = record.target;
      if (record.type === "attributes") {
        if (MARKERS.has(record.attributeName)) continue;
        changed = true;
        if (DOCUMENT_ATTRIBUTES.has(record.attributeName)) wide = `${record.attributeName} changed`;
        if (target.matches?.(WIDE)) wide = "layer or island changed";
        // The subject itself, a subject around it, or subjects inside it.
        const host = target.closest?.(KIND);
        if (host) revokeSubject(host);
        for (const el of admitted) if (target.contains(el)) revokeSubject(el);
        continue;
      }
      changed = true;
      const host = target.nodeType === 1 ? target.closest(KIND) : null;
      if (host) revokeSubject(host);
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(KIND)) revokeSubject(node);
        for (const el of node.querySelectorAll(KIND)) revokeSubject(el);
        if (node.matches(WIDE) || node.querySelector(WIDE)) wide = "inserted layer, alert or island";
        if (node.matches(PROTECTED)) mark(node, M.protected, "");
      }
    }
    if (wide) request("full", wide);
    else if (changed) request("incremental", "mutation");
  });

  const onRoute = (event) => {
    stripAll(event.type);
    exhausted = false;
    spent = 0;
  };
  const onResume = (event) => {
    exhausted = false;
    spent = 0;
    request("full", event.type);
  };
  const onActivation = (event) => {
    const el = event.target?.nodeType === 1 ? event.target : null;
    if (!el || (event.type === "keydown" && !ACTIVATION_KEYS.has(event.key))) return;
    if (el.closest(ACTIVATORS)) request("layers", `${event.type} on a layer control`);
  };
  const onToggle = (event) => request("layers", event.type);
  const onScheme = () => request("full", "color scheme");
  const onForced = () => (forced?.matches ? stripAll("forced colors") : request("full", "forced colors"));

  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: INVALIDATION.attributes });
  for (const type of ROUTE_EVENTS) view.addEventListener(type, onRoute, true);
  for (const type of RESUME_EVENTS) view.addEventListener(type, onResume, true);
  for (const type of ACTIVATION_EVENTS) view.addEventListener(type, onActivation, true);
  for (const type of TOGGLE_EVENTS) view.addEventListener(type, onToggle, true);
  dark?.addEventListener?.("change", onScheme);
  forced?.addEventListener?.("change", onForced);
  if (forced?.matches) stripAll("forced colors");
  else request("full", "start");

  return {
    /** Why an element is not admitted now, "admitted", or "not a candidate". For diagnostics. */
    explain(el) {
      if (admitted.has(el)) return "admitted";
      const def = HOST_SUBJECTS.find((s) => s.routes.includes(route) && el.matches(s.select));
      return def ? (rejection(el, def) ?? (KINDS[def.kind] && (counts.get(def.kind) ?? 0) >= KINDS[def.kind].maxTargets ? "kind limit" : "pending")) : "not a candidate";
    },
    state: () => ({ route, reason, gate: root.getAttribute(M.nativeGate) === "active", scope: root.getAttribute(M.scope) === "active", admitted: admitted.size, kinds: Object.fromEntries([...counts].filter(([, n]) => n > 0)), pending }),
    update({ modes: next, cssAllowed: nextAllowed } = {}) {
      if (Array.isArray(next)) covered = new Set(next);
      if (typeof nextAllowed === "boolean") allowed = nextAllowed;
      stripAll("update");
      exhausted = false;
      spent = 0;
      request("full", "update");
    },
    revoke: (why) => stripAll(why),
    dispose() {
      disposed = true;
      observer.disconnect();
      if (frame) view.cancelAnimationFrame(frame);
      for (const type of ROUTE_EVENTS) view.removeEventListener(type, onRoute, true);
      for (const type of RESUME_EVENTS) view.removeEventListener(type, onResume, true);
      for (const type of ACTIVATION_EVENTS) view.removeEventListener(type, onActivation, true);
      for (const type of TOGGLE_EVENTS) view.removeEventListener(type, onToggle, true);
      dark?.removeEventListener?.("change", onScheme);
      forced?.removeEventListener?.("change", onForced);
      stripAll("disposed");
      unmark(root, M.scope);
    },
  };
}
