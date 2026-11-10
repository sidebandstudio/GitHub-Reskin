// The userscript entry, bundled by build.mjs into github-reskin.user.js. It assembles the same
// runtime as the extension's content script (C4's lifecycle with its boot gate and auth-route
// guard, C3's GitHub adapter and Primer compiler, the engine, C5's appearance) and the same
// picker as its popup, over the manager's storage instead of the extension's:
//   - document-start: the boot gate, then C4's repository initializes (first run, or the 1.1.0
//     userscript's saved theme, on/off and custom colors migrated once), then the lifecycle paints.
//   - the panel: the popup's card in a frame inside a closed shadow root, which page scripts
//     cannot reach (panel.js), from the manager's menu or an address ending in #reskin.
// No network at runtime: fonts and the icon are embedded, there is no @require, no update timer
// and no request of any kind. The fonts are handed to the page as bytes (fonts.js), which
// GitHub's CSP allows where it refuses font URLs. No page storage either; a manager without
// durable storage gets an honestly labeled session preview with file export.
/* global GM, GM_getValue, GM_setValue, GM_deleteValue, GM_addValueChangeListener, GM_removeValueChangeListener, GM_registerMenuCommand */
import BOOT_CSS from "reskin:boot";
import CARD from "reskin:card";
import CARDS from "reskin:cards";
import CATALOG from "reskin:catalog";
import FONTS from "reskin:fonts";
import { noResources } from "../packages/appearance/index.js";
import { exportTheme } from "../packages/format/index.js";
import { createRepository, selectedSource } from "../packages/settings/index.js";
import { catalogFromData } from "../packages/ui/catalog.js";
import { mountPicker } from "../packages/ui/picker.js";
import { backgroundRendering, createRenderer, standardCard } from "../packages/ui/renderer.js";
import * as github from "../extension/content/github/index.js";
import { TIME_LIMIT_MS } from "../extension/content/github/slots.js";
import { startContent } from "../extension/content/lifecycle/index.js";
import { createFontLoader } from "./fonts.js";
import { createGmHost } from "./host.js";
import { createPanel, PANEL_HASH } from "./panel.js";
import { createGmStorage } from "./storage.js";

// The marker that keeps a second copy of this script (two managers, or a reinjection) from
// running beside the first.
const RUNNING = "data-reskin-userscript";
export const COPY = Object.freeze({
  durable: "Saved by your userscript manager. Export a theme file to keep a copy or move it to the extension.",
  session: "This userscript manager can't save themes here. You can preview and export a file.",
  sessionLabel: "Session preview",
  exported: "Theme file saved to your downloads.",
  exportFailed: "The theme file could not be saved. Try again.",
});

const scope = {
  GM: typeof GM === "object" ? GM : undefined,
  GM_getValue: typeof GM_getValue === "function" ? GM_getValue : undefined,
  GM_setValue: typeof GM_setValue === "function" ? GM_setValue : undefined,
  GM_deleteValue: typeof GM_deleteValue === "function" ? GM_deleteValue : undefined,
  GM_addValueChangeListener: typeof GM_addValueChangeListener === "function" ? GM_addValueChangeListener : undefined,
  GM_removeValueChangeListener: typeof GM_removeValueChangeListener === "function" ? GM_removeValueChangeListener : undefined,
  GM_registerMenuCommand: typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : undefined,
};

whenRoot(document, () => start(scope, { document, view: window }));

// Some managers run a document-start script before the parser has made <html>. The boot gate and
// the lifecycle start as soon as it exists.
function whenRoot(document, run) {
  if (document.documentElement) return run();
  const observer = new MutationObserver(() => {
    if (!document.documentElement) return;
    observer.disconnect();
    run();
  });
  observer.observe(document, { childList: true });
}

/**
 * @param {object} scope the manager's grants
 * @param {{document:Document, view:Window}} page
 */
