// A fake userscript manager for the unit tests. kind "sync" grants GM_* (with the change listener
// Tampermonkey and Violentmonkey have), "async" grants GM.* only, "none" grants nothing. Values
// are JSON-copied on the way in and out, as managers store them. remoteWrite() is another tab's
// write: the value changes and listeners hear it with remote true. Several fakes can share one
// `values` map, as tabs share one manager. `refuse(key, value)` returning "refuse" makes a write
// fail with nothing stored, "after" makes it fail after it was stored.
import { STORAGE_KEYS } from "../../packages/contracts/index.js";
import { RECOVERY_KEY } from "../../packages/settings/index.js";

// userscript/storage.js's STATE_KEY, spelled out so these tests also run against the earlier layout.
export const STATE_KEY = "reskin.state";

export const RECORD_KEYS = [...Object.values(STORAGE_KEYS), RECOVERY_KEY];

/** The extension records as a reader sees them, from a fake's snapshot: in STATE_KEY, or one key each (the 1.x-era layout). */
export function records(snapshot) {
  if (snapshot[STATE_KEY]) return { ...snapshot[STATE_KEY].records };
  return Object.fromEntries(RECORD_KEYS.filter((key) => key in snapshot).map((key) => [key, snapshot[key]]));
}

export function fakeGm(kind = "sync", initial = {}, { listeners: withListeners = kind === "sync", deleteValue = true, values: shared = null, refuse = null } = {}) {
  const values = shared ?? new Map();
  if (!shared) for (const [key, value] of Object.entries(initial)) values.set(key, JSON.stringify(value));
  const listeners = new Map();
  let nextId = 1;
  const calls = [];
  const fire = (key, oldValue, newValue, remote) => {
    for (const entry of listeners.values()) if (entry.key === key) entry.listener(key, oldValue, newValue, remote);
  };
  const read = (key, fallback) => (values.has(key) ? JSON.parse(values.get(key)) : fallback);
  const get = (key, fallback) => {
    calls.push(["get", key]);
    return read(key, fallback);
  };
  const set = (key, value, remote = false) => {
    calls.push(["set", key]);
    const refused = !remote && fake.refuse?.(key, value);
    if (refused === "refuse") throw new Error("The manager refused the write");
    const old = read(key);
    values.set(key, JSON.stringify(value));
    fire(key, old, value, remote);
    if (refused === "after") throw new Error("The manager reported a failure after storing");
  };
  const del = (key) => {
    calls.push(["delete", key]);
    const old = read(key);
    values.delete(key);
    fire(key, old, undefined, false);
  };
  const scope = {};
  if (kind === "sync") {
    Object.assign(scope, { GM_getValue: get, GM_setValue: (key, value) => set(key, value) });
    if (deleteValue) scope.GM_deleteValue = del;
  }
  if (kind === "async") {
    scope.GM = { getValue: async (key, fallback) => get(key, fallback), setValue: async (key, value) => set(key, value) };
    if (deleteValue) scope.GM.deleteValue = async (key) => del(key);
  }
  if (withListeners && kind !== "none") {
    scope.GM_addValueChangeListener = (key, listener) => {
      const id = nextId++;
      listeners.set(id, { key, listener });
      return id;
    };
    scope.GM_removeValueChangeListener = (id) => listeners.delete(id);
  }
  const fake = {
    refuse,
    scope,
    calls,
    listeners,
    snapshot: () => Object.fromEntries([...values].map(([key, value]) => [key, JSON.parse(value)])),
    remoteWrite: (key, value) => set(key, value, true),
  };
  return fake;
}

/** A minimal document for the visibility fallback. */
export function fakeDocument() {
  const handlers = new Set();
  return {
    visibilityState: "visible",
    addEventListener: (type, handler) => type === "visibilitychange" && handlers.add(handler),
    removeEventListener: (type, handler) => handlers.delete(handler),
    show() {
      this.visibilityState = "visible";
      for (const handler of [...handlers]) handler();
    },
    hide() {
      this.visibilityState = "hidden";
      for (const handler of [...handlers]) handler();
    },
    handlers,
  };
}
