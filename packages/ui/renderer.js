// The GitHub renderer the content lifecycle (C4) runs, assembled from C3's adapter and Primer
// compiler, the engine's resolver and C5's appearance. The userscript (C8) assembles the same
// renderer with its own resources. Nothing here reads storage; the GitHub adapter is passed in
// because it lives with the content script.
import { compileAppearance, fontFaceCss, mountAppearance } from "../appearance/index.js";
import { repairTheme, resolveTheme } from "../engine/index.js";
import { compileGitHub, MODE_INDEX, seedFor, selectMode, standardSeed } from "../primer/index.js";
import { themeCard } from "./catalog.js";

/**
 * @param {object} options
 * @param {object} options.github C3's content adapter (extension/content/github): readNativeMode,
 *   forcedColorsActive, reducedMotion, classifyRoute, locateSlots, MODE_ATTRIBUTES
 * @param {object} options.resources a C5 resource adapter (extensionResources, embeddedResources)
 * @param {object} [options.index] the ModeIndex; the frozen production index by default
 * @returns the renderer startContent takes
 */
export function createRenderer({ github, resources, index = MODE_INDEX }) {
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
      const css = [primer.css, fontUrl ? fontFaceCss(resolved.font, fontUrl) : "", compileAppearance(resolved, prefs, "github")].join("\n");
      return { css, fingerprint: `${primer.fingerprint}:${fontUrl ? 1 : 0}` };
    },
    decorate(document, resolved, prefs) {
      const anchors = github.locateSlots(document, github.classifyRoute(document));
      return mountAppearance(document.body, resolved, prefs, anchors);
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
