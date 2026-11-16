// The extension entry's builder (extension/manifests/entries.json `builder`). scripts/build.mjs
// calls build() and packages exactly the files the entry lists as `generated`:
//   - the content script, the background and the one script all extension pages share, bundled
//     from their ESM sources as IIFEs, and the content script's CSS parser chunk as a module;
//   - the bundled fonts and the preview fixture's images, copied from their repository paths.
// Three build-time modules are embedded: reskin:catalog, the validated catalog with the
// sanitizer's proofs for its CSS (catalogData), for the background and pages; reskin:catalog-index,
// every bundled theme's ID, source hash and record hash (catalogIndex), for the content script,
// which gets the one theme a page shows from storage (packages/ui/catalog.js contentCatalog); and
// reskin:cards, each theme's labels and miniature colors resolved against its standard seed.
// The background and the pages carry the full format entry with C2b's css-tree sanitizer: a saved
// theme can hold Advanced CSS or a gradientCss layer, and settings validation there checks it. The
// content script carries the sanitizer without css-tree, and imports content/css-parser.js (web
// accessible to GitHub's two origins only) the first time the saved theme a page shows has CSS the
// build did not prove. Bundled CSS is admitted from the proofs everywhere.
// The background and pages have whitespace and syntax minified, names kept, so the artifact scan
// still finds the preview's one packaged-file read by its reviewed text; the content script and
// the parser chunk, which a GitHub page compiles, are minified fully. Minified output carries no
// module path comments, and dependencies resolve through their symlinked path, so a rebuild from
// the source archive, whose node_modules is a link, writes the same bytes.
// The background and the pages carry Primer's mode data (vendor/primer/modes.json, about 700 KB)
// deflated, and inflate it once when they load; the content script keeps it as plain data, so a
// GitHub page never waits on that. Compression uses fflate, a pinned pure-JS dependency the format
// entry already ships, so the bytes never depend on the machine's zlib.
// Reads only checked-in files and lockfile-installed packages; same inputs, same bytes.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strToU8, zlibSync } from "fflate";
import { cssProofs } from "../format/authoring.js";
import { createCatalogSource } from "../settings/catalog.js";
import { catalogRecord, recordHash } from "./catalog.js";
import { standardCard } from "./renderer.js";

export const BUNDLES = Object.freeze({
  "content.js": "extension/content/index.mjs",
  "content/css-parser.js": "extension/content/css-parser.mjs",
  "background.js": "extension/pages/background.mjs",
  "pages/pages.js": "extension/pages/main.mjs",
});
const PACKED_MODES = Object.freeze(["background.js", "pages/pages.js"]);
// What a GitHub page compiles, minified fully. The parser chunk is a module the content script imports.
const MINIFIED = Object.freeze(["content.js", "content/css-parser.js"]);
const MODULES = Object.freeze(["content/css-parser.js"]);
// Bundled without packages/format/authoring.js, which would bring css-tree: the content script
// installs the sanitizer itself, with css-tree from the parser chunk.
const VIEWER_ONLY = Object.freeze(["content.js"]);

// Resolves packages/format/authoring.js to an empty module. The format and engine entries import it
// for its side effect of installing the sanitizer; anything that imports one of its names instead
// fails to bundle.
function withoutAuthoring(root) {
  const authoring = resolve(root, "packages/format/authoring.js");
  return {
    name: "reskin-without-authoring",
    setup(build) {
      build.onResolve({ filter: /(^|[\\/])authoring\.js$/ }, (args) => (resolve(args.resolveDir, args.path) === authoring ? { path: "authoring", namespace: "reskin-empty" } : null));
      build.onLoad({ filter: /.*/, namespace: "reskin-empty" }, () => ({ contents: "", loader: "js" }));
    },
  };
}

/** The mode data as a module that inflates its deflated, base64 JSON when it loads. */
export function packedModesModule(json) {
  const packed = Buffer.from(zlibSync(strToU8(JSON.stringify(JSON.parse(json))), { level: 9 })).toString("base64");
  return [
    'import { strFromU8, unzlibSync } from "fflate";',
    `const packed = atob(${JSON.stringify(packed)});`,
    "const bytes = new Uint8Array(packed.length);",
    "for (let i = 0; i < packed.length; i++) bytes[i] = packed.charCodeAt(i);",
    "export default JSON.parse(strFromU8(unzlibSync(bytes)));",
  ].join("\n");
}

function packModes(root) {
  return {
    name: "reskin-packed-modes",
    setup(build) {
      build.onLoad({ filter: /[\\/]vendor[\\/]primer[\\/]modes\.json$/ }, async (args) => ({ contents: packedModesModule(await readFile(args.path, "utf8")), loader: "js", resolveDir: root }));
    },
  };
}

