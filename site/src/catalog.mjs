// The site's only connection to the bundled theme catalog (the other seam is engine.mjs). Phase 1
// reads the temporary development catalog in site/dev; phase 2 reads themes/catalog.json and its
// documents. Build-time only: client scripts receive theme documents through the page.
export { CATALOG, CATALOG_SOURCE } from "../dev/catalog.mjs";
