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
// One writer at a time across tabs. The extension has one background writer; here every tab is its
// own, and a manager has no compare-and-swap. Every write of STATE_KEY, and each whole commit
// through transaction() (the repository's read, its revision check, the reduced action and the
// write), runs under one Web Lock, LOCK_NAME, which every tab of the same origin shares. Inside it
// the tab first makes sure its manager has delivered the latest write any other tab made: each tab
// holds a second, shared lock named after its last write (LOCK_NAME|time|stamp) for as long as it
// is open, and the record read must be that write or descend from it. A wait for the lock or for
// that delivery is bounded by LOCK_WAIT_MS and then fails with LOCK_BUSY, which the picker shows
// with Retry. A lock another script steals mid-commit fails the write the same way.
// In a Firefox content script a lock callback's own promise lives in the script's compartment,
// which the page's LockManager may not read, so the lock would end the moment it was granted.
// There (`bridge`) the callback is exported to the page and returns a promise of the page's
// original Promise, reached through the Xray, which page scripts cannot replace. A browser whose
// lock still fails that way is left to the revision check below.
//
// Checked and confirmed writes, kept as a second guard and as the only one where Web Locks are
// missing or the tabs are on different origins (github.com and gist.github.com share manager
// storage but not locks):
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
// again instead. Without the lock this assumes a manager delivers one tab's write to the others
// within CONFIRM_MS; a write delayed past that can still replace another tab's.
//
// Cross-tab: a manager with GM_addValueChangeListener (or GM.addValueChangeListener) reports
// another tab's writes, and subscribers hear the records that changed. Without one, a tab that
// becomes visible again reports every watched key as changed, so it re-reads what other tabs
// saved. Writes made through this adapter are reported to its own subscribers once confirmed,
// marked as this tab's own ({own: true}).
import { STORAGE_KEYS } from "../packages/contracts/index.js";
import { RECOVERY_KEY } from "../packages/settings/index.js";

// The records another tab can change that this tab shows, which live in STATE_KEY.
export const WATCHED_KEYS = Object.freeze([STORAGE_KEYS.settings, STORAGE_KEYS.boot, STORAGE_KEYS.lastGood, STORAGE_KEYS.ui, STORAGE_KEYS.draft, RECOVERY_KEY]);
export const STATE_KEY = "reskin.state";
export const STATE_FORMAT = 1;
export const CONFIRM_MS = 50;
export const WRITE_LOST = "Another tab saved at the same time, so this change was not kept.";
export const LOCK_NAME = "github-reskin-userscript-state";
export const LOCK_WAIT_MS = 5000;
export const LOCK_BUSY = "Another GitHub tab is still saving GitHub Reskin settings, so this change was not saved. Try again.";
const POLL_MS = 25;
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
 * @param {{document?: Document, newId?: () => string, confirmMs?: number, wait?: (ms:number) => Promise<void>, locks?: LockManager|null, bridge?: {exportFunction:(fn:Function)=>Function, Promise:PromiseConstructor}|null, lockName?: string, lockWaitMs?: number, now?: () => number}} [options]
 *   the page, for the visibility fallback; the tab's stamp prefix; how long a write is watched;
 *   the origin's Web Locks (navigator.locks; null: the revision check alone), the Firefox
 *   content-script bridge described above, and how long to wait
 * @returns {{storage: import("../packages/contracts/index.js").StorageAdapter, kind: string, capabilities: import("../packages/contracts/index.js").UiHostCapabilities}}
 */