export function start(scope, { document, view }) {
  const root = document.documentElement;
  if (!root || root.hasAttribute(RUNNING)) return null;
  root.setAttribute(RUNNING, "");

  // The extension's boot.css, as a style node: GitHub stays hidden for at most 120 ms while
  // storage answers, and forced colors bypass it.
  const gate = document.createElement("style");
  gate.id = "reskin-userscript-boot";
  gate.textContent = BOOT_CSS;
  root.prepend(gate);

  const catalog = catalogFromData(CATALOG);
  const { storage, kind, capabilities } = createGmStorage(scope, { document });
  const rendering = backgroundRendering();
  const repository = createRepository(storage, { catalog, ...rendering, newId: () => view.crypto.randomUUID() });
  // The renderer writes no @font-face (GitHub's CSP would refuse its data: URL); the loader adds
  // the same faces from their bytes whenever the theme it compiles uses them.
  const fonts = createFontLoader({ document, view, fonts: FONTS });
  const base = createRenderer({ github, catalog, resources: noResources, slotTimeLimitMs: TIME_LIMIT_MS });
  const renderer = {
    ...base,
    compile(resolved, plan, prefs, context) {
      if (prefs.fonts) fonts.loadFor(resolved);
      return base.compile(resolved, plan, prefs, context);
    },
  };

  let content = null;
  // The 1.1.0 migration or first-run defaults are written before the first paint reads them.
  const ready = repository
    .initialize()
    .catch(() => null)
    .then(() => {
      content = startContent({ storage, document, view, catalog, renderer });
      return content.ready;
    });

  let panel = null;
  const host = createGmHost({ storage, repository, capabilities, view, openPage: () => panel?.open() });
  panel = createPanel({
    document,
    view,
    srcdoc: CARD.srcdoc,
    mount: (doc, mode, controls) => mountCard(doc, mode, { host, catalog, kind, controls }),
  });

  // Tampermonkey, Violentmonkey and Greasemonkey list this in their menu. Managers without a
  // menu (Userscripts for Safari) open the panel from an address ending in #reskin.
  const register = scope.GM_registerMenuCommand ?? (typeof scope.GM?.registerMenuCommand === "function" ? scope.GM.registerMenuCommand.bind(scope.GM) : null);
  try {
    register?.("Open GitHub Reskin", () => panel.toggle());
  } catch {
    // The hash still opens it.
  }
  // #reskin counts only when a person asked for it: in the address this page loaded with (read
  // now, before any page script runs), or a navigation the browser reports as the person's own
  // (typed in the address bar or a real click on a link). A page script that sets location.hash,
  // pushes history or calls navigation.navigate() opens nothing.
  let requested = view.location.hash === PANEL_HASH;
  const fromHash = () => {
    if (!requested || document.visibilityState === "hidden" || document.readyState === "loading") return;
    requested = false;
    panel.open();
  };
  view.navigation?.addEventListener?.("navigate", (event) => {
    let hash = "";
    try {
      hash = new URL(event.destination.url).hash;
    } catch {
      return;
    }
    if (hash !== PANEL_HASH || !event.userInitiated) return;
    requested = true;
    view.setTimeout(fromHash, 0);
  });
  // A tab opened in the background waits until it is shown, so the card reads current settings.
  document.addEventListener("visibilitychange", fromHash);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fromHash, { once: true });
  else fromHash();

  return { ready, panel, storage, repository, kind, capabilities, content: () => content };
}

// The card in the frame: the shared picker on the popup's controls, the storage note and Export,
// and the Close button.
function mountCard(doc, mode, { host, catalog, kind, controls }) {
  const cleanups = [];
  const listen = (target, type, handler) => {
    if (!target) return;
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };
  const part = (name) => doc.querySelector(`[data-us="${name}"]`);
  const durable = kind !== "session";
  doc.documentElement.dataset.usStorage = kind;
  part("storage-note").textContent = durable ? COPY.durable : COPY.session;
  const label = part("session-label");
  label.hidden = durable;
  label.textContent = COPY.sessionLabel;

  // A card's heading face is loaded into the frame's document as the theme's is into GitHub's; it
  // needs no CSS of its own.
  const fonts = createFontLoader({ document: doc, view: doc.defaultView, fonts: FONTS });
  const fontFace = (id) => {
    fonts.load(id);
    return "";
  };
  const picker = mountPicker(doc, host, { cards: CARDS, catalog, cardFor: standardCard, fontFace });

  const status = part("status");
  listen(part("export"), "click", async () => {
    const read = await host.read();
    const source = read.settings ? selectedSource(read.settings, catalog) : null;
    const result = source ? await host.downloadFile(exportTheme(source)) : { ok: false };
    status.textContent = result.ok ? COPY.exported : COPY.exportFailed;
  });
  listen(part("close"), "click", () => controls.close());
  // TODO(C8, PR #18): the builder and import. When packages/ui's builder lands on main, mount it
  // here for mode "builder" or "import" through the same host (mountBuilder(doc, host)); the
  // popup's Customize/Import buttons then call host.openPage("settings", {view}). Until then
  // every mode shows the picker.
  void mode;

  return {
    initialFocus: () => doc.querySelector('[data-rs="enabled"]'),
    destroy() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      picker.destroy();
    },
  };
}
