// Import, export and sharing as pure functions over C2's format and the engine: what an import
// attempt found and what to say about it in UX.md's words, the recovery choices a failure can
// offer, and the file, share code and preview link a theme exports as. No DOM or storage.
import { ISSUE_CODES, LIMITS, SANITIZER_VERSION } from "../contracts/index.js";
import { basePolarityIssue, repairTheme, resolveTheme } from "../engine/index.js";
import { admitCss, colorsOnly, encodeShare, exportTheme, NOTE_CODES, parseImport, rasterInfo, rasterLayers } from "../format/index.js";
import RELEASE from "../../release.config.json" with { type: "json" };

export const SHARE_PAGE = `${RELEASE.site.origin}${RELEASE.site.base.replace(/\/+$/, "")}/share/`;
export const HELP_URL = RELEASE.support.source;

export const COPY = Object.freeze({
  ready: "Theme ready to preview.",
  wrapper: "We found your theme inside the answer.",
  contrast: (count) => `We adjusted ${count} ${count === 1 ? "color" : "colors"} so links and text are easier to read.`,
  graph: "We spaced the graph colors so activity levels stay visible.",
  cutOff: "This theme looks cut off. Copy the full answer and try again.",
  two: "There are two themes here. Choose one to preview.",
  several: (count) => `There are ${count} themes here. Choose one to preview.`,
  newer: "This theme needs a newer version of Reskin.",
  font: "That font isn't included.",
  unsafe: "This theme has options we cannot safely apply.",
  tooLarge: "This theme exceeds the file, image or CSS limit.",
  badCode: "This share code is incomplete or damaged. Ask for the full code or theme file.",
  noTheme: "We couldn't find a theme here. Copy the chatbot's full answer, including the lines with { and }.",
  basePolarity: (base) => `This theme's colors read as ${base === "dark" ? "light" : "dark"}, but it is set to ${base}.`,
  cssWarning:
    "Advanced CSS changes GitHub's appearance and can break layout or reduce readability. Reskin blocks outside resources and unsupported rules, but cannot guarantee every GitHub page. Review the preview and CSS before enabling it. Calm turns it off.",
  sharedImages: (count) => `This theme carries ${count} embedded ${count === 1 ? "image" : "images"}. Anyone you share the file or code with can save ${count === 1 ? "it" : "them"}. Don't share a personal photo you want to keep private.`,
  sharedCss: "This theme carries Advanced CSS. Whoever imports it reviews the CSS and turns it on themselves; a shared link never turns it on.",
  linkTooLong: "Share codes can be longer than a TikTok comment. Share the file or preview link instead.",
  linkOverLimit: `This theme is too big for a preview link (over ${LIMITS.maxShareLinkCharacters.toLocaleString("en-US")} characters). Share the .reskin.json file instead.`,
  savedAdjustment: "Saved color adjustment",
  previewAdjustment: "Adjusted for this preview",
});

const FIELD_NAMES = {
  "/colors/background": "Background",
  "/colors/text": "Text",
  "/colors/accent": "Accent",
  "/colors/contribution": "Graph color",
  "/contributions/levels": "Graph levels",
};

