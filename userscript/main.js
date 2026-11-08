// Runs GitHub Reskin as a userscript, for browsers that can't keep the extension installed.
// scripts/userscript.mjs puts this first in github-reskin.user.js, then the extension's own
// scripts, all inside one function. This chrome object stands in for the extension's storage,
// so content.js and popup.js run unchanged. Like the extension, it keeps each setting under its
// own key, so a save only writes what changed.
const listeners = [];
const notify = () => listeners.forEach((listener) => listener({}, "local"));

const chrome = {
  storage: {
    local: {
      // Like chrome.storage, get takes a list of keys and returns only the saved ones, so load()
      // can tell a missing theme from a saved one, or takes defaults for the keys not saved.
      async get(request) {
        const defaults = Array.isArray(request) ? {} : request;
        const keys = Array.isArray(request) ? request : Object.keys(request);
        const values = await Promise.all(keys.map((key) => GM.getValue(key, defaults[key])));
        return Object.fromEntries(keys.map((key, i) => [key, values[i]]).filter(([, value]) => value !== undefined));
      },
      async set(patch) {
        await Promise.all(Object.entries(patch).map(([key, value]) => GM.setValue(key, value)));
        notify();
      },
    },
    onChanged: { addListener: (listener) => listeners.push(listener) },
  },
};

// The popup's card, in a frame over the page. Keys typed in a frame never reach the page, so
// GitHub's shortcuts can't fire while you type a hex value, and popup.css styles it unchanged.
const FRAME_CSS = `position: fixed; top: 16px; right: 16px; z-index: 2147483647; height: 0;
  width: 336px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); border: 0; border-radius: 12px;
  box-shadow: 0 0 0 1px rgb(128 128 128 / .35), 0 8px 24px rgb(0 0 0 / .4);`;
let panel = null;

function open() {
  if (panel) return;
  const frame = (panel = document.createElement("iframe"));
  frame.title = "GitHub Reskin";
  frame.style.cssText = FRAME_CSS;
  // The popup is 336px wide. The frame can be narrower on small phones, so the card fills it instead.
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>${POPUP_CSS}\nbody { width: auto; }</style>${POPUP_HTML}`;
  frame.addEventListener("load", () => {
    const doc = frame.contentDocument;
    // The frame takes the card's height, which changes when the contrast warning shows.
    const fit = () => (frame.style.height = `${doc.body.offsetHeight}px`);
    new MutationObserver(fit).observe(doc.body, { subtree: true, childList: true, attributes: true });
    doc.addEventListener("keydown", (e) => e.key === "Escape" && close());
    globalThis.GitHubReskin.card(doc);
    fit();
  });
  document.documentElement.append(frame);
}

function close() {
  if (!panel) return;
  panel.remove();
  panel = null;
  if (location.hash === "#reskin") history.replaceState(history.state, "", location.pathname + location.search);
}

// Tampermonkey, Violentmonkey and Greasemonkey list this command in their menu.
if (typeof GM.registerMenuCommand === "function") GM.registerMenuCommand("Theme and colors", () => (panel ? close() : open()));
// Userscripts in Safari has no menu, so github.com/#reskin opens the card too. A tab opened in
// the background waits until you switch to it, so the card loads the settings current by then.
const openFromHash = () => location.hash === "#reskin" && !document.hidden && open();
window.addEventListener("hashchange", openFromHash);
// Wait for popup.js, which runs after this file.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", openFromHash);
else setTimeout(openFromHash);

// A userscript can't hear another tab save, so a tab repaints when you switch back to it.
// The card closes when you leave, like the extension's popup, so it never shows old settings.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return close();
  notify();
  openFromHash();
});

// Clicks and keys inside the frame stay in the frame, so these only see the page.
document.addEventListener("pointerdown", () => panel && close(), true);
document.addEventListener("keydown", (e) => panel && e.key === "Escape" && close());
