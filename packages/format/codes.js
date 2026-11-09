// Issue codes for normalization and import notes. ISSUE_CODES in packages/contracts has the error
// codes but no codes for informational notes.
// TODO(C1): move NOTE_CODES into packages/contracts ISSUE_CODES, then import them from there.
export const NOTE_CODES = Object.freeze({
  // The theme was found inside surrounding prose or a code fence.
  wrapper: "wrapper",
  // Comments or trailing commas were accepted.
  jsonc: "jsonc",
  // A color was written in an equivalent form, such as #ABC or 0a0b0c.
  color: "normalized-color",
  // Leading, trailing or repeated whitespace in text was collapsed.
  text: "normalized-text",
  // A font display name was replaced by its ID.
  font: "font-name",
  // A missing name or schema version was filled in.
  defaultName: "default-name",
  defaultVersion: "default-schema-version",
  // A UTF-8 byte order mark was removed.
  bom: "bom",
  // Admitted advanced CSS or a gradientCss value was rewritten in canonical form.
  css: "css-canonical",
  // Author !important was removed from advanced CSS.
  important: "css-important",
  // The theme asks for something this version renders another way, such as a deferred font.
  deferred: "deferred-capability",
});
