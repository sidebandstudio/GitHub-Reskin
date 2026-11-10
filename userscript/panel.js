// The userscript's panel: the extension popup's card in an iframe over GitHub, and the iframe in a
// closed shadow root that only this script holds. The frame's document has github.com's origin,
// so it must never be reachable from the page: a frame in a shadow tree is not one of the page's
// window.frames, page selectors stop at the boundary, the host element has no shadowRoot and no
// children, and window.find, caret and point lookups end at the bare host. The userscript itself
// runs isolated from page scripts (@inject-into content, @sandbox DOM), so a page that replaces
// DOM prototypes does not see the panel's nodes pass either. Keys typed in the frame are
// delivered to the frame's document only, so GitHub's keyboard shortcuts and any page listener
// never see them. The card is the same markup and stylesheet as the popup (build.mjs extracts
// them), and the shared picker is mounted on the frame's document by the userscript, which keeps
// the frame itself free of scripts.
//
// One panel at a time. It opens from the manager's menu or an address ending in #reskin, takes
// focus, and closes with Escape, its Close button, a click on the page or the menu again. Escape
// and Close return focus to whatever had it when the panel opened. Closing removes the host,
// disconnects the ResizeObserver and every listener, and drops #reskin from the address. Only a
// person's events count: synthetic page events neither close it nor reach it.
export const PANEL_HASH = "#reskin";
export const PANEL_ATTRIBUTE = "data-reskin-userscript-panel";
const GAP = 16;
const WIDTH = 400;

// The host's box, fixed against page styles: shadow-context !important declarations outrank the
// page's, inline and !important ones included.
export const HOST_CSS = `:host{all:initial!important;display:block!important;position:fixed!important;top:${GAP}px!important;right:${GAP}px!important;left:auto!important;bottom:auto!important;z-index:2147483647!important;width:min(${WIDTH}px,calc(100vw - ${2 * GAP}px))!important;height:auto!important;margin:0!important;padding:0!important;border:0!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;transform:none!important;filter:none!important;clip-path:none!important;mask:none!important}iframe{display:block;width:100%;height:0;max-height:calc(100vh - ${2 * GAP}px);margin:0;padding:0;border:0;border-radius:12px;background:#0c0f14;color-scheme:dark;box-shadow:0 0 0 1px rgb(128 128 128 / 35%),0 8px 24px rgb(0 0 0 / 40%)}`;

// Captured at document start, before any page script can replace them.
const attachShadow = globalThis.Element?.prototype.attachShadow;

/**
 * @param {object} options
 * @param {Document} options.document the GitHub page
 * @param {Window} options.view its window
 * @param {string} options.srcdoc the card document (build.mjs)
 * @param {(doc:Document, mode:string, panel:{close:Function})=>{destroy():void, initialFocus?():Element|null}} options.mount
 *   mounts the UI on the frame's document
 */
export function createPanel({ document, view, srcdoc, mount }) {
  let current = null;

  function open(mode = "picker") {
    if (current?.host.isConnected) {
      current.focus();
      return current.host;
    }
    current?.close(false);
    const invoker = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const host = document.createElement("div");
    host.setAttribute(PANEL_ATTRIBUTE, mode);
    const root = attachShadow.call(host, { mode: "closed" });
    const style = document.createElement("style");
    style.textContent = HOST_CSS;
    const frame = document.createElement("iframe");
    frame.title = "GitHub Reskin";
    frame.srcdoc = srcdoc;
    root.append(style, frame);
    const cleanups = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    };
    let mounted = null;
    let observer = null;
    const state = (current = {
      host,
      frame,
      mode,
      focus() {
        const target = mounted?.initialFocus?.() ?? frame.contentDocument?.querySelector("button, input");
        frame.focus();
        target?.focus();
      },
      close(restore) {
        if (current !== state) return;
        current = null;
        for (const cleanup of cleanups.splice(0)) cleanup();
        observer?.disconnect();
        observer = null;
        try {
          mounted?.destroy();
        } finally {
          mounted = null;
          host.remove();
        }
        if (view.location.hash === PANEL_HASH) view.history.replaceState(view.history.state, "", view.location.pathname + view.location.search);
        if (restore) (invoker?.isConnected ? invoker : null)?.focus({ preventScroll: true });
      },
    });

    listen(frame, "load", () => {
      if (current !== state) return;
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      // The frame takes the card's height, up to the viewport, and follows it as the card
      // changes (an error, a notice, the Calm note).
      const fit = () => {
        frame.style.height = `${Math.ceil(doc.body.getBoundingClientRect().height)}px`;
      };
      observer = new view.ResizeObserver(fit);
      observer.observe(doc.body);
      fit();
      listen(doc, "keydown", (event) => {
        if (event.key === "Escape" && event.isTrusted) {
          event.preventDefault();
          state.close(true);
        }
      });
      mounted = mount(doc, mode, { close: () => state.close(true) });
      state.focus();
    });
    // Clicks and keys inside the frame stay in the frame, so these see only the page.
    listen(document, "pointerdown", (event) => event.isTrusted && event.target !== host && state.close(false), true);
    listen(document, "keydown", (event) => event.isTrusted && event.key === "Escape" && state.close(true));
    document.documentElement.append(host);
    return host;
  }

  const close = (restore = true) => current?.close(restore);
  return {
    open,
    close,
    toggle: (mode) => (current ? close() : open(mode)),
    isOpen: () => Boolean(current),
    host: () => current?.host ?? null,
  };
}
