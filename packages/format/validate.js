// Validation against the bundled schema through the precompiled standalone validator, plus the
// content rules JSON Schema cannot express. Errors become Issues with plain-language messages.
// After the schema passes, the semantic layer runs: nondecreasing gradient stops, raster header
// and document byte/pixel admission, the shared CSS byte budget and mandatory AST admission of
// css and each gradientCss layer. Only those exact paths and the $schema hint skip the
// resource-string scan; each goes to its own admission instead.
import { ISSUE_CODES, LIMITS } from "../contracts/index.js";
import { admitCss, admitGradientCss } from "./css/admission.js";
import { pointer } from "./json.js";
import { rasterIssues } from "./raster.js";
import validateSchema from "./schema-validator.js";

const COLOR_PATH = /^\/(?:colors|overrides(?:\/syntax)?)\/[^/]+$|^\/contributions\/levels\/\d$/;
// Strings with their own admission rather than the resource scan.
const ADMITTED_STRING = /^\/(?:\$schema|css)$|^\/backgrounds\/(?:page|profileBanner|header)\/layers\/\d+\/(?:image\/data|gradientCss\/(?:value|size))$/;
const LAYER_BRANCHES = ["gradient", "pattern", "image", "gradientCss"];
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
  if (keyword === "pattern" && /\/hexColor\//.test(error.schemaPath)) return issue(ISSUE_CODES.invalidValue, path, "Colors must look like #18212b: six hex digits, no transparency, names or code.");
  if (keyword === "pattern" && /\/image\/data$/.test(path)) return issue(ISSUE_CODES.imageData, path, "Images are PNG, JPEG, WebP or GIF data in canonical base64; links, SVG and other files are not allowed.");
  if (keyword === "oneOf") return issue(ISSUE_CODES.invalidValue, path, "A background layer holds exactly one gradient, pattern, image or gradientCss.");
  if (/^\/contributions\/glow\/levels(?:\/\d+)?$/.test(path)) return issue(keyword === "uniqueItems" ? ISSUE_CODES.invalidValue : ISSUE_CODES.outOfBounds, "/contributions/glow/levels", "Glow levels are distinct whole numbers from 1 to 4.");
  const at = (key) => pointer(path, key);
  switch (keyword) {
    case "additionalProperties": {
      const key = params.additionalProperty;
      if (path === "/effects") return issue(ISSUE_CODES.unknownField, at(key), `The ${key} effect isn't available in this version of Reskin. You can preview the colors without it.`);
      if (path === "/flavor/slots") return issue(ISSUE_CODES.unknownField, at(key), `${key} isn't one of the places Reskin can add text.`);
      if (path === "/overrides") return issue(ISSUE_CODES.unknownField, at(key), `${key} isn't a color a theme can set. Reskin works out that color itself.`);
      if (/^\/effects\/[^/]+$/.test(path)) return issue(ISSUE_CODES.unknownField, at(key), `This effect has no ${key} setting.`);
      if (/^\/(?:code|overrides)\/syntax$/.test(path)) return issue(ISSUE_CODES.unknownField, at(key), `${key} isn't one of the syntax roles a theme can color.`);
      if (path === "/code/diff" || path === "/code/ansi") return issue(ISSUE_CODES.unknownField, at(key), `${key} isn't one of the ${path === "/code/diff" ? "diff" : "terminal"} colors a theme can set.`);
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
      if (/^\/fonts\/(?:accent|heading)$/.test(path)) return issue(ISSUE_CODES.invalidValue, path, "This font isn't included. Preview with GitHub's default font, or choose one of Reskin's fonts.");
      if (path === "/fonts/body") return issue(ISSUE_CODES.invalidValue, path, "Body text uses system or one of Reskin's readable body fonts.");
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

// Resource-like strings anywhere except the paths with their own admission: the exact $schema
// hint, which the schema pins, embedded raster data and the CSS fields.
function resourceIssues(value, path, out) {
  if (typeof value === "string") {
    if (!ADMITTED_STRING.test(path) && (hasScheme(value) || RESOURCE.test(value))) out.push(issue(ISSUE_CODES.resourceString, path, "Theme text can't include links, web addresses or code."));
  } else if (Array.isArray(value)) value.forEach((item, index) => resourceIssues(item, pointer(path, index), out));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) resourceIssues(item, pointer(path, key), out);
}

// A failed paint layer reports every oneOf branch. Keep the branch the layer chose by its key.
function layerBranchNoise(error, root) {
  const match = /^#\/\$defs\/paintLayer\/oneOf\/(\d)\//.exec(error.schemaPath);
  if (!match) return false;
  const at = /^(\/backgrounds\/[^/]+\/layers\/\d+)/.exec(error.instancePath)?.[1];
  const layer = at && valueAt(root, at);
  const chosen = layer && typeof layer === "object" ? LAYER_BRANCHES.findIndex((key) => Object.hasOwn(layer, key)) : -1;
  return chosen >= 0 && Number(match[1]) !== chosen;
}

const utf8 = (text) => new TextEncoder().encode(text).length;

// Rules a schema-valid theme still has to meet.
function semanticIssues(theme) {
  const issues = [];
  const cssSources = [];
  for (const target of ["page", "profileBanner", "header"]) {
    (theme.backgrounds?.[target]?.layers ?? []).forEach((layer, index) => {
      const at = `/backgrounds/${target}/layers/${index}`;
      const stops = layer.gradient?.stops;
      if (stops && stops.some((stop, i) => i > 0 && stop.position < stops[i - 1].position)) {
        issues.push(issue(ISSUE_CODES.gradientOrder, `${at}/gradient/stops`, "Gradient stop positions must not go backwards."));
      }
      if (layer.gradientCss) cssSources.push({ at: `${at}/gradientCss`, layer: layer.gradientCss });
    });
  }
  issues.push(...rasterIssues(theme));
  const sourceBytes = (typeof theme.css === "string" ? utf8(theme.css) : 0) + cssSources.reduce((sum, { layer }) => sum + utf8(layer.value) + utf8(layer.size ?? ""), 0);
  if (sourceBytes > LIMITS.cssUtf8Bytes) return [...issues, issue(ISSUE_CODES.outOfBounds, "/css", `Advanced CSS and gradientCss layers come to at most ${LIMITS.cssUtf8Bytes} UTF-8 bytes together.`)];
  let outputBytes = 0;
  for (const { at, layer } of cssSources) {
    if (utf8(layer.value) > LIMITS.gradientCssUtf8Bytes) {
      issues.push(issue(ISSUE_CODES.outOfBounds, `${at}/value`, `A gradientCss value is at most ${LIMITS.gradientCssUtf8Bytes} UTF-8 bytes.`));
      continue;
    }
    const result = admitGradientCss(layer, at);
    if (!result.ok) issues.push(...result.issues);
    else outputBytes += utf8(result.value) + utf8(result.size ?? "");
  }
  if (typeof theme.css === "string") {
    const result = admitCss(theme.css, "/css");
    if (!result.ok) issues.push(...result.issues);
    else outputBytes += result.value.bytes;
  }
  if (outputBytes > LIMITS.cssUtf8Bytes) issues.push(issue(ISSUE_CODES.outOfBounds, "/css", `Advanced CSS and gradientCss layers expand to more than ${LIMITS.cssUtf8Bytes} UTF-8 bytes together.`));
  return issues;
}

const order = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/**
 * @param {unknown} value
 * @returns {{ok:true, theme:import("../contracts/index.js").ThemeV1} | {ok:false, issues:import("../contracts/index.js").Issue[]}}
 */
export function validateTheme(value) {
  const issues = [];
  const schemaValid = validateSchema(value);
  if (!schemaValid) {
    for (const error of validateSchema.errors) {
      // Ajv reports a failed $ref branch and its parent; describe the most specific error only.
      if (error.keyword === "if" || error.keyword === "$ref" || layerBranchNoise(error, value)) continue;
      if (error.keyword === "oneOf" && validateSchema.errors.some((e) => e !== error && e.instancePath.startsWith(error.instancePath) && !layerBranchNoise(e, value) && e.keyword !== "oneOf")) continue;
      issues.push(describe(error, valueAt(value, error.instancePath)));
    }
  }
  resourceIssues(value, "", issues);
  if (schemaValid && !issues.length) issues.push(...semanticIssues(value));
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
