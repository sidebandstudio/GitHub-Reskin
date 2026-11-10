// The settings tab: Themes, Make a theme, Preferences and Backup & help as views a link away, so the switches
// never sit behind the gallery. The address's #fragment names the view, Preferences by default,
// since the popup already holds the themes. Make a theme is the builder, with C5's shared offline
// preview painted by the same engine, Primer compiler and appearance as github.com.
import { fontFaceCss } from "../../packages/appearance/index.js";
import { configurePreview, mountPreview } from "../../packages/preview/index.js";
import * as primer from "../../packages/primer/index.js";
import { mountBackup } from "../../packages/ui/backup.js";
import { mountBuilder } from "../../packages/ui/builder.js";
import { dormantSlots } from "../content/github/index.js";
import { catalog, host, mountPage, resources } from "./common.mjs";

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
  configurePreview({ primer, modeIndex: primer.MODE_INDEX, resources, dormantSlots: dormantSlots() });
  const builder = mountBuilder(document, {
    host,
    catalog,
    standardSeed: (base) => primer.standardSeed(primer.MODE_INDEX, base),
    mountPreview,
    fontFace: (id) => fontFaceCss(id, resources.fontUrl(id)),
    download,
  });
  mountBackup(document, { host, catalog, download, builder });
  return mountPage();
}

// Saves a file through a temporary object URL, released after the click.
function download({ filename, mime, bytes }) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
