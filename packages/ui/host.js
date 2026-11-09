// UiHost: what the picker needs from its runtime, without browser-specific globals. The extension
// host below talks to C4's background for settings and reads its own small records directly; the
// userscript (C8) supplies the same interface over GM storage.
//
//   read()                         -> {ok, settings, notices, lastGood, ui} or {ok:false, message}
//   commit(action, revision)       -> SettingsReply from the background
//   writeUi(patch)                 -> merges into the reskin.ui record (gallery group, Undo state)
//   subscribe(listener)            -> unsubscribe; called when settings or lastGood change elsewhere
//   openPage(page, query?)         -> opens an internal page in a tab
//   reducedMotion()                -> the device's reduced-motion setting
import { STORAGE_KEYS } from "../contracts/index.js";

const requestId = () => crypto.randomUUID().replace(/-/g, "");
const UI_KEYS = ["group", "undoneAt"];

/** The reskin.ui record with only known fields: the last gallery group and the lastGood revision Undo already used. */
export function cleanUi(value) {
  const ui = {};
  if (value && typeof value === "object") {
    if (["anime", "classics", "mine"].includes(value.group)) ui.group = value.group;
    if (Number.isSafeInteger(value.undoneAt)) ui.undoneAt = value.undoneAt;
  }
  return ui;
}

/** @param {object} api the chrome or browser namespace of an extension page */
export function createExtensionHost(api, { view = globalThis } = {}) {
  const send = (request) => api.runtime.sendMessage({ requestId: requestId(), ...request });
  const local = api.storage.local;

  return {
    async read() {
      let reply;
      try {
        reply = await send({ type: "get" });
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) };
      }
      if (!reply?.ok) return { ok: false, message: reply?.issues?.[0]?.message ?? "Settings could not be read.", settings: reply?.current ?? null };
      const records = await local.get([STORAGE_KEYS.lastGood, STORAGE_KEYS.ui]).catch(() => ({}));
      return { ok: true, settings: reply.settings, notices: reply.notices ?? [], lastGood: records[STORAGE_KEYS.lastGood] ?? null, ui: cleanUi(records[STORAGE_KEYS.ui]) };
    },
    async commit(action, expectedRevision) {
      try {
        return (await send({ type: "commit", expectedRevision, action })) ?? { ok: false, code: "storage", issues: [] };
      } catch (error) {
        return { ok: false, code: "storage", issues: [{ message: String(error?.message ?? error) }] };
      }
    },
    async writeUi(patch) {
      const current = cleanUi((await local.get([STORAGE_KEYS.ui]))[STORAGE_KEYS.ui]);
      const next = cleanUi({ ...current, ...patch });
      if (Object.keys(patch).some((key) => !UI_KEYS.includes(key))) throw new TypeError("Unknown UI record field");
      await local.set({ [STORAGE_KEYS.ui]: next });
    },
    subscribe(listener) {
      const handler = (changes, area) => {
        if (area === "local" && (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.lastGood])) listener();
      };
      api.storage.onChanged.addListener(handler);
      return () => api.storage.onChanged.removeListener(handler);
    },
    openPage: (page, query) => send({ type: "open-page", action: query ? { page, query } : { page } }),
    reducedMotion: () => Boolean(view.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
  };
}
