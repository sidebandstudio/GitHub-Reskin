// Home and theme pages. The first paint is the shared preview's own capture of the selected theme;
// this script makes the page interactive without loading the preview engine up front:
// - A theme choice applies at once: labels, the URL, the keep link and the capture change in place.
// - The live preview (engine.mjs: C5 mountPreview with the real resolver and compilers) loads when
//   a visitor reaches for the preview or the gallery, and replaces the capture once its first frame
//   is shown. Views, Before/After, Calm and the whole page need it; a choice made while it loads is
//   kept and applied when it arrives.
// Nothing here measures or sends anything.
import { copyText } from "./clipboard.mjs";

const data = JSON.parse(document.getElementById("reskin-data").textContent);
const themes = new Map(data.themes.map((theme) => [theme.slug, theme]));
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  slug: data.initial,
  view: $('input[name="view"]:checked').value,
  before: $('input[name="before"]:checked').value === "before",
  calm: $('input[name="appearance"]:checked').value === "calm",
  expanded: false,
};
const windowEl = $("[data-window]");
const shot = $("[data-shot-img]");
const shotDesk = $("[data-shot-desk]");
const pending = $("[data-pending]");
const status = $("[data-status]");
const themeUrl = (slug) => `${data.canonical}themes/${slug}/`;
// The capture shows the profile in Full, after; anything else needs the live preview.
const captureShows = () => state.view === "profile" && !state.before && !state.calm && !state.expanded;

// The live preview.
let engine = null;
let live = null;
let liveReady = false;
function loadLive() {
  engine ??= import("../engine.mjs").then((module) => {
    const preferences = () => (state.calm ? module.CALM : module.DEFAULT_PREFERENCES);
    const container = $("[data-live]");
    const handle = module.mountPreview(container, { view: state.view, theme: module.DOCS[state.slug], preferences: preferences() });
    if (state.before) handle.setBefore(true);
    const host = container.querySelector("[data-reskin-preview]");
    host.addEventListener("reskin-preview-complete", () => {
      liveReady = true;
      windowEl.dataset.preview = "live";
      refresh();
    });
    live = {
      host,
      update: () => handle.update({ theme: module.DOCS[state.slug], preferences: preferences() }),
      setView: () => handle.setView(state.view),
      setBefore: () => handle.setBefore(state.before),
    };
    return live;
  });
  return engine;
}
// Intent: pointing at, touching or focusing the preview or gallery starts the load.
for (const region of $$("[data-intent], #themes, #extras")) {
  for (const type of ["pointerenter", "pointerdown", "focusin", "touchstart"]) region.addEventListener(type, loadLive, { once: true, passive: true });
}

// Shows the capture or the live frame, and a loading line while the live frame is needed but absent.
function refresh() {
  const theme = themes.get(state.slug);
  const needsLive = !captureShows();
  windowEl.dataset.expanded = String(state.expanded);
  pending.hidden = liveReady || !needsLive;
  if (!liveReady) {
    if (shot.dataset.slug !== state.slug) {
      shot.src = theme.phone;
      shotDesk.srcset = theme.desk;
      shot.alt = `${theme.name} on the whoisaldo GitHub profile`;
      shot.dataset.slug = state.slug;
      shot.dataset.sourceHash = theme.sourceHash;
    }
  }
}
shot.dataset.slug = state.slug;

