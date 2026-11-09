// The background entry: Chrome's MV3 service worker and Firefox's nonpersistent background script.
// C4's host registers its listeners synchronously at module load, before any event is delivered.
import CATALOG from "reskin:catalog";
import { installBackground } from "../background/host.js";
import { catalogFromData } from "../../packages/ui/catalog.js";
import { backgroundRendering } from "../../packages/ui/renderer.js";

const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

installBackground(api, { catalog: catalogFromData(CATALOG), ...backgroundRendering() });
