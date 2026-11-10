// Module wiring shared by the site's two bundlers: Vite (Astro) for the pages and esbuild for the
// build-time preview captures. Both bundle the same client modules, so a capture is what a visitor's
// browser renders.
//
// - The format and engine full entries install the css-tree sanitizer as a side effect. Inside
//   packages/** they resolve to the viewer entries, so the landing pages never carry the parser.
//   Bundled CSS is admitted through build-time proofs instead, and pages that import or edit a
//   theme load packages/format/authoring.js themselves.
// - "reskin:themes" is every bundled theme document by slug plus the sanitizer's proofs for their
//   CSS, made at build time from themes/catalog.json. Only the lazily loaded live preview imports it.
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACKAGES = resolve(ROOT, "packages") + sep;
const FULL_ENTRIES = new Map([
  [resolve(ROOT, "packages/format/index.js"), resolve(ROOT, "packages/format/viewer.js")],
  [resolve(ROOT, "packages/engine/index.js"), resolve(ROOT, "packages/engine/viewer.js")],
]);
export const THEMES_MODULE = "reskin:themes";

/** The viewer entry a package-internal import of a full entry resolves to, or null. */
export function viewerFor(source, importer) {
  if (!importer || !source.startsWith(".") || !resolve(importer).startsWith(PACKAGES)) return null;
  return FULL_ENTRIES.get(resolve(dirname(importer), source)) ?? null;
}

/** Source of the reskin:themes module. */
export async function themesModuleSource() {
  const { CATALOG, CSS_PROOFS } = await import("./src/catalog.mjs");
  const docs = Object.fromEntries(CATALOG.map((theme) => [theme.slug, theme.doc]));
  return `export const DOCS = ${JSON.stringify(docs)};\nexport const CSS_PROOFS = ${JSON.stringify(CSS_PROOFS)};\n`;
}

/** The Vite plugin. */
export function vitePlugin() {
  const id = `\0${THEMES_MODULE}`;
  return {
    name: "reskin-modules",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === THEMES_MODULE) return id;
      return viewerFor(source, importer?.split("?")[0]);
    },
    load(loaded) {
      return loaded === id ? themesModuleSource() : null;
    },
  };
}

/** The esbuild plugin. */
export function esbuildPlugin() {
  return {
    name: "reskin-modules",
    setup(build) {
      build.onResolve({ filter: /^reskin:themes$/ }, () => ({ path: THEMES_MODULE, namespace: "reskin" }));
      build.onLoad({ filter: /.*/, namespace: "reskin" }, async () => ({ contents: await themesModuleSource(), loader: "js", resolveDir: ROOT }));
      build.onResolve({ filter: /(format|engine)\/index\.js$/ }, (args) => {
        const path = viewerFor(args.path, args.importer);
        return path ? { path } : undefined;
      });
    },
  };
}