function select(slug, { announce = true } = {}) {
  const theme = themes.get(slug);
  if (!theme || slug === state.slug) return;
  state.slug = slug;
  for (const link of $$("[data-select]")) {
    if (link.dataset.select === slug) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
  for (const button of $$("[data-theme]")) button.setAttribute("aria-pressed", String(button.dataset.theme === slug));
  for (const card of $$("[data-card]")) card.classList.toggle("is-selected", card.dataset.card === slug);
  for (const node of $$('[data-selected="title"]')) node.textContent = theme.title;
  for (const node of $$('[data-selected="name"]')) node.textContent = node.closest(".picker-drop") ? theme.sub : theme.name;
  for (const node of $$('[data-selected="description"]')) node.textContent = theme.description;
  for (const node of $$('[data-selected="themeFor"]')) node.textContent = theme.group === "anime" ? `${theme.name} · ${theme.themeFor}` : theme.themeFor;
  for (const node of $$('[data-selected="badge"]')) node.hidden = !theme.advancedCss;
  for (const swatch of $$('[data-selected="swatch"]')) swatch.querySelectorAll("i").forEach((cell, i) => cell.style.setProperty("--c", theme.swatch[i]));
  for (const node of $$("[data-keep-name]")) node.textContent = theme.name;
  for (const field of $$("[data-keep-link], [data-keep-inline]")) field.value = themeUrl(slug);
  const full = $('[data-compare="full"]');
  const calm = $('[data-compare="calm"]');
  Object.assign(full, { src: theme.phone, alt: `${theme.name} in Full` });
  Object.assign(calm, { src: theme.calm, alt: `${theme.name} in Calm` });
  document.title = theme.pageTitle;
  history.replaceState(null, "", `${data.base}themes/${slug}/${location.hash}`);
  refresh();
  if (live) live.update();
  else loadLive();
  if (announce) status.textContent = `Previewing ${theme.title}, ${theme.name}`;
}

// Theme links: in place once this script runs; before that they are ordinary links to the theme page.
const drop = $("[data-picker]");
for (const link of $$("[data-select]")) {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    select(link.dataset.select);
    if (drop?.contains(link)) {
      drop.open = false;
      drop.querySelector("summary").focus({ preventScroll: true });
    }
  });
}
drop?.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drop.open) {
    drop.open = false;
    drop.querySelector("summary").focus();
  }
});
document.addEventListener("click", (event) => {
  if (drop?.open && !drop.contains(event.target)) drop.open = false;
});

// Gallery Preview keeps focus and scroll; View in preview selects and jumps there.
for (const button of $$("[data-theme]")) button.addEventListener("click", () => select(button.dataset.theme));
for (const link of $$("[data-jump]")) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    select(link.dataset.jump);
    $("#preview").scrollIntoView({ block: "start" });
    const target = $$(`[data-select="${link.dataset.jump}"]`).find((node) => node.offsetParent !== null) ?? $("[data-picker] summary");
    target?.focus({ preventScroll: true });
  });
}

// View, Before/After and Full/Calm. Choices made before the live preview arrives are kept.
const controls = {
  view: () => live?.setView(),
  before: () => live?.setBefore(),
  appearance: () => live?.update(),
};
function readControls() {
  state.view = $('input[name="view"]:checked').value;
  state.before = $('input[name="before"]:checked').value === "before";
  state.calm = $('input[name="appearance"]:checked').value === "calm";
}
for (const name of Object.keys(controls)) {
  for (const input of $$(`input[name="${name}"]`)) {
    input.addEventListener("change", () => {
      readControls();
      refresh();
      // A preview that is still loading mounts with the state it finds.
      if (live) controls[name]();
      else loadLive();
    });
  }
}
// A choice made before this script ran.
readControls();
if (!captureShows()) loadLive();

const expand = $("[data-expand]");
expand.addEventListener("click", () => {
  state.expanded = !state.expanded;
  expand.setAttribute("aria-expanded", String(state.expanded));
  expand.textContent = state.expanded ? "Show less" : "Show the whole page";
  refresh();
  loadLive();
  if (!state.expanded) windowEl.scrollIntoView({ block: "nearest" });
});

$("[data-show-diff]").addEventListener("click", (event) => {
  event.preventDefault();
  const input = $('input[name="view"][value="diff"]');
  input.checked = true;
  input.dispatchEvent(new Event("change"));
  $("#preview").scrollIntoView({ block: "start" });
  input.focus({ preventScroll: true });
});

// Keep for desktop. Without this script the Keep links lead to the selectable link in #keep.
const sheet = $("#keep-sheet");
const keepStatus = $("[data-keep-status]");
let opener = null;
for (const button of $$("[data-open-keep]")) {
  button.addEventListener("click", (event) => {
    event.preventDefault();
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
    const theme = themes.get(state.slug);
    try {
      await navigator.share({ title: `${theme.title} theme for GitHub: ${theme.name}`, text: `Pick ${theme.name} in GitHub Reskin on desktop.`, url: themeUrl(state.slug) });
    } catch {}
  });
}

// Copy AI prompt. Copied is shown only after the clipboard accepts the text.
const promptText = $("#prompt-text");
const copyStatus = $("[data-copy-status]");
$("[data-copy-prompt]").addEventListener("click", async () => {
  if (await copyText(promptText.value)) {
    copyStatus.textContent = "Prompt copied. Paste it into your chatbot and describe your theme, then paste its answer on Make a theme.";
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

// On a theme page, show the selected option inside the open list without scrolling the page.
drop?.addEventListener("toggle", () => {
  if (drop.open) drop.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
});
