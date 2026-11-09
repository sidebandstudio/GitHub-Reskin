// The settings repository: reads that never write, and the one serialized writer. Only the
// background creates a writing repository. Every commit re-reads storage first, so a restarted
// worker and an empty in-memory queue lose nothing; storage is the only authority.
import { ISSUE_CODES, LEGACY_STORAGE_KEYS, LOCAL_THEME_ID_PREFIX, STORAGE_KEYS } from "../contracts/index.js";
import { ActionError, reduceAction } from "./actions.js";
import { capacityIssues } from "./admission.js";
import { bootRecordProblems, buildBootRecord } from "./boot.js";
import { selectedSource } from "./catalog.js";
import { NOTICES, RECOVERY_KEY, STORAGE_LIMITS } from "./constants.js";
import { boundRecovery, hasLegacyKeys, migrateLegacy } from "./migrate.js";
import { defaultSettings, isPlainObject, issue, salvageSettings, validateSettings } from "./model.js";
import { sourceHash } from "../engine/index.js";

const ALL_KEYS = [...Object.values(STORAGE_KEYS), RECOVERY_KEY];
const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const storageIssue = (error) => issue(ISSUE_CODES.storage, "", `Storage failed: ${error?.message ?? String(error)}`);

/**
 * Reads settings without writing anything. A missing v2 record with 1.x keys returns the migration
 * preview (migrated:true); the background persists it once. A newer, damaged or unreadable record
 * returns ok:false with safe defaults as the fallback.
 */
export async function readSettings(storage, { catalog, newId = () => "00000000-0000-4000-8000-000000000000", repair } = {}) {
  let raw;
  try {
    raw = await storage.get([STORAGE_KEYS.settings, ...LEGACY_STORAGE_KEYS]);
  } catch (error) {
    return { ok: false, code: "storage", issues: [storageIssue(error)], fallback: defaultSettings(catalog) };
  }
  const stored = raw[STORAGE_KEYS.settings];
  if (stored !== undefined) {
    const result = validateSettings(stored, catalog);
    if (result.ok) return { ok: true, settings: result.settings, migrated: false, notices: result.settings.migration.notices };
    return { ok: false, code: "invalid", issues: result.issues, fallback: defaultSettings(catalog) };
  }
  if (hasLegacyKeys(raw)) {
    const { settings, notices } = migrateLegacy(raw, { catalog, newId, repair });
    return { ok: true, settings, migrated: true, notices };
  }
  return { ok: true, settings: defaultSettings(catalog), migrated: false, notices: [] };
}

/**
 * @param {import("../contracts/index.js").StorageAdapter} storage
 * @param {{catalog, snapshot?, repair?, newId:()=>string, css?, images?}} context
 *   snapshot: renderer callback for the boot record (see boot.js); repair: engine source repair
 *   for migrated colors; css/images: admission interfaces (admission.js).
 */
