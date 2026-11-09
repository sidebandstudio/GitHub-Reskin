// Make a theme: Copy AI prompt and the local importer. The format's parseImport reads the pasted
// answer or file, with the CSS sanitizer loaded, and the shared preview shows it. Imported advanced
// CSS stays off until the visitor enables it. Nothing is fetched or uploaded; the engine and the
// sanitizer load when the visitor starts on an answer.
import { copyText } from "./clipboard.mjs";

const $ = (selector) => document.querySelector(selector);
const { sample, maxLink } = JSON.parse($("#make-data").textContent);
const answer = $("#answer-text");
const fieldError = $("[data-import-error]");
const status = $("[data-import-status]");
const nameLine = $("[data-make-name]");
const notes = $("[data-notes]");
const issues = $("[data-import-issues]");
const candidates = $("[data-candidates]");
const cssReview = $("[data-css-review]");
const cssEnable = $("[data-css-enable]");
const images = $("[data-images]");
const exportsRow = $("[data-exports]");
const exportStatus = $("[data-export-status]");
const windowEl = $("[data-window]");

let engine = null;
const load = () =>
  (engine ??= import("../engine.mjs").then(async (module) => {
    await module.loadAuthoring();
    return module;
  }));
for (const node of [answer, $("[data-preview-answer]"), $("[data-sample]"), $("[data-file]")]) {
  for (const type of ["focus", "pointerenter", "touchstart"]) node.addEventListener(type, load, { once: true, passive: true });
}

// The last valid theme, and whether its advanced CSS is enabled in the preview.
let current = null;
let handle = null;

const list = (node, items) => {
  node.replaceChildren(...items.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
  node.hidden = !items.length;
};
const kib = (bytes) => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;

async function show() {
  const module = await load();
  const options = { theme: current, preferences: module.DEFAULT_PREFERENCES, cssAllowed: cssEnable.checked };
  if (handle) handle.update(options);
  else {
    const container = $("[data-live]");
    handle = module.mountPreview(container, { view: "profile", ...options });
    container.querySelector("[data-reskin-preview]").addEventListener("reskin-preview-complete", () => {
      windowEl.dataset.preview = "live";
      $("[data-pending]").hidden = true;
    });
    $("[data-pending]").hidden = false;
  }
}

function clearError() {
  fieldError.hidden = true;
  fieldError.textContent = "";
  answer.removeAttribute("aria-invalid");
}

async function runImport(input, kind) {
  const module = await load();
  clearError();
  list(issues, []);
  candidates.hidden = true;
  candidates.replaceChildren();
  const result = module.parseImport(input, kind);
  if (!result.ok) {
    // The leading problem appears once, at the field; the rest are listed below it. The last valid
    // preview stays and is named as the previous one, with its own download.
    const [first, ...rest] = result.issues;
    fieldError.textContent = first.message;
    fieldError.hidden = false;
    answer.setAttribute("aria-invalid", "true");
    list(issues, [...new Set(rest.map((issue) => issue.message))].filter((message) => message !== first.message));
    status.textContent = current ? `The previous valid preview, ${current.name}, is still shown.` : "Nothing to preview yet.";
    if (current) nameLine.textContent = `Previous valid preview: ${current.name}`;
    if (result.candidates?.length) {
      candidates.hidden = false;
      for (const candidate of result.candidates) {
        const button = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: `Preview ${candidate.name}` });
        button.addEventListener("click", () => runImport(candidate.input, "text"));
        candidates.append(button);
      }
    }
    return;
  }
  current = result.normalized;
  cssEnable.checked = false;
  nameLine.textContent = current.inspiredBy ? `${current.inspiredBy}: ${current.name}` : current.name;
  status.textContent = "Theme ready to preview.";
  list(notes, result.notes.map((note) => note.message));
  const css = typeof current.css === "string" && current.css !== "";
  cssReview.hidden = !css;
  if (css) {
    $("[data-css-size]").textContent = `${new TextEncoder().encode(current.css).length.toLocaleString("en-US")} bytes of CSS, checked by the sanitizer. It is off in this preview until you enable it.`;
    $("[data-css-source]").textContent = current.css;
    const note = $("[data-css-note]");
    const reach = await module.cssReach(current.css);
    note.hidden = reach === "owned";
    note.textContent = module.CSS_NOTES[reach] ?? "";
  }
  const layers = module.rasterLayers(current);
  const bytes = layers.reduce((n, layer) => n + Math.floor((layer.image.data.length - layer.image.data.indexOf(",") - 1) * 0.75), 0);
  images.hidden = !layers.length;
  images.textContent = layers.length ? `This theme embeds ${layers.length} image${layers.length === 1 ? "" : "s"}, ${kib(bytes)} in all. Its file and preview link include them, and anyone you share them with can save them.` : "";
  $("[data-download-label]").textContent = `Download ${current.name}`;
  exportsRow.hidden = false;
  exportStatus.textContent = "";
  $("[data-share-fallback]").hidden = true;
  await show();
}

cssEnable.addEventListener("change", async () => {
  if (!current) return;
  status.textContent = cssEnable.checked ? "Advanced CSS is enabled in this preview." : "Advanced CSS is off in this preview.";
  await show();
});

$("[data-preview-answer]").addEventListener("click", () => runImport(answer.value, "text"));
answer.addEventListener("input", () => fieldError.hidden || clearError());
$("[data-sample]").addEventListener("click", () => {
  answer.value = sample;
  runImport(sample, "text");
});
$("[data-file]").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  runImport(new Uint8Array(await file.arrayBuffer()), "file");
  event.target.value = "";
});

$("[data-download]").addEventListener("click", async () => {
  if (!current) return;
  const { filename, mime, bytes } = (await load()).exportTheme(current);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  exportStatus.textContent = `Downloaded ${filename}.`;
});

$("[data-copy-share]").addEventListener("click", async () => {
  if (!current) return;
  const code = (await load()).encodeShare(current);
  const url = `${new URL("../share/", document.querySelector('link[rel="canonical"]').href)}#${code}`;
  const fallback = $("[data-share-fallback]");
  if (url.length > maxLink) {
    fallback.hidden = true;
    exportStatus.textContent = `This preview link would be ${url.length.toLocaleString("en-US")} characters, over the ${maxLink.toLocaleString("en-US")}-character limit. Share the theme file instead.`;
    return;
  }
  const field = $("[data-share-text]");
  field.value = url;
  if (await copyText(url)) {
    fallback.hidden = true;
    exportStatus.textContent = "Preview link copied. It opens this theme on the site; advanced CSS stays off until the recipient enables it.";
  } else {
    fallback.hidden = false;
    field.focus();
    field.select();
    exportStatus.textContent = "Copy is not available here. The link is selected; copy it from the field.";
  }
});

const promptText = $("#prompt-text");
const copyStatus = $("[data-copy-status]");
$("[data-copy-prompt]").addEventListener("click", async () => {
  if (await copyText(promptText.value)) copyStatus.textContent = "Prompt copied. Paste it into your chatbot, describe your theme, then paste its answer below.";
  else {
    $("[data-prompt-details]").open = true;
    promptText.focus();
    promptText.select();
    copyStatus.textContent = "Copy is not available here. Select the prompt and copy it.";
  }
});

// A link to #sample from the home page fills the sample in.
if (location.hash === "#sample") {
  answer.value = sample;
  runImport(sample, "text");
}
