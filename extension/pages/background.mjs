// The background entry: Chrome's MV3 service worker and Firefox's nonpersistent background script.
// C4's host registers its listeners synchronously at module load, before any event is delivered.
import CATALOG from "reskin:catalog";
import { installBackground } from "../background/host.js";
import { catalogFromData } from "../../packages/ui/catalog.js";
import { backgroundRendering } from "../../packages/ui/renderer.js";

const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

const catalog = catalogFromData(CATALOG);
// The content script carries no catalog: every settings write also stores the selected bundled
// theme's record for it.
installBackground(api, { catalog, ...backgroundRendering(), selectedRecord: (settings) => catalog.record(settings.selectedThemeId) });
