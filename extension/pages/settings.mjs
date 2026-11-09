// The settings tab: Themes, Make a theme and Preferences as views a link away, so the switches
// never sit behind the gallery. The address's #fragment names the view, Preferences by default,
// since the popup already holds the themes.
import { mountPage } from "./common.mjs";

const DEFAULT_VIEW = "preferences";

export function mountSettings() {
  const sections = [...document.querySelectorAll("[data-rs-section]")];
  const links = [...document.querySelectorAll("[data-rs-view]")];
  function show() {
    const wanted = location.hash.slice(1);
    const view = sections.some((section) => section.id === wanted) ? wanted : DEFAULT_VIEW;
    for (const section of sections) section.hidden = section.id !== view;
    for (const link of links) {
      if (link.dataset.rsView === view) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }
  addEventListener("hashchange", show);
  show();
  return mountPage();
}
