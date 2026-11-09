// The Primer variables the inert fixture reads, and the resolved color each carries. The fixture
// styles itself only through these names, so GitHub's native mode CSS paints the Before view and
// the Primer compiler's output paints the After view, exactly as on github.com. C3's compiler and
// native mode CSS must define every name here; tests check that.
export const PREVIEW_VARIABLES = Object.freeze({
  "--bgColor-default": "/tokens/canvas",
  "--bgColor-muted": "/tokens/surface",
  "--fgColor-default": "/tokens/text",
  "--fgColor-muted": "/tokens/mutedText",
  "--fgColor-accent": "/tokens/link",
  "--borderColor-default": "/tokens/border",
  "--borderColor-muted": "/tokens/border",
  "--control-borderColor-rest": "/tokens/controlBorder",
  "--underlineNav-borderColor-active": "/tokens/accent",
  "--bgColor-neutral-muted": "/tokens/counterBackground",
  "--codeMirror-bgColor": "/tokens/codeBackground",
  "--codeMirror-fgColor": "/tokens/codeText",
  "--diffBlob-hunkLine-bgColor": "/tokens/neutralBackground",
  "--diffBlob-hunkLine-fgColor": "/tokens/neutralText",
  "--diffBlob-additionLine-bgColor": "/tokens/diffAddedBackground",
  "--diffBlob-additionLine-fgColor": "/tokens/diffAddedText",
  "--diffBlob-additionWord-bgColor": "/tokens/diffWordAddedBackground",
  "--diffBlob-additionWord-fgColor": "/tokens/diffWordAddedText",
  "--diffBlob-deletionLine-bgColor": "/tokens/diffRemovedBackground",
  "--diffBlob-deletionLine-fgColor": "/tokens/diffRemovedText",
  "--diffBlob-deletionWord-bgColor": "/tokens/diffWordRemovedBackground",
  "--diffBlob-deletionWord-fgColor": "/tokens/diffWordRemovedText",
  "--prettylights-syntax-comment": "/syntax/comment",
  "--prettylights-syntax-keyword": "/syntax/keyword",
  "--prettylights-syntax-string": "/syntax/string",
  "--prettylights-syntax-entity": "/syntax/function",
  "--prettylights-syntax-constant": "/syntax/number",
  "--prettylights-syntax-variable": "/syntax/variable",
  "--prettylights-syntax-entityTag": "/syntax/type",
  "--fgColor-success": "/semantics/success/text",
  "--fgColor-danger": "/semantics/danger/text",
  "--bgColor-success-emphasis": "/semantics/success/emphasisBackground",
  "--bgColor-danger-emphasis": "/semantics/danger/emphasisBackground",
  "--contribution-default-bgColor-0": "/graph/0",
  "--contribution-default-bgColor-1": "/graph/1",
  "--contribution-default-bgColor-2": "/graph/2",
  "--contribution-default-bgColor-3": "/graph/3",
  "--contribution-default-bgColor-4": "/graph/4",
  "--contribution-default-borderColor-0": "/tokens/controlBorder",
  "--header-bgColor": "/tokens/inset",
  "--header-fgColor-default": "/tokens/mutedText",
  "--header-fgColor-logo": "/tokens/text",
  "--header-borderColor-divider": "/tokens/border",
  "--headerSearch-bgColor": "/tokens/canvas",
  "--headerSearch-borderColor": "/tokens/controlBorder",
});

/** The value at a ColorPath of a ColorSet (a seed's colors or a themed resolution). */
export function colorAt(colors, path) {
  const [group, key, field] = path.slice(1).split("/");
  const value = group === "graph" ? colors.graph[Number(key)] : field ? colors[group][key][field] : colors[group][key];
  if (typeof value !== "string") throw new Error(`No color at ${path}`);
  return value;
}

/** Declarations for every preview variable from a ColorSet, as "name:value;" text. */
export const variableDeclarations = (colors) =>
  Object.entries(PREVIEW_VARIABLES)
    .map(([name, path]) => `${name}:${colorAt(colors, path)};`)
    .join("");
