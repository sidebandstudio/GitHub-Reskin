// The content script entry, injected at document_start after boot.css. It assembles the runtime
// from C4's lifecycle, C3's GitHub adapter and Primer compiler, the engine and C5's appearance,
// with the catalog the build embedded. It reads extension storage directly and talks to nothing
// else: no background messages, no page messaging.
import CATALOG from "reskin:catalog";
import { createExtensionStorage } from "../../packages/settings/index.js";
import { extensionResources } from "../../packages/appearance/index.js";
import { catalogFromData } from "../../packages/ui/catalog.js";
import { createRenderer } from "../../packages/ui/renderer.js";
import * as github from "./github/index.js";
import { startContent } from "./lifecycle/index.js";

const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

startContent({
  storage: createExtensionStorage(api),
  document,
  view: window,
  catalog: catalogFromData(CATALOG),
  renderer: createRenderer({ github, resources: extensionResources(api.runtime) }),
});
