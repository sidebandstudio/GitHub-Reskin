// Whether the userscript really runs isolated from GitHub's own JavaScript. The metadata asks for
// it (@inject-into content, @sandbox DOM), but a manager can ignore that or be set to inject into
// the page, and then any page script shares this script's globals and prototypes: patching
// Document.prototype.createElement hands it the picker's frame. So the panel's controls exist only
// once isolation is shown, and otherwise every durable change goes through the manager's own menu.
//
// Only evidence a page script that ran first can't fake counts. In the page's own context such a
// script owns every global and prototype: it can set window.wrappedJSObject or a null
// window.customElements, declare `let GM_info` or `let exportFunction` for any name the manager
// doesn't bind itself, and put getters on Object.prototype that answer for any field an object
// lacks. In order:
//   1. The manager says the script runs in the page: Tampermonkey's GM_info.sandboxMode "raw", or
//      Violentmonkey's GM_info.injectInto "page". Not isolated.
//   2. Firefox's content-script sandbox: the global object of this script's own realm is the
//      sandbox, not a window. main.mjs gets it as `this` of a bare sloppy-mode call, which no page
//      code can intercept, and a window's own `window` is unforgeable. Isolated.
//   3. The manager says the script runs isolated: Tampermonkey's sandboxMode "js" or "dom",
//      Violentmonkey's injectInto "content", or Userscripts for Safari, whose GM.* storage exists
//      only in its content-script scope. Isolated.
//   4. Otherwise unverified, which counts as not isolated. A Chromium isolated world with no report
//      ends here: nothing inside it tells it apart from a page that faked one.
// The report is the one that comes with the storage the script would use (main.mjs), and only the
// fields the manager set on it count (ownFields).

/**
 * An object's own enumerable fields, copied into an object with no prototype. Spreading calls no
 * built-in the page could have replaced, and a field the original lacks reads as undefined on the
 * copy, where on the original it would reach a getter the page put on Object.prototype and hand
 * that getter the object.
 * @param {unknown} value
 * @returns {object|null}
 */
export const ownFields = (value) => (value !== null && typeof value === "object" ? { __proto__: null, ...value } : null);

/**
 * @param {{realm?: object|null, report?: object|null, gm?: object|null}} options this script's
 *   realm's global object (undefined in strict code), the manager's report and its GM object, both
 *   as ownFields copies
 * @returns {{isolated: boolean, method: string}}
 */
export function detectIsolation({ realm = null, report = null, gm = null } = {}) {
  const handler = typeof report?.scriptHandler === "string" ? report.scriptHandler : "";
  const sandbox = report?.sandboxMode;
  const inject = report?.injectInto;
  if (sandbox === "raw" || inject === "page") return { isolated: false, method: "manager-page" };
  if (realm !== null && typeof realm === "object" && realm.window !== realm) return { isolated: true, method: "xray" };
  if (sandbox === "js" || sandbox === "dom" || inject === "content") return { isolated: true, method: "manager" };
  if (handler === "Userscripts" && typeof gm?.getValue === "function") return { isolated: true, method: "manager" };
  return { isolated: false, method: "unverified" };
}
