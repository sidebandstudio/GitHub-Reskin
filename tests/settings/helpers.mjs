// Test doubles for settings and lifecycle tests: a fixture catalog, in-memory extension storage with
// injectable delays and failures, a fake extension API, a renderer over the real engine with the
// synthetic seeds, and a small DOM with a virtual clock. Not a test file itself.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_THEME_ID } from "../../packages/contracts/index.js";
import { repairTheme, resolveTheme, sha256 } from "../../packages/engine/index.js";
import { createCatalogSource } from "../../packages/settings/index.js";

export const ROOT = new URL("../../", import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

export const SEEDS = Object.freeze({ dark: readJson("tests/fixtures/seeds/standard-dark.json"), light: readJson("tests/fixtures/seeds/standard-light.json") });
export const CHOOM = readJson("tests/fixtures/settings/choom-circuit.reskin.json");
export const CLASSICS = readdirSync(join(ROOT, "themes/classics")).filter((f) => f.endsWith(".reskin.json")).map((f) => ({ id: f.replace(".reskin.json", ""), document: readJson(`themes/classics/${f}`) }));

/** Choom first, then the twelve Classics: the catalog shape C6 builds. */
export const catalog = createCatalogSource([{ id: DEFAULT_THEME_ID, document: CHOOM }, ...CLASSICS]);

/** The renderer's boot snapshot: the standard seed of the source's base, the common page. */
export const snapshot = (theme) => resolveTheme(theme, { seed: SEEDS[theme.base], policy: "themed", reducedMotion: false, forcedColors: false });
export const repair = (theme) => repairTheme(theme, SEEDS[theme.base]);

export function counter(prefix = "00000000-0000-4000-8000-") {
  let n = 0;
  return () => `${prefix}${String(++n).padStart(12, "0")}`;
}

export const context = (extra = {}) => ({ catalog, snapshot, repair, newId: counter(), ...extra });

/**
 * A CssAdmission shaped like C2b's: it reads only `css`, refuses text containing "INVALID", and
 * names other CSS by a SHA-256 of the sanitizer version and text, so a version bump changes it.
 */
export function standInCss(sanitizerVersion = 1) {
  return {
    sanitizerVersion,
    inspect(document) {
      if (document?.css === undefined) return { css: null };
      if (typeof document.css !== "string" || document.css.includes("INVALID")) return { css: { ok: false, issues: [{ code: "invalid", path: "/css", message: "This CSS is not allowed.", severity: "error" }] } };
      return { css: { ok: true, hash: sha256(new TextEncoder().encode(`${sanitizerVersion}:${document.css}`)), sanitizerVersion } };
    },
  };
}

/**
 * In-memory storage.local. Values are cloned on the way in and out like the real API, and change
 * events arrive asynchronously. hooks.get/hooks.set run before each call and may delay or throw.
 */
export function memoryStorage(initial = {}, hooks = {}) {
  const data = new Map(Object.entries(structuredClone(initial)));
  const listeners = new Set();
  const log = [];
  const emit = (changes) => {
    if (Object.keys(changes).length) queueMicrotask(() => listeners.forEach((listener) => listener(structuredClone(changes))));
  };
  return {
    data,
    log,
    snapshot: () => Object.fromEntries([...data].map(([k, v]) => [k, structuredClone(v)])),
    async get(keys) {
      log.push(["get", keys]);
      await hooks.get?.(keys);
      return Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))]));
    },
    async set(record) {
      log.push(["set", Object.keys(record)]);
      await hooks.set?.(record);
      const changes = {};
      for (const [key, value] of Object.entries(record)) {
        changes[key] = { oldValue: structuredClone(data.get(key)), newValue: structuredClone(value) };
        data.set(key, structuredClone(value));
      }
      emit(changes);
    },
    async remove(keys) {
      log.push(["remove", keys]);
      await hooks.remove?.(keys);
      const changes = {};
      for (const key of keys) if (data.has(key)) {
        changes[key] = { oldValue: data.get(key) };
        data.delete(key);
      }
      emit(changes);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
  };
}

