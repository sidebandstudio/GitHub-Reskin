// Fixture app entry, bundled by build.mjs. Four pages share it:
//   preview.html      window.reskinPreview drives one mountPreview handle.
//   views.html        window.reskinViews paints a view straight into the page for axe.
//   any page          window.reskinRaster converts local images as the theme builder will.
//   adversarial.html  window.reskinNative applies a theme the way the GitHub content adapter
//                     does: compiled CSS in one owned style node plus mountAppearance at located
//                     slot anchors, on a page full of authored text and native controls.
//   C3's profile page window.reskinGithub does the same with C3's real locateSlots, when the
//                     tests serve C3's fixture as github.com and C3 is in the checkout.
import { compileAppearance, convertRaster, createRasterQueue, imageAssets, mountAppearance, roleFontFaceCss, siteResources } from "../../../packages/appearance/index.js";
import { rasterInfo, rasterSourceInfo } from "../../../packages/format/viewer.js";
import { repairTheme, resolveTheme } from "../../../packages/engine/index.js";
import { FIXTURE_CSS, PREVIEW_VARIABLES, colorAt, configurePreview, createFixtureRenderer, mountPreview, nativeBaseline, serializeFixture } from "../../../packages/preview/index.js";
import * as github from "reskin:github";
import * as primer from "reskin:primer";
import { artTheme, paintArt } from "./art.js";
import { hostileAnchors, locateSlots } from "./locator.js";

const resources = siteResources("/");
const params = new URLSearchParams(location.search);
const index = primer.MODE_INDEX;
// ?slots=all shows every slot the view has, dormant ones included, for appearance tests.
// Otherwise the dormant slots are C3's evidence-derived list.
const dormantSlots = params.get("slots") === "all" ? [] : github.dormantSlots();
configurePreview({ primer, modeIndex: index, resources, dormantSlots });
window.reskinAdapters = { primer: index.modes.dark ? "c3" : "double", github: github.available !== false };

const standard = (base) => Object.values(index.modes).find((m) => m.family === "standard" && m.base === base && !m.highContrast && m.id === base) ?? Object.values(index.modes).find((m) => m.family === "standard" && m.base === base && !m.highContrast);

function resolveFor(theme) {
  const seed = standard(theme.base);
  const light = standard("light").id;
  const dark = standard("dark").id;
  const plan = primer.selectMode({ colorMode: theme.base, lightTheme: light, darkTheme: dark, systemDark: theme.base === "dark" }, theme.base, index);
  const resolved = resolveTheme(repairTheme(theme, seed).theme, {
    seed: plan.seedMode ? index.modes[plan.seedMode] : null,
    policy: plan.policy,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    forcedColors: matchMedia("(forced-colors: active)").matches,
  });
  return { plan, resolved, seed };
}

let handle = null;
window.reskinPreview = {
  mount(options) {
    handle?.destroy();
    const states = [];
    handle = mountPreview(document.getElementById("preview"), { ...options, onState: (state) => states.push({ policy: state.policy, repairs: state.repairs.length }) });
    window.reskinPreview.states = states;
    return true;
  },
  update: (options) => handle.update(options),
  setView: (view) => handle.setView(view),
  setBefore: (before) => handle.setBefore(before),
  destroy: () => {
    handle?.destroy();
    handle = null;
  },
  /** mountPreview itself, for tests that hold their own handles. */
  mountPreview,
  /** The styled frame's complete srcdoc, as the host page holds it. */
  srcdoc: () => document.querySelector("#preview iframe:not([aria-hidden])")?.srcdoc ?? null,
  /**
   * The value each preview variable should have: the adapter's emitted color in After, the
   * standard seed's native color in Before.
   */
  expected(theme, before) {
    const { resolved, seed } = resolveFor(theme);
    if (before) return Object.fromEntries(Object.entries(PREVIEW_VARIABLES).map(([name, path]) => [name, colorAt(seed.colors, path)]));
    return Object.fromEntries(primer.emittedColors(resolved));
  },
};

window.reskinSerialize = { serializeFixture };

// The builder's local image conversion, run in the page with the browser's own decoder.
window.reskinRaster = { convertRaster, createRasterQueue, rasterInfo, rasterSourceInfo };
window.reskinArt = { paintArt, artTheme };

