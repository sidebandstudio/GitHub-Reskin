// GitHub Reskin shared preview: one inert, offline GitHub-like fixture (profile, repository, diff,
// empty states and 404), painted by the same resolver, Primer compiler and appearance code as
// github.com. The extension UI, userscript, site and films all mount this. See README.md.
export { mountPreview, configurePreview, createFixtureRenderer, nativeBaseline, DEFAULT_DORMANT_SLOTS, VIEW_LABELS, PREVIEW_SANDBOX } from "./mount.js";
export { serializeFixture, fixtureBody, styleText, PREVIEW_CSP } from "./serialize.js";
export { PREVIEW_VARIABLES, colorAt, variableDeclarations } from "./variables.js";
export { VIEWS, FIXTURE, ASSET_DIR, NARROW_WEEKS } from "./views.js";
export { FIXTURE_CSS, LANGUAGE_COLORS } from "./styles.js";
