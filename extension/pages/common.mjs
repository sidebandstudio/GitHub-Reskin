// What every extension page shares: the browser namespace, the extension UiHost, the embedded
// catalog and theme cards, and buttons that open another internal page.
import CARDS from "reskin:cards";
import CATALOG from "reskin:catalog";
import { catalogFromData } from "../../packages/ui/catalog.js";
import { createExtensionHost } from "../../packages/ui/host.js";
import { mountPicker } from "../../packages/ui/picker.js";
import { standardCard } from "../../packages/ui/renderer.js";

export const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
export const host = createExtensionHost(api);
export const catalog = catalogFromData(CATALOG);
export const cards = CARDS;

/** Mounts the picker on this page's controls and wires [data-rs-open] buttons. */
export function mountPage(options = {}) {
  for (const button of document.querySelectorAll("[data-rs-open]")) {
    button.addEventListener("click", () => host.openPage(button.dataset.rsOpen));
  }
  return mountPicker(document, host, { cards, catalog, cardFor: standardCard, ...options });
}
