// A fake userscript manager for the unit tests. kind "sync" grants GM_* (with the change listener
// Tampermonkey and Violentmonkey have), "async" grants GM.* only, "none" grants nothing. Values
// are JSON-copied on the way in and out, as managers store them. remoteWrite() is another tab's
// write: the value changes and listeners hear it with remote true.
export function fakeGm(kind = "sync", initial = {}, { listeners: withListeners = kind === "sync", deleteValue = true } = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
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
    const old = read(key);
    values.set(key, JSON.stringify(value));
    fire(key, old, value, remote);
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
  return {
    scope,
    calls,
    listeners,
    snapshot: () => Object.fromEntries([...values].map(([key, value]) => [key, JSON.parse(value)])),
    remoteWrite: (key, value) => set(key, value, true),
  };
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
