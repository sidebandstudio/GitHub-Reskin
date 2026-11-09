// Storage admission: what a write may hold before it is attempted. Measures every extension record,
// and asks two typed interfaces about advanced CSS and embedded images.
//
// TODO(C2b): the sanitizer and image admission types are not merged. Until they are, this build
// ships NO_CSS_SANITIZER and NO_IMAGE_ADMISSION, which reject any document carrying CSS or a raster
// and never grant CSS consent. C2b replaces them with its real implementations behind the same
// shapes:
//
//   CssAdmission = {
//     sanitizerVersion: number | null,        // null: this build cannot sanitize CSS
//     inspect(document): {css:null}           // the document has no CSS
//       | {css:{ok:true, hash:string, sanitizerVersion:number}}   // canonical sanitized CSS hash
//       | {css:{ok:false, issues:Issue[]}}
//   }
//   ImageAdmission = {
//     inspect(document): {ok:true, bytes:number, pixels:number, hashes:string[]}
//       | {ok:false, issues:Issue[]}           // aggregate bytes/pixels over every occurrence
//   }
import { ISSUE_CODES } from "../contracts/index.js";
import { STORAGE_LIMITS } from "./constants.js";
import { issue } from "./model.js";

const utf8Length = (text) => new TextEncoder().encode(text).length;

/** Serialized UTF-8 bytes of storage records, keys included: what the 8 MiB ceiling counts. */
export function recordBytes(records) {
  let bytes = 0;
  for (const [key, value] of Object.entries(records)) if (value !== undefined) bytes += utf8Length(JSON.stringify(key)) + utf8Length(JSON.stringify(value));
  return bytes;
}

// Any data: URL anywhere in a document. Structured image fields are the only place one may appear
// after C2b, and this build admits none.
function containsDataUrl(value, depth = 0) {
  if (depth > 16) return true;
  if (typeof value === "string") return /data:/i.test(value);
  if (value && typeof value === "object") return Object.values(value).some((v) => containsDataUrl(v, depth + 1));
  return false;
}

export const NO_CSS_SANITIZER = Object.freeze({
  sanitizerVersion: null,
  inspect(document) {
    if (document?.css === undefined && document?.appearance?.css === undefined) return { css: null };
    return { css: { ok: false, issues: [issue(ISSUE_CODES.unknownField, "/css", "This version of Reskin cannot apply advanced CSS yet.")] } };
  },
});

export const NO_IMAGE_ADMISSION = Object.freeze({
  inspect(document) {
    if (!containsDataUrl(document)) return { ok: true, bytes: 0, pixels: 0, hashes: [] };
    return { ok: false, issues: [issue(ISSUE_CODES.resourceString, "", "This version of Reskin cannot store images in themes yet.")] };
  },
});

/** Issues that keep a document out of storage under the given admission interfaces. */
export function documentAdmissionIssues(document, { css = NO_CSS_SANITIZER, images = NO_IMAGE_ADMISSION } = {}) {
  const issues = [];
  const cssResult = css.inspect(document).css;
  if (cssResult && !cssResult.ok) issues.push(...cssResult.issues);
  const imageResult = images.inspect(document);
  if (!imageResult.ok) issues.push(...imageResult.issues);
  return issues;
}

/**
 * Whether the selected local theme's CSS may render: an explicit consent for exactly the sanitized
 * hash and sanitizer version this build produces. Built-in CSS is reviewed at build time and needs
 * no consent (C2b). With NO_CSS_SANITIZER this is always false.
 */
export function cssAllowed(document, consent, css = NO_CSS_SANITIZER) {
  if (!consent || css.sanitizerVersion === null) return false;
  const result = css.inspect(document).css;
  return Boolean(result?.ok && result.hash === consent.hash && result.sanitizerVersion === consent.sanitizerVersion && consent.sanitizerVersion === css.sanitizerVersion);
}

/** Capacity issues for the complete set of records a write would leave in storage. */
export function capacityIssues(records) {
  const bytes = recordBytes(records);
  if (bytes <= STORAGE_LIMITS.maxRecordsBytes) return [];
  return [issue(ISSUE_CODES.capacity, "", `Saving needs ${bytes} bytes; Reskin keeps at most ${STORAGE_LIMITS.maxRecordsBytes}. Export or remove a saved theme, then try again.`)];
}
