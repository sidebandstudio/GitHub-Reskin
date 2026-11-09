// The shared-link page: decodes the RS1 code after # locally, within the link bound, and previews
// it with advanced CSS off until the recipient enables it.
import { copyText } from "./clipboard.mjs";

const $ = (selector) => document.querySelector(selector);
const { maxLink } = JSON.parse($("#share-data").textContent);
const name = $("[data-share-name]");
const state = $("[data-share-state]");
const code = decodeURIComponent(location.hash.slice(1));

async function open() {
  if (!code) return;
  if (location.href.length > maxLink) {
    state.textContent = `This link is longer than ${maxLink.toLocaleString("en-US")} characters, so it is not read. Ask for the theme's .reskin.json file instead.`;
    return;
  }
  name.textContent = "Reading the shared theme";
  const module = await import("../engine.mjs");
  await module.loadAuthoring();
  const result = module.decodeShare(code);
  if (!result.ok) {
    name.textContent = "This share code can't be read";
    state.textContent = result.issues[0].message;
    return;
  }
  const theme = result.normalized;
  name.textContent = theme.inspiredBy ? `${theme.inspiredBy}: ${theme.name}` : theme.name;
  state.textContent = "Theme ready to preview.";
  const css = typeof theme.css === "string" && theme.css !== "";
  const enable = $("[data-css-enable]");
  $("[data-css-review]").hidden = !css;
  if (css) {
    $("[data-css-source]").textContent = theme.css;
    const note = $("[data-css-note]");
    note.hidden = await module.cssStylesOwnedOnly(theme.css);
    note.textContent = "This CSS styles GitHub's own elements. Reskin cannot apply those rules yet, so enabling it changes nothing here or in the extension.";
  }
  const layers = module.rasterLayers(theme);
  $("[data-images]").hidden = !layers.length;
  $("[data-images]").textContent = layers.length ? `This theme embeds ${layers.length} image${layers.length === 1 ? "" : "s"}. Its file and share code include them.` : "";

  const windowEl = $("[data-window]");
  windowEl.hidden = false;
  const container = $("[data-live]");
  const handle = module.mountPreview(container, { view: "profile", theme, preferences: module.DEFAULT_PREFERENCES, cssAllowed: false });
  container.querySelector("[data-reskin-preview]").addEventListener("reskin-preview-complete", () => {
    windowEl.dataset.preview = "live";
    $("[data-pending]").hidden = true;
  });
  enable.addEventListener("change", () => handle.update({ theme, preferences: module.DEFAULT_PREFERENCES, cssAllowed: enable.checked }));

  $("[data-download-label]").textContent = `Download ${theme.name}`;
  $("[data-exports]").hidden = false;
  $("[data-download]").addEventListener("click", () => {
    const { filename, mime, bytes } = module.exportTheme(theme);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    Object.assign(document.createElement("a"), { href: url, download: filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    $("[data-export-status]").textContent = `Downloaded ${filename}.`;
  });
  $("[data-copy-code]").addEventListener("click", async () => {
    const field = $("[data-code-text]");
    field.value = code;
    if (await copyText(code)) $("[data-export-status]").textContent = "Share code copied.";
    else {
      $("[data-code-fallback]").hidden = false;
      field.focus();
      field.select();
      $("[data-export-status]").textContent = "Copy is not available here. The code is selected; copy it from the field.";
    }
  });
}

open();
window.addEventListener("hashchange", () => location.reload());
