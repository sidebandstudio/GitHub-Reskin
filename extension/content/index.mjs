// The content script entry, injected at document_start after boot.css. It assembles the runtime
// from C4's lifecycle, C3's GitHub adapter and Primer compiler, the engine and C5's appearance,
// with the catalog index the build embedded. It reads extension storage directly and talks to
// nothing else: no background messages, no page messaging. The bundled theme a page shows comes
// from storage, checked against the index (packages/ui/catalog.js contentCatalog), and css-tree
// loads from its own chunk only when the saved theme a page shows needs the sanitizer.
import INDEX from "reskin:catalog-index";
import { installCssSanitizer } from "../../packages/format/css/admission.js";
import { admitGradientCss, sanitizeCss, useCssParser } from "../../packages/format/css/sanitize.js";
import { createExtensionStorage } from "../../packages/settings/index.js";
import { extensionResources } from "../../packages/appearance/index.js";
import { contentCatalog } from "../../packages/ui/catalog.js";
import { createRenderer } from "../../packages/ui/renderer.js";
import * as github from "./github/index.js";
import { TIME_LIMIT_MS } from "./github/slots.js";
import { startContent } from "./lifecycle/index.js";

const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
const PARSER = "content/css-parser.js";

let parser = null;
const loadCssSanitizer = () =>
  (parser ??= import(api.runtime.getURL(PARSER)).then((module) => {
    useCssParser(module);
    installCssSanitizer({ sanitizeCss, admitGradientCss });
  }).catch((error) => {
    // A later read tries again.
    parser = null;
    throw error;
  }));

const catalog = contentCatalog(INDEX);
startContent({
  storage: createExtensionStorage(api),
  document,
  view: window,
  catalog,
  loadCssSanitizer,
  renderer: createRenderer({ github, catalog, resources: extensionResources(api.runtime), slotTimeLimitMs: TIME_LIMIT_MS }),
});
