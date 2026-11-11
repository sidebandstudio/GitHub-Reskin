// The userscript entry, bundled by build.mjs into github-reskin.user.js. It assembles the same
// runtime as the extension's content script (C4's lifecycle with its boot gate and auth-route
// guard, C3's GitHub adapter and Primer compiler, the engine, C5's appearance) and the same
// picker as its popup, over the manager's storage instead of the extension's:
//   - document-start: the boot gate, then C4's repository initializes (first run, or the 1.1.0
//     userscript's saved theme, on/off and custom colors migrated once), then the lifecycle paints.
//   - the panel: the popup's card in a frame inside a closed shadow root, which page scripts
//     cannot reach (panel.js), from the manager's menu or an address ending in #reskin. Only when
//     the script is shown to run isolated from GitHub's JavaScript (isolation.js). Otherwise the
//     script never reads or writes the manager's storage, since page code that patches a built-in
//     like Array.prototype.map could capture the callbacks that hold it. The panel only shows the
//     theme and why, and the manager's menu (menu.js) changes settings until the page reloads.
//   - the builder: from the card, the settings page's Make a theme and Backup & help (C6's
//     mountBuilder and mountBackup) in a wider frame over the same host and C5's offline preview,
//     again only when isolated.
//   - a theme's own advanced CSS: a bundled theme's reviewed CSS applies, a saved theme's never
//     does here, whatever approval its settings record, and nothing here offers approval. The
//     sanitizer is installed, so a theme that carries CSS imports and saves with it, and its CSS
//     shows as present and off; the builder's host refuses every approval request.
// No network at runtime: fonts and the icon are embedded, there is no @require, no update timer
// and no request of any kind. The fonts are handed to the page as bytes (fonts.js), which
// GitHub's CSP allows where it refuses font URLs. No page storage either; a manager without
// durable storage gets an honestly labeled session preview with file export.
/* global GM, GM_info, GM_getValue, GM_setValue, GM_deleteValue, GM_addValueChangeListener, GM_removeValueChangeListener, GM_registerMenuCommand, GM_unregisterMenuCommand, exportFunction */
import ASSETS from "reskin:assets";
import BOOT_CSS from "reskin:boot";
import BUILDER from "reskin:builder";
import CARD from "reskin:card";
import CARDS from "reskin:cards";
import CATALOG from "reskin:catalog";
import FONTS from "reskin:fonts";
import { embeddedResources, noResources } from "../packages/appearance/index.js";
import { convertRaster } from "../packages/appearance/raster.js";
// Installs C2b's CSS sanitizer, so saved and imported themes that carry Advanced CSS validate.
import "../packages/format/authoring.js";
import { exportTheme } from "../packages/format/index.js";
import { configurePreview, mountPreview } from "../packages/preview/index.js";
import * as primer from "../packages/primer/index.js";
import { createRepository, selectedSource } from "../packages/settings/index.js";
import { mountBackup } from "../packages/ui/backup.js";
import { mountBuilder } from "../packages/ui/builder.js";
import { catalogFromData } from "../packages/ui/catalog.js";
import { mountPicker } from "../packages/ui/picker.js";
import { backgroundRendering, createRenderer, standardCard } from "../packages/ui/renderer.js";
import * as github from "../extension/content/github/index.js";
import { TIME_LIMIT_MS } from "../extension/content/github/slots.js";
import { startContent } from "../extension/content/lifecycle/index.js";
import { createFontLoader } from "./fonts.js";
import { createGmHost } from "./host.js";
import { detectIsolation, ownFields } from "./isolation.js";
import { createMenu } from "./menu.js";
import { BUILDER_MODES, createPanel, PANEL_HASH } from "./panel.js";
import { xrayRasterEnv } from "./raster.js";
import { COPY } from "./copy.js";
import { createGmStorage, lockBridge } from "./storage.js";

// The marker that keeps a second copy of this script (two managers, or a reinjection) from
// running beside the first.
const RUNNING = "data-reskin-userscript";

