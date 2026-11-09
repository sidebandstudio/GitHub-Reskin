// Browser entry for check:boot's real-engine gate timing. Bundled to an IIFE and run inside a page
// that loads extension/content/lifecycle/boot.css first, the way the manifest injects it. The
// renderer is the real engine with the synthetic seeds and a trivial stylesheet; C3/C5 rendering is
// not under test here, the lifecycle's timing is.
import { DEFAULT_THEME_ID } from "../../packages/contracts/index.js";
import { resolveTheme, sha256 } from "../../packages/engine/index.js";
import { createCatalogSource } from "../../packages/settings/index.js";
import { startContent } from "../../extension/content/lifecycle/index.js";
import choom from "../fixtures/settings/choom-circuit.reskin.json" with { type: "json" };
import dark from "../fixtures/seeds/standard-dark.json" with { type: "json" };
import light from "../fixtures/seeds/standard-light.json" with { type: "json" };

export const catalog = createCatalogSource([{ id: DEFAULT_THEME_ID, document: choom }]);
export const seeds = { dark, light };
export const snapshot = (theme) => resolveTheme(theme, { seed: seeds[theme.base], policy: "themed", reducedMotion: false, forcedColors: false });

const renderer = {
  readPage: (document, view) => ({
    native: { colorMode: document.documentElement.getAttribute("data-color-mode") },
    forcedColors: view.matchMedia("(forced-colors: active)").matches,
    reducedMotion: view.matchMedia("(prefers-reduced-motion: reduce)").matches,
  }),
  plan: (page, base) => ({ plan: { seedMode: seeds[base].id, policy: "themed" }, seed: seeds[base] }),
  resolve: resolveTheme,
  compile: (resolved, plan, prefs) => ({
    css: resolved.policy === "themed" ? `html{background:${resolved.tokens.canvas}!important}body{color:${resolved.tokens.text}!important}` : "",
    fingerprint: sha256(new TextEncoder().encode(JSON.stringify([resolved.sourceHash, resolved.seedHash, plan, prefs]))).slice(0, 16),
  }),
};

/** Starts the lifecycle against in-page storage that answers after `delay` ms, or never when null. */
export function boot(records, delay) {
  const storage = {
    get: (keys) => new Promise((resolve) => {
      if (delay === null) return;
      setTimeout(() => resolve(Object.fromEntries(keys.filter((k) => k in records).map((k) => [k, structuredClone(records[k])]))), delay);
    }),
    set: async () => {},
    remove: async () => {},
    subscribe: () => () => {},
  };
  const started = performance.now();
  const content = startContent({ storage, document, view: window, catalog, renderer });
  return { started, content };
}
