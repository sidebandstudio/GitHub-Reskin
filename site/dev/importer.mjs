// TEMPORARY stand-in for C2's parseImport, returning the frozen ImportResult shape. It finds JSON
// objects in a pasted chatbot answer with a string- and comment-aware scanner, strips JSONC comments
// and checks only the required fields. C2's real importer adds bounds, schema validation, repair and
// the full normalization rules. Never ships; see README.md.

const MAX_INPUT = 128 * 1024;
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Top-level {...} spans in text, ignoring braces inside strings and comments.
function objectSpans(text) {
  const spans = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}" && depth > 0 && --depth === 0) {
      spans.push(text.slice(start, i + 1));
    }
  }
  return spans;
}

// JSONC to JSON: drops comments and trailing commas outside strings.
function stripJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const from = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(from, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const normalizeHex = (value) => {
  const m = typeof value === "string" && value.trim().match(HEX);
  if (!m) return null;
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join("") : m[1];
  return `#${digits.toLowerCase()}`;
};

const issue = (path, message) => ({ path, message });

/** @returns {{ok:true, source:string, normalized:object, notes:object[]} | {ok:false, issues:object[], candidates?:{name:string,input:string}[]}} */
export function parseImport(input) {
  const text = String(input ?? "").replace(/^﻿/, "");
  if (!text.trim()) return { ok: false, issues: [issue("", "Paste the chatbot's answer first.")] };
  if (text.length > MAX_INPUT) return { ok: false, issues: [issue("", "That answer is longer than 128 KB. Paste only the theme.")] };

  const parsed = [];
  for (const span of objectSpans(text)) {
    try {
      const value = JSON.parse(stripJsonc(span));
      if (value && typeof value === "object" && value.colors) parsed.push({ value, input: span });
    } catch {}
  }
  if (!parsed.length) return { ok: false, issues: [issue("", "No theme found. The answer needs a JSON object with base and colors.")] };
  if (parsed.length > 1) {
    return {
      ok: false,
      issues: [issue("", "The answer contains more than one theme. Choose one.")],
      candidates: parsed.map(({ value, input }) => ({ name: String(value.name || "Untitled theme"), input })),
    };
  }

  const raw = parsed[0].value;
  const notes = [];
  const issues = [];
  if (raw.base !== "light" && raw.base !== "dark") issues.push(issue("/base", 'Base must be "light" or "dark".'));
  const colors = {};
  for (const key of ["background", "text", "accent", "contribution"]) {
    if (raw.colors[key] === undefined && key === "contribution") continue;
    const hex = normalizeHex(raw.colors[key]);
    if (!hex) issues.push(issue(`/colors/${key}`, `${key[0].toUpperCase()}${key.slice(1)} needs a hex color such as #1a2b3c.`));
    else {
      if (hex !== raw.colors[key]) notes.push(issue(`/colors/${key}`, `Wrote ${key} as ${hex}.`));
      colors[key] = hex;
    }
  }
  if (issues.length) return { ok: false, issues };
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 64) : "My theme";
  if (name !== raw.name) notes.push(issue("/name", `Named the theme ${name}.`));
  const normalized = { schemaVersion: 1, name, base: raw.base, colors };
  for (const key of ["description", "fonts", "effects", "flavor", "overrides", "contributions"]) if (raw[key] !== undefined) normalized[key] = raw[key];
  return { ok: true, source: parsed[0].input, normalized, notes };
}

export const SAMPLE_ANSWER = `Here is your theme:

\`\`\`json
{
  // A calm harbor at dawn
  "schemaVersion": 1,
  "name": "Harbor Dawn",
  "base": "light",
  "colors": { "background": "#f4f1ea", "text": "#1f2a33", "accent": "#a2412b" },
  "effects": { "paper": { "texture": "grain", "opacity": 0.03, "scale": 1 } }
}
\`\`\``;
