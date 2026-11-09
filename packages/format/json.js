// Strict JSON with exactly two JSONC allowances, comments and trailing commas. Nothing is
// evaluated, quotes are never guessed, and depth, duplicate keys, prototype keys, non-finite
// numbers and unpaired surrogates are rejected while parsing.
import { ISSUE_CODES } from "../contracts/index.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CUT_OFF = "This theme was cut off. Copy the chatbot's full answer and try again.";

export const pointer = (path, key) => `${path}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;

class JsonError extends Error {
  constructor(code, path, message, offset) {
    super(message);
    this.code = code;
    this.path = path;
    this.offset = offset;
  }
}

// JSONC ends a line at LF, CR or CRLF. Line comments stop there and line numbers count them alike.
const isLineEnd = (c) => c === "\n" || c === "\r";
// Index of the line end that closes a // comment starting at `from`, or text.length.
function lineEnd(text, from) {
  let i = from;
  while (i < text.length && !isLineEnd(text[i])) i++;
  return i;
}

function lineColumn(text, offset) {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n" || (text[i] === "\r" && text[i + 1] !== "\n")) {
      line++;
      start = i + 1;
    }
  }
  return `line ${line}, column ${offset - start + 1}`;
}

/**
 * Parses one JSON or JSONC value.
 * @returns {{ok:true, value:unknown, jsonc:boolean} | {ok:false, issue:import("../contracts/index.js").Issue, syntax:boolean}}
 */
export function parseJson(text, { maxDepth }) {
  let i = 0;
  let jsonc = false;

  const syntax = (message, at = i) => {
    if (at >= text.length) return new JsonError(ISSUE_CODES.parseError, "", CUT_OFF, at);
    return new JsonError(ISSUE_CODES.parseError, "", `${message} (${lineColumn(text, at)}).`, at);
  };

  function skip() {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else if (c === "/" && text[i + 1] === "/") {
        jsonc = true;
        i = lineEnd(text, i);
      } else if (c === "/" && text[i + 1] === "*") {
        jsonc = true;
        const end = text.indexOf("*/", i + 2);
        if (end < 0) throw syntax("Unclosed comment", text.length);
        i = end + 2;
      } else return;
    }
  }

  function string() {
    const start = i++;
    let out = "";
    for (;;) {
      if (i >= text.length) throw syntax("Unclosed text", text.length);
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        break;
      }
      if (c < 0x20) throw syntax("Text values can't contain line breaks or control characters; write them as escapes", i);
      if (c === 0x5c) {
        const e = text[i + 1];
        const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[e];
        if (simple !== undefined) {
          out += simple;
          i += 2;
        } else if (e === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else throw syntax("Unknown escape in text", i);
      } else {
        out += text[i];
        i++;
      }
    }
    // A lone surrogate cannot be written as UTF-8, so it could never export unchanged.
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)) {
      throw new JsonError(ISSUE_CODES.invalidUtf8, "", `Text contains an unreadable character (${lineColumn(text, start)}).`, start);
    }
    return out;
  }

  function number(path) {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i, i + 400));
    if (!match) throw syntax("Unexpected character", i);
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new JsonError(ISSUE_CODES.nonFiniteNumber, path, "Numbers must be finite.", i);
    i += match[0].length;
    return value;
  }

  function value(path, depth) {
    skip();
    const c = text[i];
    if (c === "{" || c === "[") {
      if (depth + 1 > maxDepth) throw new JsonError(ISSUE_CODES.tooDeep, path, `This is nested more than ${maxDepth} levels deep, more than a theme needs.`, i);
      return c === "{" ? object(path, depth + 1) : array(path, depth + 1);
    }
    if (c === '"') return string();
    if (c === "-" || (c >= "0" && c <= "9")) return number(path);
    for (const [word, result] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return result;
      }
    }
    if (c === "'") throw syntax("Use double quotes around keys and text. Reskin does not guess at single-quoted JSON", i);
    if (/^(?:NaN|-?Infinity)/.test(text.slice(i, i + 9))) throw new JsonError(ISSUE_CODES.nonFiniteNumber, path, "Numbers must be finite.", i);
    throw syntax("Unexpected character", i);
  }

  function object(path, depth) {
    i++;
    const out = {};
    const seen = new Set();
    skip();
    if (text[i] === "}") {
      i++;
      return out;
    }
    for (;;) {
      skip();
      if (text[i] !== '"') {
        if (i >= text.length) throw syntax("", i);
        throw syntax(text[i] === "'" ? "Use double quotes around keys and text. Reskin does not guess at single-quoted JSON" : "Keys need double quotes", i);
      }
      const at = i;
      const key = string();
      const keyPath = pointer(path, key);
      if (seen.has(key)) throw new JsonError(ISSUE_CODES.duplicateKey, keyPath, `"${key}" appears twice. Keep one value and try again.`, at);
      if (FORBIDDEN_KEYS.has(key)) throw new JsonError(ISSUE_CODES.forbiddenKey, keyPath, `"${key}" can't be used as a key.`, at);
      seen.add(key);
      skip();
      if (text[i] !== ":") throw syntax("Expected : after a key", i);
      i++;
      out[key] = value(keyPath, depth);
      skip();
      if (text[i] === ",") {
        i++;
        skip();
        if (text[i] === "}") {
          jsonc = true;
          i++;
          return out;
        }
      } else if (text[i] === "}") {
        i++;
        return out;
      } else throw syntax("Expected , or }", i);
    }
  }

  function array(path, depth) {
    i++;
    const out = [];
    skip();
    if (text[i] === "]") {
      i++;
      return out;
    }
    for (;;) {
      out.push(value(pointer(path, out.length), depth));
      skip();
      if (text[i] === ",") {
        i++;
        skip();
        if (text[i] === "]") {
          jsonc = true;
          i++;
          return out;
        }
      } else if (text[i] === "]") {
        i++;
        return out;
      } else throw syntax("Expected , or ]", i);
    }
  }

  try {
    const result = value("", 0);
    skip();
    if (i < text.length) throw syntax("Unexpected text after the theme", i);
    return { ok: true, value: result, jsonc };
  } catch (error) {
    if (!(error instanceof JsonError)) throw error;
    return {
      ok: false,
      syntax: error.code === ISSUE_CODES.parseError,
      issue: { code: error.code, path: error.path, message: error.message, severity: "error" },
    };
  }
}

