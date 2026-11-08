// Tolerant, non-executing import. Bound the input, decode it, find exactly one theme object,
// normalize documented equivalents, then validate. Parsing never repairs, resolves or saves.
import { ISSUE_CODES, LIMITS, SHARE_CODE_PREFIX } from "../contracts/index.js";
import { NOTE_CODES } from "./codes.js";
import { findObjectSpans, parseJson } from "./json.js";
import { normalizeTheme } from "./normalize.js";
import { MAX_SHARE_CODE_LENGTH, unpackShare } from "./share.js";
import { validateTheme } from "./validate.js";

const BYTE_LIMITS = { text: LIMITS.pastedUtf8Bytes, file: LIMITS.fileUtf8Bytes, code: LIMITS.pastedUtf8Bytes };
const MAX_CANDIDATES = 8;
const SHARE_IN_TEXT = /(?:^|[\s#(<"'])(RS1\.[A-Za-z0-9_-]+\.[0-9a-f]{8})(?![A-Za-z0-9_.-])/g;

const fail = (issues, candidates) => (candidates ? { ok: false, issues, candidates } : { ok: false, issues });
const error = (code, message, path = "") => ({ code, path, message, severity: "error" });
const info = (code, message, path = "") => ({ code, path, message, severity: "info" });

function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3;
  }
  return bytes;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const plausible = (value) => isObject(value) && ("schemaVersion" in value || "colors" in value || "base" in value);

function finish(source, value, notes) {
  if (!isObject(value)) return fail([error(ISSUE_CODES.invalidValue, "A theme is one JSON object in { and }.")]);
  const normalized = normalizeTheme(value);
  const result = validateTheme(normalized.theme);
  if (!result.ok) return fail(result.issues);
  return { ok: true, source, normalized: normalized.theme, notes: [...notes, ...normalized.notes] };
}

function parseText(source, text, notes) {
  const whole = parseJson(text, { maxDepth: LIMITS.maxDepth });
  if (whole.ok && isObject(whole.value)) {
    if (whole.jsonc) notes.push(info(NOTE_CODES.jsonc, "Comments and trailing commas were ignored."));
    return finish(source, whole.value, notes);
  }
  if (whole.ok) return finish(source, whole.value, notes);
  if (!whole.syntax) return fail([whole.issue]);

  // Not one JSON object: look for theme objects inside prose or a code fence.
  const { spans, truncated } = findObjectSpans(text);
  const found = [];
  let firstSyntax = null;
  for (const span of spans) {
    const input = text.slice(span.start, span.end);
    const parsed = parseJson(input, { maxDepth: LIMITS.maxDepth });
    if (!parsed.ok) {
      // A safety failure inside something that names theme fields fails the whole import.
      if (!parsed.syntax && /"(?:schemaVersion|colors|base)"/.test(input)) return fail([parsed.issue]);
      firstSyntax ??= parsed.issue;
      continue;
    }
    if (plausible(parsed.value)) found.push({ input, parsed });
    if (found.length > MAX_CANDIDATES) break;
  }
  if (found.length > 1) {
    const candidates = found.map(({ input, parsed }, index) => ({
      name: typeof parsed.value.name === "string" && parsed.value.name.trim() ? parsed.value.name.trim().slice(0, 64) : `Theme ${index + 1}`,
      input,
    }));
    return fail([error(ISSUE_CODES.ambiguousCandidates, `There are ${candidates.length} themes here. Choose the one you want to preview.`)], candidates);
  }
  if (found.length === 1) {
    const { input, parsed } = found[0];
    if (input !== text) notes.push(info(NOTE_CODES.wrapper, "Used the theme inside the surrounding text."));
    if (parsed.jsonc) notes.push(info(NOTE_CODES.jsonc, "Comments and trailing commas were ignored."));
    return finish(source, parsed.value, notes);
  }
  if (truncated) return fail([error(ISSUE_CODES.parseError, "This theme was cut off. Copy the chatbot's full answer and try again.")]);
  if (text.startsWith("{")) return fail([whole.issue]);
  if (firstSyntax) return fail([firstSyntax]);
  return fail([error(ISSUE_CODES.noCandidate, "No theme was found in this text. Copy the chatbot's full answer, including the lines with { and }.")]);
}

/**
 * Decodes a share code into a validated, normalized theme.
 * @param {string} code
 * @returns {import("../contracts/index.js").ImportResult}
 */
export function decodeShare(code) {
  const unpacked = unpackShare(code);
  if (!unpacked.ok) return fail([unpacked.issue]);
  const parsed = parseJson(unpacked.text, { maxDepth: LIMITS.maxDepth });
  if (!parsed.ok) return fail([parsed.issue]);
  if (parsed.jsonc) return fail([error(ISSUE_CODES.shareFormat, "This share code is incomplete. Ask for the full code or the theme file.")]);
  return finish(typeof code === "string" ? code.trim() : "", parsed.value, []);
}

/**
 * @param {string | Uint8Array} input
 * @param {"text" | "file" | "code"} kind
 * @returns {import("../contracts/index.js").ImportResult}
 */
export function parseImport(input, kind) {
  if (!Object.hasOwn(BYTE_LIMITS, kind)) throw new TypeError(`Unknown import kind ${kind}`);
  const limit = BYTE_LIMITS[kind];
  const tooLarge = () =>
    fail([error(ISSUE_CODES.inputTooLarge, kind === "file" ? "This file includes more than a theme needs. Import a .reskin.json file without images or code." : "This text is longer than any theme needs. Paste only the chatbot's answer.")]);

  let text;
  if (input instanceof Uint8Array) {
    if (input.length > limit) return tooLarge();
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
      return fail([error(ISSUE_CODES.invalidUtf8, "This file isn't readable UTF-8 text. Save it as UTF-8 and try again.")]);
    }
  } else if (typeof input === "string") {
    if (input.length > limit || utf8Length(input) > limit) return tooLarge();
    text = input;
  } else throw new TypeError("parseImport takes a string or Uint8Array");

  const source = text;
  const notes = [];
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    notes.push(info(NOTE_CODES.bom, "Removed a byte order mark."));
  }
  text = text.trim();

  // A share code, alone or inside a pasted link or message.
  if (kind === "code" || text.startsWith(SHARE_CODE_PREFIX) || (text.length <= limit && text.includes(SHARE_CODE_PREFIX) && !text.includes("{"))) {
    const codes = [...text.matchAll(SHARE_IN_TEXT)].map((m) => m[1]);
    const unique = [...new Set(codes)];
    if (unique.length > 1) return fail([error(ISSUE_CODES.ambiguousCandidates, "There is more than one share code here. Paste one at a time.")], unique.map((code, index) => ({ name: `Code ${index + 1}`, input: code })));
    const code = unique[0] ?? text;
    if (code.length > MAX_SHARE_CODE_LENGTH) return fail([error(ISSUE_CODES.inputTooLarge, "This share code is longer than any theme needs. Import the .reskin.json file instead.")]);
    const result = decodeShare(code);
    return result.ok ? { ...result, source, notes: [...notes, ...result.notes] } : result;
  }
  return parseText(source, text, notes);
}
