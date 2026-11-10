// The userscript's panel: the extension popup's card in an iframe over GitHub, and the iframe in a
// closed shadow root that only this script holds. The frame's document has github.com's origin,
// so it must never be reachable from the page: a frame in a shadow tree is not one of the page's
// window.frames, page selectors stop at the boundary, the host element has no shadowRoot and no
// children, and window.find, caret and point lookups end at the bare host. The picker's controls
// are mounted only when the userscript is shown to run isolated from page scripts (isolation.js),
// so a page that replaces DOM prototypes does not see the panel's nodes pass either. Keys typed in the frame are
// delivered to the frame's document only, so GitHub's keyboard shortcuts and any page listener
// never see them. The card is the same markup and stylesheet as the popup (build.mjs extracts
// them), and the shared picker is mounted on the frame's document by the userscript, which keeps
// the frame itself free of scripts.
//
// It draws in the browser's top layer (a manual popover), so no ordinary page element, whatever its
// z-index, can sit above it. Something the page puts in the top layer after it (a popover, a modal
// dialog, a fullscreen element) can still cover it: when one appears over the panel the panel
// closes, and a click that lands in the panel while one covers that point, or while the panel has
// been taken out of the top layer, is dropped and closes it. Overlays the document cannot list
// (inside the page's own closed shadow roots) are not seen; see the README's userscript section.
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
const TOP_LAYER = [":popover-open", ":modal", ":fullscreen"];

// The page's top-layer elements other than the panel's host, each selector the browser knows.
function topLayer(document, host) {
  const found = [];
  for (const selector of TOP_LAYER) {
    try {
      for (const element of document.querySelectorAll(selector)) if (element !== host) found.push(element);
    } catch {
      // A selector this browser does not have.
    }
  }
  return found;
}
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const contains = (box, x, y) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

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
    const popover = typeof host.showPopover === "function";
    if (popover) host.setAttribute("popover", "manual");
    let shown = false;
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

    // Whether something of the page's covers the panel (anywhere, or at a point in the frame).
    const covered = (point = null) => {
      if (shown) {
        try {
          if (!host.matches(":popover-open")) return true;
        } catch {
          // No :popover-open: the popover check below is all there is.
        }
      }
      const box = host.getBoundingClientRect();
      const frameBox = frame.getBoundingClientRect();
      return topLayer(document, host).some((element) => {
        const other = element.getBoundingClientRect();
        return point ? contains(other, frameBox.left + point.x, frameBox.top + point.y) : overlaps(other, box);
      });
    };
    listen(frame, "load", () => {
      if (current !== state) return;
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      // A person's click where the page has drawn something over the panel does not count. The
      // frame window's capture listeners run before any control's own.
      const guard = (event) => {
        if (!covered({ x: event.clientX, y: event.clientY })) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === "click") state.close(false);
      };
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "auxclick"]) listen(doc.defaultView, type, guard, true);
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
    // Something entering the top layer over the panel closes it.
    const recheck = () => current === state && covered() && state.close(false);
    for (const type of ["toggle", "fullscreenchange"]) listen(document, type, () => view.setTimeout(recheck, 0), true);
    document.documentElement.append(host);
    if (popover) {
      try {
        host.showPopover();
        shown = true;
      } catch {
        // Not shown in the top layer: the panel stays an ordinary fixed element.
      }
    }
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