/**
 * Finds balanced top-level `{...}` spans in prose, fenced blocks or plain JSON, in one linear pass.
 * Inside a span it honors double-quoted strings and comments, so braces there never count. Prose
 * outside spans is ignored. A span left open at the end is reported as truncated, and the scan
 * restarts after its opening brace a bounded number of times so a stray prose brace cannot hide
 * the real theme. Restarts also stop once the rescanned text passes `maxWork` characters, so a
 * maximum-size paste of unclosed braces stays within one long task.
 * @returns {{spans:{start:number,end:number}[], truncated:boolean}}
 */
export function findObjectSpans(text, { maxRestarts = 16, maxWork = 8 * 1024 * 1024 } = {}) {
  const spans = [];
  let truncated = false;
  let from = 0;
  let work = 0;
  for (let restarts = 0; from < text.length && restarts <= maxRestarts && work <= maxWork; restarts++) {
    work += text.length - from;
    const open = scan(text, from, spans);
    if (open < 0) break;
    truncated = true;
    from = open + 1;
  }
  return { spans, truncated };
}

// Scans from `from`, pushing closed spans. Returns the start of an unclosed span, or -1. Char
// codes rather than one-character strings: a maximum paste can be rescanned up to 17 times.
const OPEN = 0x7b;
const CLOSE = 0x7d;
const QUOTE = 0x22;
const SLASH = 0x2f;
const STAR = 0x2a;
const BACKSLASH = 0x5c;
function scan(text, from, spans) {
  let depth = 0;
  let start = -1;
  const length = text.length;
  for (let i = from; i < length; i++) {
    const c = text.charCodeAt(i);
    if (depth === 0) {
      if (c === OPEN) {
        depth = 1;
        start = i;
      }
      continue;
    }
    if (c === QUOTE) {
      for (i++; i < length && text.charCodeAt(i) !== QUOTE; i++) if (text.charCodeAt(i) === BACKSLASH) i++;
      if (i >= length) return start;
    } else if (c === SLASH && text.charCodeAt(i + 1) === SLASH) {
      i = lineEnd(text, i);
    } else if (c === SLASH && text.charCodeAt(i + 1) === STAR) {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return start;
      i = end + 1;
    } else if (c === OPEN) depth++;
    else if (c === CLOSE && --depth === 0) spans.push({ start, end: i + 1 });
  }
  return depth > 0 ? start : -1;
}
