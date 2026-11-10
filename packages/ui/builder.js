// mountBuilder(doc, options): the Make a theme view. Three colors first, then progressive
// disclosures for fonts, effects, flavor text, backgrounds, shape and type, the graph, code and
// diffs, details and Advanced CSS; one-change Undo, a recoverable draft, Save/Discard/Reset;
// Import by paste, file or share code; export as a file, theme JSON, share code or preview link;
// and Copy AI prompt. Editing changes only the draft and its offline preview until Save. The
// page's static HTML supplies the controls, marked data-rb="<part>"; repeated color rows are
// built here from fields.js. Text from themes enters only through textContent and value.
import { LOCAL_THEME_ID_PREFIX, LIMITS, SANITIZER_VERSION } from "../contracts/index.js";
import { basePolarityIssue, repairTheme, sourceHash } from "../engine/index.js";
import { acceptsFileName, canonicalize, dataUrlBytes, makeAiPrompt, normalizeHex, rasterInfo, rasterSourceInfo, rasterTotals, UPLOAD_SOURCE_BYTES } from "../format/index.js";
import { browserRasterEnv, convertRaster, createRasterQueue, fitSize, removeRasterLayer, setRasterLayer } from "../appearance/raster.js";
import { COPY as DRAFT_COPY, addLayer, checked, commitEdit, copyName, createDraft, draftFromRecord, draftRecord, fixBase, freshDocument, layerCount, removeLayer, setCss, setEffect, setField, setFlavorSlot, setGraphLevel, switchBase, undo, valueAt, withValue } from "./draft.js";
import { ANSI_COLORS, BACKGROUND_TARGETS, CODE_COLORS, CORE_COLORS, DETAIL_COLORS, DETAIL_FIELDS, DIFF_COLORS, EFFECTS, FLAVOR_FIELDS, GRADIENT_TYPES, GRAPH_FIELDS, GRAPH_LEVEL_LABELS, IMAGE_FITS, IMAGE_POSITIONS, PATTERN_KINDS, SHAPE_FIELDS, SYNTAX_COLORS, fontChoices } from "./fields.js";
import { APPROVAL_ISSUE, effectivePreferences, NEW_TARGET } from "../settings/index.js";
import { analyzeImport, COPY as IMPORT_COPY, cssSummary, exportFile, extractObject, kib, repaired, shareSheet, themeJson } from "./importer.js";

export const COPY = Object.freeze({
  promptCopied: "AI prompt copied.",
  promptBlocked: "Your browser didn't allow copying. Select the prompt below and copy it.",
  saved: (name) => `Saved ${name} and applied it to GitHub.`,
  savedChanges: (name) => `Saved changes to ${name}.`,
  saveFailed: "We couldn't save your theme. Your draft is still here.",
  full: "Your theme collection is full. Export or remove a saved theme, then try again.",
  needName: "Give your theme a name.",
  hex: "Use a color like #18212b.",
  imported: (name) => `Imported ${name}. Save it to keep it.`,
  reset: (name) => `Reset to ${name}.`,
  discarded: "Draft discarded. The preview shows your saved theme.",
  resumed: "Your draft is back.",
  copied: (what) => `Copied the ${what}.`,
  copyBlocked: "Your browser didn't allow copying. Select the text below and copy it.",
  downloaded: (file) => `Downloaded ${file}.`,
  draftFailed: "We couldn't keep a recoverable copy of this draft. Download it to keep your work.",
  fixFirst: "Fix Light or dark first, then export.",
  cssOff: "Advanced CSS is off for this draft. Turn on Enable advanced CSS to preview it.",
  fileType: "Choose a .json or .reskin.json file.",
  fileTooLarge: `This theme exceeds the file, image or CSS limit. Theme files are at most ${kib(LIMITS.fileUtf8Bytes)}.`,
  baseFix: (base) => `Switch to ${base}`,
  cssRevoked: "Advanced CSS was turned off in another window. Turn on Enable advanced CSS to use it again.",
  missingColor: (label) => `Choose ${label.toLowerCase()} here, or copy a fix request for your chatbot.`,
  fresh: "New theme from three colors",
  imageLimits: `Each image is at most ${kib(LIMITS.perImageDecodedBytes)}, and a theme's images come to at most ${kib(LIMITS.documentImageDecodedBytes)} and ${LIMITS.documentImageDecodedPixels.toLocaleString("en-US")} pixels together. PNG, JPEG, WebP or GIF files up to ${UPLOAD_SOURCE_BYTES / 1048576} MiB that don't fit are converted here first, and you choose whether to use the result.`,
  imageUsage: (bytes, pixels) => `Images in this theme: ${kib(bytes)} of ${kib(LIMITS.documentImageDecodedBytes)}, ${pixels.toLocaleString("en-US")} of ${LIMITS.documentImageDecodedPixels.toLocaleString("en-US")} pixels.`,
  imageType: "Choose a PNG, JPEG, WebP or GIF image.",
  imageTooLarge: (bytes) => `This image is ${kib(bytes)}. Images to convert are at most ${UPLOAD_SOURCE_BYTES / 1048576} MiB.`,
  imageAdded: (name, image, bytes) => `Added ${name}, ${image.width} × ${image.height} px, ${kib(bytes)}.`,
  imageConverting: "Converting the image on this device…",
  imageOffer: (name) => `${name} doesn't fit as it is. Use this converted copy?`,
  imageAccepted: "Added the converted image.",
  imageReplaced: "Replaced the image with the smaller copy.",
  imageRemoved: "Removed the image.",
  freshStarted: "Started a new theme from three colors. Undo puts the last one back.",
  remixed: (name) => `Started from every detail of ${name}. Undo puts the last one back.`,
  approveAgain: "Advanced CSS needs your approval again. Turn on Enable advanced CSS, then save.",
  approveFailed: "We couldn't turn on advanced CSS. Try Enable advanced CSS again.",
  copyCssOff: (name) => `Saved ${name} as a copy and applied it to GitHub. Its advanced CSS stays off until you turn on Enable advanced CSS for the copy.`,
  conflict: "Your settings changed in another window, so this draft was not saved.",
  resumeConflict: (name) => `${name} was saved again after this draft was kept. Keep editing to replace the saved version when you save, or load the saved theme.`,
  imageResize: (width, height) => `Resize to ${width} × ${height} px`,
  imageTooBig: (bytes) => `The converted image is ${kib(bytes)}, more than this theme has room for. Resize it to make it smaller.`,
  imageTooManyPixels: "This image doesn't fit beside the theme's other images. Resize it to make it smaller, or remove another image.",
  imageCannotFit: (width, height) => `This image can't be made small enough to fit in this theme, even at ${width} × ${height} px. Choose a smaller or simpler image, or remove another image first.`,
  imageNoRoom: "This image has more pixels than this theme has room for, so it can't be converted here. Choose a smaller image, or remove another image first.",
});
// Resize halves the longest side, down to this many pixels.
const MIN_IMAGE_SIDE = 16;
const ROLE_LABELS = { background: "Background", text: "Text", accent: "Accent" };
const ROLE_EXAMPLES = { background: "#18212b", text: "#e6edf3", accent: "#ff806c" };

const AUTOSAVE_MS = 400;
const CSS_CHECK_MS = 250;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const json = (value) => JSON.stringify(value);
const MIME_NAMES = { "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP", "image/gif": "GIF" };
const describe = ({ bytes, width, height, mime }) => `${kib(bytes)} ${MIME_NAMES[mime] ?? ""}, ${width} × ${height} px`.replace(/ ,/, ",");
function base64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
// A file's bytes as a Uint8Array of this script's own realm. In a Firefox content script (the
// userscript) a file from the page's input is read through an Xray, and a view made on its
// ArrayBuffer belongs to the page, which no check here accepts as bytes; a copy does.
async function fileBytes(file) {
  const view = new Uint8Array(await file.arrayBuffer());
  const bytes = new Uint8Array(view.length);
  bytes.set(view);
  return bytes;
}
// Saved documents come back from storage in canonical key order; compare themes the same way.
const same = (a, b) => (a && b ? canonicalize(a) === canonicalize(b) : a === b);
const el = (doc, tag, props = {}, children = []) => {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children);
  return node;
};
const idFor = (path) => `rb${path.replace(/[^a-z0-9]+/gi, "-")}`;

/**
 * @param {Document} doc
 * @param {object} options
 * @param {object} options.host UiHost with loadDraft/saveDraft/discardDraft (host.js)
 * @param {object} options.catalog CatalogSource of bundled themes
 * @param {(base:string)=>object} options.standardSeed the standard seed of a base
 * @param {(container:Element, options:object)=>object} options.mountPreview C5's mountPreview
 * @param {(fontId:string)=>string} [options.fontFace] @font-face CSS for a bundled face
 * @param {object} [options.clipboard] {writeText(text)}; navigator.clipboard by default
 * @param {(file:{filename,mime,bytes})=>void} [options.download]
 * @param {(bytes:Uint8Array, options:object)=>Promise<object>} [options.convertImage] convertRaster in this page
 */