/** A promise with its resolve and reject, for holding a storage call open. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/** A chrome-like namespace that records listener registrations and opened tabs. */
export function fakeApi({ id = "reskin-test-id", origin = "chrome-extension://reskin-test-id" } = {}) {
  const registered = {};
  const event = (name) => ({
    addListener: (fn) => (registered[name] ??= []).push(fn),
    removeListener: (fn) => (registered[name] = (registered[name] ?? []).filter((f) => f !== fn)),
  });
  const tabs = [];
  return {
    registered,
    tabs: { opened: tabs, create: async ({ url }) => tabs.push(url) },
    runtime: {
      id,
      getURL: (path) => `${origin}/${path}`,
      onInstalled: event("onInstalled"),
      onMessage: event("onMessage"),
      onStartup: event("onStartup"),
      onMessageExternal: event("onMessageExternal"),
      onConnectExternal: event("onConnectExternal"),
      onConnect: event("onConnect"),
    },
  };
}

export const pageSender = (api, page = "pages/settings.html") => ({ id: api.runtime.id, url: api.runtime.getURL(page) });
export const contentSender = (api) => ({ id: api.runtime.id, url: "https://github.com/whoisaldo", tab: { id: 4 }, frameId: 0, documentId: "content-document" });
/** The builder's settings page as Chrome names it (a documentId) or Firefox does (tab and frame). */
export const builderSender = (api, { documentId = "builder-document-1", tab = 7, frameId = 0, hash = "#make" } = {}) => ({
  id: api.runtime.id,
  url: `${api.runtime.getURL("pages/settings.html")}${hash}`,
  ...(documentId === null ? {} : { documentId }),
  ...(tab === null ? {} : { tab: { id: tab }, frameId }),
});

// ---------------------------------------------------------------------------------------------
// A small DOM for the lifecycle: elements, attribute and childList mutation observers, events,
// media lists, a virtual clock, animation frames and a page storage that records every call.

class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.textContent = "";
  }
  get id() {
    return this.attributes.get("id") ?? "";
  }
  set id(value) {
    this.setAttribute("id", value);
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  setAttribute(name, value) {
    const oldValue = this.getAttribute(name);
    this.attributes.set(name, String(value));
    this.ownerDocument._record({ type: "attributes", target: this, attributeName: name, oldValue });
  }
  removeAttribute(name) {
    if (!this.attributes.has(name)) return;
    const oldValue = this.attributes.get(name);
    this.attributes.delete(name);
    this.ownerDocument._record({ type: "attributes", target: this, attributeName: name, oldValue });
  }
  append(child) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    this.ownerDocument._record({ type: "childList", target: this, addedNodes: [child], removedNodes: [] });
  }
  remove() {
    const parent = this.parentNode;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentNode = null;
    this.ownerDocument._record({ type: "childList", target: parent, addedNodes: [], removedNodes: [this] });
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument.documentElement;
  }
}

class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.readyState = "loading";
    this.visibilityState = "visible";
    this.observers = new Set();
    this.documentElement = new FakeElement("html", this);
    this.documentElement.append(new FakeElement("head", this));
    this.documentElement.append(new FakeElement("body", this));
  }
  createElement(tag) {
    return new FakeElement(tag, this);
  }
  getElementById(id) {
    const walk = (node) => (node.id === id ? node : node.children.map(walk).find(Boolean) ?? null);
    return walk(this.documentElement);
  }
  _record(record) {
    for (const observer of this.observers) observer._offer(record);
  }
}

