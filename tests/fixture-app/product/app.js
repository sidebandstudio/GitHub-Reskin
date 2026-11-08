// Fixture app entry, bundled by build.mjs. Three pages share it:
//   preview.html      window.reskinPreview drives one mountPreview handle.
//   views.html        window.reskinViews paints a view straight into the page for axe.
//   adversarial.html  window.reskinNative applies a theme the way the GitHub content adapter
//                     does: compiled CSS in one owned style node plus mountAppearance at located
//                     slot anchors, on a page full of authored text and native controls.
import { compileAppearance, fontFaceCss, mountAppearance, siteResources } from "../../../packages/appearance/index.js";
import { repairTheme, resolveTheme } from "../../../packages/engine/index.js";
import { FIXTURE_CSS, configurePreview, createFixtureRenderer, mountPreview } from "../../../packages/preview/index.js";
import { hostileAnchors, locateSlots } from "./locator.js";
import * as primer from "./primer-double.js";

const resources = siteResources("/");
const params = new URLSearchParams(location.search);
// ?slots=all shows every slot the view has, dormant ones included, for appearance tests.
const dormantSlots = params.get("slots") === "all" ? [] : undefined;
configurePreview({ primer, modeIndex: primer.modeIndex, resources, dormantSlots });

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
  frame: () => document.querySelector("#preview iframe")?.contentDocument ?? null,
};

let renderer = null;
window.reskinViews = {
  render(state, options) {
    renderer ??= createFixtureRenderer(document);
    const { resolved } = renderer.paint({ before: false, ...state }, options);
    return { policy: resolved.policy, sourceHash: resolved.sourceHash };
  },
};

let applied = null;
window.reskinNative = {
  // GitHub's own baseline before any theme: the fixture layout and native mode CSS.
  boot() {
    const style = document.createElement("style");
    style.id = "native-baseline";
    const base = document.documentElement.getAttribute("data-color-mode");
    const id = Object.keys(primer.modeIndex.modes).find((m) => primer.modeIndex.modes[m].family === "standard" && primer.modeIndex.modes[m].base === base);
    style.textContent = FIXTURE_CSS + primer.modeIndex.nativeCss[id];
    document.head.append(style);
  },
  apply(theme, prefs, { play = false, hostile = false } = {}) {
    window.reskinNative.remove();
    const index = primer.modeIndex;
    const standard = Object.values(index.modes).find((m) => m.family === "standard" && m.base === theme.base);
    const plan = primer.selectMode({ colorMode: theme.base, lightTheme: standard.base === "light" ? standard.id : "", darkTheme: standard.base === "dark" ? standard.id : "", systemDark: theme.base === "dark" }, theme.base, index);
    const resolved = resolveTheme(repairTheme(theme, standard).theme, {
      seed: index.modes[plan.seedMode],
      policy: plan.policy,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      forcedColors: matchMedia("(forced-colors: active)").matches,
    });
    const style = document.createElement("style");
    style.setAttribute("data-reskin-style", "");
    const fontUrl = prefs.enabled && prefs.extras && prefs.fonts && resolved.policy === "themed" ? resources.fontUrl(resolved.font) : null;
    style.textContent = [primer.compileGitHub(resolved, plan, prefs).css, fontUrl ? fontFaceCss(resolved.font, fontUrl) : "", compileAppearance(resolved, prefs, "github")].join("\n");
    document.head.append(style);
    const anchors = hostile ? hostileAnchors(document) : locateSlots(document);
    const decoration = mountAppearance(document.body, resolved, prefs, anchors);
    if (play) decoration.play();
    applied = { style, decoration };
    return { sourceHash: resolved.sourceHash, seedHash: resolved.seedHash, policy: resolved.policy, owned: decoration.owned, animated: decoration.animated, anchors: anchors.length };
  },
  play: () => applied?.decoration.play() ?? false,
  remove() {
    applied?.decoration.destroy();
    applied?.style.remove();
    applied = null;
  },
};
