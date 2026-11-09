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
const FORCED_COLORS = "(forced-colors: active)";

/**
 * @param {object} options
 * @param {object} options.github C3's content adapter (extension/content/github): readNativeMode,
 *   forcedColorsActive, reducedMotion, classifyRoute, locateSlots, MODE_ATTRIBUTES
 * @param {object} options.resources a C5 resource adapter (extensionResources, embeddedResources)
 * @param {object} [options.catalog] CatalogSource; a bundled theme's own reviewed CSS applies in
 *   Full. A saved theme's CSS needs consent for its hash, which arrives with the stage 2 builder,
 *   so until then it gets none.
 * @param {object} [options.index] the ModeIndex; the frozen production index by default
 * @param {number} [options.slotTimeLimitMs] the adapter's slot-search time limit; a search that
 *   ran past it and found nothing gave up, and is tried once more on the next frame
 * @returns the renderer startContent takes
 */
export function createRenderer({ github, resources, catalog = null, index = MODE_INDEX, slotTimeLimitMs = null }) {
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
      // The heading face applies in Full and Calm alike while Fonts is on, as in C5's preview.
      const fontUrl = prefs.fonts && resolved.font !== "system" ? resources.fontUrl(resolved.font) : null;
      const css = [primer.css, fontUrl ? fontFaceCss(resolved.font, fontUrl) : "", compileAppearance(resolved, prefs, "github", themeCss(resolved))].join("\n");
      return { css, fingerprint: `${primer.fingerprint}:${fontUrl ? 1 : 0}` };
    },
    // Owned decoration at C3's verified anchors. The theme's own CSS reaches owned nodes only under
    // the host's scope marker, which lives exactly as long as the decoration.
    decorate(document, resolved, prefs) {
      // The pass right after a theme or preference change runs before the browser has styled the
      // new stylesheet. Settle style and layout first, so the adapter's slot search, which gives up
      // past its time limit and places nothing, measures a laid-out page instead of paying for it.
      document.body?.getBoundingClientRect();
      const view = document.defaultView;
      const owned = themeCss(resolved);
      const clock = view?.performance ?? globalThis.performance;
      const place = () => {
        const start = clock.now();
        const anchors = github.locateSlots(document, github.classifyRoute(document));
        const gaveUp = !anchors.length && slotTimeLimitMs !== null && clock.now() - start > slotTimeLimitMs;
        return { decoration: mountAppearance(document.body, resolved, prefs, anchors, owned), gaveUp };
      };
      let { decoration, gaveUp } = place();
      // A busy frame, such as the first one after a hidden tab is shown, can push the search past
      // its limit. It gets one more try on the next frame.
      let retry = gaveUp && view?.requestAnimationFrame
        ? view.requestAnimationFrame(() => {
            retry = 0;
            decoration.destroy();
            ({ decoration } = place());
          })
        : 0;
      const root = document.documentElement;
      const scoped = owned.cssAllowed && resolved.policy === "themed" && prefs.extras;
      // A theme's own CSS never applies under forced colors. The marker follows the mode as it
      // changes, so it holds even before the lifecycle's recompute takes GitHub native.
      const gate = () => {
        if (scoped && !github.forcedColorsActive(view)) root.setAttribute(CSS_SCOPE, "active");
        else if (scoped) root.removeAttribute(CSS_SCOPE);
      };
      const forced = view?.matchMedia?.(FORCED_COLORS);
      gate();
      forced?.addEventListener?.("change", gate);
      return {
        get owned() {
          return decoration.owned;
        },
        get animated() {
          return decoration.animated;
        },
        play: () => decoration.play(),
        motionBoxes: () => decoration.motionBoxes(),
        destroy() {
          if (retry) view.cancelAnimationFrame(retry);
          retry = 0;
          forced?.removeEventListener?.("change", gate);
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