const scope = {
  GM: typeof GM === "object" ? GM : undefined,
  GM_info: typeof GM_info === "object" ? GM_info : undefined,
  GM_getValue: typeof GM_getValue === "function" ? GM_getValue : undefined,
  GM_setValue: typeof GM_setValue === "function" ? GM_setValue : undefined,
  GM_deleteValue: typeof GM_deleteValue === "function" ? GM_deleteValue : undefined,
  GM_addValueChangeListener: typeof GM_addValueChangeListener === "function" ? GM_addValueChangeListener : undefined,
  GM_removeValueChangeListener: typeof GM_removeValueChangeListener === "function" ? GM_removeValueChangeListener : undefined,
  GM_registerMenuCommand: typeof GM_registerMenuCommand === "function" ? GM_registerMenuCommand : undefined,
  GM_unregisterMenuCommand: typeof GM_unregisterMenuCommand === "function" ? GM_unregisterMenuCommand : undefined,
  // Firefox's content-script function, for storage.js's lock bridge.
  exportFunction: typeof exportFunction === "function" ? exportFunction : undefined,
};

// The global object of this script's own realm, for isolation.js: a sloppy-mode function called
// bare gets it as `this`, with no lookup a page script could answer. The bundle is a classic
// script without "use strict"; where a manager makes it strict this is undefined and shows nothing.
const realm = (function () {
  return this;
})();

whenRoot(document, () => start(scope, { document, view: window, realm }));

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
 * @param {{document:Document, view:Window, realm?:object}} page
 */
