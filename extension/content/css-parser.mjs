// The content script's CSS parser chunk: the css-tree 3.1.0 exports C2b's sanitizer uses
// (packages/format/css/sanitize.js useCssParser). Bundled themes never need it, since the build
// proved their CSS. The content script imports it from the package, web accessible to GitHub's two
// origins only, the first time the saved theme a page shows has Advanced CSS or a gradientCss layer.
export { clone, fork, ident, List, tokenize, tokenNames, tokenTypes, toPlainObject, walk } from "css-tree/dist/csstree.esm";
