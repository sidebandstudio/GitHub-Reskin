// Whether the userscript really runs isolated from GitHub's own JavaScript. The metadata asks for
// it (@inject-into content, @sandbox DOM), but a manager can ignore that or be set to inject into
// the page, and then any page script shares this script's globals and prototypes: patching
// Document.prototype.createElement hands it the picker's frame. So the panel's controls exist only
// once isolation is shown, and otherwise every durable change goes through the manager's own menu.
//
// Checked once at document start, before GitHub's scripts run, so nothing the page defines later
// can answer for it. In order:
//   1. The manager says the script runs in the page: Tampermonkey's GM_info.sandboxMode "raw", or
//      Violentmonkey's GM_info.injectInto "page". Not isolated.
//   2. Firefox's content-script Xray: window.wrappedJSObject is the page's own window, and a marker
//      set on it is not seen through this script's window. Isolated.
//   3. A Chromium isolated world (content scripts, the userScripts API's world): window.customElements
//      is null there and a registry in the page's world. Isolated.
//   4. The manager says the script runs isolated: Tampermonkey's sandboxMode "js" or "dom",
//      Violentmonkey's injectInto "content", or Userscripts for Safari, whose GM.* storage exists
//      only in its content-script scope. Isolated. A report that is a page global instead of the
//      manager's own is ignored.
//   5. Otherwise unverified, which counts as not isolated.
// Steps 2 and 3 are facts of the browser rather than reports, and either one is enough; 1 and 4
// come from the manager's GM_info, which it hands the script directly.

/**
 * @param {{view: Window, info?: object|null, gm?: object|null}} options this script's window, the
 *   manager's GM_info (or GM.info), and its GM object
 * @returns {{isolated: boolean, method: string}}
 */
export function detectIsolation({ view, info = null, gm = null }) {
  const reported = isObject(info) && !(view && isOwnGlobal(view, "GM_info", info)) ? info : null;
  const handler = typeof reported?.scriptHandler === "string" ? reported.scriptHandler : "";
  const sandbox = reported?.sandboxMode;
  const inject = reported?.injectInto;
  if (sandbox === "raw" || inject === "page") return { isolated: false, method: "manager-page" };
  if (xrayIsolated(view)) return { isolated: true, method: "xray" };
  if (isolatedWorld(view)) return { isolated: true, method: "isolated-world" };
  if (sandbox === "js" || sandbox === "dom" || inject === "content") return { isolated: true, method: "manager" };
  if (handler === "Userscripts" && typeof gm?.getValue === "function") return { isolated: true, method: "manager" };
  return { isolated: false, method: "unverified" };
}

const isObject = (value) => value !== null && typeof value === "object";

// A report the page could have planted: the very object a page global of that name holds.
function isOwnGlobal(view, name, value) {
  try {
    return Object.prototype.hasOwnProperty.call(view, name) && view[name] === value;
  } catch {
    return false;
  }
}

function xrayIsolated(view) {
  let page;
  try {
    page = view?.wrappedJSObject;
  } catch {
    return false;
  }
  if (!isObject(page) || page === view) return false;
  const key = `__reskinIsolation${Math.random().toString(36).slice(2)}`;
  try {
    page[key] = true;
    const shared = key in view || page[key] !== true;
    delete page[key];
    return !shared;
  } catch {
    return false;
  }
}

function isolatedWorld(view) {
  try {
    return "customElements" in view && view.customElements === null;
  } catch {
    return false;
  }
}
