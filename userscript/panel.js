// The userscript's panel: the extension popup's card in an iframe over GitHub. Keys typed in the
// frame are delivered to the frame's document only, so GitHub's keyboard shortcuts never see
// them. The card is the same markup and stylesheet as the popup (build.mjs extracts them), and
// the shared picker is mounted on the frame's document by the userscript, which keeps the frame
// itself free of scripts.
//
// One panel at a time. It opens from the manager's menu or #reskin, takes focus, and closes with
// Escape, its Close button, a click on the page or the menu again. Escape and Close return focus
// to whatever had it when the panel opened. Closing removes the frame, disconnects the
// ResizeObserver and every listener, and drops #reskin from the address.
export const PANEL_HASH = "#reskin";
export const PANEL_ATTRIBUTE = "data-reskin-userscript-panel";
const GAP = 16;
const WIDTH = 400;

const FRAME_STYLE = [
  "position: fixed",
  `top: ${GAP}px`,
  `right: ${GAP}px`,
  "z-index: 2147483647",
  `width: min(${WIDTH}px, calc(100vw - ${2 * GAP}px))`,
  "height: 0",
  `max-height: calc(100vh - ${2 * GAP}px)`,
  "margin: 0",
  "padding: 0",
  "border: 0",
  "border-radius: 12px",
  "background: #0c0f14",
  "color-scheme: dark",
  "box-shadow: 0 0 0 1px rgb(128 128 128 / 35%), 0 8px 24px rgb(0 0 0 / 40%)",
  "visibility: visible",
  "opacity: 1",
].join("; ");

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
    if (current) {
      current.focus();
      return current.frame;
    }
    const invoker = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const frame = document.createElement("iframe");
    frame.setAttribute(PANEL_ATTRIBUTE, mode);
    frame.title = "GitHub Reskin";
    frame.style.cssText = FRAME_STYLE;
    frame.srcdoc = srcdoc;
    const cleanups = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    };
    let mounted = null;
    let observer = null;
    const state = (current = {
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
          frame.remove();
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
        if (event.key === "Escape") {
          event.preventDefault();
          state.close(true);
        }
      });
      mounted = mount(doc, mode, { close: () => state.close(true) });
      state.focus();
    });
    // Clicks and keys inside the frame stay in the frame, so these see only the page.
    listen(document, "pointerdown", (event) => event.target !== frame && state.close(false), true);
    listen(document, "keydown", (event) => event.key === "Escape" && state.close(true));
    document.documentElement.append(frame);
    return frame;
  }

  const close = (restore = true) => current?.close(restore);
  return {
    open,
    close,
    toggle: (mode) => (current ? close() : open(mode)),
    isOpen: () => Boolean(current),
    frame: () => current?.frame ?? null,
  };
}
