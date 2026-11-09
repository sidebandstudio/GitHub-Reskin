// createGmHost: the UiHost the shared picker (packages/ui) runs on in the userscript frame. The
// extension's host asks its background; here the userscript is its own settings writer, so the
// host wraps C4's repository over the GM storage adapter. Settings stay separate from any
// installed extension's: they live in the manager's storage, and files are the way across.
import { STORAGE_KEYS } from "../packages/contracts/index.js";
import { cleanUi } from "../packages/ui/host.js";

const UI_KEYS = ["group", "undoneAt"];
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
    async commit(action, expectedRevision) {
      try {
        return (await repository.commit(action, expectedRevision)) ?? storageFailure("No reply");
      } catch (error) {
        return storageFailure(error);
      }
    },
    async writeUi(patch) {
      if (Object.keys(patch).some((key) => !UI_KEYS.includes(key))) throw new TypeError("Unknown UI record field");
      const current = cleanUi((await storage.get([STORAGE_KEYS.ui]))[STORAGE_KEYS.ui]);
      await storage.set({ [STORAGE_KEYS.ui]: cleanUi({ ...current, ...patch }) });
    },
    subscribe(listener) {
      return storage.subscribe((changes) => {
        if (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.lastGood]) listener();
      });
    },
    loadDraft: () => repository.loadDraft(),
    saveDraft: (draft) => repository.saveDraft(draft),
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
    // A local file download: a blob link clicked in the page. Nothing leaves the browser.
    async downloadFile({ filename, mime, bytes }) {
      try {
        const doc = view.document;
        const url = view.URL.createObjectURL(new view.Blob([bytes], { type: mime }));
        const link = doc.createElement("a");
        link.href = url;
        link.download = filename;
        link.hidden = true;
        doc.documentElement.append(link);
        link.click();
        link.remove();
        view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    reducedMotion: () => Boolean(view.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
  };
}
