// The resolve page's entry, bundled by helpers.mjs: the preview's own resolve step (selectMode,
// repairTheme and resolveTheme, through createFixtureRenderer) over C3's Primer index.
import { configurePreview, createFixtureRenderer } from "../../../packages/preview/index.js";
import * as primer from "reskin:primer";

configurePreview({ primer, modeIndex: primer.MODE_INDEX });
const renderer = createFixtureRenderer(document);

window.timeResolves = (states) =>
  states.map((state) => {
    const started = performance.now();
    renderer.resolve(state);
    return performance.now() - started;
  });