const readJson = async (root, path) => JSON.parse(await readFile(join(root, path), "utf8"));

/** The catalog's entries in display order, read from themes/catalog.json. */
export async function readCatalogEntries(root) {
  const catalog = await readJson(root, "themes/catalog.json");
  const ordered = [...catalog].sort((a, b) => (a.group === b.group ? a.order - b.order : a.group === "anime" ? -1 : 1));
  return Promise.all(ordered.map(async ({ id, group, file }) => ({ id, group, document: await readJson(root, file) })));
}

/**
 * The catalog data the runtime embeds (catalogFromData), from entries in display order: each
 * document validated by createCatalogSource, its source hash, and the sanitizer's proofs for
 * every bundled css and gradientCss text, each theme's at its [start, end) in proofRanges.
 * @param {{id:string, group:string, document:object}[]} entries
 */
export function catalogData(entries) {
  const source = createCatalogSource(entries);
  const proofs = source.ids.map((id) => cssProofs([source.document(id)]));
  let at = 0;
  return {
    hash: source.hash,
    ids: [...source.ids],
    hashes: Object.fromEntries(source.ids.map((id) => [id, source.sourceHash(id)])),
    documents: Object.fromEntries(source.ids.map((id) => [id, source.document(id)])),
    cssProofs: proofs.flat(),
    proofRanges: Object.fromEntries(source.ids.map((id, i) => [id, [at, (at += proofs[i].length)]])),
  };
}

/** The content script's index of catalogData (contentCatalog): IDs, source hashes and record hashes. */
export const catalogIndex = (data) => ({
  hash: data.hash,
  ids: [...data.ids],
  hashes: { ...data.hashes },
  records: Object.fromEntries(data.ids.map((id) => [id, recordHash(catalogRecord(data, id))])),
});

/** Each theme's picker card, resolved against the standard seed of its base. */
export const catalogCards = (entries) => entries.map((entry) => standardCard(entry));

function virtualModules(modules) {
  return {
    name: "reskin-virtual",
    setup(build) {
      build.onResolve({ filter: /^reskin:/ }, (args) => (Object.hasOwn(modules, args.path) ? { path: args.path, namespace: "reskin" } : null));
      build.onLoad({ filter: /.*/, namespace: "reskin" }, (args) => ({ contents: `export default ${JSON.stringify(modules[args.path])};`, loader: "js" }));
    },
  };
}

async function bundle(root, entry, modules, { packed = false, minified = false, module = false, plugins = [] } = {}) {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: root,
    bundle: true,
    format: module ? "esm" : "iife",
    platform: "browser",
    target: ["chrome120", "firefox140"],
    charset: "utf8",
    legalComments: "inline",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: minified,
    preserveSymlinks: true,
    write: false,
    logLevel: "silent",
    plugins: [...plugins, virtualModules(modules), ...(packed ? [packModes(root)] : [])],
  });
  return Buffer.from(result.outputFiles[0].contents);
}

const options = (root, path) => ({ packed: PACKED_MODES.includes(path), minified: MINIFIED.includes(path), module: MODULES.includes(path), plugins: VIEWER_ONLY.includes(path) ? [withoutAuthoring(root)] : [] });

async function embeddedModules(root) {
  const entries = await readCatalogEntries(root);
  const data = catalogData(entries);
  return { "reskin:catalog": data, "reskin:catalog-index": catalogIndex(data), "reskin:cards": catalogCards(entries) };
}

/**
 * One of BUNDLES as build() makes it, with `plugins` first. check:budgets measures content.js
 * this way with the mode data left out, and the parser chunk as it ships.
 * @returns {Promise<Buffer>}
 */
export async function bundleFile(root, path, { plugins = [] } = {}) {
  const own = options(root, path);
  return bundle(root, BUNDLES[path], await embeddedModules(root), { ...own, plugins: [...plugins, ...own.plugins] });
}

/**
 * @param {{root:string, entry:{generated:string[]}}} options
 * @returns {Promise<Record<string, Buffer>>} every generated path's bytes
 */
export async function build({ root, entry }) {
  const modules = await embeddedModules(root);
  const files = {};
  for (const path of entry.generated) {
    if (Object.hasOwn(BUNDLES, path)) files[path] = await bundle(root, BUNDLES[path], modules, options(root, path));
    else if (/^(assets\/fonts|packages\/preview\/fixture\/assets)\//.test(path)) files[path] = await readFile(join(root, path));
    else throw new Error(`packages/ui/bundle.mjs does not generate ${path}`);
  }
  return files;
}
