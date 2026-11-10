// The shared-link page: decodes the RS1 code after # locally, within the link bound, and previews
// it with advanced CSS off until the recipient enables it.
import { copyText } from "./clipboard.mjs";

const $ = (selector) => document.querySelector(selector);
const { maxLink } = JSON.parse($("#share-data").textContent);
const name = $("[data-share-name]");
const state = $("[data-share-state]");
const retry = $("[data-share-retry]");

// A new code in the address is a new page. Registered first, so nothing in a link can stop it.
window.addEventListener("hashchange", () => location.reload());
retry.addEventListener("click", () => {
  retry.hidden = true;
  open();
});

async function open() {
  const fragment = location.hash.slice(1);
  if (!fragment) return;
  if (location.href.length > maxLink) {
    state.textContent = `This link is longer than ${maxLink.toLocaleString("en-US")} characters, so it is not read. Ask for the theme's .reskin.json file instead.`;
    return;
  }
  // A damaged escape is read as it stands, so it gets the same answer as any damaged code.
  let code = fragment;
  try {
    code = decodeURIComponent(fragment);
  } catch {}
  name.textContent = "Reading the shared theme";
  let module;
  try {
    module = await import("../engine.mjs");
    await module.loadAuthoring();
  } catch {
    // The theme stays in the address; trying again imports the previewer again.
    name.textContent = "The shared theme didn't load";
    state.textContent = "Your browser couldn't load the previewer. Check your connection and try again.";
    retry.hidden = false;
    return;
  }
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
    const reach = await module.cssReach(theme.css);
    note.hidden = reach === "owned";
    note.textContent = module.CSS_NOTES[reach] ?? "";
  }
  const layers = module.rasterLayers(theme);
  $("[data-images]").hidden = !layers.length;
  $("[data-images]").textContent = layers.length ? `This theme embeds ${layers.length} image${layers.length === 1 ? "" : "s"}. Its file and share code include them.` : "";

  const windowEl = $("[data-window]");
  windowEl.hidden = false;
  const container = $("[data-live]");
  const handle = module.mountPreview(container, { view: "profile", theme, preferences: module.DEFAULT_PREFERENCES, cssAllowed: false, compact: true });
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