export function fakePage({ colorMode = "dark", darkTheme = "dark", lightTheme = "light", media = {} } = {}) {
  const document = new FakeDocument();
  const root = document.documentElement;
  root.attributes.set("data-color-mode", colorMode);
  root.attributes.set("data-dark-theme", darkTheme);
  root.attributes.set("data-light-theme", lightTheme);

  const clock = { now: 0 };
  let timerId = 0;
  const timers = new Map();
  let frameId = 0;
  const frames = new Map();
  const pageStorage = [];
  const mediaLists = new Map();

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      this.queue = [];
    }
    observe(target, options) {
      this.targets.push({ target, options });
      document.observers.add(this);
    }
    disconnect() {
      this.targets = [];
      this.queue = [];
      document.observers.delete(this);
    }
    _offer(record) {
      const wanted = this.targets.some(({ target, options }) => target === record.target
        && ((record.type === "attributes" && options.attributes && (!options.attributeFilter || options.attributeFilter.includes(record.attributeName)))
          || (record.type === "childList" && options.childList)));
      if (!wanted) return;
      if (!this.queue.length) queueMicrotask(() => {
        const records = this.queue.splice(0);
        if (records.length && document.observers.has(this)) this.callback(records, this);
      });
      this.queue.push(record);
    }
  }

  class FakeMediaList extends EventTarget {
    constructor(query) {
      super();
      this.media = query;
      this.matches = Boolean(media[query]);
    }
  }

  const view = new EventTarget();
  Object.assign(view, {
    document,
    performance: { now: () => clock.now },
    MutationObserver: FakeMutationObserver,
    setTimeout: (fn, ms = 0) => {
      const id = ++timerId;
      timers.set(id, { fn, at: clock.now + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => {
      const id = ++frameId;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    matchMedia: (query) => {
      if (!mediaLists.has(query)) mediaLists.set(query, new FakeMediaList(query));
      return mediaLists.get(query);
    },
  });
  Object.defineProperty(view, "localStorage", {
    configurable: true,
    get() {
      return {
        getItem: (key) => pageStorage.push(["getItem", key]) && null,
        setItem: (key, value) => pageStorage.push(["setItem", key, value]),
        removeItem: (key) => pageStorage.push(["removeItem", key]),
        clear: () => pageStorage.push(["clear"]),
        key: (index) => pageStorage.push(["key", index]) && null,
      };
    },
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    document,
    view,
    root,
    clock,
    pageStorage,
    timers,
    frames,
    /** Moves virtual time forward, running due timers in order. */
    async advance(ms) {
      const end = clock.now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        clock.now = Math.max(clock.now, due[1].at);
        due[1].fn();
        await settle();
      }
      clock.now = end;
      await settle();
    },
    /** Runs one animation frame: every queued callback, 16 ms later. */
    async frame() {
      clock.now += 16;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((fn) => fn(clock.now));
      await settle();
    },
    settle,
    setMedia(query, matches) {
      const list = view.matchMedia(query);
      list.matches = matches;
      list.dispatchEvent(new Event("change"));
    },
    fire(target, type, extra = {}) {
      const event = new Event(type);
      Object.assign(event, extra);
      (target === "view" ? view : document).dispatchEvent(event);
    },
    style: () => document.getElementById("reskin-style"),
    observerCount: () => document.observers.size,
  };
}

/** A renderer over the real engine and the synthetic seeds, counting its calls. */
export function testRenderer({ decorateCost = 0, clock, nativeRoute } = {}) {
  const calls = { resolve: 0, compile: 0, decorate: 0, destroyed: 0 };
  return {
    calls,
    nativeRoute,
    modeAttributes: ["data-color-mode", "data-light-theme", "data-dark-theme"],
    readPage(document, view) {
      const root = document.documentElement;
      return {
        native: { colorMode: root.getAttribute("data-color-mode"), lightTheme: root.getAttribute("data-light-theme"), darkTheme: root.getAttribute("data-dark-theme"), systemDark: view.matchMedia("(prefers-color-scheme: dark)").matches },
        forcedColors: view.matchMedia("(forced-colors: active)").matches,
        reducedMotion: view.matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
    },
    plan(page, base) {
      const theme = page.native?.colorMode === "light" ? page.native.lightTheme : page.native?.darkTheme;
      if (/high_contrast/.test(theme ?? "")) return { plan: { seedMode: null, policy: "native-high-contrast" }, seed: null };
      if (!page.native) return { plan: { seedMode: null, policy: "native-unknown" }, seed: null };
      return { plan: { seedMode: SEEDS[base].id, policy: "themed" }, seed: SEEDS[base] };
    },
    resolve(theme, ctx) {
      calls.resolve++;
      return resolveTheme(theme, ctx);
    },
    compile(resolved, plan, prefs) {
      calls.compile++;
      const css = resolved.policy === "themed" ? `:root{--reskin-canvas:${resolved.tokens.canvas}}` : "";
      return { css, fingerprint: sha256(new TextEncoder().encode(JSON.stringify([resolved.sourceHash, resolved.seedHash, resolved.motionAllowed, plan, prefs]))).slice(0, 16) };
    },
    decorate() {
      calls.decorate++;
      if (clock) clock.now += decorateCost;
      return { destroy: () => calls.destroyed++ };
    },
  };
}