export function createGmStorage(
  scope = {},
  { document = null, newId = () => globalThis.crypto.randomUUID(), confirmMs = CONFIRM_MS, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), locks = null, bridge = null, lockName = LOCK_NAME, lockWaitMs = LOCK_WAIT_MS, now = () => Date.now() } = {},
) {
  const backend = detectGmStorage(scope);
  const tab = newId();
  let sequence = 0;
  const subscribers = new Set();
  // `own`: the change is this tab's own write, which its writer already knows about.
  const emit = (changes, own = false) => {
    if (!Object.keys(changes).length) return;
    for (const listener of [...subscribers]) {
      try {
        listener(changes, { own });
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
  // Every write this tab has started, finished.
  async function drain() {
    for (let tail = queue; ; tail = queue) {
      await tail;
      if (tail === queue) return;
    }
  }

  // The cross-tab lock. `grant` is this tab's hold while it has one: a write made meanwhile runs
  // under it (the lock is not re-entrant), and the hold ends only once those writes have finished.
  let lockable = Boolean(locks && typeof locks.request === "function" && backend.kind !== "session");
  // locks.request, with the callback's promise in the page's compartment where `bridge` says so.
  // Results stay with the caller: only undefined crosses.
  const request = (name, options, callback) => {
    if (!bridge) return locks.request(name, options, callback);
    return locks.request(
      name,
      options,
      bridge.exportFunction(
        (lock) =>
          new bridge.Promise((resolve) => {
            Promise.resolve()
              .then(() => callback(lock))
              .then(
                () => resolve(),
                () => resolve(),
              );
          }),
      ),
    );
  };
  const MARK = `${lockName}|`;
  let grant = null;
  let marker = null;

  // Whether a stored record is the write a marker names, or was made from it or after it.
  const knows = (stored, { at, stamp }) => isObject(stored) && (stored.stamp === stamp || (Array.isArray(stored.lineage) && stored.lineage.includes(stamp)) || (typeof stored.at === "number" && stored.at > at));
  // Waits until the manager shows this tab every other open tab's latest write.
  async function awaitDelivery(deadline) {
    if (typeof locks.query !== "function") return;
    const { held = [] } = await locks.query();
    const marks = [];
    for (const { name } of held) {
      if (typeof name !== "string" || !name.startsWith(MARK)) continue;
      const [at, ...rest] = name.slice(MARK.length).split("|");
      const stamp = rest.join("|");
      if (!stamp.startsWith(`${tab}:`)) marks.push({ at: Number(at), stamp });
    }
    if (!marks.length) return;
    for (;;) {
      const stored = await backend.get(STATE_KEY);
      if (marks.every((mark) => knows(stored, mark))) return;
      if (now() >= deadline) throw new Error(LOCK_BUSY);
      await wait(POLL_MS);
    }
  }
  // Announces this tab's latest write for as long as the tab is open, in place of its previous one.
  async function announce(at, stamp) {
    let release = () => {};
    const kept = new Promise((resolve) => (release = resolve));
    const granted = await new Promise((resolve) => {
      Promise.resolve()
        .then(() => request(`${MARK}${at}|${stamp}`, { mode: "shared", ifAvailable: true }, (lock) => (resolve(Boolean(lock)), lock ? kept : undefined)))
        .catch(() => resolve(false));
    });
    if (!granted) return;
    marker?.();
    marker = release;
  }

  /** Runs `task` under the cross-tab lock: bounded, and after this tab has every other tab's latest write. */
  async function exclusive(task) {
    if (!lockable || grant) return task();
    const deadline = now() + lockWaitMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), lockWaitMs);
    const hold = { lost: false };
    let finished = null;
    const done = new Promise((resolve) => (finished = resolve));
    let granted = false;
    const pending = request(lockName, { signal: controller.signal }, async () => {
      granted = true;
      clearTimeout(timer);
      grant = hold;
      let outcome;
      try {
        await awaitDelivery(deadline);
        outcome = { value: await task() };
      } catch (error) {
        outcome = { error };
      }
      await drain();
      if (grant === hold) grant = null;
      finished(outcome);
    });
    try {
      await pending;
    } catch (error) {
      clearTimeout(timer);
      if (!granted) throw new Error(LOCK_BUSY);
      if (error?.name === "AbortError") {
        // Another script stole the lock: what is still running fails before it writes.
        hold.lost = true;
      } else {
        // This browser ended the lock as it granted it: the revision check alone from now on.
        lockable = false;
      }
    }
    const outcome = await done;
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  }

  // One write of STATE_KEY: the stored record with `update` applied, confirmed as described above.
  async function writeState(update) {
    for (let attempt = 0; ; attempt++) {
      const stored = await backend.get(STATE_KEY);
      const before = stateRecords(stored);
      const records = update({ ...before });
      if (staleWrite(before, records)) throw new Error(WRITE_LOST);
      if (grant?.lost) throw new Error(LOCK_BUSY);
      const stamp = `${tab}:${++sequence}`;
      const at = now();
      const lineage = isObject(stored) && typeof stored.stamp === "string" ? [stored.stamp, ...(Array.isArray(stored.lineage) ? stored.lineage : [])].slice(0, LINEAGE) : [];
      const next = { format: STATE_FORMAT, stamp, at, lineage, records };
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
      if (lockable && grant) await announce(at, stamp);
      emit(diff(before, records), true);
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
      return exclusive(() =>
        serialize(async () => {
          if (own.length) await writeState((records) => Object.assign(records, copy(Object.fromEntries(own))));
          await Promise.all(other.map(([key, value]) => backend.set(key, value)));
        }),
      );
    },
    remove(keys) {
      const list = typeof keys === "string" ? [keys] : keys;
      return exclusive(() =>
        serialize(async () => {
          if (list.some(watched)) {
            await writeState((records) => {
              for (const key of list) delete records[key];
              return records;
            });
          }
          await Promise.all(list.filter((key) => !watched(key)).map((key) => backend.remove(key)));
        }),
      );
    },
    // Runs a whole read-modify-write (a repository commit) under the cross-tab lock.
    transaction: (task) => exclusive(task),
    // Lets go of the lock that announces this tab's last write, as closing the tab does.
    release() {
      marker?.();
      marker = null;
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