export function mountBuilder(doc, { host, catalog, standardSeed, mountPreview, fontFace = null, clipboard = doc.defaultView?.navigator?.clipboard, download = null, convertImage = null }) {
  const root = doc.querySelector('[data-rb="builder"]');
  if (!root) return null;
  const part = (name) => root.querySelector(`[data-rb="${name}"]`);
  const win = doc.defaultView;
  const cleanups = [];
  const listen = (target, type, handler, options) => {
    if (!target) return;
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  let settings = null;
  let draft = null;
  // The committed source the draft started from, to tell whether it changed and to Reset to.
  let source = null;
  let pendingRecord = null;
  let autosave = 0;
  let cssTimer = 0;
  let preview = null;
  let importPreview = null;
  let view = "profile";
  let resolvedNow = null;
  let lastPreviewed = null;
  let retry = null;
  let importResult = null;
  let importKind = "text";
  let bgTarget = "page";
  let layerKey = "";
  let destroyed = false;
  // While Reset all runs: no autosave, not even the one destroy() flushes, may write the draft back.
  let holding = false;
  // This editor's identity for CSS approval. It lives only in this page's memory: no draft record,
  // other window or later page has it, so none of them can redeem this editor's approval.
  const editor = (win?.crypto ?? globalThis.crypto).randomUUID().replace(/-/g, "");
  // The approval ticket the settings repository issued when the person turned on Enable advanced
  // CSS here, for one target and exactly one CSS text: {ticket, target, hash, storedHash, storedConsent}.
  // It is never part of the draft, its Undo history or its record.
  let approval = null;
  let approving = null;

  // ----- messages -----
  const say = (text) => (part("status").textContent = text);
  function fail(text, { again = null, offerDownload = false, manage = false } = {}) {
    retry = again;
    const box = part("error");
    box.hidden = false;
    box.querySelector("[data-rb-text]").textContent = text;
    part("retry").hidden = !again;
    part("download-draft").hidden = !offerDownload;
    part("manage").hidden = !manage;
  }
  const clearError = () => {
    retry = null;
    part("error").hidden = true;
  };
  function fieldError(key, text) {
    const node = root.querySelector(`[data-rb-error-for="${CSS.escape(key)}"]`);
    if (!node) return;
    node.hidden = !text;
    node.textContent = text ?? "";
  }

  // ----- source and draft -----
  const customTheme = (id) => settings?.customThemes.find((theme) => theme.id === id) ?? null;
  function sourceFor(draftLike) {
    const saved = draftLike.savedId ? customTheme(draftLike.savedId) : null;
    if (saved) return { name: saved.document.name, document: saved.document, cssEnabled: consentMatches(saved.id, saved.document), savedId: saved.id };
    const id = draftLike.basedOn && catalog.has(draftLike.basedOn) ? draftLike.basedOn : null;
    if (!id) return null;
    const document = catalog.document(id);
    if (draftLike.fresh) return { name: document.name, document: freshDocument(document), cssEnabled: false, savedId: null, bundledName: document.name, fresh: true };
    return { name: document.name, document: { ...structuredClone(document), name: copyName(document.name) }, cssEnabled: false, savedId: null, bundledName: document.name };
  }
  function consentMatches(id, document) {
    const consent = settings?.cssConsent?.[id];
    const css = cssSummary(document);
    return Boolean(consent && css?.ok && consent.hash === css.hash && consent.sanitizerVersion === SANITIZER_VERSION);
  }
  // The draft a selected theme starts: a saved one is edited; a bundled one starts a new theme from
  // its three colors alone, or with `remix` every detail of it as "My <name>".
  function startFrom(themeId, { remix = false } = {}) {
    if (themeId.startsWith(LOCAL_THEME_ID_PREFIX) && customTheme(themeId)) {
      const saved = customTheme(themeId);
      return createDraft({ document: structuredClone(saved.document), basedOn: saved.basedOn ?? null, savedId: saved.id, cssEnabled: consentMatches(saved.id, saved.document), baseHash: sourceHash(saved.document) });
    }
    const id = catalog.has(themeId) ? themeId : catalog.ids[0];
    if (!remix) return createDraft({ document: freshDocument(catalog.document(id)), basedOn: id, fresh: true });
    return createDraft({ document: { ...structuredClone(catalog.document(id)), name: copyName(catalog.document(id).name) }, basedOn: id });
  }
  // The bundled theme a new draft takes its starting colors or details from.
  const bundledBase = () => [draft?.basedOn, settings?.selectedThemeId].find((id) => id && catalog.has(id)) ?? catalog.ids[0];
  // What Remix (a bundled theme) or Edit (a saved one) starts from: the theme the builder opened
  // on, or the one it last saved.
  let remixFrom = null;
  const remixTarget = () => (remixFrom && (customTheme(remixFrom) || catalog.has(remixFrom)) ? remixFrom : bundledBase());
  const dirty = () => Boolean(source && (!same(draft.document, source.document) || cssOn(draft) !== Boolean(source.cssEnabled)));

  // ----- CSS approval -----
  // A draft's CSS applies only with an approval in force for its target and exact CSS: this
  // editor's ticket, or the stored approval of the saved theme it edits. draft.cssEnabled is only
  // the person's choice to use it, so no restored, copied or resumed draft carries approval itself.
  // The settings repository enforces the same rule on every save (packages/settings/consent.js).
  const targetOf = (d) => d.savedId ?? NEW_TARGET;
  const cssHash = (document) => {
    const summary = cssSummary(document);
    return summary?.ok ? summary.hash : null;
  };
  const ticketFor = (d) => Boolean(approval && approval.target === targetOf(d) && approval.hash === cssHash(d.document));
  function cssOn(d) {
    if (!d?.cssEnabled || !cssHash(d.document)) return false;
    return ticketFor(d) || Boolean(d.savedId && consentMatches(d.savedId, d.document));
  }
  // Drops this editor's ticket here and in the repository: the person turned Enable off, changed
  // the CSS or what the draft is, or the approval stopped holding elsewhere.
  function dropApproval() {
    approving = null;
    if (!approval) return;
    approval = null;
    host.commit({ type: "withdrawCss", editor }, settings?.revision ?? 0).catch(() => {});
  }
  // A ticket covers one target and one CSS text; anything else leaves it behind.
  function settleApproval() {
    if (approval && !ticketFor(draft)) dropApproval();
  }
  /**
   * Asks the repository for a ticket for this draft's exact CSS: the explicit Enable choice.
   * Resolves true once held, false when refused, null when withdrawn or overtaken meanwhile.
   */
  function requestApproval() {
    const text = draft.document.css;
    const target = targetOf(draft);
    const request = (async () => {
      const reply = await host.commit({ type: "approveCss", editor, target, css: text }, settings?.revision ?? 0);
      if (!reply?.ok || !reply.approval) {
        if (request !== approving) return null;
        approving = null;
        return false;
      }
      // Withdrawn, or the draft moved on while the repository answered: the person did not
      // approve what is shown now, so the new ticket goes too. A newer request has already
      // replaced it in the repository and answers for itself.
      if (request !== approving || destroyed || draft.document.css !== text || targetOf(draft) !== target) {
        const superseded = approving !== null && request !== approving;
        if (request === approving) approving = null;
        if (!superseded) {
          approval = null;
          host.commit({ type: "withdrawCss", editor }, settings?.revision ?? 0).catch(() => {});
        }
        return null;
      }
      approving = null;
      const stored = target === NEW_TARGET ? null : customTheme(target);
      approval = { ticket: reply.approval.ticket, target, hash: reply.approval.hash, storedHash: stored ? cssHash(stored.document) : null, storedConsent: Boolean(stored && settings?.cssConsent?.[target]) };
      return true;
    })().catch(() => false);
    approving = request;
    return request;
  }

  /** Replaces the draft after a completed edit, then renders, previews and schedules the autosave. */
  function accept(next, { save = true } = {}) {
    if (pendingRecord) dismissResume(true);
    draft = next;
    render();
    if (save) scheduleAutosave();
  }
  function edit(result, patch = {}) {
    if (!result.ok) return result;
    accept(commitEdit(draft, result.document, patch));
    return result;
  }

  function scheduleAutosave() {
    if (!win || pendingRecord || holding) return;
    win.clearTimeout(autosave);
    autosave = win.setTimeout(saveDraftNow, AUTOSAVE_MS);
  }
  async function saveDraftNow() {
    autosave = 0;
    if (destroyed || holding || !draft || pendingRecord) return;
    if (!dirty()) return void host.discardDraft().catch(() => {});
    const reply = await host.saveDraft(draftRecord(draft)).catch((error) => ({ ok: false, issues: [{ message: String(error?.message ?? error) }] }));
    if (!reply?.ok && !destroyed) fail(reply?.issues?.[0]?.message && /1\.25 MiB/.test(reply.issues[0].message) ? reply.issues[0].message : COPY.draftFailed, { offerDownload: true });
  }

  // ----- preview -----
  // The draft previews as GitHub would show it under the global preferences, with Reskin on.
  const preferences = () => (settings ? { ...effectivePreferences(settings), enabled: true } : { enabled: true, appearance: "full", extras: true, text: true, motion: true, fonts: true, effects: true });
  const cssAllowed = (document, enabled) => Boolean(enabled && cssSummary(document)?.ok);

  /** Shows a document in the preview, unless its base contradicts its colors: then the fix shows. */
  function showPreview(document, enabled = cssOn(draft)) {
    const polarity = basePolarityIssue(document);
    const box = part("polarity");
    box.hidden = !polarity;
    if (polarity) {
      const other = document.base === "dark" ? "light" : "dark";
      box.querySelector("[data-rb-text]").textContent = IMPORT_COPY.basePolarity(document.base);
      part("polarity-fix").textContent = COPY.baseFix(other);
      return false;
    }
    const options = { theme: document, preferences: preferences(), cssAllowed: cssAllowed(document, enabled) };
    try {
      if (!preview) preview = mountPreview(part("preview"), { view, ...options });
      else preview.update(options);
      lastPreviewed = { document, cssAllowed: options.cssAllowed };
      return true;
    } catch {
      // An invalid theme throws in the preview; the last valid one stays.
      return false;
    }
  }

  function showRepairs(document) {
    const box = part("repairs");
    if (basePolarityIssue(document)) return void (box.hidden = true);
    const result = repaired(document, standardSeed);
    resolvedNow = result.resolved;
    const messages = result.messages.map((m) => m.text);
    box.hidden = !messages.length;
    box.querySelector("[data-rb-text]").textContent = messages.join(" ");
    fillRepairList(part("repair-list"), result.repairs);
  }

  function fillRepairList(container, repairs) {
    const table = el(doc, "table", { class: "rb-repair-table" });
    table.append(el(doc, "caption", { class: "rs-visually-hidden", text: "Color adjustments" }));
    table.append(el(doc, "thead", {}, [el(doc, "tr", {}, ["Field", "Before", "After", "Why"].map((h) => el(doc, "th", { scope: "col", text: h })))]));
    const body = el(doc, "tbody");
    for (const repair of repairs) {
      const swatch = (value) => (typeof value === "string" ? el(doc, "span", { class: "rb-swatch-text" }, [el(doc, "span", { class: "rb-swatch", style: `background:${value}`, "aria-hidden": "true" }), value]) : el(doc, "span", { text: Array.isArray(value) ? value.join(" ") : "" }));
      body.append(
        el(doc, "tr", {}, [
          el(doc, "th", { scope: "row" }, [el(doc, "span", { text: repair.field }), el(doc, "span", { class: "rb-persistence", text: repair.persistence })]),
          el(doc, "td", {}, [swatch(repair.before)]),
          el(doc, "td", {}, [swatch(repair.after)]),
          el(doc, "td", { text: repair.reason }),
        ]),
      );
    }
    table.append(body);
    container.replaceChildren(repairs.length ? table : el(doc, "p", { class: "rs-note", text: "Nothing needed adjusting." }));
  }

  // ----- controls -----
  function colorRow(spec, { removable = !spec.required, group = "" } = {}) {
    const id = idFor(spec.path);
    const row = el(doc, "div", { class: "rb-color", dataset: { path: spec.path, group } });
    const swatch = el(doc, "input", { type: "color", id: `${id}-picker`, "aria-label": `${spec.label} color picker`, class: "rb-picker" });
    const hex = el(doc, "input", { type: "text", id, class: "rb-input rb-hex", inputmode: "text", autocomplete: "off", spellcheck: "false", maxlength: "7", "aria-describedby": `${id}-error ${id}-state` });
    const label = el(doc, "label", { for: id, text: spec.label });
    const state = el(doc, "span", { class: "rb-state", id: `${id}-state` });
    const error = el(doc, "p", { class: "rb-field-error", id: `${id}-error`, hidden: true });
    const children = [label, el(doc, "span", { class: "rb-color-inputs" }, [swatch, hex]), state];
    if (removable) children.push(el(doc, "button", { type: "button", class: "rs-link-button rb-clear", "aria-label": `Use default ${spec.label.toLowerCase()}`, text: "Use default", dataset: { clear: spec.path } }));
    row.append(...children, error);
    return row;
  }

  function buildColors() {
    const add = (name, specs) => root.querySelector(`[data-rb-colors="${name}"]`).append(...specs.map((spec) => colorRow(spec, { group: name })));
    add("core", CORE_COLORS);
    add("code", CODE_COLORS);
    add("syntax", SYNTAX_COLORS);
    add("diff", DIFF_COLORS);
    add("ansi", ANSI_COLORS);
    add("details", DETAIL_COLORS);
    const graph = root.querySelector('[data-rb-colors="graph"]');
    graph.append(...GRAPH_LEVEL_LABELS.map((label, index) => colorRow({ path: `/contributions/levels/${index}`, label, required: true }, { removable: false, group: "graph" })));
  }

  function fieldControl(spec) {
    if (spec.kind === "color") return colorRow(spec);
    const id = idFor(spec.path);
    const error = el(doc, "p", { class: "rb-field-error", id: `${id}-error`, hidden: true });
    if (spec.kind === "check") {
      return el(doc, "div", { class: "rb-field", dataset: { path: spec.path } }, [el(doc, "label", { class: "rb-check" }, [el(doc, "input", { type: "checkbox", id, dataset: { field: spec.path } }), spec.label]), error]);
    }
    const control =
      spec.kind === "select"
        ? el(doc, "select", { id, class: "rb-input", dataset: { field: spec.path } }, spec.options.map(([value, text]) => el(doc, "option", { value, text })))
        : el(doc, "input", { type: "number", id, class: "rb-input", min: String(spec.min), max: String(spec.max), step: String(spec.step), inputmode: "decimal", placeholder: "Theme default", dataset: { field: spec.path }, "aria-describedby": `${id}-error` });
    return el(doc, "div", { class: "rb-field", dataset: { path: spec.path } }, [el(doc, "label", { for: id, text: spec.label }), control, error]);
  }

  function buildFields() {
    part("shape").append(...SHAPE_FIELDS.map(fieldControl));
    part("graph-style").append(...GRAPH_FIELDS.map(fieldControl));
    part("details-style").append(...DETAIL_FIELDS.map(fieldControl));
    part("effects").append(
      ...EFFECTS.map(({ id, label }) => el(doc, "label", { class: "rs-switch" }, [el(doc, "input", { type: "checkbox", role: "switch", dataset: { effect: id } }), label])),
    );
    part("flavor-slots").append(
      ...FLAVOR_FIELDS.filter((f) => f.id !== "profile.tag").map((f) => {
        const id = idFor(f.id);
        return el(doc, "div", { class: "rb-field" }, [el(doc, "label", { for: id, text: f.label }), el(doc, "input", { type: "text", id, class: "rb-input", maxlength: String(f.maxLength), autocomplete: "off", dataset: { slot: f.id } })]);
      }),
    );
    const tag = root.querySelector('[data-rb-slot="profile.tag"]');
    tag.maxLength = FLAVOR_FIELDS.find((f) => f.id === "profile.tag")?.maxLength ?? 24;
    tag.dataset.slot = "profile.tag";
    for (const [role, select] of [["heading", part("font-heading")], ["body", part("font-body")]]) {
      select.append(...fontChoices(role).map((font) => el(doc, "option", { value: font.id, text: font.label })));
    }
    part("image-limits").textContent = COPY.imageLimits;
    part("css-warning").textContent = IMPORT_COPY.cssWarning;
    part("import-css-warning").textContent = IMPORT_COPY.cssWarning;
  }

  const focused = (node) => node === doc.activeElement;
  const setValue = (node, value) => {
    if (!focused(node) && node.value !== value) node.value = value;
  };

  function syncColor(row, value, explicit, resolved) {
    const [picker, hex] = row.querySelectorAll("input");
    const shown = value ?? resolved ?? "#000000";
    const six = normalizeHex(shown) ?? "#000000";
    if (!focused(picker)) picker.value = six.length === 7 ? six : "#000000";
    if (!row.dataset.invalid) setValue(hex, shown);
    const state = row.querySelector(".rb-state");
    if (state) state.textContent = row.dataset.group === "core" || row.dataset.group === "graph" ? "" : explicit ? "Set by this theme" : "From the theme";
    const clear = row.querySelector("[data-clear]");
    if (clear) clear.hidden = !explicit;
  }

  function currentLevels() {
    return draft.document.contributions?.levels ?? resolvedNow?.graph ?? null;
  }

  function render() {
    if (!draft) return;
    settleApproval();
    const document = draft.document;
    const resolved = resolvedNow;
    setValue(part("name"), document.name);
    for (const row of root.querySelectorAll(".rb-color[data-path]")) {
      const path = row.dataset.path;
      if (row.closest('[data-rb="bg-color"],[data-rb="bg-layers"]')) continue;
      if (row.dataset.group === "graph") {
        const index = Number(path.split("/").pop());
        syncColor(row, currentLevels()?.[index] ?? null, true, null);
        continue;
      }
      const spec = [...CORE_COLORS, ...CODE_COLORS, ...SYNTAX_COLORS, ...DIFF_COLORS, ...ANSI_COLORS, ...DETAIL_COLORS, ...SHAPE_FIELDS, ...GRAPH_FIELDS].find((s) => s.path === path);
      const own = valueAt(document, path);
      const alias = spec?.alias ? valueAt(document, spec.alias) : undefined;
      syncColor(row, own ?? alias ?? null, own !== undefined || alias !== undefined, resolved && spec?.current ? spec.current(resolved) : null);
    }
    for (const control of root.querySelectorAll("[data-field]")) {
      const value = valueAt(document, control.dataset.field);
      if (control.type === "checkbox") control.checked = value === true;
      else setValue(control, value === undefined ? "" : String(value));
    }
    for (const input of root.querySelectorAll('input[name="rb-base"]')) input.checked = input.value === document.base;
    const heading = document.fonts?.heading ?? document.fonts?.accent ?? "system";
    const body = document.fonts?.body ?? "system";
    syncFont(part("font-heading"), part("heading-sample"), heading);
    syncFont(part("font-body"), part("body-sample"), body);
    for (const input of root.querySelectorAll("[data-effect]")) input.checked = Boolean(document.effects?.[input.dataset.effect]);
    part("flavor-enabled").checked = Boolean(document.flavor) && document.flavor.enabled !== false;
    for (const input of root.querySelectorAll("[data-slot]")) setValue(input, document.flavor?.slots?.[input.dataset.slot] ?? "");
    part("text-off").hidden = !(settings && settings.preferences.text === false && document.flavor);
    renderBackgrounds();
    renderCss();
    part("undo").disabled = !draft.previous;
    const isDirty = dirty();
    part("dirty").hidden = !isDirty;
    part("based-on").textContent = source ? (draft.savedId ? `Editing ${source.name}` : draft.fresh ? COPY.fresh : `Based on ${source.bundledName ?? source.name}`) : "";
    part("reset").textContent = source ? (source.fresh ? `Reset to ${source.bundledName} colors` : `Reset to ${source.bundledName ?? source.name}`) : "Reset";
    const target = remixTarget();
    const remixName = customTheme(target)?.document.name ?? catalog.document(target)?.name;
    part("start-remix").textContent = customTheme(target) ? `Edit ${remixName}` : `Remix ${remixName}`;
    part("start-note").textContent = draft.fresh
      ? "Background, Text and Accent make the whole theme; the graph and every other color follow them."
      : customTheme(target)
        ? `Changes ${remixName} itself, keeping every detail it has.`
        : `Starts with every detail of ${remixName}: backgrounds, effects, fonts, code colors and more.`;
    for (const input of root.querySelectorAll('input[name="rb-start"]')) input.checked = input.value === (draft.fresh ? "fresh" : "remix");
    part("save").textContent = draft.savedId ? "Save changes" : "Save as theme";
    part("save-copy").hidden = !draft.savedId;
    part("discard").disabled = !isDirty;
    if (json(document) !== json(lastPreviewed?.document) || lastPreviewed.cssAllowed !== cssAllowed(document, cssOn(draft))) {
      showRepairs(document);
      showPreview(document);
      // The repair pass resolves the theme; colors left to the engine show its values.
      if (resolved !== resolvedNow) renderResolvedColors();
    }
    renderExport();
  }

  function renderResolvedColors() {
    const resolved = resolvedNow;
    if (!resolved) return;
    for (const row of root.querySelectorAll(".rb-color[data-path]")) {
      const spec = [...CODE_COLORS, ...SYNTAX_COLORS, ...DIFF_COLORS, ...ANSI_COLORS, ...DETAIL_COLORS, ...SHAPE_FIELDS, ...GRAPH_FIELDS].find((s) => s.path === row.dataset.path);
      if (row.dataset.group === "graph") syncColor(row, currentLevels()?.[Number(row.dataset.path.split("/").pop())] ?? null, true, null);
      else if (spec?.current) {
        const own = valueAt(draft.document, spec.path);
        const alias = spec.alias ? valueAt(draft.document, spec.alias) : undefined;
        syncColor(row, own ?? alias ?? null, own !== undefined || alias !== undefined, spec.current(resolved));
      }
    }
  }

  const faces = new Set();
  let faceStyle = null;
  function syncFont(select, sample, id) {
    setValue(select, id);
    const font = fontChoices(select === part("font-heading") ? "heading" : "body").find((f) => f.id === id);
    if (font?.bundled && fontFace && !faces.has(id)) {
      faces.add(id);
      // A face that cannot load leaves the sample in its fallback stack.
      try {
        const css = fontFace(id);
        faceStyle ??= doc.head.appendChild(el(doc, "style", { "data-rb-faces": "" }));
        faceStyle.append(css);
      } catch {}
    }
    sample.style.fontFamily = font?.family ? `"${font.family}", ${font.fallback ?? "system-ui, sans-serif"}` : "";
  }

  // ----- backgrounds -----
  function renderBackgrounds() {
    const target = draft.document.backgrounds?.[bgTarget];
    const colorBox = part("bg-color");
    if (!colorBox.firstChild) colorBox.append(colorRow({ path: "/backgrounds/target/color", label: "Solid color" }, { group: "bg" }));
    const row = colorBox.firstChild;
    row.dataset.path = `/backgrounds/${bgTarget}/color`;
    syncColor(row, target?.color ?? null, target?.color !== undefined, bgTarget === "page" ? draft.document.colors.background : resolvedNow?.appearance?.colors?.header?.background ?? draft.document.colors.background);
    row.querySelector(".rb-state").textContent = target?.color ? "Set by this theme" : "Not set";
    const layers = target?.layers ?? [];
    const key = json([bgTarget, layers.map((layer) => Object.keys(layer)[0])]);
    const list = part("bg-layers");
    if (key !== layerKey) {
      layerKey = key;
      list.replaceChildren(...layers.map((layer, index) => layerItem(layer, index)));
    }
    for (const item of list.children) syncLayer(item, layers[Number(item.dataset.index)]);
    const full = layerCount(draft.document, bgTarget) >= LIMITS.maxBackgroundLayers;
    part("bg-add-gradient").disabled = full;
    part("bg-add-pattern").disabled = full;
    part("image-file").disabled = full;
    const totals = rasterTotals(draft.document);
    part("image-usage").textContent = COPY.imageUsage(totals.bytes, totals.pixels);
  }

  // ----- images -----
  // Uploads, Compress and Resize run one at a time on this device; a newer request cancels an
  // older one. A file that already fits is added as it is; anything else is converted to a still,
  // metadata-free copy that is added only once the person accepts its before and after sizes.
  const images = createRasterQueue();
  const convert = convertImage ?? ((bytes, options) => convertRaster(bytes, options, browserRasterEnv(win)));
  let offer = null;
  // The conversion that did not fit, kept (at most one upload source, 2 MiB) so Resize can retry it.
  let retryJob = null;
  function imageError(text, resize = null) {
    fieldError("backgrounds", text);
    retryJob = resize;
    part("image-retry").hidden = !resize;
    if (resize) part("image-resize").textContent = COPY.imageResize(resize.size.width, resize.size.height);
  }
  function closeOffer() {
    offer = null;
    part("image-offer").hidden = true;
  }

  async function addImageFile(file) {
    closeOffer();
    imageError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) return imageError(COPY.imageType);
    if (file.size > UPLOAD_SOURCE_BYTES) return imageError(COPY.imageTooLarge(file.size));
    const target = bgTarget;
    if (layerCount(draft.document, target) >= LIMITS.maxBackgroundLayers) return imageError(`A background holds up to ${LIMITS.maxBackgroundLayers} layers. Remove one first.`);
    const bytes = await fileBytes(file);
    const source = rasterSourceInfo(bytes);
    if (!source.ok) return imageError(source.message);
    if (!source.animated && !source.metadata) {
      const image = { data: `data:${source.mime};base64,${base64(bytes)}`, width: source.width, height: source.height };
      if (rasterInfo(image.data).ok) {
        const placed = setRasterLayer(draft.document, target, null, image);
        if (placed.ok && edit(checked(placed.theme)).ok) return say(COPY.imageAdded(file.name, image, bytes.length));
      }
    }
    await offerConversion({ bytes, target, index: null, name: file.name, options: { compress: true } });
  }

  async function offerConversion({ bytes, target, index, name, options }) {
    const others = rasterTotals(draft.document, index === null ? null : `/backgrounds/${target}/layers/${index}/image`);
    say(COPY.imageConverting);
    const result = await images.run("image", (signal) => convert(bytes, { ...options, others, signal }));
    if (destroyed || result.code === "cancelled") return;
    say("");
    if (!result.ok) return conversionFailed({ bytes, target, index, name, options }, result, others);
    offer = { target, index, image: result.image };
    part("image-offer-title").textContent = COPY.imageOffer(name);
    part("image-before").textContent = describe(result.before);
    part("image-after").textContent = describe(result.after);
    part("image-note").textContent = result.note;
    part("image-offer").hidden = false;
    part("image-accept").focus();
  }

  // A conversion over the theme's byte or pixel room: offer Resize at half the longest side, keeping
  // Compress on, until the image fits or reaches the smallest size; then say it cannot fit. The
  // converter's own wording names Resize, so it is replaced with wording beside a working control.
  function conversionFailed(job, result, others) {
    if (result.code !== "image-limit") return imageError(result.message);
    const source = rasterSourceInfo(job.bytes);
    if (!source.ok) return imageError(result.message);
    // The source itself must decode within the pixel room; no size of output changes that.
    if (others.pixels + source.width * source.height > LIMITS.documentImageDecodedPixels) return imageError(COPY.imageNoRoom);
    const drawn = fitSize(source.width, source.height, job.options.maxSide ?? LIMITS.imageMaxDimension);
    const side = Math.floor(Math.max(drawn.width, drawn.height) / 2);
    if (side < MIN_IMAGE_SIDE) return imageError(COPY.imageCannotFit(drawn.width, drawn.height));
    const size = fitSize(source.width, source.height, side);
    const text = result.after ? COPY.imageTooBig(result.after.bytes) : COPY.imageTooManyPixels;
    imageError(text, { ...job, size, options: { compress: true, quality: job.options.quality ?? 0.9, maxSide: side } });
  }
  function resizeRetry() {
    const job = retryJob;
    if (!job) return;
    imageError(null);
    offerConversion(job);
  }

  function acceptOffer() {
    if (!offer) return;
    const { target, index, image } = offer;
    const placed = setRasterLayer(draft.document, target, index, image);
    closeOffer();
    if (!placed.ok) return imageError(placed.message);
    const result = edit(checked(placed.theme));
    if (!result.ok) return imageError(result.message);
    say(index === null ? COPY.imageAccepted : COPY.imageReplaced);
    part("image-file").value = "";
  }

  function imageAction(action, index) {
    const layer = draft.document.backgrounds?.[bgTarget]?.layers?.[index]?.image;
    const bytes = layer ? dataUrlBytes(layer.data) : null;
    if (!bytes) return;
    imageError(null);
    const options = action === "compress" ? { compress: true, quality: 0.8 } : { maxSide: Math.max(16, Math.ceil(Math.max(layer.width, layer.height) / 2)) };
    if (action === "resize" && fitSize(layer.width, layer.height, options.maxSide).width === layer.width) return imageError(COPY.imageCannotFit(layer.width, layer.height));
    offerConversion({ bytes, target: bgTarget, index, name: `Layer ${index + 1}`, options });
  }

  function layerItem(layer, index) {
    const kind = Object.keys(layer)[0];
    const base = `/backgrounds/${bgTarget}/layers/${index}/${kind}`;
    const title = { gradient: "Gradient", pattern: "Pattern", image: "Image", gradientCss: "CSS gradient" }[kind];
    const item = el(doc, "li", { class: "rb-layer", dataset: { index: String(index), kind } });
    const heading = el(doc, "p", { class: "rb-layer-title" }, [el(doc, "span", { text: `${index + 1}. ${title}` })]);
    const remove = el(doc, "button", { type: "button", class: "rs-link-button", text: "Remove", "aria-label": `Remove layer ${index + 1}, ${title.toLowerCase()}`, dataset: { removeLayer: String(index) } });
    heading.append(remove);
    item.append(heading);
    const select = (path, label, values) => {
      const id = idFor(path);
      return el(doc, "div", { class: "rb-field" }, [el(doc, "label", { for: id, text: label }), el(doc, "select", { id, class: "rb-input", dataset: { field: path } }, values.map(([value, text]) => el(doc, "option", { value, text })))]);
    };
    const number = (path, label, min, max, step) => {
      const id = idFor(path);
      return el(doc, "div", { class: "rb-field" }, [el(doc, "label", { for: id, text: label }), el(doc, "input", { type: "number", id, class: "rb-input", min: String(min), max: String(max), step: String(step), placeholder: "Default", dataset: { field: path } })]);
    };
    const grid = el(doc, "div", { class: "rb-grid" });
    if (kind === "gradient") {
      grid.append(select(`${base}/type`, "Type", GRADIENT_TYPES), number(`${base}/angle`, "Angle (degrees)", 0, 360, 1), number(`${base}/opacity`, "Opacity (0 to 1)", 0, 1, 0.05));
      const stops = layer.gradient.stops;
      grid.append(colorRow({ path: `${base}/stops/0/color`, label: "First color", required: true }, { group: "bg" }), colorRow({ path: `${base}/stops/${stops.length - 1}/color`, label: "Last color", required: true }, { group: "bg" }));
    } else if (kind === "pattern") {
      grid.append(select(`${base}/kind`, "Pattern", PATTERN_KINDS), colorRow({ path: `${base}/color`, label: "Pattern color", required: true }, { group: "bg" }), number(`${base}/opacity`, "Opacity (0 to 0.2)", 0, 0.2, 0.01), number(`${base}/size`, "Size (px, 2 to 128)", 2, 128, 1));
    } else if (kind === "image") {
      grid.append(el(doc, "p", { class: "rs-note", dataset: { imageInfo: "" } }), select(`${base}/fit`, "Fit", [["", "Default (cover)"], ...IMAGE_FITS]), select(`${base}/position`, "Position", [["", "Default (center)"], ...IMAGE_POSITIONS]), number(`${base}/opacity`, "Opacity (0 to 1)", 0, 1, 0.05));
      const what = `layer ${index + 1}, image`;
      item.append(
        el(doc, "div", { class: "rs-actions" }, [
          el(doc, "button", { type: "button", class: "rs-button", text: "Compress", "aria-label": `Compress ${what}`, dataset: { imageAction: "compress", index: String(index) } }),
          el(doc, "button", { type: "button", class: "rs-button", text: "Resize", "aria-label": `Resize ${what} to half its width and height`, dataset: { imageAction: "resize", index: String(index) } }),
        ]),
      );
    } else {
      grid.append(el(doc, "p", { class: "rs-note", text: "Imported as CSS. Edit it in the theme file." }));
    }
    item.append(grid);
    return item;
  }

  function syncLayer(item, layer) {
    if (!layer) return;
    for (const control of item.querySelectorAll("[data-field]")) {
      const value = valueAt(draft.document, control.dataset.field);
      setValue(control, value === undefined ? "" : String(value));
    }
    for (const row of item.querySelectorAll(".rb-color")) syncColor(row, valueAt(draft.document, row.dataset.path) ?? null, true, null);
    const info = item.querySelector("[data-image-info]");
    if (info && layer.image) {
      const admitted = rasterInfo(layer.image.data);
      info.textContent = admitted.ok ? `${describe({ bytes: admitted.bytes.length, width: admitted.width, height: admitted.height, mime: admitted.mime })}.` : `${layer.image.width} × ${layer.image.height} px.`;
    }
  }

  // ----- Advanced CSS -----
  let cssShown = null;
  function renderCss() {
    const css = draft.document.css ?? "";
    const area = part("css");
    if (cssShown !== css && !focused(area)) area.value = css;
    cssShown = css;
    const summary = cssSummary(draft.document);
    meter(summary ? summary.bytes : 0);
    const enable = part("css-enable");
    enable.disabled = !summary?.ok;
    enable.checked = cssOn(draft);
  }
  function meter(bytes) {
    part("css-meter").textContent = `${kib(bytes)} of ${kib(LIMITS.cssUtf8Bytes)}${bytes > LIMITS.cssUtf8Bytes ? ", over the limit" : ""}.`;
  }
  function checkCss() {
    cssTimer = 0;
    const text = part("css").value;
    const findings = part("css-findings");
    const bytes = new TextEncoder().encode(text).length;
    meter(bytes);
    if (!text.trim()) {
      findings.hidden = true;
      if (draft.document.css !== undefined) edit(setCss(draft.document, ""), { cssEnabled: false });
      return;
    }
    const summary = cssSummary({ css: text });
    if (!summary.ok || bytes > LIMITS.cssUtf8Bytes) {
      // Invalid CSS never applies or replaces the last valid preview.
      findings.hidden = false;
      const issues = summary.ok ? [{ message: `This CSS is ${kib(bytes)}; the limit is ${kib(LIMITS.cssUtf8Bytes)}.` }] : summary.issues;
      findings.replaceChildren(...issues.map((issue) => el(doc, "li", { text: issue.message })));
      return;
    }
    findings.hidden = true;
    if (text === draft.document.css) return;
    // Changed CSS needs a fresh choice to enable it.
    const result = setCss(draft.document, text);
    if (result.ok) edit(result, { cssEnabled: false });
    else {
      findings.hidden = false;
      findings.replaceChildren(el(doc, "li", { text: result.message }));
    }
  }

  /** Enable advanced CSS: the explicit choice, which only a ticket from the repository makes real. */
  async function enableCss() {
    const held = await requestApproval();
    if (destroyed) return;
    if (held) edit({ ok: true, document: draft.document }, { cssEnabled: true });
    else {
      if (held === false) fail(COPY.approveFailed);
      render();
    }
  }

  // ----- export -----
  function exportable() {
    if (basePolarityIssue(draft.document)) return null;
    return repairTheme(draft.document, standardSeed(draft.document.base)).theme;
  }
  function renderExport() {
    if (!part("export").open) return;
    const theme = exportable();
    for (const name of ["download", "copy-json", "copy-code", "copy-link"]) part(name).disabled = !theme;
    if (!theme) return void (part("export-note").textContent = COPY.fixFirst);
    const css = typeof theme.css === "string";
    part("export-css").hidden = !css;
    part("export-css-note").hidden = !css;
    part("export-css-note").textContent = css ? IMPORT_COPY.sharedCss : "";
    const images = imagesIn(theme);
    part("export-images").hidden = !images;
    part("export-images").textContent = images ? IMPORT_COPY.sharedImages(images) : "";
  }
  const imagesIn = (theme) => ["page", "profileBanner", "header"].reduce((n, t) => n + (theme.backgrounds?.[t]?.layers ?? []).filter((layer) => layer.image).length, 0);

  // True only once the clipboard accepted the text.
  async function copy(text) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  function showExportText(text, label) {
    const box = part("export-fallback");
    box.hidden = false;
    part("export-label").textContent = label;
    part("export-text").value = text;
  }

  // ----- import -----
  const dialog = part("import");
  function openImport(kind = "text") {
    importResult = null;
    setImportKind(kind);
    part("import-error").hidden = true;
    part("import-result").hidden = true;
    part("import-use").disabled = true;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    (kind === "text" ? part("paste") : kind === "code" ? part("code") : part("file")).focus();
  }
  function closeImport() {
    importPreview?.destroy();
    importPreview = null;
    importResult = null;
    if (dialog.open) dialog.close();
    part("import-open").focus();
  }
  function setImportKind(kind) {
    importKind = kind;
    for (const button of part("import-kinds").querySelectorAll("[data-kind]")) button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
    for (const box of root.querySelectorAll("[data-rb-kind]")) box.hidden = box.dataset.rbKind !== kind;
  }

  async function runImport(input = null, kind = importKind) {
    let value = input;
    if (value === null) {
      if (kind === "text") value = part("paste").value;
      else if (kind === "code") value = part("code").value;
      else {
        const file = part("file").files?.[0];
        if (!file) return importError({ ok: false, message: "Choose a theme file first.", details: [], actions: [] });
        if (!acceptsFileName(file.name)) return importError({ ok: false, message: COPY.fileType, details: [], actions: [] });
        if (file.size > LIMITS.fileUtf8Bytes) return importError({ ok: false, message: COPY.fileTooLarge, details: [], actions: [] });
        value = await fileBytes(file);
      }
    }
    if (typeof value === "string" && !value.trim()) return importError({ ok: false, message: kind === "code" ? "Paste a share code first." : "Paste the chatbot's answer first.", details: [], actions: [] });
    const result = analyzeImport(value, kind, { standardSeed });
    if (!result.ok) return importError(result, value);
    showImport(result);
  }

  // The missing Background, Text or Accent of an answer that is otherwise a theme: a labeled picker
  // and hex field. The chosen color goes into the retained object, which the normal importer then
  // parses, validates and repairs again from scratch.
  function missingColorFix(path, input) {
    const text = typeof input === "string" ? input : input instanceof Uint8Array ? new TextDecoder().decode(input) : null;
    const object = text === null ? null : extractObject(text);
    if (!object) return null;
    const role = path.split("/")[2];
    const label = ROLE_LABELS[role];
    const example = ROLE_EXAMPLES[role];
    const picker = el(doc, "input", { type: "color", id: "rb-missing-picker", class: "rb-picker", value: example, "aria-label": `${label} color picker` });
    const hex = el(doc, "input", { type: "text", id: "rb-missing-hex", class: "rb-input rb-hex", value: example, maxlength: "7", autocomplete: "off", spellcheck: "false", "aria-describedby": "rb-missing-note rb-missing-error" });
    const error = el(doc, "p", { class: "rb-field-error", id: "rb-missing-error", hidden: true });
    const apply = el(doc, "button", { type: "button", class: "rs-button rs-button--primary", text: `Preview with this ${label.toLowerCase()}` });
    picker.addEventListener("input", () => {
      hex.value = picker.value;
      error.hidden = true;
      hex.removeAttribute("aria-invalid");
    });
    hex.addEventListener("input", () => {
      const value = normalizeHex(hex.value.trim());
      if (value && HEX.test(hex.value.trim())) picker.value = value.length === 7 ? value : picker.value;
    });
    apply.addEventListener("click", () => {
      const raw = hex.value.trim();
      if (!HEX.test(raw)) {
        Object.assign(error, { hidden: false, textContent: COPY.hex });
        hex.setAttribute("aria-invalid", "true");
        return hex.focus();
      }
      const fixed = { ...object, colors: { ...(object.colors && typeof object.colors === "object" ? object.colors : {}), [role]: normalizeHex(raw) } };
      runImport(JSON.stringify(fixed), "text");
    });
    return el(doc, "div", { class: "rb-missing", role: "group", "aria-labelledby": "rb-missing-label" }, [
      el(doc, "label", { id: "rb-missing-label", for: "rb-missing-hex", text: label }),
      el(doc, "span", { class: "rb-color-inputs" }, [picker, hex]),
      el(doc, "p", { class: "rs-note", id: "rb-missing-note", text: COPY.missingColor(label) }),
      error,
      apply,
    ]);
  }

  function importError(view, input = null) {
    importResult = null;
    part("import-result").hidden = true;
    part("import-use").disabled = true;
    const box = part("import-error");
    box.hidden = false;
    box.querySelector("[data-rb-text]").textContent = view.message;
    part("import-details").replaceChildren(...(view.details ?? []).map((d) => el(doc, "li", {}, [d.path ? el(doc, "code", { text: d.path }) : "", d.path ? " " : "", d.message])));
    const choices = [];
    const fix = view.missingColor ? missingColorFix(view.missingColor, input) : null;
    if (fix) choices.push(fix);
    for (const candidate of view.candidates ?? []) choices.push(el(doc, "button", { type: "button", class: "rs-button", text: `Preview ${candidate.name || "this theme"}`, onclick: () => runImport(candidate.input, candidate.input.startsWith("RS1.") ? "code" : "text") }));
    for (const action of view.actions ?? []) {
      choices.push(el(doc, "button", { type: "button", class: "rs-button", text: action.label, title: `Leaves out: ${action.omitted.join(", ")}`, onclick: () => runImport(action.input, "text") }));
      choices.push(el(doc, "p", { class: "rs-note", text: `${action.label} leaves out: ${action.omitted.join(", ")}.` }));
    }
    if (view.fixRequest) choices.push(el(doc, "button", { type: "button", class: "rs-button", text: "Copy fix request", onclick: async (event) => (event.target.textContent = (await copy(view.fixRequest)) ? "Fix request copied" : "Copy blocked; select the answer and retry") }));
    if (view.help) choices.push(el(doc, "a", { href: view.help, target: "_blank", rel: "noopener noreferrer", text: "Update help" }));
    part("import-choices").replaceChildren(...choices);
  }

  function showImport(result) {
    importResult = result;
    part("import-error").hidden = true;
    part("import-result").hidden = false;
    const theme = result.theme;
    part("import-show").textContent = theme.inspiredBy ?? theme.name;
    part("import-name").textContent = theme.inspiredBy ? theme.name : theme.author ? `by ${theme.author}` : "";
    part("import-messages").replaceChildren(
      ...result.messages.map((m) => el(doc, "li", { class: `rb-message rb-message--${m.kind}` }, [m.text, ...(m.details?.length ? [el(doc, "span", { class: "rs-note rb-message-detail", text: ` ${m.details.join(" ")}` })] : [])])),
    );
    const fix = part("import-polarity");
    fix.hidden = !result.polarity;
    if (result.polarity) part("import-polarity-fix").textContent = COPY.baseFix(theme.base === "dark" ? "light" : "dark");
    part("import-changes").hidden = !result.repairs.length;
    fillRepairList(part("import-repair-list"), result.repairs);
    const images = result.images ?? [];
    part("import-images").hidden = !images.length;
    part("import-images").textContent = images.length ? `This theme carries ${images.length} embedded ${images.length === 1 ? "image" : "images"}: ${images.map((i) => `${i.width} × ${i.height} px${i.bytes ? `, ${kib(i.bytes)}` : ""}`).join("; ")}.` : "";
    const css = result.css;
    part("import-css").hidden = !css;
    const enable = part("import-css-enable");
    enable.checked = false;
    if (css) {
      part("import-css-size").textContent = `${kib(css.bytes)} of CSS. It is off in this preview until you enable it.`;
      part("import-css-source").textContent = css.ok ? css.canonical : css.source;
      enable.disabled = !css.ok;
    }
    part("import-use").disabled = Boolean(result.polarity);
    updateImportPreview();
  }

  function updateImportPreview() {
    if (!importResult || importResult.polarity) return;
    const options = { theme: importResult.theme, preferences: preferences(), cssAllowed: Boolean(part("import-css-enable").checked && importResult.css?.ok) };
    try {
      if (!importPreview) importPreview = mountPreview(part("import-frame"), { view: "profile", ...options });
      else importPreview.update(options);
    } catch {
      // The import's summary stays; its preview keeps the last valid frame.
    }
  }

  function useImport() {
    if (!importResult || importResult.polarity) return;
    const result = checked(importResult.theme);
    if (!result.ok) return;
    const enabled = Boolean(part("import-css-enable").checked && importResult.css?.ok);
    const name = result.document.name;
    // An import is a new theme with no approval. Enable advanced CSS ticked in this dialog is the
    // person's explicit choice for exactly this CSS, so it asks for a ticket like the editor's own.
    dropApproval();
    edit(result, { cssEnabled: false, savedId: null });
    closeImport();
    say(COPY.imported(name));
    if (enabled) enableCss();
  }

  // ----- save -----
  // The saved theme or its CSS approval changed elsewhere since this draft loaded it.
  // The draft's baseHash is the saved version it started from, through Undo, autosave and resume.
  function drifted(asCopy) {
    if (!draft.savedId) return false;
    const stored = customTheme(draft.savedId);
    if (!stored) return !asCopy;
    if (source?.savedId === stored.id && consentMatches(stored.id, stored.document) !== Boolean(source.cssEnabled)) return true;
    return !asCopy && sourceHash(stored.document) !== draft.baseHash;
  }
  function showConflict(text = COPY.conflict) {
    part("conflict-title").textContent = text;
    part("conflict").hidden = false;
  }

  async function save({ asCopy = false } = {}) {
    clearError();
    part("conflict").hidden = true;
    const name = draft.document.name?.trim();
    if (!name) {
      fieldError("name", COPY.needName);
      part("name").focus();
      return;
    }
    const polarity = basePolarityIssue(draft.document);
    if (polarity) {
      fail(IMPORT_COPY.basePolarity(draft.document.base));
      part("polarity-fix").focus();
      return;
    }
    const current = await host.read();
    if (!current.ok) return fail(COPY.saveFailed, { again: () => save({ asCopy }), offerDownload: true });
    settings = current.settings;
    // Never overwrite an unknown revision silently, and never grant again an approval another
    // window revoked: both need Keep editing or Load saved theme first.
    if (drifted(asCopy)) return void showConflict();
    // An Enable choice still waiting on the repository is part of this save.
    if (approving) await approving;
    const editing = Boolean(draft.savedId && !asCopy);
    const target = editing ? draft.savedId : NEW_TARGET;
    const document = repairTheme(draft.document, standardSeed(draft.document.base)).theme;
    const action = { type: "saveCustom", document, select: true, editor };
    if (editing) action.id = draft.savedId;
    if (draft.basedOn && catalog.has(draft.basedOn)) action.basedOn = draft.basedOn;
    // The theme and its approval are one commit, so a failed save leaves nothing behind and Retry
    // cannot add a second theme. Only this editor's ticket for this target and exactly this CSS
    // approves; an edit with unchanged CSS keeps the stored approval, a copy starts without one,
    // and turning Enable off revokes it. The repository checks all of this again.
    const hash = cssHash(document);
    const wanted = Boolean(draft.cssEnabled && hash);
    if (wanted && approval && approval.target === target && approval.hash === hash) action.approval = approval.ticket;
    else if (editing && !draft.cssEnabled && settings.cssConsent?.[draft.savedId]) action.approval = null;
    say("Saving…");
    const before = new Set(settings.customThemes.map((t) => t.id));
    const reply = await host.commit(action, settings.revision);
    if (!reply?.ok) return saveFailed(reply, () => save({ asCopy }));
    settings = reply.settings;
    // The repository dropped every ticket this editor held when it saved.
    approval = null;
    const id = action.id ?? settings.customThemes.find((t) => !before.has(t.id))?.id;
    const saved = customTheme(id);
    draft = { ...draft, document, savedId: id, fresh: false, baseHash: saved ? sourceHash(saved.document) : null, cssEnabled: Boolean(saved && consentMatches(id, saved.document)) };
    remixFrom = id;
    source = sourceFor(draft);
    await host.discardDraft().catch(() => {});
    lastPreviewed = null;
    render();
    if (asCopy && wanted && !draft.cssEnabled) say(COPY.copyCssOff(name));
    else say(action.id ? COPY.savedChanges(name) : COPY.saved(name));
  }

  function saveFailed(reply, again) {
    say("");
    if (reply?.code === "conflict") {
      if (reply.current) settings = reply.current;
      showConflict();
      return;
    }
    // The approval stopped holding (revoked, removed or changed elsewhere): nothing was saved, and
    // only a fresh Enable choice approves this CSS.
    if (reply?.issues?.some((i) => i?.reason === APPROVAL_ISSUE)) {
      dropApproval();
      draft = withoutCss(draft);
      render();
      fail(COPY.approveAgain);
      return;
    }
    const detail = reply?.issues?.find((i) => i?.message)?.message ?? "";
    const full = /full|exceed|capacity/i.test(detail);
    fail(full ? COPY.full : COPY.saveFailed, { again, offerDownload: true, manage: full });
  }

  /** Three colors or remix: a new start for the draft, which Undo can take back. */
  function startOver(kind) {
    let next;
    if (kind === "fresh") {
      const name = draft.fresh || draft.savedId ? draft.document.name : "My theme";
      next = createDraft({ document: freshDocument(draft.document, draft.savedId ? copyName(name) : name), basedOn: bundledBase(), fresh: true });
    } else next = startFrom(remixTarget(), { remix: true });
    dropApproval();
    accept(commitEdit(draft, next.document, { basedOn: next.basedOn, savedId: next.savedId, cssEnabled: next.cssEnabled, fresh: next.fresh, baseHash: next.baseHash }));
    source = sourceFor(draft) ?? source;
    render();
    say(kind === "fresh" ? COPY.freshStarted : COPY.remixed(source?.bundledName ?? source?.name ?? ""));
  }

  function downloadDraft() {
    const file = exportFile(draft.document);
    download?.(file);
    say(COPY.downloaded(file.filename));
  }

  // The draft with Enable advanced CSS off, in Undo's copy too.
  const withoutCss = (d) => ({ ...d, cssEnabled: false, previous: d.previous && { ...d.previous, cssEnabled: false } });

  // ----- resume -----
  function dismissResume(discard) {
    part("resume").hidden = true;
    if (discard) host.discardDraft().catch(() => {});
    pendingRecord = null;
  }

  // ----- events -----
  function onColorInput(event) {
    const row = event.target.closest(".rb-color");
    if (!row) return;
    const path = row.dataset.path;
    const [picker, hex] = row.querySelectorAll("input");
    const error = row.querySelector(".rb-field-error");
    const raw = event.target === picker ? picker.value : hex.value.trim();
    const valid = HEX.test(raw);
    // An invalid partial hex stays in its field with an inline error; the preview keeps the last
    // valid value, and render leaves the field alone until it is valid again.
    if (event.target === picker) hex.value = raw;
    if (valid) delete row.dataset.invalid;
    else row.dataset.invalid = "1";
    error.hidden = valid;
    error.textContent = valid ? "" : COPY.hex;
    if (valid) hex.removeAttribute("aria-invalid");
    else hex.setAttribute("aria-invalid", "true");
    if (!valid) return;
    // Dragging previews locally; the change event accepts the value.
    const value = normalizeHex(raw);
    if (event.type === "input") {
      const candidate = previewCandidate(path, value);
      if (candidate) showPreview(candidate);
      return;
    }
    if (valueAt(draft.document, path) === value) return;
    const result = applyColor(path, value);
    if (!result.ok) {
      error.hidden = false;
      error.textContent = result.message;
    }
  }
  function previewCandidate(path, value) {
    const result = colorResult(path, value);
    return result.ok ? result.document : null;
  }
  function colorResult(path, value) {
    if (path.startsWith("/contributions/levels/")) return setGraphLevel(draft.document, Number(path.split("/").pop()), value, currentLevels());
    return setField(draft.document, path, value, { levels: currentLevels() });
  }
  function applyColor(path, value) {
    return edit(colorResult(path, value));
  }

  function onFieldChange(event) {
    const control = event.target;
    const path = control.dataset.field;
    let value;
    if (control.type === "checkbox") value = control.checked ? true : undefined;
    else if (control.type === "number") value = control.value === "" ? undefined : Number(control.value);
    else value = control.value === "" ? undefined : control.value;
    const errorNode = control.closest(".rb-field")?.querySelector(".rb-field-error");
    if (control.type === "number" && control.value !== "" && !Number.isFinite(value)) {
      if (errorNode) Object.assign(errorNode, { hidden: false, textContent: "Enter a number." });
      return;
    }
    const result = setField(draft.document, path, value, { levels: currentLevels() });
    if (errorNode) {
      errorNode.hidden = result.ok;
      errorNode.textContent = result.ok ? "" : friendly(result, control);
    }
    if (result.ok) edit(result);
  }
  const friendly = (result, control) => (control.min !== undefined && control.max ? `Use a value from ${control.min} to ${control.max}.` : result.message);

  listen(root, "input", (event) => {
    const target = event.target;
    if (target.closest(".rb-color")) return onColorInput(event);
    if (target === part("css")) {
      win.clearTimeout(cssTimer);
      cssTimer = win.setTimeout(checkCss, CSS_CHECK_MS);
      meter(new TextEncoder().encode(target.value).length);
    }
  });
  listen(root, "change", (event) => {
    const target = event.target;
    if (!draft) return;
    if (target.closest(".rb-color")) return onColorInput(event);
    if (target.dataset.field) return onFieldChange(event);
    if (target === part("name")) {
      const name = target.value.trim();
      if (!name) return fieldError("name", COPY.needName);
      const result = setField(draft.document, "/name", target.value.trim());
      fieldError("name", result.ok ? null : result.message);
      return void edit(result);
    }
    if (target.name === "rb-start") return void startOver(target.value);
    if (target.name === "rb-base") {
      const result = switchBase(draft.document, target.value);
      if (edit(result).ok && result.note) say(result.note);
      return;
    }
    if (target === part("font-heading") || target === part("font-body")) {
      const role = target === part("font-heading") ? "heading" : "body";
      const path = `/fonts/${role}`;
      const legacy = role === "heading" && draft.document.fonts?.accent !== undefined;
      return void edit(setField(draft.document, path, target.value === "system" && !legacy ? undefined : target.value));
    }
    if (target.dataset.effect) {
      const result = setEffect(draft.document, target.dataset.effect, target.checked);
      fieldError("effects", result.ok ? null : result.message);
      if (!result.ok) target.checked = !target.checked;
      return void edit(result);
    }
    if (target === part("flavor-enabled")) return void edit(setField(draft.document, "/flavor/enabled", target.checked));
    if (target.dataset.slot) return void edit(setFlavorSlot(draft.document, target.dataset.slot, target.value));
    if (target.name === "rb-bg-target") {
      bgTarget = target.value;
      closeOffer();
      imageError(null);
      return renderBackgrounds();
    }
    if (target === part("image-file")) return void addImageFile(target.files?.[0] ?? null);
    if (target === part("css")) {
      win.clearTimeout(cssTimer);
      return checkCss();
    }
    if (target === part("css-enable")) {
      if (target.checked) return void enableCss();
      dropApproval();
      return void edit({ ok: true, document: draft.document }, { cssEnabled: false });
    }
    if (target.name === "rb-compare") return preview?.setBefore(target.value === "before");
  });
  listen(root, "click", (event) => {
    const button = event.target.closest("button");
    if (!button || !draft) return;
    if (button.dataset.clear) {
      const path = button.closest(".rb-color").dataset.path;
      const spec = [...SYNTAX_COLORS, ...DETAIL_COLORS].find((s) => s.path === path);
      let document = withValue(draft.document, path, undefined);
      if (spec?.alias && valueAt(document, spec.alias) !== undefined && valueAt(draft.document, path) === undefined) document = withValue(document, spec.alias, undefined);
      edit(checked(document));
      return;
    }
    if (button.dataset.imageAction) return imageAction(button.dataset.imageAction, Number(button.dataset.index));
    if (button.dataset.removeLayer !== undefined) {
      const index = Number(button.dataset.removeLayer);
      const image = draft.document.backgrounds?.[bgTarget]?.layers?.[index]?.image;
      const removed = image ? removeRasterLayer(draft.document, bgTarget, index) : null;
      const result = removed ? (removed.ok ? checked(removed.theme) : removed) : removeLayer(draft.document, bgTarget, index);
      if (edit(result).ok && image) say(COPY.imageRemoved);
      part("bg-add-gradient").focus();
      return;
    }
    if (button.dataset.view) {
      view = button.dataset.view;
      for (const b of part("views").querySelectorAll("[data-view]")) b.setAttribute("aria-pressed", String(b === button));
      preview?.setView(view);
      return;
    }
    if (button.dataset.kind) return setImportKind(button.dataset.kind);
  });

  // Enter in a field accepts its value; it never submits the controls.
  listen(part("controls"), "submit", (event) => event.preventDefault());
  listen(part("undo"), "click", () => {
    if (!draft.previous) return say(DRAFT_COPY.nothingToUndo);
    accept(undo(draft));
    // Undoing Enable advanced CSS gives up the approval it asked for; Undo never brings one back.
    if (!draft.cssEnabled) dropApproval();
    source = sourceFor(draft) ?? source;
    render();
    say(DRAFT_COPY.undone);
  });
  listen(part("polarity-fix"), "click", () => {
    const result = fixBase(draft.document);
    if (edit(result).ok) say(`Switched to ${result.document.base}.`);
  });
  listen(part("bg-add-gradient"), "click", () => {
    const { accent, background } = draft.document.colors;
    const result = addLayer(draft.document, bgTarget, { gradient: { type: "linear", angle: 180, stops: [{ color: accent, position: 0 }, { color: background, position: 100 }], opacity: 0.3 } });
    imageError(result.ok ? null : result.message);
    edit(result);
  });
  listen(part("bg-add-pattern"), "click", () => {
    const result = addLayer(draft.document, bgTarget, { pattern: { kind: "grid", color: draft.document.colors.accent, opacity: 0.05, size: 32 } });
    imageError(result.ok ? null : result.message);
    edit(result);
  });
  listen(part("reset"), "click", () => {
    if (!source) return;
    dropApproval();
    accept(commitEdit(draft, structuredClone(source.document), { cssEnabled: source.cssEnabled }));
    say(COPY.reset(source.bundledName ?? source.name));
  });
  listen(part("discard"), "click", () => {
    if (!source) return;
    dropApproval();
    accept(commitEdit(draft, structuredClone(source.document), { cssEnabled: source.cssEnabled }), { save: false });
    win.clearTimeout(autosave);
    host.discardDraft().catch(() => {});
    say(COPY.discarded);
  });
  listen(part("image-accept"), "click", acceptOffer);
  listen(part("image-resize"), "click", resizeRetry);
  listen(part("image-cancel"), "click", () => {
    closeOffer();
    part("image-file").value = "";
    part("image-file").focus();
  });
  listen(part("save"), "click", () => save());
  listen(part("save-copy"), "click", () => save({ asCopy: true }));
  listen(part("retry"), "click", () => retry?.());
  listen(part("download-draft"), "click", downloadDraft);
  listen(part("keep-editing"), "click", async () => {
    const current = await host.read();
    if (current.ok) settings = current.settings;
    // Keep this draft, now based on what is saved: the next Save is a deliberate overwrite. An
    // approval revoked elsewhere stays off until Enable advanced CSS is chosen again.
    if (draft.savedId) {
      const stored = customTheme(draft.savedId);
      source = stored ? { ...sourceFor(draft) } : null;
      if (!stored) draft = { ...draft, savedId: null, baseHash: null };
      else {
        draft = { ...draft, baseHash: sourceHash(stored.document) };
        if (!source.cssEnabled) draft = withoutCss(draft);
      }
      source ??= sourceFor(draft);
    }
    part("conflict").hidden = true;
    render();
    part("save").focus();
  });
  listen(part("load-saved"), "click", async () => {
    const current = await host.read();
    if (current.ok) settings = current.settings;
    part("conflict").hidden = true;
    remixFrom = draft.savedId && customTheme(draft.savedId) ? draft.savedId : settings.selectedThemeId;
    const next = startFrom(remixFrom);
    source = sourceFor(next);
    dropApproval();
    accept(commitEdit(draft, next.document, { cssEnabled: next.cssEnabled, savedId: next.savedId, basedOn: next.basedOn, fresh: next.fresh, baseHash: next.baseHash }));
  });
  function resumeDraft() {
    const restored = draftFromRecord(pendingRecord);
    pendingRecord = null;
    part("resume").hidden = true;
    if (!restored) return false;
    // A record carries no approval: CSS stays on only where storage approved exactly this CSS for
    // the saved theme it edits.
    dropApproval();
    const stored = restored.savedId ? customTheme(restored.savedId) : null;
    source = sourceFor(restored) ?? source;
    draft = { ...restored, cssEnabled: Boolean(stored && consentMatches(stored.id, restored.document)) };
    render();
    say(COPY.resumed);
    // The saved theme changed (or went) since this draft was kept: ask before any save replaces it.
    if (draft.savedId && drifted(false)) {
      showConflict(stored ? COPY.resumeConflict(stored.document.name) : COPY.conflict);
      part("keep-editing").focus();
    } else part("name").focus();
    return true;
  }
  listen(part("resume-draft"), "click", resumeDraft);
  listen(part("resume-saved"), "click", () => {
    dismissResume(true);
    part("name").focus();
  });

  // Copy AI prompt: Copied only after the clipboard accepted it.
  listen(part("prompt-copy"), "click", async () => {
    const prompt = makeAiPrompt();
    const ok = await copy(prompt);
    part("prompt-steps").hidden = false;
    // Success is said once, in the status above the steps; a refusal stays beside the prompt text.
    part("prompt-result").hidden = ok;
    part("prompt-result").textContent = ok ? "" : COPY.promptBlocked;
    part("prompt-fallback").hidden = ok;
    if (!ok) part("prompt-text").value = prompt;
    say(ok ? COPY.promptCopied : "");
  });
  listen(part("prompt-select"), "click", () => {
    part("prompt-text").focus();
    part("prompt-text").select();
  });
  listen(part("import-paste"), "click", () => openImport("text"));
  listen(part("import-open"), "click", () => openImport("text"));
  listen(part("import-close"), "click", closeImport);
  listen(part("import-cancel"), "click", closeImport);
  listen(dialog, "cancel", (event) => {
    event.preventDefault();
    closeImport();
  });
  listen(part("import-preview"), "click", () => runImport());
  listen(part("import-use"), "click", useImport);
  listen(part("import-css-enable"), "change", updateImportPreview);
  listen(part("import-polarity-fix"), "click", () => {
    const fixed = fixBase(importResult.theme);
    if (!fixed.ok) return;
    const result = repaired(fixed.document, standardSeed);
    showImport({ ...importResult, ...result, messages: [{ kind: "info", text: `Switched to ${fixed.document.base}.` }, ...result.messages], css: importResult.css, images: importResult.images });
  });
  listen(part("export"), "toggle", renderExport);
  listen(part("download"), "click", () => {
    const theme = exportable();
    if (!theme) return;
    const file = exportFile(theme);
    download?.(file);
    part("export-note").textContent = COPY.downloaded(file.filename);
  });
  const exportCopy = async (what, text, label, extra = "") => {
    const ok = await copy(text);
    part("export-note").textContent = `${ok ? COPY.copied(what) : COPY.copyBlocked}${extra ? ` ${extra}` : ""}`;
    // Success leaves the text selectable too.
    showExportText(text, label);
  };
  listen(part("copy-json"), "click", () => {
    const theme = exportable();
    if (theme) exportCopy("theme JSON", themeJson(theme), "Theme JSON");
  });
  listen(part("copy-code"), "click", () => {
    const theme = exportable();
    if (theme) exportCopy("share code", shareSheet(theme).code, "Share code", IMPORT_COPY.linkTooLong);
  });
  listen(part("copy-link"), "click", () => {
    const theme = exportable();
    if (!theme) return;
    const sheet = shareSheet(theme);
    if (sheet.linkTooLong) {
      part("export-note").textContent = IMPORT_COPY.linkOverLimit;
      return;
    }
    exportCopy("preview link", sheet.link, "Preview link");
  });
  listen(part("export-select"), "click", () => {
    part("export-text").focus();
    part("export-text").select();
  });

  buildColors();
  buildFields();

  // Saved theme changes elsewhere: keep the draft; refresh the source and whether CSS applies.
  const unsubscribe = host.subscribe(async () => {
    const current = await host.read();
    if (!current.ok || destroyed) return;
    const pristine = draft && !dirty() && !draft.previous;
    const consentBefore = settings?.cssConsent ?? {};
    settings = current.settings;
    // The repository voids a ticket whose saved theme was removed, revoked or given other CSS;
    // follow it, so this editor never shows an approval it no longer holds.
    if (approval && approval.target !== NEW_TARGET) {
      const stored = customTheme(approval.target);
      if (!stored || cssHash(stored.document) !== approval.storedHash || (consentBefore[approval.target] && !settings.cssConsent?.[approval.target])) {
        if (draft?.cssEnabled) say(COPY.cssRevoked);
        dropApproval();
      }
    }
    if (pristine && !draft.savedId) {
      // An untouched draft follows the selected theme.
      remixFrom = settings.selectedThemeId;
      dropApproval();
      draft = startFrom(remixFrom);
      source = sourceFor(draft);
    } else if (draft?.savedId && !customTheme(draft.savedId)) {
      draft = { ...draft, savedId: null };
      source = sourceFor(draft);
    } else if (draft?.savedId && source?.cssEnabled) {
      const stored = customTheme(draft.savedId);
      if (!consentMatches(stored.id, stored.document)) {
        // Another window revoked this theme's CSS approval. The draft follows, and only a fresh
        // Enable advanced CSS grants it again.
        source = { ...source, cssEnabled: false };
        if (draft.cssEnabled || draft.previous?.cssEnabled) say(COPY.cssRevoked);
        dropApproval();
        draft = withoutCss(draft);
      }
    }
    lastPreviewed = null;
    render();
  });

  const ready = (async () => {
    const current = await host.read();
    if (destroyed) return;
    settings = current.ok ? current.settings : null;
    remixFrom = settings?.selectedThemeId ?? catalog.ids[0];
    draft = startFrom(remixFrom);
    source = sourceFor(draft);
    render();
    const stored = await host.loadDraft().catch(() => null);
    if (destroyed) return;
    const restored = draftFromRecord(stored);
    if (restored) {
      pendingRecord = stored;
      part("resume").hidden = false;
      part("resume-name").textContent = restored.document.name;
    } else if (stored) host.discardDraft().catch(() => {});
    // Settings and any kept draft are in: the controls show what they will act on.
    root.dataset.rbReady = "";
  })();

  return {
    ready,
    state: () => ({ draft, source, settings }),
    // For Backup & help: the stored draft not yet resumed, or this page's unsaved changes.
    draftStatus: () => ({ pending: draftFromRecord(pendingRecord)?.document ?? null, dirty: Boolean(draft && dirty()), name: draft?.document.name ?? "" }),
    resumeDraft,
    // Reset all is starting: no draft write until restart(), or the returned resume if it fails.
    holdDrafts() {
      win?.clearTimeout(autosave);
      autosave = 0;
      holding = true;
      return () => {
        holding = false;
        if (draft && dirty()) scheduleAutosave();
      };
    },
    // After Reset all: a new start from the theme now selected, with no draft kept.
    async restart() {
      const current = await host.read();
      if (current.ok) settings = current.settings;
      win?.clearTimeout(autosave);
      dismissResume(false);
      clearError();
      part("conflict").hidden = true;
      remixFrom = settings?.selectedThemeId ?? catalog.ids[0];
      dropApproval();
      draft = startFrom(remixFrom);
      source = sourceFor(draft);
      lastPreviewed = null;
      holding = false;
      render();
    },
    downloadDraft: () => {
      const record = draftFromRecord(pendingRecord);
      if (record) download?.(exportFile(record.document));
      else downloadDraft();
    },
    discardDraft() {
      if (pendingRecord) return dismissResume(true);
      win?.clearTimeout(autosave);
      dropApproval();
      if (source) accept(commitEdit(draft, structuredClone(source.document), { cssEnabled: source.cssEnabled }), { save: false });
      host.discardDraft().catch(() => {});
    },
    destroy() {
      // An edit still inside the autosave delay is saved now, so closing right after it keeps it.
      if (autosave) {
        win.clearTimeout(autosave);
        void saveDraftNow();
      }
      dropApproval();
      destroyed = true;
      win?.clearTimeout(autosave);
      win?.clearTimeout(cssTimer);
      images.cancelAll();
      unsubscribe();
      for (const cleanup of cleanups.splice(0)) cleanup();
      preview?.destroy();
      importPreview?.destroy();
    },
  };
}