let renderer = null;
window.reskinViews = {
  render(state, options) {
    renderer ??= createFixtureRenderer(document);
    const { resolved } = renderer.paint({ before: false, ...state }, options);
    return { policy: resolved.policy, sourceHash: resolved.sourceHash };
  },
};

// The content host's part: compiled CSS in one owned style node, the CSS scope marker on the root
// when the theme's admitted CSS may apply, then owned nodes at located anchors.
function applyTheme(theme, prefs, anchors, { play = false, extraCss = "", cssAllowed = false } = {}) {
  const { plan, resolved } = resolveFor(theme);
  const style = document.createElement("style");
  style.setAttribute("data-reskin-style", "");
  const faces = prefs.enabled && prefs.fonts && resolved.policy === "themed" ? roleFontFaceCss(resolved, resources) : "";
  const owned = { css: theme.css ?? null, cssAllowed };
  const images = imageAssets(theme);
  style.textContent = [extraCss, primer.compileGitHub(resolved, plan, prefs).css, faces, compileAppearance(resolved, prefs, "github", { ...owned, images })].join("\n");
  document.head.append(style);
  if (cssAllowed && resolved.policy === "themed") document.documentElement.setAttribute("data-reskin-css", "active");
  const decoration = mountAppearance(document.body, resolved, prefs, anchors(), owned);
  if (play) decoration.play();
  return { resolved, style, decoration };
}

let applied = null;
window.reskinNative = {
  // GitHub's own baseline before any theme: the fixture layout and native mode CSS.
  boot() {
    const style = document.createElement("style");
    style.id = "native-baseline";
    style.textContent = FIXTURE_CSS + nativeBaseline(index, standard(document.documentElement.getAttribute("data-color-mode")).id);
    document.head.append(style);
  },
  apply(theme, prefs, { play = false, hostile = false, cssAllowed = false } = {}) {
    window.reskinNative.remove();
    let count = 0;
    const anchors = () => {
      const found = hostile ? hostileAnchors(document) : locateSlots(document);
      count = found.length;
      return found;
    };
    const { resolved, style, decoration } = applyTheme(theme, prefs, anchors, { play, cssAllowed });
    applied = { style, decoration };
    return { sourceHash: resolved.sourceHash, seedHash: resolved.seedHash, policy: resolved.policy, owned: decoration.owned, animated: decoration.animated, anchors: count };
  },
  play: () => applied?.decoration.play() ?? false,
  remove() {
    applied?.decoration.destroy();
    applied?.style.remove();
    document.documentElement.removeAttribute("data-reskin-css");
    applied = null;
  },
};

// C3's guarded profile fixture has GitHub's markup but none of its stylesheet; this is the
// minimum layout for its sidebar, main column and names.
const C3_LAYOUT = "main{padding:20px}.Layout{display:grid;grid-template-columns:256px minmax(0,1fr);gap:24px}.Layout-sidebar,.Layout-main{min-width:0}.js-profile-editable-names{position:relative}.sr-only,[hidden]{display:none}";
let real = null;
window.reskinGithub = {
  available: github.available !== false,
  // A page that brings its own layout (layout: false) gets only GitHub's native mode colors.
  apply(theme, prefs, { cssAllowed = false, layout = true } = {}) {
    window.reskinGithub.remove();
    let found = [];
    const anchors = () => {
      found = github.locateSlots(document, github.classifyRoute(document));
      return found;
    };
    const native = nativeBaseline(index, standard(theme.base).id);
    const { resolved, style, decoration } = applyTheme(theme, prefs, anchors, { extraCss: layout ? FIXTURE_CSS + native + C3_LAYOUT : native, cssAllowed });
    real = { style, decoration };
    return {
      policy: resolved.policy,
      anchors: found.map((a) => ({ slot: a.slot, insert: a.insert })),
      slots: [...document.querySelectorAll("[data-reskin-owned]:not([data-reskin-slot])")].map((n) => n.getAttribute("data-reskin-owned")),
      owned: decoration.owned,
    };
  },
  remove() {
    real?.decoration.destroy();
    real?.style.remove();
    document.documentElement.removeAttribute("data-reskin-css");
    real = null;
  },
};
