// What this increment admits, and how each deferred construct is refused. The schema can
// represent more than the Choom subset renders; representability is not admission.
import { DEFERRED_EDITOR_ACTION_TYPES, EDITOR_ACTION_TYPES, EXPANSION_INCREMENT, FONT_INVENTORY, ISSUE_CODES } from "../contracts/index.js";
import { NOTE_CODES } from "./codes.js";

export const CAPABILITIES = Object.freeze({
  increment: EXPANSION_INCREMENT,
  admitted: Object.freeze([
    "backgrounds: solid colors, structured gradients and patterns, gradientCss layers, up to four layers per target",
    "backgrounds: static PNG, JPEG, WebP and GIF rasters that pass byte and header admission",
    "shape: corners, borders, shadows, buttons, avatar shape and frame",
    "typography: uppercase headings and heading/body tracking",
    "fonts: heading and body roles for bundled families and the native condensed stack",
    "code: all 22 syntax roles, 16 ANSI roles and 8 diff roles, with code.syntax precedence",
    "contributions: square, round, glow and diamond cells, cell radius and boundary, static glow",
    "details: header ink, selection, scrollbar, labels and topics",
    "css: owned decorations, mapped page roots and @media; GitHub's own elements only against C3's registry",
  ]),
  deferred: Object.freeze([
    "rasters needing conversion: animated frames and metadata are rejected until local conversion lands",
    `fonts without files yet (${FONT_INVENTORY.deferred.join(", ")}): requests resolve to GitHub's font with a note`,
    "css conveniences: nesting and @supports are rejected",
    `editor controls: ${DEFERRED_EDITOR_ACTION_TYPES.join(", ")} are rejected; images and CSS arrive by import`,
  ]),
});

const FONT_PATHS = ["accent", "heading", "body"];

/** Warning notes for requests this increment renders another way. Never errors; source is kept. */
export function capabilityNotes(theme) {
  const notes = [];
  for (const role of FONT_PATHS) {
    const id = theme?.fonts?.[role];
    if (FONT_INVENTORY.deferred.includes(id)) {
      notes.push({ code: NOTE_CODES.deferred, path: `/fonts/${role}`, message: `The ${id} font arrives in a later version of Reskin. GitHub's own font is used until then; the theme keeps asking for it.`, severity: "warning" });
    }
  }
  return notes;
}

/** Errors for an editor action this increment cannot apply. Fragment validity is checked on apply. */
export function editorActionIssues(action) {
  const type = action?.type;
  if (!EDITOR_ACTION_TYPES.includes(type)) return [{ code: ISSUE_CODES.invalidValue, path: "", message: `${String(type)} is not an editor action.`, severity: "error" }];
  if (DEFERRED_EDITOR_ACTION_TYPES.includes(type)) {
    return [{ code: ISSUE_CODES.deferred, path: "", message: type === "setImage" ? "Uploading images arrives in a later version. Import a theme file that carries the image instead." : "The Advanced CSS editor arrives in a later version. Import a theme file that carries the CSS instead.", severity: "error" }];
  }
  return [];
}
