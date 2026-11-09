// Astro static site for GitHub Pages. site/build.mjs passes outDir; origin and base come from
// release.config.json so every path is base-aware. site/modules.mjs resolves the format and engine
// to their viewer entries inside packages/** and provides the bundled themes to the live preview.
import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import { vitePlugin } from "./modules.mjs";

const release = JSON.parse(readFileSync(new URL("../release.config.json", import.meta.url), "utf8"));

export default defineConfig({
  site: release.site.origin,
  base: `${release.site.base.replace(/\/+$/, "")}/`,
  trailingSlash: "always",
  output: "static",
  build: { format: "directory", assets: "_assets", inlineStylesheets: "never" },
  compressHTML: true,
  devToolbar: { enabled: false },
  server: { host: "0.0.0.0", port: 4321 },
  vite: {
    plugins: [vitePlugin()],
    // The live preview chunk carries the full Primer ModeIndex; it loads only on intent.
    build: { sourcemap: false, modulePreload: { polyfill: false }, chunkSizeWarningLimit: 1024 },
  },
});