export function start(scope, { document, view, realm = null }) {
  const root = document.documentElement;
  if (!root || root.hasAttribute(RUNNING)) return null;
  root.setAttribute(RUNNING, "");
  // Before any of GitHub's scripts run. The report is the one that comes with the storage the
  // script would use: GM.info on the GM object for GM.*, otherwise GM_info. A page global could
  // stand in only for a name the manager doesn't bind, and a manager binds the report it grants
  // storage with. Fields are read from ownFields copies: a page getter on Object.prototype never
  // sees the manager's objects or fills in a field they lack.
  const gm = ownFields(scope.GM);
  const sync = typeof scope.GM_getValue === "function" && typeof scope.GM_setValue === "function";
  const report = !sync && typeof gm?.getValue === "function" ? ownFields(gm.info) : (ownFields(scope.GM_info) ?? ownFields(gm?.info));
  const isolation = detectIsolation({ realm, report, gm });

  // The extension's boot.css, as a style node: GitHub stays hidden for at most 120 ms while
  // storage answers, and forced colors bypass it.
  const gate = document.createElement("style");
  gate.id = "reskin-userscript-boot";
  gate.textContent = BOOT_CSS;
  root.prepend(gate);

  const catalog = catalogFromData(CATALOG);
  // Firefox content scripts (isolation.js's Xray) hand the lock manager page-compartment callbacks.
  const bridge = lockBridge(scope, { document, view, isolation });
  // Not isolated: session storage only, with no GM grant in reach of the page's built-ins.
  const { storage, kind, capabilities } = createGmStorage(isolation.isolated ? scope : {}, { document, locks: view.navigator?.locks ?? null, bridge });
  const rendering = backgroundRendering();
  const repository = createRepository(storage, { catalog, ...rendering, newId: () => view.crypto.randomUUID() });
  // The renderer writes no @font-face (GitHub's CSP would refuse its data: URL); the loader adds
  // the same faces from their bytes whenever the theme it compiles uses them.
  const fonts = createFontLoader({ document, view, fonts: FONTS });
  const base = createRenderer({ github, catalog, resources: noResources, slotTimeLimitMs: TIME_LIMIT_MS });
  // No approval reaches the renderer, so only a bundled theme's own CSS can apply.
  const renderer = {
    ...base,
    compile(resolved, plan, prefs, context) {
      if (prefs.fonts) fonts.loadFor(resolved);
      return base.compile(resolved, plan, prefs, { ...context, consent: null });
    },
    decorate: (doc, resolved, prefs, context) => base.decorate(doc, resolved, prefs, { ...context, consent: null }),
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
  // Tampermonkey, Violentmonkey and Greasemonkey list commands in their menu. Managers without a
  // menu (Userscripts for Safari) open the panel from an address ending in #reskin.
  // A closure rather than bind(): page code that patched Function.prototype.bind would be handed
  // the whole GM object, storage included. The method is the GM object's own (gm is its ownFields
  // copy), so calling it reads no inherited getter.
  const register = scope.GM_registerMenuCommand ?? (typeof gm?.registerMenuCommand === "function" ? (name, onClick) => scope.GM.registerMenuCommand(name, onClick) : null);
  const unregister = scope.GM_unregisterMenuCommand ?? null;
  const note = isolation.isolated ? null : register ? COPY.menuOnly : COPY.noControls;
  // Not isolated, every mode is the note on the card: no builder document is ever loaded.
  const builder = !note && BUILDER_MODES;
  panel = createPanel({
    document,
    view,
    srcdoc: (mode) => (builder && builder.includes(mode) ? BUILDER.srcdoc : CARD.srcdoc),
    mount(doc, mode, controls) {
      if (note) return mountNote(doc, { host, kind, controls, note });
      if (builder.includes(mode)) return mountBuilderView(doc, mode, { host, catalog, kind, controls, xray: isolation.method === "xray" });
      return mountCard(doc, { host, catalog, kind, controls });
    },
  });

  let menu = null;
  if (isolation.isolated) {
    try {
      register?.("Open GitHub Reskin", () => panel.toggle());
    } catch {
      // The hash still opens it.
    }
  } else if (register) {
    // Not isolated: the manager's own menu changes this page's session settings.
    const customCard = (theme) => {
      try {
        return { ...standardCard({ id: theme.id, group: "mine", document: theme.document }), group: "mine" };
      } catch {
        return null;
      }
    };
    menu = createMenu({ register, unregister, host, cards: CARDS, customCard, open: () => panel.toggle() });
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

  return { ready, panel, storage, repository, kind, capabilities, isolation, menu, content: () => content };
}

// The card when the script shares GitHub's JavaScript: the current theme and why the panel has no
// controls, and Close. Nothing in it changes a setting; the theme it names is painted on the page
// anyway.
const CONTROLS = [".rs-top-switch", "[data-rs=undo]", "[data-rs=error]", "[data-rs=notices]", ".rs-browse", "[data-rs=gallery]", "[data-rs=empty]", ".rs-prefs", ".us-storage-row", ".us-pages"];
function mountNote(doc, { host, kind, controls, note }) {
  const part = (name) => doc.querySelector(`[data-us="${name}"]`);
  for (const node of doc.querySelectorAll(CONTROLS.join(","))) node.remove();
  doc.documentElement.dataset.usStorage = kind;
  doc.documentElement.dataset.usControls = "menu";
  part("storage-note").textContent = note;
  const label = part("session-label");
  label.hidden = kind !== "session";
  label.textContent = COPY.sessionLabel;
  const cards = new Map(CARDS.map((card) => [card.id, card]));
  let live = true;
  const show = async () => {
    const read = await host.read();
    if (!live || !read.settings) return;
    const id = read.settings.selectedThemeId;
    const custom = read.settings.customThemes.find((theme) => theme.id === id);
    let card = cards.get(id) ?? null;
    try {
      card ??= custom ? standardCard({ id, group: "mine", document: custom.document }) : null;
    } catch {
      // An unreadable saved theme: no name to show.
    }
    doc.querySelector("[data-rs=summary-show]").textContent = card?.show ?? card?.name ?? "";
    doc.querySelector("[data-rs=summary-name]").textContent = card?.show ? card.name : "";
    doc.querySelector("[data-rs=summary-note]").textContent = read.settings.enabled ? "" : "GitHub Reskin is off.";
  };
  void show();
  const stop = host.subscribe(() => void show());
  const close = part("close");
  const onClose = () => controls.close();
  close.addEventListener("click", onClose);
  return {
    initialFocus: () => close,
    destroy() {
      live = false;
      stop();
      close.removeEventListener("click", onClose);
    },
  };
}

// The card in the frame: the shared picker on the popup's controls, the storage note and Export,
// Make a theme and Backup & help, and the Close button.
function mountCard(doc, { host, catalog, kind, controls }) {
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
    const result = source ? await host.downloadFile(exportTheme(source), doc) : { ok: false };
    status.textContent = result.ok ? COPY.exported : COPY.exportFailed;
  });
  listen(part("close"), "click", () => controls.close());
  listen(part("make"), "click", () => controls.show("make"));
  listen(part("backup"), "click", () => controls.show("backup"));

  return {
    initialFocus: () => doc.querySelector('[data-rs="enabled"]'),
    destroy() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      picker.destroy();
    },
  };
}

