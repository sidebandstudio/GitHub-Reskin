// The site's client seam to the shared preview and format (catalog.mjs is the build-time one).
// Pages never import it at load: the home page imports it when a visitor reaches for a preview
// control, and /make/ and /share/ when they read a theme. It configures C5's mountPreview once with
// C3's Primer adapter and slot evidence and the site's own copies of the fonts and fixture images,
// and registers the build-time proofs for the bundled themes' CSS. Bundled through site/modules.mjs,
// the format and engine resolve to their viewer entries; loadAuthoring() adds the CSS sanitizer.
import { configurePreview, mountPreview } from "../../packages/preview/index.js";
import * as primer from "../../packages/primer/index.js";
import { siteResources } from "../../packages/appearance/index.js";
import { dormantSlots } from "../../extension/content/github/slots.js";
import { decodeShare, encodeShare, exportTheme, fileStem, parseImport, rasterLayers, registerCssProofs } from "../../packages/format/viewer.js";
import { CSS_PROOFS, DOCS } from "reskin:themes";

export { mountPreview, decodeShare, encodeShare, exportTheme, fileStem, parseImport, rasterLayers, DOCS };

// What every preview starts from: the extension's defaults, Full appearance.
export const DEFAULT_PREFERENCES = Object.freeze({ enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true });
export const CALM = Object.freeze({ ...DEFAULT_PREFERENCES, extras: false });

// The base path, for example "/GitHub-Reskin/"; both bundlers define it.
configurePreview({ primer, modeIndex: primer.MODE_INDEX, resources: siteResources(import.meta.env.BASE_URL), dormantSlots: dormantSlots() });
registerCssProofs(CSS_PROOFS);

let authoring = null;
/** Installs the CSS sanitizer for imported themes; resolves once parseImport admits CSS. */
export const loadAuthoring = () => (authoring ??= import("../../packages/format/authoring.js"));

/**
 * Whether a theme's advanced CSS styles only Reskin's own decorations. Those rules compile in the
 * preview and the extension; a rule for GitHub's own elements fails the whole CSS closed until
 * C3b's target registry lands.
 */
export async function cssStylesOwnedOnly(css) {
  const { sanitizeCss } = await loadAuthoring();
  const result = sanitizeCss(css);
  return result.ok && result.value.rules.every((rule) => rule.selectors.every((selector) => selector.compounds.some((compound) => compound.attributes.some((a) => a.name === "data-reskin-slot"))));
}
