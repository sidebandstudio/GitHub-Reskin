// Astro static site for GitHub Pages. site/build.mjs passes outDir; origin and base come from
// release.config.json so every path is base-aware.
import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";

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
});
