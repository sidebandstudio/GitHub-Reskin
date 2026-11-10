// createGmHost: the UiHost the shared picker (packages/ui) runs on in the userscript frame. The
// extension's host asks its background; here the userscript is its own settings writer, so the
// host wraps C4's repository over the GM storage adapter. Settings stay separate from any
// installed extension's: they live in the manager's storage, and files are the way across.
//
// Every tab writes for itself, so each commit runs whole under storage.js's cross-tab lock: the
// repository reads the latest settings, checks the revision the picker showed, applies the action
// to them and writes, with no other tab of the origin in between. A commit made from a revision
// another tab has since replaced is a conflict with the current settings, which the picker answers
// by applying a preference change again on them and by telling the user a theme choice was not
// kept. A write lost without the lock (storage.js confirms each one) is reported the same way, and
// a lock that stays busy as a storage failure with Retry. apply() is the manager menu's commit: the
// action (or the action a function makes of them) on whatever the settings are inside the lock,
// since a menu entry names its own change.
import { ISSUE_CODES, STORAGE_KEYS } from "../packages/contracts/index.js";
import { cleanUi } from "../packages/ui/host.js";
import { WRITE_LOST } from "./storage.js";

const UI_KEYS = ["group", "undoneAt"];
const CONFLICT = "Settings changed in another window. Review the current settings and try again.";
const lost = (reply) => reply?.ok === false && reply.code === "storage" && reply.issues?.some((issue) => String(issue?.message).includes(WRITE_LOST));
const storageFailure = (error) => ({ ok: false, code: "storage", issues: [{ code: "storage", path: "", message: String(error?.message ?? error), severity: "error" }] });

/**
 * @param {object} options
 * @param {import("../packages/contracts/index.js").StorageAdapter} options.storage GM storage (storage.js)
 * @param {object} options.repository createRepository(storage, context) from packages/settings
 * @param {object} options.capabilities from createGmStorage
 * @param {Window} options.view the page window, for media queries, clipboard and downloads
 * @param {(page:string, query?:object)=>void} [options.openPage] shows another part of the panel
 */
export function createGmHost({ storage, repository, capabilities, view, openPage = () => {} }) {
  async function locked(task) {
    try {
      const reply = (await (storage.transaction ?? ((run) => run()))(task)) ?? storageFailure("No reply");
      if (!lost(reply)) return reply;
      const now = await repository.read();
      if (!now.ok) return reply;
      return { ok: false, code: "conflict", current: now.settings, issues: [{ code: ISSUE_CODES.conflict, path: "/revision", message: CONFLICT, severity: "error" }] };
    } catch (error) {
      return storageFailure(error);
    }
  }
  return {
    capabilities: Object.freeze({ ...capabilities, clipboard: typeof view.navigator?.clipboard?.writeText === "function" }),
    async read() {
      try {
        await repository.initialize();
        const result = await repository.read();
        if (!result.ok) return { ok: false, message: result.issues?.[0]?.message ?? "Settings could not be read.", settings: result.fallback ?? null };
        const records = await storage.get([STORAGE_KEYS.lastGood, STORAGE_KEYS.ui]).catch(() => ({}));
        return { ok: true, settings: result.settings, notices: result.notices ?? [], lastGood: records[STORAGE_KEYS.lastGood] ?? null, ui: cleanUi(records[STORAGE_KEYS.ui]) };
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) };
      }
    },
    commit: (action, expectedRevision) => locked(() => repository.commit(action, expectedRevision)),
    apply: (action) =>
      locked(async () => {
        await repository.initialize();
        const now = await repository.read();
        if (!now.ok) return { ok: false, code: "invalid", issues: now.issues ?? [] };
        return repository.commit(typeof action === "function" ? action(now.settings) : action, now.settings.revision);
      }),
    async writeUi(patch) {
      if (Object.keys(patch).some((key) => !UI_KEYS.includes(key))) throw new TypeError("Unknown UI record field");
      const current = cleanUi((await storage.get([STORAGE_KEYS.ui]))[STORAGE_KEYS.ui]);
      await storage.set({ [STORAGE_KEYS.ui]: cleanUi({ ...current, ...patch }) });
    },
    // Settings another tab saved. This tab's own commits answer with their settings, and a re-read
    // started by their write could land after the next change and show the one before it.
    subscribe(listener) {
      return storage.subscribe((changes, { own = false } = {}) => {
        if (!own && (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.lastGood])) listener();
      });
    },
    loadDraft: () => repository.loadDraft(),
    // The UiHost's answer, as the extension's background gives it: {ok:true}, or the repository's
    // issues (a draft over its size limit) or the storage failure.
    async saveDraft(draft) {
      try {
        await repository.saveDraft(draft);
        return { ok: true };
      } catch (error) {
        return { ok: false, issues: error?.issues ?? storageFailure(error).issues };
      }
    },
    discardDraft: () => repository.discardDraft(),
    async openPage(page, query) {
      openPage(page, query);
      return { ok: true };
    },
    async copyText(text) {
      try {
        await view.navigator.clipboard.writeText(text);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    // A local file download: a blob link clicked in `doc`, the panel's frame, so the file never
    // passes through GitHub's own document (the page's by default). Nothing leaves the browser.
    async downloadFile({ filename, mime, bytes }, doc = view.document) {
      try {
        const win = doc.defaultView ?? view;
        const url = win.URL.createObjectURL(new win.Blob([bytes], { type: mime }));
        const link = doc.createElement("a");
        link.href = url;
        link.download = filename;
        link.hidden = true;
        doc.documentElement.append(link);
        link.click();
        link.remove();
        win.setTimeout(() => win.URL.revokeObjectURL(url), 0);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    reducedMotion: () => Boolean(view.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
  };
}
