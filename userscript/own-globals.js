// Globals the bundle takes from the script's own realm, injected by build.mjs in place of every bare
// reference. Violentmonkey in Firefox resolves a script's globals through a proxy over the page, so
// a bare structuredClone is the page's: its copies are page objects, and a content script may not
// set its own values on them. A sloppy-mode function called bare gets the script's own global as
// `this`; where a manager makes the script strict it is undefined, and the usual global serves.
const own = (function () {
  return this;
})();

export const structuredClone = typeof own?.structuredClone === "function" ? own.structuredClone.bind(own) : globalThis.structuredClone;
