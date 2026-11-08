// Make a theme: Copy AI prompt and the local answer preview. Parsing happens in the page; nothing
// is fetched or uploaded.
import { DEFAULT_PREFERENCES, mountPreview, parseImport } from "../engine.mjs";
import { copyText } from "./clipboard.mjs";

const $ = (selector) => document.querySelector(selector);
const { sample } = JSON.parse($("#make-data").textContent);
const container = $("#make-preview");
// The page shows the default theme pre-rendered; the preview mounts on the first valid answer.
let current = null;
let handle = null;

const status = $("[data-import-status]");
const issues = $("[data-import-issues]");
const candidates = $("[data-candidates]");
const download = $("[data-download]");

function show(theme) {
  current = theme;
  if (handle) handle.update({ theme, preferences: DEFAULT_PREFERENCES });
  else handle = mountPreview(container, { view: "profile", theme, preferences: DEFAULT_PREFERENCES });
  $("[data-make-name]").textContent = `Showing ${theme.name}.`;
  download.hidden = false;
}

function runImport(text) {
  issues.hidden = true;
  issues.replaceChildren();
  candidates.hidden = true;
  candidates.replaceChildren();
  const result = parseImport(text);
  if (result.ok) {
    show(result.normalized);
    status.textContent = result.notes.length ? `Previewing ${result.normalized.name}. ${result.notes.map((n) => n.message).join(" ")}` : `Previewing ${result.normalized.name}.`;
    return;
  }
  // The last valid preview stays in place.
  status.textContent = result.issues[0].message;
  for (const item of result.issues.slice(result.candidates ? 1 : 0)) {
    const li = document.createElement("li");
    li.textContent = item.message;
    issues.append(li);
  }
  issues.hidden = !issues.children.length;
  if (result.candidates) {
    candidates.hidden = false;
    for (const candidate of result.candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = `Preview ${candidate.name}`;
      button.addEventListener("click", () => runImport(candidate.input));
      candidates.append(button);
    }
  }
}

$("[data-preview-answer]").addEventListener("click", () => runImport($("#answer").value));
$("[data-sample]").addEventListener("click", () => {
  $("#answer").value = sample;
  runImport(sample);
});

download.addEventListener("click", () => {
  if (!current) return;
  const name = current.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "my-theme";
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(current, null, 2)}\n`], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `${name}.reskin.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
