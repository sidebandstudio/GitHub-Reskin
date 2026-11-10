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
// One record, one write. The extension's records (settings, boot, lastGood, ui, draft and
// recovery) live together in the single manager value STATE_KEY, so a commit that writes several
// of them is one GM write: the manager stores all of it or none of it. When the manager reports a
// failed write, the record is read back: if the write landed after all it counts, otherwise
// nothing changed. Other keys (the 1.1.0 userscript's, which migration reads and removes) stay
// one manager value each.
//
// Checked and confirmed writes. The extension has one background writer; here every tab is its
// own, and a manager has no compare-and-swap. Two steps keep the repository's revision check
// whole across tabs:
//   - checked: right before writing, the stored record is read again, and settings must still be
//     the revision the new one follows (one less, or the same for a Revision 3 upgrade); a boot
//     record written alone must match the stored settings. Otherwise another tab committed since
//     the repository read, and the write fails with WRITE_LOST.
//   - confirmed: each write carries a stamp and the stamps it replaced, and is acknowledged only
//     once it is still in the stored record, or in the lineage of what replaced it, CONFIRM_MS
//     after it was made. Of two tabs that wrote over the same record in that window, the
//     overwritten one fails with WRITE_LOST.
// The host reports WRITE_LOST as a conflict, so a later save never silently undoes an
// acknowledged one. A UI or draft record, which does not depend on what was read, is written
// again instead. This assumes a manager delivers one tab's write to the others within CONFIRM_MS.
//
// Cross-tab: a manager with GM_addValueChangeListener (or GM.addValueChangeListener) reports
// another tab's writes, and subscribers hear the records that changed. Without one, a tab that
// becomes visible again reports every watched key as changed, so it re-reads what other tabs
// saved. Writes made through this adapter are reported to its own subscribers once confirmed.
import { STORAGE_KEYS } from "../packages/contracts/index.js";
import { RECOVERY_KEY } from "../packages/settings/index.js";

// The records another tab can change that this tab shows, which live in STATE_KEY.
export const WATCHED_KEYS = Object.freeze([STORAGE_KEYS.settings, STORAGE_KEYS.boot, STORAGE_KEYS.lastGood, STORAGE_KEYS.ui, STORAGE_KEYS.draft, RECOVERY_KEY]);
export const STATE_KEY = "reskin.state";
export const STATE_FORMAT = 1;
export const CONFIRM_MS = 50;
export const WRITE_LOST = "Another tab saved at the same time, so this change was not kept.";
// Whether `records` would replace a settings revision other than the one it follows.
function staleWrite(before, records) {
  const next = records[STORAGE_KEYS.settings];
  const prev = before[STORAGE_KEYS.settings];
  if (!same(next, prev) && isObject(next)) {
    if (!isObject(prev) || typeof prev.revision !== "number") return false;
    if (next.revision === prev.revision + 1) return false;
    const revision3 = !("cssConsent" in prev) || !isObject(prev.preferences) || !("appearance" in prev.preferences);
    return !(next.revision === prev.revision && revision3);
  }
  const boot = records[STORAGE_KEYS.boot];
  if (!same(boot, before[STORAGE_KEYS.boot]) && isObject(boot) && isObject(next)) return boot.settingsRevision !== next.revision;
  return false;
}

// Records whose writes do not depend on anything read, so a lost write is simply made again.
const SELF_CONTAINED = new Set([STORAGE_KEYS.ui, STORAGE_KEYS.draft]);
const RETRIES = 3;
const LINEAGE = 16;

const fn = (value) => (typeof value === "function" ? value : null);
// GM values are JSON. A value is copied on the way in and out of session memory, so a caller that
// edits what it read or wrote never edits the stored record, as with real GM storage.
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

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

/** The records of a stored STATE_KEY value; a missing one is empty, a malformed one is refused. */
export function stateRecords(value) {
  if (value === undefined || value === null) return {};
  if (!isObject(value) || value.format !== STATE_FORMAT || !isObject(value.records)) throw new Error("The saved GitHub Reskin record is unreadable");
  return value.records;
}

/**
 * @param {object} scope see detectGmStorage
 * @param {{document?: Document, newId?: () => string, confirmMs?: number, wait?: (ms:number) => Promise<void>}} [options]
 *   the page, for the visibility fallback; the tab's stamp prefix; how long a write is watched
 * @returns {{storage: import("../packages/contracts/index.js").StorageAdapter, kind: string, capabilities: import("../packages/contracts/index.js").UiHostCapabilities}}
 */
