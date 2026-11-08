// Validation against the bundled schema through the precompiled standalone validator, plus the
// content rules JSON Schema cannot express. Errors become Issues with plain-language messages.
import { ISSUE_CODES } from "../contracts/index.js";
import { pointer } from "./json.js";
import validateSchema from "./schema-validator.js";

const COLOR_PATH = /^\/(?:colors|overrides(?:\/syntax)?)\/[^/]+$|^\/contributions\/levels\/\d$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
// Web addresses and resource schemes. The exact $schema hint is the only URL a theme may carry.
// Each alternative here starts at a word boundary or a literal, so matching stays linear; a
// scheme before "://" is found by hasScheme instead.
const RESOURCE = /\bwww\.[a-z0-9-]+\.[a-z]|\b(?:data|javascript|vbscript|blob|file|about):(?!\s)|\burl\s*\(|@import/i;

const isLetter = (c) => (c | 32) >= 97 && (c | 32) <= 122;
const isSchemeChar = (c) => isLetter(c) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46;

// True when some "://" follows a scheme, a letter and then [a-z0-9+.-]*. That holds exactly when
// the run of scheme characters before "://" contains a letter. A run ends at the ":" or "/" of
// the previous "://", so the runs never overlap and the scan is linear.
function hasScheme(value) {
  for (let at = value.indexOf("://"); at !== -1; at = value.indexOf("://", at + 3)) {
    for (let i = at - 1; i >= 0 && isSchemeChar(value.charCodeAt(i)); i--) if (isLetter(value.charCodeAt(i))) return true;
  }
  return false;
}

const FIELD_NAMES = { background: "The background color", text: "The text color", accent: "The accent color" };

const issue = (code, path, message) => ({ code, path, message, severity: "error" });

function describe(error, value) {
  const { keyword, instancePath: path, params } = error;
  const at = (key) => pointer(path, key);
  switch (keyword) {
    case "additionalProperties": {
      const key = params.additionalProperty;
      if (path === "/effects") return issue(ISSUE_CODES.unknownField, at(key), `The ${key} effect isn't available in this version of Reskin. You can preview the colors without it.`);
      if (path === "/flavor/slots") return issue(ISSUE_CODES.unknownField, at(key), `${key} isn't one of the places Reskin can add text.`);
      if (path === "/overrides") return issue(ISSUE_CODES.unknownField, at(key), `${key} isn't a color a theme can set. Reskin works out that color itself.`);
      if (/^\/effects\/[^/]+$/.test(path)) return issue(ISSUE_CODES.unknownField, at(key), `This effect has no ${key} setting.`);
      return issue(ISSUE_CODES.unknownField, at(key), `"${key}" isn't part of the theme format. Reskin theme files hold colors and a few named options, not code or custom fields.`);
    }
    case "required": {
      const key = params.missingProperty;
      if (path === "/colors" && FIELD_NAMES[key]) return issue(ISSUE_CODES.missingField, at(key), `${FIELD_NAMES[key]} is missing. Ask the chatbot to use a color like #18212b.`);
      if (key === "base") return issue(ISSUE_CODES.missingField, "/base", 'The theme needs a base, "dark" or "light".');
      return issue(ISSUE_CODES.missingField, at(key), `The theme is missing ${key}.`);
    }
    case "const":
      if (path === "/schemaVersion") {
        return typeof value === "number" && value > 1
          ? issue(ISSUE_CODES.unsupportedVersion, path, "This theme needs a newer version of Reskin.")
          : issue(ISSUE_CODES.invalidValue, path, "schemaVersion must be 1.");
      }
      if (path === "/$schema") return issue(ISSUE_CODES.invalidValue, path, "This schema link isn't Reskin's. Remove it to use the theme.");
      return issue(ISSUE_CODES.invalidValue, path, `This value must be ${JSON.stringify(params.allowedValue)}.`);
    case "enum":
      if (path === "/fonts/accent") return issue(ISSUE_CODES.invalidValue, path, "This font isn't included. Preview with GitHub's default font, or choose one of Reskin's fonts.");
      if (path === "/base") return issue(ISSUE_CODES.invalidValue, path, 'base must be "dark" or "light".');
      return issue(ISSUE_CODES.invalidValue, path, `Choose one of: ${params.allowedValues.join(", ")}.`);
    case "pattern":
      if (COLOR_PATH.test(path)) return issue(ISSUE_CODES.invalidValue, path, "Colors must look like #18212b: six hex digits, no transparency, names or code.");
      if (typeof value === "string" && /[<>]/.test(value)) return issue(ISSUE_CODES.markup, path, "Theme text can't contain < or >.");
      if (typeof value === "string" && CONTROL.test(value)) return issue(ISSUE_CODES.controlText, path, "Theme text can't contain control or text-direction characters.");
      if (path === "/version") return issue(ISSUE_CODES.invalidValue, path, "version must look like 1.0.0.");
      if (/^\/tags\/\d+$/.test(path)) return issue(ISSUE_CODES.invalidValue, path, "Tags use lowercase letters, digits and hyphens, like neon-city.");
      return issue(ISSUE_CODES.invalidValue, path, "This text has characters a theme can't use.");
    case "maxProperties":
      if (path === "/effects") return issue(ISSUE_CODES.outOfBounds, path, "Choose at most three effects.");
      return issue(ISSUE_CODES.outOfBounds, path, `At most ${params.limit} entries are allowed here.`);
    case "minProperties":
      return issue(ISSUE_CODES.outOfBounds, path, "Remove this empty section or add a value to it.");
    case "minItems":
    case "maxItems":
      if (path === "/contributions/levels") return issue(ISSUE_CODES.outOfBounds, path, "Contribution colors need exactly five levels, from no activity to the most.");
      return issue(ISSUE_CODES.outOfBounds, path, `${keyword === "minItems" ? "At least" : "At most"} ${params.limit} items are allowed here.`);
    case "false schema":
      return issue(ISSUE_CODES.outOfBounds, path, "This list has too many items.");
    case "minLength":
      return issue(ISSUE_CODES.outOfBounds, path, params.limit === 1 ? "This text can't be empty." : `Use at least ${params.limit} characters.`);
    case "maxLength":
      return issue(ISSUE_CODES.outOfBounds, path, `Use at most ${params.limit} characters.`);
    case "minimum":
    case "maximum":
      return issue(ISSUE_CODES.outOfBounds, path, `Use a value from the allowed range (${keyword} ${params.limit}).`);
    case "uniqueItems":
      return issue(ISSUE_CODES.invalidValue, path, path === "/contributions/levels" ? "Each contribution level needs its own color." : "Remove the repeated item.");
    case "type":
      return issue(ISSUE_CODES.invalidValue, path, `This should be ${params.type === "integer" ? "a whole number" : `a ${params.type}`}.`);
    default:
      return issue(ISSUE_CODES.invalidValue, path, "This value isn't allowed here.");
  }
}

function valueAt(root, path) {
  let value = root;
  for (const part of path.split("/").slice(1)) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

// Resource-like strings anywhere except the exact $schema hint, which the schema already pins.
function resourceIssues(value, path, out) {
  if (typeof value === "string") {
    if (path !== "/$schema" && (hasScheme(value) || RESOURCE.test(value))) out.push(issue(ISSUE_CODES.resourceString, path, "Theme text can't include links, web addresses or code."));
  } else if (Array.isArray(value)) value.forEach((item, index) => resourceIssues(item, pointer(path, index), out));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) resourceIssues(item, pointer(path, key), out);
}

const order = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/**
 * @param {unknown} value
 * @returns {{ok:true, theme:import("../contracts/index.js").ThemeV1} | {ok:false, issues:import("../contracts/index.js").Issue[]}}
 */
export function validateTheme(value) {
  const issues = [];
  if (!validateSchema(value)) {
    for (const error of validateSchema.errors) {
      // Ajv reports a failed $ref branch and its parent; describe the most specific error only.
      if (error.keyword === "if" || error.keyword === "$ref") continue;
      issues.push(describe(error, valueAt(value, error.instancePath)));
    }
  }
  resourceIssues(value, "", issues);
  if (!issues.length) return { ok: true, theme: value };
  const seen = new Set();
  const unique = issues.filter((i) => {
    const key = `${i.code}\u0000${i.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ok: false, issues: unique.sort(order) };
}
