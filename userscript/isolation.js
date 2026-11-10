// Whether the userscript really runs isolated from GitHub's own JavaScript. The metadata asks for
// it (@inject-into content, @sandbox DOM), but a manager can ignore that or be set to inject into
// the page, and then any page script shares this script's globals and prototypes: patching
// Document.prototype.createElement hands it the picker's frame. So the panel's controls exist only
// once isolation is shown, and otherwise every durable change goes through the manager's own menu.
//
// Only evidence a page script can't plant counts. In the page's own context a script that ran first
// controls every global and prototype, so it can set window.wrappedJSObject or a null
// window.customElements and look like a Firefox Xray or a Chromium isolated world. In order:
//   1. The manager says the script runs in the page: Tampermonkey's GM_info.sandboxMode "raw", or
//      Violentmonkey's GM_info.injectInto "page". Not isolated.
//   2. Firefox's content-script sandbox: exportFunction is one of the sandbox's own globals, and
//      the page's window has no such name. Isolated.
//   3. The manager says the script runs isolated: Tampermonkey's sandboxMode "js" or "dom",
//      Violentmonkey's injectInto "content", or Userscripts for Safari, whose GM.* storage exists
//      only in its content-script scope. Isolated.
//   4. Otherwise unverified, which counts as not isolated. A Chromium isolated world with no report
//      ends here: nothing inside it tells it apart from a page that faked one.
// main.mjs passes the manager's GM_info and GM, and exportFunction, only when the page's window
// doesn't answer those names, so none of them is a global the page planted.

/**
 * @param {{info?: object|null, gm?: object|null, exportFunction?: Function|null}} options the
 *   manager's GM_info (or GM.info), its GM object, and Firefox's exportFunction
 * @returns {{isolated: boolean, method: string}}
 */
export function detectIsolation({ info = null, gm = null, exportFunction = null } = {}) {
  const handler = typeof info?.scriptHandler === "string" ? info.scriptHandler : "";
  const sandbox = info?.sandboxMode;
  const inject = info?.injectInto;
  if (sandbox === "raw" || inject === "page") return { isolated: false, method: "manager-page" };
  if (typeof exportFunction === "function") return { isolated: true, method: "xray" };
  if (sandbox === "js" || sandbox === "dom" || inject === "content") return { isolated: true, method: "manager" };
  if (handler === "Userscripts" && typeof gm?.getValue === "function") return { isolated: true, method: "manager" };
  return { isolated: false, method: "unverified" };
}
