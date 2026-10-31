// Paints GitHub with the chosen theme. Runs at document_start on github.com.
(function () {
  "use strict";
  const { palette, css, load } = globalThis.GitHubReskin;
  const CACHE = "github-reskin-css";

  const style = document.createElement("style");
  style.id = "github-reskin";
  // The cache is optional. Some browsers block site storage, so failures are ignored.
  const cache = (action) => {
    try {
      return action();
    } catch {
      return null;
    }
  };

  // Paint the last theme right away so full page loads don't flash GitHub's colors.
  style.textContent = cache(() => localStorage.getItem(CACHE)) || "";
  document.documentElement.append(style);

  function apply(settings) {
    const text = settings.enabled ? css(palette(settings)) : "";
    style.textContent = text;
    cache(() => (text ? localStorage.setItem(CACHE, text) : localStorage.removeItem(CACHE)));
  }

  load(chrome.storage.local).then(apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") load(chrome.storage.local).then(apply);
  });
})();