export function createGmStorage(scope = {}, { document = null, newId = () => globalThis.crypto.randomUUID(), confirmMs = CONFIRM_MS, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const backend = detectGmStorage(scope);
  const tab = newId();
  let sequence = 0;
  const subscribers = new Set();
  const emit = (changes) => {
    if (!Object.keys(changes).length) return;
    for (const listener of [...subscribers]) {
      try {
        listener(changes);
      } catch {
        // One subscriber's failure does not stop the others.
      }
    }
  };
  const diff = (before, after) => {
    const changes = {};
    for (const key of WATCHED_KEYS) if (!same(before[key], after[key])) changes[key] = { oldValue: before[key], newValue: after[key] };
    return changes;
  };

  // Remote changes reach subscribers only while someone listens, so a page that never subscribes
  // registers nothing with the manager.
  let detach = null;
  function attach() {
    if (backend.kind === "session") return () => {};
    if (backend.listen) {
      return backend.listen(STATE_KEY, (name, oldValue, newValue, remote) => {
        // This tab's own writes are reported once they are confirmed.
        if (remote === false) return;
        let before = {};
        let after = {};
        try {
          before = stateRecords(oldValue);
        } catch {
          // An unreadable old record: every record of the new one is a change.
        }
        try {
          after = stateRecords(newValue);
        } catch {
          return emit(Object.fromEntries(WATCHED_KEYS.map((key) => [key, {}])));
        }
        emit(diff(before, after));
      });
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
  const watched = (key) => WATCHED_KEYS.includes(key);

  // This tab's writes, one at a time.
  let queue = Promise.resolve();
  const serialize = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  // One write of STATE_KEY: the stored record with `update` applied, confirmed as described above.
  async function writeState(update) {
    for (let attempt = 0; ; attempt++) {
      const stored = await backend.get(STATE_KEY);
      const before = stateRecords(stored);
      const records = update({ ...before });
      if (staleWrite(before, records)) throw new Error(WRITE_LOST);
      const stamp = `${tab}:${++sequence}`;
      const lineage = isObject(stored) && typeof stored.stamp === "string" ? [stored.stamp, ...(Array.isArray(stored.lineage) ? stored.lineage : [])].slice(0, LINEAGE) : [];
      const next = { format: STATE_FORMAT, stamp, lineage, records };
      try {
        await backend.set(STATE_KEY, next);
      } catch (error) {
        // A write the manager reported as failed may still have landed; it counts only if it did.
        let landed = null;
        try {
          landed = await backend.get(STATE_KEY);
        } catch {
          // Unreadable now: report the failure; the record is whichever single write landed.
        }
        if (landed?.stamp !== stamp) throw error;
      }
      if (backend.kind !== "session") {
        await wait(confirmMs);
        const now = await backend.get(STATE_KEY);
        if (!(now?.stamp === stamp || (Array.isArray(now?.lineage) && now.lineage.includes(stamp)))) {
          const keys = Object.keys(records).filter((key) => !same(records[key], before[key]));
          if (attempt < RETRIES && keys.every((key) => SELF_CONTAINED.has(key))) continue;
          throw new Error(WRITE_LOST);
        }
      }
      emit(diff(before, records));
      return;
    }
  }

  const storage = {
    async get(request) {
      const { keys, defaults } = keysOf(request);
      const own = keys.some(watched) ? stateRecords(await backend.get(STATE_KEY)) : {};
      const values = await Promise.all(keys.map((key) => (watched(key) ? copy(own[key]) : backend.get(key))));
      const out = {};
      keys.forEach((key, i) => {
        const value = values[i] === undefined && defaults ? defaults[key] : values[i];
        if (value !== undefined) out[key] = value;
      });
      return out;
    },
    set(record) {
      const entries = Object.entries(record).filter(([, value]) => value !== undefined);
      const own = entries.filter(([key]) => watched(key));
      const other = entries.filter(([key]) => !watched(key));
      return serialize(async () => {
        if (own.length) await writeState((records) => Object.assign(records, copy(Object.fromEntries(own))));
        await Promise.all(other.map(([key, value]) => backend.set(key, value)));
      });
    },
    remove(keys) {
      const list = typeof keys === "string" ? [keys] : keys;
      return serialize(async () => {
        if (list.some(watched)) {
          await writeState((records) => {
            for (const key of list) delete records[key];
            return records;
          });
        }
        await Promise.all(list.filter((key) => !watched(key)).map((key) => backend.remove(key)));
      });
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