// The preview runs the same Primer compiler as github.com, once per page. Its frames inherit
// GitHub's CSP, which refuses data: fonts, so the preview shows the system fallback while GitHub
// itself gets the faces from their bytes. Its images are the fixture's, embedded by the build.
let previewReady = false;
function preparePreview() {
  if (previewReady) return;
  configurePreview({ primer, modeIndex: primer.MODE_INDEX, resources: embeddedResources({ fonts: {}, assets: ASSETS }), dormantSlots: github.dormantSlots() });
  previewReady = true;
}

// The builder's host: the card's, except that no Advanced CSS approval is ever asked for or
// carried here. The builder shows no Enable advanced CSS in this frame, and the repository grants
// tickets only to the extension's own builder document; this keeps the rule here as well.
const NO_APPROVAL = Object.freeze({ ok: false, code: "invalid", issues: [{ code: "invalid", path: "/css", message: "Advanced CSS can't be turned on in the userscript.", severity: "error" }] });
function builderHost(host) {
  return {
    ...host,
    commit(action, revision) {
      if (action?.type === "approveCss") return Promise.resolve(NO_APPROVAL);
      if (action?.type === "saveCustom" && typeof action.approval === "string") {
        const { approval, ...rest } = action;
        void approval;
        return host.commit(rest, revision);
      }
      return host.commit(action, revision);
    },
  };
}

// Make a theme and Backup & help in the wider frame: C6's builder and backup views on the
// settings page's markup (build.mjs), a view a link away as on that page, Themes back to the
// card, the storage note and Close.
function mountBuilderView(doc, mode, { host, catalog, kind, controls, xray }) {
  const cleanups = [];
  const listen = (target, type, handler) => {
    if (!target) return;
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };
  const part = (name) => doc.querySelector(`[data-us="${name}"]`);
  const win = doc.defaultView;
  const durable = kind !== "session";
  doc.documentElement.dataset.usStorage = kind;
  part("storage-note").textContent = durable ? COPY.durable : COPY.builderSession;
  const label = part("session-label");
  label.hidden = durable;
  label.textContent = COPY.sessionLabel;

  // The views, as settings.mjs shows them: the frame's own #fragment names one.
  const sections = [...doc.querySelectorAll("[data-rs-section]")];
  const links = [...doc.querySelectorAll("[data-rs-view]")];
  const show = () => {
    const wanted = win.location.hash.slice(1);
    const current = sections.some((section) => section.id === wanted) ? wanted : mode;
    for (const section of sections) section.hidden = section.id !== current;
    for (const link of links) {
      if (link.dataset.rsView === current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  };
  listen(win, "hashchange", show);
  // A fragment link in a srcdoc frame resolves against GitHub's address, which would navigate the
  // frame away; it changes the frame's own fragment instead, as backup.js does.
  listen(doc, "click", (event) => {
    const link = event.target.closest?.('a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    win.location.hash = link.getAttribute("href");
  });
  show();

  preparePreview();
  const fonts = createFontLoader({ document: doc, view: win, fonts: FONTS });
  const own = builderHost(host);
  const download = (file) => void host.downloadFile(file, doc);
  const builder = mountBuilder(doc, {
    host: own,
    catalog,
    standardSeed: (base) => primer.standardSeed(primer.MODE_INDEX, base),
    mountPreview,
    // The samples' faces come from their bytes, as the theme's do on GitHub.
    fontFace: (id) => {
      fonts.load(id);
      return "";
    },
    download,
    // Behind Firefox's Xrays images convert through userscript/raster.js; elsewhere the builder's own.
    convertImage: xray ? (bytes, options) => convertRaster(bytes, options, xrayRasterEnv(win)) : null,
  });
  const backup = mountBackup(doc, { host: own, catalog, download, builder });
  listen(part("themes"), "click", () => controls.show("picker"));
  listen(part("close"), "click", () => controls.close());

  return {
    initialFocus: () => doc.querySelector(mode === "backup" ? '[data-rk="saved-title"]' : '[data-rb="name"]'),
    destroy() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      backup?.destroy();
      builder?.destroy();
    },
  };
}
