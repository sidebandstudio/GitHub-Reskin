// The userscript's StorageAdapter over whatever its manager grants, with an honest capability
// report. Three cases:
//   sync     GM_getValue/GM_setValue (Tampermonkey, Violentmonkey). Values are read synchronously
//            and wrapped in promises, so callers see one async contract.
//   async    GM.getValue/GM.setValue (Greasemonkey 4, Userscripts for Safari, FireMonkey, and
//            Tampermonkey/Violentmonkey when only the GM.* grants exist).
//   session  neither: the values live in this page's memory and are gone on reload. Nothing ever
//            falls back to the page's localStorage, sessionStorage, IndexedDB or cookies.
// get() takes a key list and returns only the keys that are saved, or an object of defaults and
// returns a value for every key, as storage.local does; 1.1.0's GM adapter fix depends on the
// list form telling a missing theme from a saved one.
//
// Cross-tab: a manager with GM_addValueChangeListener (or GM.addValueChangeListener) reports
// another tab's writes, and subscribers hear those as changes. Without one, a tab that becomes
// visible again reports every watched key as changed, so it re-reads what other tabs saved.
// Writes made through this adapter are reported to its own subscribers at once.
import { STORAGE_KEYS } from "../packages/contracts/index.js";
import { RECOVERY_KEY } from "../packages/settings/index.js";

// The records another tab can change that this tab shows.
export const WATCHED_KEYS = Object.freeze([STORAGE_KEYS.settings, STORAGE_KEYS.boot, STORAGE_KEYS.lastGood, STORAGE_KEYS.ui, STORAGE_KEYS.draft, RECOVERY_KEY]);

const fn = (value) => (typeof value === "function" ? value : null);
// GM values are JSON. A value is copied on the way in and out of session memory, so a caller that
// edits what it read or wrote never edits the stored record, as with real GM storage.
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * The storage functions a manager granted, from the userscript's scope.
 * @param {object} scope {GM, GM_getValue, GM_setValue, GM_deleteValue, GM_addValueChangeListener, GM_removeValueChangeListener}
 * @returns {{kind:'sync'|'async'|'session', get, set, remove, listen}}
 */
export function detectGmStorage(scope = {}) {
  const gm = scope.GM && typeof scope.GM === "object" ? scope.GM : null;
  const listenWith = (add, removeListener) =>
    add
      ? (key, listener) => {
          const id = add(key, (name, oldValue, newValue, remote) => listener(name, oldValue, newValue, remote));
          return () => {
            try {
              removeListener?.(id);
            } catch {
              // The manager already dropped it.
            }
          };
        }
      : null;
  const listen = listenWith(fn(scope.GM_addValueChangeListener), fn(scope.GM_removeValueChangeListener)) ?? listenWith(fn(gm?.addValueChangeListener)?.bind(gm), fn(gm?.removeValueChangeListener)?.bind(gm));

  const getSync = fn(scope.GM_getValue);
  const setSync = fn(scope.GM_setValue);
  if (getSync && setSync) {
    const deleteSync = fn(scope.GM_deleteValue);
    return {
      kind: "sync",
      get: async (key) => getSync(key, undefined),
      set: async (key, value) => setSync(key, value),
      // A manager without GM_deleteValue gets null, which every reader treats as absent.
      remove: async (key) => (deleteSync ? deleteSync(key) : setSync(key, null)),
      listen,
    };
  }
  const getAsync = fn(gm?.getValue);
  const setAsync = fn(gm?.setValue);
  if (getAsync && setAsync) {
    const deleteAsync = fn(gm.deleteValue);
    return {
      kind: "async",
      get: (key) => getAsync.call(gm, key, undefined),
      set: (key, value) => setAsync.call(gm, key, value),
      remove: (key) => (deleteAsync ? deleteAsync.call(gm, key) : setAsync.call(gm, key, null)),
      listen,
    };
  }
  const memory = new Map();
  return {
    kind: "session",
    get: async (key) => copy(memory.get(key)),
    set: async (key, value) => void memory.set(key, copy(value)),
    remove: async (key) => void memory.delete(key),
    listen: null,
  };
}

/**
 * @param {object} scope see detectGmStorage
 * @param {{document?: Document}} [options] the page, for the visibility fallback
 * @returns {{storage: import("../packages/contracts/index.js").StorageAdapter, kind: string, capabilities: import("../packages/contracts/index.js").UiHostCapabilities}}
 */
export function createGmStorage(scope = {}, { document = null } = {}) {
  const backend = detectGmStorage(scope);
  const subscribers = new Set();
  const emit = (changes) => {
    for (const listener of [...subscribers]) {
      try {
        listener(changes);
      } catch {
        // One subscriber's failure does not stop the others.
      }
    }
  };

  // Remote changes reach subscribers only while someone listens, so a page that never subscribes
  // registers nothing with the manager.
  let detach = null;
  function attach() {
    if (backend.kind === "session") return () => {};
    if (backend.listen) {
      const removers = WATCHED_KEYS.map((key) =>
        backend.listen(key, (name, oldValue, newValue, remote) => {
          // This tab's own writes were reported when they were made.
          if (remote !== false) emit({ [name]: { oldValue, newValue } });
        }),
      );
      return () => removers.forEach((remove) => remove());
    }
    if (!document) return () => {};
    const visible = () => {
      if (document.visibilityState === "visible") emit(Object.fromEntries(WATCHED_KEYS.map((key) => [key, {}])));
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }

  const keysOf = (request) => {
    if (typeof request === "string") return { keys: [request], defaults: null };
    if (Array.isArray(request)) return { keys: request, defaults: null };
    if (request && typeof request === "object") return { keys: Object.keys(request), defaults: request };
    throw new TypeError("GM storage get takes a key, a key list or an object of defaults");
  };

  const storage = {
    async get(request) {
      const { keys, defaults } = keysOf(request);
      const values = await Promise.all(keys.map((key) => backend.get(key)));
      const out = {};
      keys.forEach((key, i) => {
        const value = values[i] === undefined && defaults ? defaults[key] : values[i];
        if (value !== undefined) out[key] = value;
      });
      return out;
    },
    async set(record) {
      const entries = Object.entries(record).filter(([, value]) => value !== undefined);
      await Promise.all(entries.map(([key, value]) => backend.set(key, value)));
      emit(Object.fromEntries(entries.map(([key, value]) => [key, { newValue: value }])));
    },
    async remove(keys) {
      const list = typeof keys === "string" ? [keys] : keys;
      await Promise.all(list.map((key) => backend.remove(key)));
      emit(Object.fromEntries(list.map((key) => [key, { newValue: undefined }])));
    },
    subscribe(listener) {
      subscribers.add(listener);
      detach ??= attach();
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size && detach) {
          detach();
          detach = null;
        }
      };
    },
  };

  const durable = backend.kind !== "session";
  return {
    storage,
    kind: backend.kind,
    capabilities: Object.freeze({
      durableStorage: durable,
      // Remote change events when the manager has them, visibility re-reads otherwise.
      crossTabUpdates: durable,
      crossTabEvents: durable && Boolean(backend.listen),
      clipboard: false,
      fileDownload: true,
    }),
  };
}