/** A readable name for a theme or token path: "/code/syntax/keyword" becomes "Code syntax keyword". */
export function fieldName(path) {
  if (FIELD_NAMES[path]) return FIELD_NAMES[path];
  const words = path
    .split("/")
    .filter(Boolean)
    .filter((part) => !/^\d+$/.test(part) && part !== "tokens" && part !== "semantics" && part !== "appearance" && part !== "colors")
    .map((part) => part.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
  const text = words.join(" ") || "theme";
  return text[0].toUpperCase() + text.slice(1);
}

const utf8Bytes = (text) => new TextEncoder().encode(text).length;

/** Size in KiB with one decimal, for limits and meters. */
export const kib = (bytes) => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;

/**
 * What a theme's Advanced CSS is: its source size, and the sanitizer's canonical text and hash,
 * or its located findings. null when the theme has none.
 */
export function cssSummary(theme) {
  if (typeof theme?.css !== "string") return null;
  const admitted = admitCss(theme.css, "/css");
  const summary = { bytes: utf8Bytes(theme.css), limit: LIMITS.cssUtf8Bytes, source: theme.css };
  if (!admitted.ok) return { ...summary, ok: false, issues: admitted.issues };
  return { ...summary, ok: true, canonical: admitted.value.css, hash: admitted.value.hash, sanitizerVersion: admitted.value.sanitizerVersion ?? SANITIZER_VERSION };
}

/** Every embedded image: where it is, its size and dimensions. */
export function imageSummary(theme) {
  return rasterLayers(theme).map(({ path, image }) => {
    const info = rasterInfo(image.data);
    return { path, target: path.split("/")[2], width: image.width, height: image.height, bytes: info.ok ? info.bytes : null };
  });
}

/**
 * The repairs to list under See changes: the saved source adjustments, then what only this preview
 * adjusts. Graph regeneration is its own message.
 */
export function repairList(sourceRepairs, renderRepairs = []) {
  const row = (repair, persistence) => ({ field: fieldName(repair.path), path: repair.path, before: repair.before, after: repair.after, reason: repair.reason, persistence });
  return [...sourceRepairs.map((r) => row(r, COPY.savedAdjustment)), ...renderRepairs.map((r) => row(r, COPY.previewAdjustment))];
}

/**
 * Repairs a valid theme against its base's standard seed, and the messages to show for it. A base
 * that contradicts the colors is not repaired: `polarity` carries the issue and the one-tap fix.
 * @param {object} theme a valid ThemeV1
 * @param {(base:string)=>object} standardSeed
 */
export function repaired(theme, standardSeed) {
  const polarity = basePolarityIssue(theme);
  if (polarity) return { ok: true, polarity, theme, source: theme, repairs: [], messages: [{ kind: "error", text: COPY.basePolarity(theme.base) }] };
  const seed = standardSeed(theme.base);
  const fixed = repairTheme(theme, seed);
  const resolved = resolveTheme(fixed.theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
  const graph = fixed.repairs.filter((r) => r.path.startsWith("/contributions") || r.path === "/colors/contribution");
  const colors = fixed.repairs.filter((r) => !graph.includes(r));
  const render = resolved.repairs.filter((r) => r.path.startsWith("/tokens/"));
  const messages = [];
  const count = new Set([...colors.map((r) => r.path), ...render.map((r) => r.path)]).size;
  if (count) messages.push({ kind: "repair", text: COPY.contrast(count) });
  if (graph.length) messages.push({ kind: "repair", text: COPY.graph });
  return { ok: true, polarity: null, theme: fixed.theme, source: theme, resolved, repairs: repairList(fixed.repairs, render), messages };
}

/**
 * One import attempt: parse, validate, then repair, with the messages UX.md's table gives each
 * outcome. Nothing is applied; the caller previews `theme` and applies it only on Use theme.
 * @param {string|Uint8Array} input
 * @param {"text"|"file"|"code"} kind
 * @param {{standardSeed:(base:string)=>object}} context
 */
export function analyzeImport(input, kind, { standardSeed }) {
  const parsed = parseImport(input, kind);
  if (!parsed.ok) return importFailure(parsed, typeof input === "string" ? input : null);
  const result = repaired(parsed.normalized, standardSeed);
  const notes = parsed.notes ?? [];
  const found = notes.filter((n) => n.code === NOTE_CODES.wrapper || n.code === NOTE_CODES.jsonc);
  const deferred = notes.filter((n) => n.code === NOTE_CODES.deferred);
  const messages = [];
  if (found.length) messages.push({ kind: "info", text: COPY.wrapper, details: found.map((n) => n.message) });
  for (const note of deferred) messages.push({ kind: "warning", text: /font/i.test(note.message) ? COPY.font : COPY.unsafe, details: [note.message] });
  messages.push(...result.messages);
  if (!messages.length || messages.every((m) => m.kind === "info")) messages.unshift({ kind: "info", text: COPY.ready });
  return { ...result, messages, notes, css: cssSummary(result.theme), images: imageSummary(result.theme) };
}

const pathOf = (issue) => issue.path || "";
const hasCode = (issues, ...codes) => issues.some((issue) => codes.includes(issue.code));

/**
 * The failure view for a parse or validation failure: the headline, the located details, and the
 * explicit recovery choices the input allows (two candidates, colors only, CSS removed).
 */
export function importFailure(result, text = null) {
  const issues = result.issues ?? [];
  const details = issues.map((issue) => ({ path: pathOf(issue), message: issue.message }));
  const view = { ok: false, details, actions: [], candidates: result.candidates ?? null, issues };
  if (hasCode(issues, ISSUE_CODES.ambiguousCandidates)) return { ...view, message: result.candidates?.length === 2 ? COPY.two : COPY.several(result.candidates?.length ?? 2) };
  if (hasCode(issues, ISSUE_CODES.shareFormat, ISSUE_CODES.shareChecksum, ISSUE_CODES.decompressLimit)) return { ...view, message: COPY.badCode };
  if (hasCode(issues, ISSUE_CODES.unsupportedVersion)) return { ...view, message: COPY.newer, help: HELP_URL };
  if (hasCode(issues, ISSUE_CODES.parseError) && /cut off/i.test(issues[0].message)) return { ...view, message: COPY.cutOff };
  if (hasCode(issues, ISSUE_CODES.inputTooLarge, ISSUE_CODES.imageLimit)) return withChoices({ ...view, message: COPY.tooLarge }, text);
  const missing = issues.find((issue) => issue.code === ISSUE_CODES.missingField && /^\/colors\/(background|text|accent)$/.test(issue.path));
  if (missing) {
    const role = missing.path.split("/")[2];
    return { ...view, message: `Add ${role === "accent" ? "an" : "a"} ${role} color like ${role === "background" ? "#18212b" : role === "text" ? "#e6edf3" : "#ff806c"}.`, fixRequest: fixRequest(issues), missingColor: missing.path };
  }
  if (hasCode(issues, ISSUE_CODES.noCandidate)) return { ...view, message: COPY.noTheme };
  if (hasCode(issues, ISSUE_CODES.parseError, ISSUE_CODES.invalidUtf8, ISSUE_CODES.duplicateKey, ISSUE_CODES.tooDeep, ISSUE_CODES.nonFiniteNumber, ISSUE_CODES.forbiddenKey)) return { ...view, message: issues[0].message };
  return withChoices({ ...view, message: COPY.unsafe, fixRequest: fixRequest(issues) }, text);
}

// Recovery choices need the object itself, which a failed parse does not return. A failed
// validation came from an object the parser found; the same extraction here offers the choice,
// and whatever the person picks is parsed and validated again from scratch.
function withChoices(view, text) {
  const value = text === null ? null : extractObject(text);
  if (!value) return view;
  const actions = [];
  const cssIssue = view.issues.some((issue) => issue.code === ISSUE_CODES.css || issue.code === ISSUE_CODES.cssUnavailable || pathOf(issue).startsWith("/css"));
  if (cssIssue && typeof value.css === "string") {
    const { css, ...rest } = value;
    actions.push({ id: "remove-css", label: "Remove CSS and preview structured theme", input: JSON.stringify(rest), omitted: ["css"] });
  }
  const colors = colorsOnly(value);
  if (colors.ok && colors.omitted.length) actions.push({ id: "colors-only", label: "Preview colors only", input: JSON.stringify(colors.theme), omitted: colors.omitted });
  return { ...view, actions };
}

/**
 * The first balanced JSON object in text, with line and block comments outside strings removed
 * and trailing commas dropped, or null. Only used to offer a recovery choice.
 */
export function extractObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let out = "";
  let depth = 0;
  let string = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (string) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') string = false;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 1;
      continue;
    }
    if (c === '"') string = true;
    if (c === "{") depth++;
    if (c === "}") depth--;
    out += c;
    if (depth === 0) break;
  }
  if (depth !== 0) return null;
  try {
    const value = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** A message to paste back into the chatbot, naming what to fix. */
export function fixRequest(issues) {
  const lines = issues.slice(0, 8).map((issue) => `- ${issue.path || "the theme"}: ${issue.message}`);
  return `Your GitHub Reskin theme could not be used:\n${lines.join("\n")}\nReply with the complete corrected theme as one JSON object in one json code block.`;
}

/** The download: corrected portable source as `<sanitized name>.reskin.json`. */
export function exportFile(theme) {
  return exportTheme(theme);
}

/** Pretty theme JSON for Copy theme JSON: the same text the file holds. */
export const themeJson = (theme) => new TextDecoder().decode(exportTheme(theme).bytes);

/**
 * The share code and preview link. A link longer than the site reads is not offered; the file is.
 * @returns {{code:string, link:string|null, linkTooLong:boolean, images:object[], css:boolean}}
 */
export function shareSheet(theme) {
  const code = encodeShare(theme);
  const link = `${SHARE_PAGE}#${code}`;
  const fits = link.length <= LIMITS.maxShareLinkCharacters;
  return { code, link: fits ? link : null, linkTooLong: !fits, images: imageSummary(theme), css: typeof theme.css === "string" };
}
