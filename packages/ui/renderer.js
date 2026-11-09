// The GitHub renderer the content lifecycle (C4) runs, assembled from C3's adapter and Primer
// compiler, the engine's resolver and C5's appearance. The userscript (C8) assembles the same
// renderer with its own resources. Nothing here reads storage; the GitHub adapter is passed in
// because it lives with the content script.
//
// The stylesheet is the Primer CSS, then the appearance CSS with the theme's own CSS last, compiled
// against C3b's target registry. That CSS applies only in Full, for a bundled theme or a saved one
// whose consent names its exact sanitized hash, never under forced colors; its rules for GitHub's
// own elements reach only what C3b's admission marks while the decoration lives.
import { compileAppearance, fontFaceCss, mountAppearance } from "../appearance/index.js";
import { CSS_MARKERS, SANITIZER_VERSION } from "../contracts/index.js";
import { repairTheme, resolveTheme } from "../engine/index.js";
import { admitCss } from "../format/viewer.js";
import { compileGitHub, coveredModes, CSS_TARGET_REGISTRY, MODE_INDEX, seedFor, selectMode, standardSeed } from "../primer/index.js";
import { themeCard } from "./catalog.js";

// The host scope marker the format compiler puts in front of every rule of a theme's own CSS.
const CSS_SCOPE = CSS_MARKERS.scope;
const FORCED_COLORS = "(forced-colors: active)";

/**
 * @param {object} options
 * @param {object} options.github C3's content adapter (extension/content/github): readNativeMode,
 *   forcedColorsActive, reducedMotion, authenticationRoute, classifyRoute, locateSlots,
 *   startAdmission, MODE_ATTRIBUTES
 * @param {object} options.resources a C5 resource adapter (extensionResources, embeddedResources)
 * @param {object} [options.catalog] CatalogSource; a bundled theme's own reviewed CSS applies in
 *   Full. A saved theme's CSS applies in Full only with consent for its sanitized hash.
 * @param {object} [options.index] the ModeIndex; the frozen production index by default
 * @param {number} [options.slotTimeLimitMs] the adapter's slot-search time limit; a search that
 *   ran past it and found nothing gave up, and is tried once more on the next frame
 * @returns the renderer startContent takes
 */
export function createRenderer({ github, resources, catalog = null, index = MODE_INDEX, slotTimeLimitMs = null }) {
  const bundled = new Map((catalog?.ids ?? []).map((id) => [catalog.sourceHash(id), catalog.document(id)]));
  // The theme's CSS and whether the host allows it: packaged with a bundled theme, or consented
  // to for exactly this sanitized hash and sanitizer version. Calm, forced colors and native
  // policy are refused again where it compiles and is admitted.
  const themeCss = (resolved, { source = null, consent = null } = {}) => {
    const packaged = bundled.get(resolved.sourceHash)?.css;
    if (packaged !== undefined) return { css: packaged, cssAllowed: true, registry: CSS_TARGET_REGISTRY };
    const css = typeof source?.css === "string" ? source.css : null;
    return { css, cssAllowed: css !== null && consented(css, consent), registry: CSS_TARGET_REGISTRY };
  };
  return {
    modeAttributes: github.MODE_ATTRIBUTES,
    // Authentication routes stay native before anything is compiled.
    nativeRoute: (document) => (github.authenticationRoute(document) ? "authentication" : null),
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
    // `context` is {source, consent}: the selected source document and the settings' consent for it.
    compile(resolved, plan, prefs, context) {
      const primer = compileGitHub(resolved, plan, prefs, index);
      if (!primer.css) return { css: "", fingerprint: primer.fingerprint };
      // The heading face applies in Full and Calm alike while Fonts is on, as in C5's preview.
      const fontUrl = prefs.fonts && resolved.font !== "system" ? resources.fontUrl(resolved.font) : null;
      const theme = themeCss(resolved, context);
      const css = [primer.css, fontUrl ? fontFaceCss(resolved.font, fontUrl) : "", compileAppearance(resolved, prefs, "github", theme)].join("\n");
      return { css, fingerprint: `${primer.fingerprint}:${fontUrl ? 1 : 0}:${theme.cssAllowed ? 1 : 0}` };
    },
    // Owned decoration at C3's verified anchors, and C3b's admission of GitHub's own elements. The
    // theme's own CSS reaches anything only under the host's scope marker, which admission writes
    // and which lives exactly as long as the decoration. `context` is compile's, with the plan.
    decorate(document, resolved, prefs, { plan = null, ...context } = {}) {
      // The pass right after a theme or preference change runs before the browser has styled the
      // new stylesheet. Settle style and layout first, so the adapter's slot search, which gives up
      // past its time limit and places nothing, measures a laid-out page instead of paying for it.
      document.body?.getBoundingClientRect();
      const view = document.defaultView;
      const owned = themeCss(resolved, context);
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
      const scoped = owned.cssAllowed && resolved.policy === "themed" && prefs.extras && plan?.policy === "themed";
      // Admission writes the scope marker on reviewed routes and the native markers on reviewed
      // subjects of the plan's islands, and strips them under forced colors on every path.
      const admission = scoped ? github.startAdmission(document, { modes: coveredModes(index, plan.seedMode) }) : null;
      // A theme's own CSS never applies under forced colors. The marker follows the mode as it
      // changes, so it holds even before the lifecycle's recompute takes GitHub native; admission
      // puts it back once they turn off.
      const gate = () => {
        if (scoped && github.forcedColorsActive(view)) root.removeAttribute(CSS_SCOPE);
      };
      const forced = view?.matchMedia?.(FORCED_COLORS);
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
          admission?.dispose();
          decoration.destroy();
        },
      };
    },
  };
}

// Whether a consent names this CSS's sanitized hash under this build's sanitizer.
function consented(css, consent) {
  if (!consent || consent.sanitizerVersion !== SANITIZER_VERSION) return false;
  const admitted = admitCss(css, "/css");
  return admitted.ok && admitted.value.hash === consent.hash && admitted.value.sanitizerVersion === SANITIZER_VERSION;
}

/**
 * The settings CssAdmission (packages/settings/admission.js) from C2b's sanitizer: a saved
 * theme's CSS is stored only when it sanitizes, and consent names its canonical hash.
 */
export const CSS_ADMISSION = Object.freeze({
  sanitizerVersion: SANITIZER_VERSION,
  inspect(document) {
    if (document?.css === undefined) return { css: null };
    const admitted = typeof document.css === "string" ? admitCss(document.css, "/css") : { ok: false, issues: [] };
    return { css: admitted.ok ? { ok: true, hash: admitted.value.hash, sanitizerVersion: admitted.value.sanitizerVersion } : { ok: false, issues: admitted.issues } };
  },
});

/**
 * The background's callbacks for settings: the boot snapshot is the selected source resolved for
 * the common page (standard seed of its base, themed, motion allowed), source repair runs against
 * the same standard seed, and saved themes' CSS goes through C2b's sanitizer.
 */
export function backgroundRendering(index = MODE_INDEX) {
  return {
    snapshot: (theme) => resolveTheme(theme, { seed: standardSeed(index, theme.base), policy: "themed", reducedMotion: false, forcedColors: false }),
    repair: (theme) => repairTheme(theme, standardSeed(index, theme.base)),
    css: CSS_ADMISSION,
  };
}

/** A picker card for a bundled or saved theme, resolved against the standard seed of its base. */
export function standardCard(entry, index = MODE_INDEX) {
  const seed = standardSeed(index, entry.document.base);
  return themeCard(entry, resolveTheme(entry.document, { seed, policy: "themed", reducedMotion: false, forcedColors: false }));
}
