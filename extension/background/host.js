// The background host: the only privileged settings writer, the installation handler and the
// internal page opener. Chrome runs it as the MV3 service worker and Firefox as the nonpersistent
// background script. C6's entry calls installBackground at module load, so listeners are registered
// before any event is delivered; state is rehydrated from storage on every start.
//
// There is no external message bridge: no onMessageExternal, onConnectExternal or page messaging.
// Content scripts may only read settings.
import {
  createExtensionStorage,
  createRepository,
  queryIssues,
  READ_ONLY_REQUESTS,
  requestIssues,
  PAGE_PATHS,
} from "../../packages/settings/index.js";
import { INTERNAL_PAGES, ISSUE_CODES } from "../../packages/contracts/index.js";

const refuse = (code, path, message) => ({ ok: false, code, issues: [{ code: ISSUE_CODES.invalid, path, message, severity: "error" }] });

/**
 * @param {object} options
 * @param {object} options.api the chrome or browser namespace (runtime, tabs, storage)
 * @param {import("../../packages/contracts/index.js").StorageAdapter} [options.storage]
 * @param {object} options.catalog CatalogSource from packages/settings
 * @param {(theme:object)=>object} [options.snapshot] renderer resolution for the boot record
 * @param {(theme:object)=>{theme:object, repairs:readonly object[]}} [options.repair] engine source repair
 * @param {()=>string} [options.newId] UUID source, crypto.randomUUID by default
 * @param {object} [options.css] CssAdmission, [options.images] ImageAdmission (packages/settings/admission.js)
 */
export function createBackground({ api, storage = createExtensionStorage(api), catalog, snapshot, repair, newId = () => crypto.randomUUID(), css, images }) {
  const context = { catalog, snapshot, repair, newId, ...(css && { css }), ...(images && { images }) };
  const repository = createRepository(storage, context);
  const extensionOrigin = new URL(api.runtime.getURL("")).origin;

  const ownSender = (sender) => Boolean(sender) && sender.id === api.runtime.id;
  // A mutation must come from one of this extension's own pages, never a content script.
  const extensionPage = (sender) => {
    if (!ownSender(sender) || typeof sender.url !== "string") return false;
    try {
      return new URL(sender.url).origin === extensionOrigin;
    } catch {
      return false;
    }
  };

  // The builder document a message came from, as the browser identifies it, or null. Only the
  // settings page, where the builder lives, may ask for or redeem an advanced CSS approval ticket;
  // the popup, the first-run page and content scripts never can. The identity is the sender's
  // documentId where the browser provides one (Chrome), otherwise its tab, frame and page
  // (Firefox), so a ticket is honoured only for the document that asked for it.
  const builderPath = new URL(api.runtime.getURL(PAGE_PATHS.settings)).pathname;
  const builderDocument = (sender) => {
    if (!extensionPage(sender)) return null;
    const url = new URL(sender.url);
    if (url.pathname !== builderPath) return null;
    if (typeof sender.documentId === "string" && sender.documentId) return `document:${sender.documentId}`;
    if (Number.isSafeInteger(sender.tab?.id) && Number.isSafeInteger(sender.frameId)) return `frame:${sender.tab.id}:${sender.frameId}:${url.origin}${url.pathname}${url.search}`;
    return null;
  };

  async function openPage(page, query) {
    if (!INTERNAL_PAGES.includes(page) || queryIssues(query).length) throw new TypeError("Only internal pages with a safe query can be opened");
    const search = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
    await api.tabs.create({ url: `${api.runtime.getURL(PAGE_PATHS[page])}${search}` });
  }

  async function dispatch(request, sender) {
    if (!ownSender(sender)) return refuse("invalid", "/sender", "Requests are accepted only from this extension.");
    const issues = requestIssues(request);
    if (issues.length) return { ok: false, code: "invalid", issues };
    if (!READ_ONLY_REQUESTS.includes(request.type) && !extensionPage(sender)) return refuse("invalid", "/sender", "Only Reskin's own pages can change settings or open pages.");
    await repository.initialize();
    switch (request.type) {
      case "get": {
        const result = await repository.read();
        return result.ok ? { ok: true, settings: result.settings, notices: result.notices } : { ok: false, code: result.code, current: result.fallback, issues: result.issues };
      }
      case "commit":
        return repository.commit(request.action, request.expectedRevision, { document: builderDocument(sender) });
      case "draft":
        try {
          if (request.action.type === "load") return { ok: true, draft: await repository.loadDraft() };
          if (request.action.type === "save") await repository.saveDraft(request.action.draft);
          else await repository.discardDraft();
          return { ok: true };
        } catch (error) {
          return { ok: false, code: "storage", issues: error.issues ?? [{ code: ISSUE_CODES.storage, path: "/draft", message: String(error?.message ?? error), severity: "error" }] };
        }
      case "open-page":
        try {
          await openPage(request.action.page, request.action.query);
          return { ok: true };
        } catch {
          return refuse("invalid", "/action/page", "The page could not be opened.");
        }
      case "recovery":
        return request.action.type === "load" ? { ok: true, recovery: await repository.loadRecovery() } : { ok: true, lastGood: await repository.lastGood() };
    }
    return refuse("invalid", "/type", "Unknown request.");
  }

  // First run opens only on a genuine install that found no earlier state at all. Updates,
  // browser restarts, re-enabling and migration from 1.1.0 never open a tab, and an existing
  // settings record prevents a second onboarding tab.
  let firstRunOpened = false;
  async function handleInstalled(details) {
    const init = await repository.initialize();
    if (details?.reason !== "install" || init.state !== "fresh" || firstRunOpened) return false;
    firstRunOpened = true;
    try {
      await openPage("onboarding");
      return true;
    } catch {
      return false;
    }
  }

  return { dispatch, openPage, handleInstalled, initialize: repository.initialize, repository };
}

/** Registers the background's listeners synchronously and starts initialization. */
export function installBackground(api, options) {
  const background = createBackground({ api, ...options });
  api.runtime.onInstalled.addListener((details) => {
    background.handleInstalled(details);
  });
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    background.dispatch(message, sender).then(sendResponse, () => sendResponse(refuse("storage", "", "The request failed.")));
    return true;
  });
  background.initialize();
  return background;
}
