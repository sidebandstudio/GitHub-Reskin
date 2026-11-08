// The site's only connection to the resolver, preview, importer and AI prompt; catalog.mjs is the
// other seam. Phase 1 points every export at site/dev, the temporary adapter. Phase 2 replaces
// these imports with C5 mountPreview/compileAppearance, C2 resolveTheme/parseImport/repairTheme
// and the prompt generator. No other file under site/src may import site/dev; site/checks.mjs
// enforces this and rejects the adapter in production output. Client scripts import this file,
// so it must stay free of build-only data.
export { ADAPTER_ID, DEFAULT_PREFERENCES, VIEWS, declarations, mountPreview, resolvePreview } from "../dev/preview-adapter.mjs";
export { parseImport, SAMPLE_ANSWER } from "../dev/importer.mjs";
export { AI_PROMPT } from "../dev/prompt.mjs";
