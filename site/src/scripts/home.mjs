// Home and theme pages: theme switching, preview views, Before/After, flavor extras, the
// keep-for-desktop sheet, Copy AI prompt and the likely-browser hint. Everything works on the
// pre-rendered page; this only adds behavior. No network requests.
import { DEFAULT_PREFERENCES, mountPreview } from "../engine.mjs";
import { copyText } from "./clipboard.mjs";

const data = JSON.parse(document.getElementById("reskin-data").textContent);
const themes = new Map(data.themes.map((theme) => [theme.slug, theme]));
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let slug = data.initial;
let preferences = { ...DEFAULT_PREFERENCES };
const hero = mountPreview($("#hero-preview"), { view: "profile", theme: themes.get(slug).doc, preferences });
const extras = mountPreview($("#extras-preview"), { view: "profile", theme: themes.get(slug).doc, preferences });
const status = $("[data-status]");

const themeUrl = (s) => `${data.canonical}themes/${s}/`;

function select(next, { announce = true } = {}) {
  const theme = themes.get(next);
  if (!theme) return;
  slug = next;
  hero.update({ theme: theme.doc, preferences });
  extras.update({ theme: theme.doc, preferences });
  for (const button of $$("[data-theme]")) button.setAttribute("aria-pressed", String(button.dataset.theme === next));
  for (const card of $$("[data-card]")) card.classList.toggle("is-selected", card.dataset.card === next);
  for (const key of ["name", "credit", "description"]) $(`[data-selected="${key}"]`).textContent = theme[key];
  for (const node of $$("[data-keep-name]")) node.textContent = theme.name;
  $("[data-keep-link]").value = themeUrl(next);
  document.title = theme.title;
  history.replaceState(null, "", `${data.base}themes/${next}/${location.hash}`);
  if (announce) status.textContent = `Previewing ${theme.name}`;
}

// On a theme page, bring the selected chip into the strip's own view without scrolling the page.
const strip = $(".picker-list");
const pressed = $('.chip[aria-pressed="true"]');
if (pressed && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = pressed.parentElement.offsetLeft - strip.offsetLeft - 16;

// Theme buttons keep focus and scroll; the page does not move.
for (const button of $$("[data-theme]")) button.addEventListener("click", () => select(button.dataset.theme));

// View in preview: select the theme and jump to the preview, without a page load.
for (const link of $$("[data-jump]")) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    select(link.dataset.jump);
    $("#preview").scrollIntoView({ block: "start" });
    $(`.chip[data-theme="${link.dataset.jump}"]`)?.focus({ preventScroll: true });
  });
}

for (const input of $$('input[name="view"]')) input.addEventListener("change", () => hero.setView(input.value));
for (const input of $$('input[name="before"]')) input.addEventListener("change", () => hero.setBefore(input.value === "before"));

$("#extras-switch").addEventListener("change", (event) => {
  preferences = { ...preferences, extras: event.target.checked };
  select(slug, { announce: false });
  status.textContent = event.target.checked ? "Flavor extras on" : "Flavor extras off";
});

$("[data-show-diff]").addEventListener("click", (event) => {
  event.preventDefault();
  const input = $('input[name="view"][value="diff"]');
  input.checked = true;
  hero.setView("diff");
  $("#preview").scrollIntoView({ block: "start" });
  input.focus({ preventScroll: true });
});

$("[data-open-classics]").addEventListener("click", () => {
  $("#classics").open = true;
});

// Keep for desktop.
const sheet = $("#keep-sheet");
const keepStatus = $("[data-keep-status]");
let opener = null;
for (const button of $$("[data-open-keep]")) {
  button.addEventListener("click", () => {
    opener = button;
    keepStatus.textContent = "";
    sheet.showModal();
  });
}
$("[data-close-keep]").addEventListener("click", () => sheet.close());
sheet.addEventListener("click", (event) => {
  if (event.target === sheet) sheet.close();
});
sheet.addEventListener("close", () => opener?.focus());
$("[data-copy-link]").addEventListener("click", async () => {
  const field = $("[data-keep-link]");
  if (await copyText(field.value)) keepStatus.textContent = "Link copied";
  else {
    field.focus();
    field.select();
    keepStatus.textContent = "Copy is not available here. The link is selected; copy it from the field.";
  }
});
const share = $("[data-share-link]");
if (typeof navigator.share === "function") {
  share.hidden = false;
  share.addEventListener("click", async () => {
    const theme = themes.get(slug);
    try {
      await navigator.share({ title: `${theme.name} for GitHub Reskin`, text: `Pick ${theme.name} in GitHub Reskin on desktop.`, url: themeUrl(slug) });
    } catch {}
  });
}

// Copy AI prompt. Copied is shown only after the clipboard accepts the text.
const promptText = $("#prompt-text");
const copyStatus = $("[data-copy-status]");
$("[data-copy-prompt]").addEventListener("click", async () => {
  if (await copyText(promptText.value)) {
    copyStatus.textContent = "Prompt copied. Paste it into your chatbot, describe your theme, then paste its answer into Import.";
  } else {
    $("[data-prompt-fallback]").hidden = false;
    promptText.focus();
    promptText.select();
    copyStatus.textContent = "Copy is not available here. Select the prompt below and copy it.";
  }
});

// Likely browser: only emphasizes a card. Every option stays visible.
function likelyBrowser() {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|BytedanceWebview|musical_ly|TikTok/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return "phone";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Edg\/|OPR\/|Vivaldi|Chrome\//.test(ua) || navigator.userAgentData?.brands?.length) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return null;
}
const likely = likelyBrowser();
if (likely && likely !== "phone") $(`[data-browser="${likely}"]`)?.classList.add("is-likely");
