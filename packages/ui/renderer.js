// The GitHub renderer the content lifecycle (C4) runs, assembled from C3's adapter and Primer
// compiler, the engine's resolver and C5's appearance. The userscript (C8) assembles the same
// renderer with its own resources. Nothing here reads storage; the GitHub adapter is passed in
// because it lives with the content script.
import { compileAppearance, fontFaceCss, mountAppearance } from "../appearance/index.js";
import { CSS_MARKERS } from "../contracts/index.js";
import { repairTheme, resolveTheme } from "../engine/index.js";
import { compileGitHub, MODE_INDEX, seedFor, selectMode, standardSeed } from "../primer/index.js";
import { themeCard } from "./catalog.js";

// The host scope marker the format compiler puts in front of every rule of a theme's own CSS.
const CSS_SCOPE = CSS_MARKERS.scope;

/**
 * @param {object} options
 * @param {object} options.github C3's content adapter (extension/content/github): readNativeMode,
 *   forcedColorsActive, reducedMotion, classifyRoute, locateSlots, MODE_ATTRIBUTES
 * @param {object} options.resources a C5 resource adapter (extensionResources, embeddedResources)
 * @param {object} [options.catalog] CatalogSource; a bundled theme's own reviewed CSS applies in
 *   Full. A saved theme's CSS needs consent for its hash, which arrives with the stage 2 builder,
 *   so until then it gets none.
 * @param {object} [options.index] the ModeIndex; the frozen production index by default
 * @returns the renderer startContent takes
 */
export function createRenderer({ github, resources, catalog = null, index = MODE_INDEX }) {
  const bundled = new Map((catalog?.ids ?? []).map((id) => [catalog.sourceHash(id), catalog.document(id)]));
  const themeCss = (resolved) => {
    const css = bundled.get(resolved.sourceHash)?.css ?? null;
    return { css, cssAllowed: css !== null };
  };
  return {
    modeAttributes: github.MODE_ATTRIBUTES,
    readPage: (document, view) => ({
      native: github.readNativeMode(document, view),
      forcedColors: github.forcedColorsActive(view),
      reducedMotion: github.reducedMotion(view),
    }),
    plan(page, base) {
      const plan = selectMode(page.native, base, index);
      return { plan, seed: seedFor(index, plan) };
    },
    resolve: resolveTheme,
    compile(resolved, plan, prefs) {
      const primer = compileGitHub(resolved, plan, prefs, index);
      if (!primer.css) return { css: "", fingerprint: primer.fingerprint };
      const fontUrl = prefs.extras && prefs.fonts && resolved.font !== "system" ? resources.fontUrl(resolved.font) : null;
      const css = [primer.css, fontUrl ? fontFaceCss(resolved.font, fontUrl) : "", compileAppearance(resolved, prefs, "github", themeCss(resolved))].join("\n");
      return { css, fingerprint: `${primer.fingerprint}:${fontUrl ? 1 : 0}` };
    },
    // Owned decoration at C3's verified anchors. The theme's own CSS reaches owned nodes only under
    // the host's scope marker, which lives exactly as long as the decoration.
    decorate(document, resolved, prefs) {
      const anchors = github.locateSlots(document, github.classifyRoute(document));
      const owned = themeCss(resolved);
      const decoration = mountAppearance(document.body, resolved, prefs, anchors, owned);
      const root = document.documentElement;
      const scoped = owned.cssAllowed && resolved.policy === "themed" && prefs.extras;
      if (scoped) root.setAttribute(CSS_SCOPE, "active");
      return {
        ...decoration,
        destroy() {
          if (scoped) root.removeAttribute(CSS_SCOPE);
          decoration.destroy();
        },
      };
    },
  };
}

/**
 * The background's callbacks for settings: the boot snapshot is the selected source resolved for
 * the common page (standard seed of its base, themed, motion allowed), and source repair runs
 * against the same standard seed.
 */
export function backgroundRendering(index = MODE_INDEX) {
  return {
    snapshot: (theme) => resolveTheme(theme, { seed: standardSeed(index, theme.base), policy: "themed", reducedMotion: false, forcedColors: false }),
    repair: (theme) => repairTheme(theme, standardSeed(index, theme.base)),
  };
}

/** A picker card for a bundled or saved theme, resolved against the standard seed of its base. */
export function standardCard(entry, index = MODE_INDEX) {
  const seed = standardSeed(index, entry.document.base);
  return themeCard(entry, resolveTheme(entry.document, { seed, policy: "themed", reducedMotion: false, forcedColors: false }));
}