export function createRepository(storage, context) {
  const { catalog, snapshot } = context;
  let queue = Promise.resolve();
  // Serializes writer work in this context. Errors never poison the queue.
  const serialize = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };
  let initialized = null;

  const readAll = () => storage.get(ALL_KEYS);
  const boot = (settings) => buildBootRecord(settings, { catalog, snapshot });

  // The record a write leaves, measured with every other extension record before it is attempted.
  // A cleared draft, recovery or lastGood is written as null in the same set, never removed in a
  // second call, so a commit that reports success has no stale record beside it.
  async function write(raw, changes) {
    const after = { ...raw, ...changes };
    const capacity = capacityIssues(Object.fromEntries(ALL_KEYS.map((key) => [key, after[key]])));
    if (capacity.length) throw new ActionError("storage", capacity);
    try {
      await storage.set(changes);
    } catch (error) {
      throw new ActionError("storage", [storageIssue(error)]);
    }
  }

  /**
   * First background initialization: one explicit migrate, repair or install write. Re-reads
   * immediately before saving so an existing v2 state wins. Resolves to
   * {state:'fresh'|'migrated'|'current'|'recovered'|'newer'|'failed', settings?}.
   */
  function initialize() {
    initialized ??= serialize(async () => {
      let raw;
      try {
        raw = await storage.get([...ALL_KEYS, ...LEGACY_STORAGE_KEYS]);
      } catch (error) {
        initialized = null;
        return { state: "failed", issues: [storageIssue(error)] };
      }
      const stored = raw[STORAGE_KEYS.settings];
      try {
        if (stored !== undefined) return await settle(raw, stored);
        const legacy = hasLegacyKeys(raw);
        const plan = legacy ? migrateLegacy(raw, context) : { settings: defaultSettings(catalog) };
        // Existing v2 state wins over a migration computed from an older read.
        const again = await storage.get([STORAGE_KEYS.settings]);
        if (again[STORAGE_KEYS.settings] !== undefined) return await settle(raw, again[STORAGE_KEYS.settings]);
        const changes = { [STORAGE_KEYS.settings]: plan.settings, [STORAGE_KEYS.boot]: boot(plan.settings) };
        if (plan.recovery) changes[RECOVERY_KEY] = plan.recovery;
        await write(raw, changes);
        if (legacy) await removeLegacyKeys(plan.settings);
        return { state: legacy ? "migrated" : "fresh", settings: plan.settings };
      } catch (error) {
        initialized = null;
        return { state: "failed", issues: error.issues ?? [storageIssue(error)] };
      }
    });
    return initialized;
  }

  // An existing v2 record: keep it, upgrade a Revision 3 shape, salvage a damaged one, never touch
  // a newer one. Refreshes a boot record an update has invalidated and finishes legacy removal.
  async function settle(raw, stored) {
    const result = validateSettings(stored, catalog);
    if (result.ok) {
      const changes = {};
      if (result.upgraded) Object.assign(changes, { [STORAGE_KEYS.settings]: result.settings, [STORAGE_KEYS.boot]: boot(result.settings) });
      else if (staleBoot(raw[STORAGE_KEYS.boot], result.settings)) changes[STORAGE_KEYS.boot] = boot(result.settings);
      if (Object.keys(changes).length) await write(raw, changes);
      if (hasLegacyKeys(raw)) await removeLegacyKeys(result.settings);
      return { state: "current", settings: result.settings };
    }
    if (result.newer) return { state: "newer", issues: result.issues };
    const { settings, dropped } = salvageSettings(stored, catalog);
    // Earlier recovery (the 1.1.0 originals or an earlier salvage) is kept whole until dismissed;
    // this salvage gets only the room left, and what does not fit is reported as truncated.
    const previous = isPlainObject(raw[RECOVERY_KEY]) ? raw[RECOVERY_KEY] : null;
    const bounded = boundRecovery(dropped, STORAGE_LIMITS.maxRecoveryBytes - (previous ? jsonBytes(previous) : 0));
    const copy = { from: "2", ...bounded.value };
    const recovery = previous ? { ...previous, salvaged: [...(Array.isArray(previous.salvaged) ? previous.salvaged : []), copy] } : copy;
    const notices = [...settings.migration.notices, NOTICES.settingsRecovered, ...(bounded.truncated ? [NOTICES.recoveryTruncated] : [])];
    settings.migration = { ...settings.migration, notices: [...new Set(notices)].slice(0, STORAGE_LIMITS.maxNotices) };
    settings.revision += 1;
    await write(raw, { [STORAGE_KEYS.settings]: settings, [STORAGE_KEYS.boot]: boot(settings), [RECOVERY_KEY]: recovery });
    return { state: "recovered", settings, issues: result.issues };
  }

  // A boot record is stale when it is missing for enabled settings, malformed, or from other
  // versions or another revision. A null record for disabled settings is current.
  function staleBoot(record, settings) {
    if (record === null || record === undefined) return settings.enabled;
    return bootRecordProblems(record).length > 0 || record.settingsRevision !== settings.revision || record.catalogHash !== catalog.hash;
  }

  // Old extension keys go only after the v2 record reloads and validates.
  async function removeLegacyKeys(expected) {
    try {
      const reread = (await storage.get([STORAGE_KEYS.settings]))[STORAGE_KEYS.settings];
      const result = validateSettings(reread, catalog);
      if (result.ok && result.settings.revision === expected.revision) await storage.remove([...LEGACY_STORAGE_KEYS]);
    } catch {
      // Removal is retried at the next initialization.
    }
  }

  /**
   * Applies one action. Checks expectedRevision against storage, reduces onto the latest state,
   * writes settings, boot and lastGood in one set, and replies only after the write resolves.
   */
  function commit(action, expectedRevision) {
    const ready = initialize();
    return serialize(async () => {
      const init = await ready;
      if (init?.state === "newer") return { ok: false, code: "invalid", issues: init.issues };
      let raw;
      try {
        raw = await readAll();
      } catch (error) {
        return { ok: false, code: "storage", issues: [storageIssue(error)] };
      }
      const result = validateSettings(raw[STORAGE_KEYS.settings], catalog);
      if (!result.ok) return { ok: false, code: "invalid", issues: result.issues };
      const current = result.settings;
      if (expectedRevision !== current.revision) {
        return { ok: false, code: "conflict", current, issues: [issue(ISSUE_CODES.conflict, "/revision", "Settings changed in another window. Review the current settings and try again.")] };
      }
      let next;
      try {
        next = reduceAction(current, action, context);
      } catch (error) {
        if (error instanceof ActionError) return { ok: false, code: error.code, current, issues: error.issues };
        throw error;
      }
      next.revision = current.revision + 1;
      const changes = { [STORAGE_KEYS.settings]: next, [STORAGE_KEYS.boot]: boot(next) };
      const notices = [];
      Object.assign(changes, lastGoodChanges(raw[STORAGE_KEYS.lastGood], current, next, notices));
      if (action.type === "resetAll") Object.assign(changes, { [STORAGE_KEYS.draft]: null, [RECOVERY_KEY]: null, [STORAGE_KEYS.lastGood]: null });
      if (action.type === "dismissMigration") changes[RECOVERY_KEY] = null;
      try {
        await write(raw, changes);
      } catch (error) {
        if (error instanceof ActionError) return { ok: false, code: error.code, current, issues: error.issues };
        throw error;
      }
      return notices.length ? { ok: true, settings: next, notices } : { ok: true, settings: next };
    });
  }

  // lastGood is one recoverable prior selection, by theme ID and source hash. Deleting its local
  // theme clears it visibly, including when that theme was the selection the action replaced.
  function lastGoodChanges(stored, current, next, notices) {
    const deleted = (id) => typeof id === "string" && id.startsWith(LOCAL_THEME_ID_PREFIX) && !next.customThemes.some((t) => t.id === id);
    const changed = current.selectedThemeId !== next.selectedThemeId;
    if (changed && !deleted(current.selectedThemeId)) {
      const source = selectedSource(current, catalog);
      return { [STORAGE_KEYS.lastGood]: source ? { themeId: current.selectedThemeId, sourceHash: sourceHash(source), revision: current.revision } : null };
    }
    if (!deleted(changed ? current.selectedThemeId : stored?.themeId)) return {};
    notices.push(NOTICES.undoCleared);
    return { [STORAGE_KEYS.lastGood]: null };
  }

  return {
    initialize,
    read: () => readSettings(storage, context),
    commit,
    async loadDraft() {
      const draft = (await storage.get([STORAGE_KEYS.draft]))[STORAGE_KEYS.draft];
      return draft === undefined ? null : draft;
    },
    saveDraft(draft) {
      return serialize(async () => {
        if (jsonBytes(draft) > STORAGE_LIMITS.maxDraftBytes) throw new ActionError("storage", [issue(ISSUE_CODES.capacity, "/draft", "This draft is larger than 1.25 MiB. Download it, then make it smaller.")]);
        await write(await readAll(), { [STORAGE_KEYS.draft]: draft });
      });
    },
    discardDraft: () => serialize(() => storage.remove([STORAGE_KEYS.draft])),
    async loadRecovery() {
      const value = (await storage.get([RECOVERY_KEY]))[RECOVERY_KEY];
      return value === undefined ? null : value;
    },
    async lastGood() {
      const value = (await storage.get([STORAGE_KEYS.lastGood]))[STORAGE_KEYS.lastGood];
      return value === undefined ? null : value;
    },
    subscribe(listener) {
      return storage.subscribe((changes) => {
        const change = changes[STORAGE_KEYS.settings];
        if (!change || change.newValue === undefined) return;
        const result = validateSettings(change.newValue, catalog);
        if (result.ok) listener(result.settings);
      });
    },
  };
}
