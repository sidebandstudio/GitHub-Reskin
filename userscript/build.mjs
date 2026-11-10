// Generates github-reskin.user.js from the product packages: release.config.json's
// `userscript.builder` is scripts/userscript.mjs, which delegates here, and scripts/build.mjs calls
// build() for the userscript target. One esbuild IIFE of userscript/main.mjs with the same
// build-time modules as the extension (packages/ui/bundle.mjs: the validated catalog with its CSS
// proofs, and the picker cards), the format/engine viewer entries, every bundled font as base64,
// the boot gate CSS and the popup's card for the frame. No @require, no remote @icon, nothing
// fetched at runtime. Reads only checked-in files and lockfile-installed packages; same inputs,
// same bytes.
//   node userscript/build.mjs            writes dist/userscript/github-reskin.user.js
// The site build publishes the same script at <site>/downloads/, its @updateURL.
import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FONTS } from "../packages/appearance/registry.js";
import { catalogCards, catalogData, readCatalogEntries } from "../packages/ui/bundle.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Where the build writes the script. Pages serves it at updateUrl().
export const OUTPUT = "dist/userscript/github-reskin.user.js";
// A frozen copy, not regenerated. The first userscript checks this path on main for updates, and
// this copy's @updateURL moves those installs to the Pages download.
export const BRIDGE = "userscript/github-reskin.user.js";
export const ENTRY = "userscript/main.mjs";
export const MATCHES = Object.freeze(["https://github.com/*", "https://gist.github.com/*"]);
export const GRANTS = Object.freeze([
  "GM.getValue",
  "GM.setValue",
  "GM.deleteValue",
  "GM.registerMenuCommand",
  "GM_getValue",
  "GM_setValue",
  "GM_deleteValue",
  "GM_addValueChangeListener",
  "GM_removeValueChangeListener",
  "GM_registerMenuCommand",
  "GM_unregisterMenuCommand",
]);
// The budget from ARCHITECTURE.md: the userscript, embedded fonts included.
export const MAX_BYTES = 3.5 * 1024 * 1024;
const VIEWER_ENTRIES = { "packages/format/index.js": "packages/format/viewer.js", "packages/engine/index.js": "packages/engine/viewer.js" };
const PRIMER_NOTICE = "licenses/primer-primitives.txt";

// Checkouts can have either line ending, so text is always read with LF.
const readText = async (root, path) => (await readFile(join(root, path), "utf8")).replace(/\r\n/g, "\n");
const readJson = async (root, path) => JSON.parse(await readText(root, path));

/** The address managers check for updates: the copy the site build publishes. */
export const updateUrl = (config) => `${config.site.origin}${config.site.base}/downloads/${config.userscript.output}`;

/** The base64 WOFF2 of every bundled font file, keyed as embeddedResources expects. */
export async function embeddedFonts(root = ROOT) {
  const fonts = {};
  for (const font of FONTS) {
    for (const file of font.files) fonts[file.path.split("/").pop().replace(/\.woff2$/, "")] = (await readFile(join(root, file.path))).toString("base64");
  }
  return fonts;
}

// Replaces exactly one occurrence, so a change to the popup's markup fails the build instead of
// shipping a card without its Close button or storage note.
function replaceOnce(text, find, replacement, what) {
  const at = text.indexOf(find);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`extension/pages/popup.html: expected one ${what}`);
  return text.slice(0, at) + replacement + text.slice(at + find.length);
}

/**
 * The frame's document: the popup's body with the mark inlined, a Close button, the storage note
 * with Export in place of the Settings link, and ui.css, popup.css and frame.css inline.
 */
export async function cardDocument(root = ROOT) {
  const popup = await readText(root, "extension/pages/popup.html");
  const body = /<body([^>]*)>([\s\S]*)<\/body>/.exec(popup);
  if (!body) throw new Error("extension/pages/popup.html has no body");
  const mark = (await readText(root, "extension/pages/icon.svg"))
    .trim()
    .replace(/ role="img" aria-labelledby="title desc"/, ' class="rs-mark" aria-hidden="true" focusable="false"')
    .replace(/<title[^>]*>[\s\S]*?<\/title>|<desc[^>]*>[\s\S]*?<\/desc>/g, "")
    .replace(/width="16" height="16"/, 'width="28" height="28"');
  if (!/^<svg [^>]*class="rs-mark" aria-hidden="true"/.test(mark)) throw new Error("extension/pages/icon.svg changed shape; update cardDocument");
  let html = body[2];
  html = replaceOnce(html, '<img class="rs-mark" src="icon.svg" alt="" width="28" height="28" />', mark, "mark image");
  html = replaceOnce(html, "</header>", '  <button type="button" class="us-close" data-us="close" aria-label="Close GitHub Reskin"><span aria-hidden="true">×</span></button>\n    </header>', "header");
  html = replaceOnce(html, '<button type="button" class="rs-link-button" data-rs-open="settings">Settings</button>', "", "Settings link");
  html = replaceOnce(
    html,
    '<footer class="rs-popup-footer">',
    `<section class="us-storage" aria-label="Saving">
      <span class="us-session-label" data-us="session-label" hidden></span>
      <p class="rs-note" data-us="storage-note"></p>
      <div class="us-storage-row">
        <button type="button" class="rs-link-button" data-us="export">Export theme file</button>
        <p class="rs-status" role="status" aria-live="polite" data-us="status"></p>
      </div>
    </section>

    <footer class="rs-popup-footer">`,
    "footer",
  );
  const css = (await Promise.all(["extension/pages/ui.css", "extension/pages/popup.css", "userscript/frame.css"].map((path) => readText(root, path)))).join("\n");
  if (/<\/style/i.test(css)) throw new Error("The card stylesheet would end its style element early");
  const srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GitHub Reskin</title><style>${css}</style></head><body${body[1]}>${html}</body></html>`;
  return { srcdoc };
}

/** Each upstream notice the script embeds: Primer's, and the OFL of every embedded font. */
export async function notices(root = ROOT) {
  const files = [PRIMER_NOTICE, ...FONTS.map((font) => `assets/fonts/${font.id}/OFL.txt`)];
  return Promise.all(
    files.map(async (file) => {
      const text = await readText(root, file);
      if (text.includes("*/")) throw new Error(`${file} would end its comment early`);
      return { file, text };
    }),
  );
}

function plugins(root, modules) {
  const swap = Object.fromEntries(Object.entries(VIEWER_ENTRIES).map(([from, to]) => [resolve(root, from), resolve(root, to)]));
  return [
    {
      name: "reskin-virtual",
      setup(build) {
        build.onResolve({ filter: /^reskin:/ }, (args) => (Object.hasOwn(modules, args.path) ? { path: args.path, namespace: "reskin" } : null));
        build.onLoad({ filter: /.*/, namespace: "reskin" }, (args) => ({ contents: `export default ${JSON.stringify(modules[args.path])};`, loader: "js" }));
      },
    },
    {
      // The runtime takes the parser-free viewer entries, as the extension does.
      name: "reskin-viewer-entries",
      setup(build) {
        build.onResolve({ filter: /\/index\.js$/ }, (args) => {
          const path = resolve(args.resolveDir, args.path);
          return Object.hasOwn(swap, path) ? { path: swap[path] } : null;
        });
      },
    },
  ];
}

async function bundle(root, modules) {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [ENTRY],
    absWorkingDir: root,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome120", "firefox140", "safari17"],
    charset: "utf8",
    legalComments: "inline",
    write: false,
    logLevel: "silent",
    plugins: plugins(root, modules),
  });
  return result.outputFiles[0].text;
}

/** The metadata block. */
export function metadata(config, { icon, description }) {
  const repo = config.support.source;
  const update = updateUrl(config);
  const lines = [
    ["name", config.displayName],
    ["namespace", repo],
    ["version", config.version],
    ["description", description],
    ["license", "MIT"],
    ["homepageURL", repo],
    ["supportURL", config.support.issues],
    ["icon", `data:image/png;base64,${icon}`],
    ...MATCHES.map((match) => ["match", match]),
    ["run-at", "document-start"],
    ["inject-into", "content"],
    ["sandbox", "DOM"],
    ["noframes", ""],
    ...GRANTS.map((grant) => ["grant", grant]),
    ["downloadURL", update],
    ["updateURL", update],
  ];
  return `// ==UserScript==\n${lines.map(([key, value]) => `// @${key.padEnd(12)} ${value}`.trimEnd()).join("\n")}\n// ==/UserScript==\n`;
}

/** @returns {Promise<string>} the userscript */
export async function build({ root = ROOT } = {}) {
  const config = await readJson(root, "release.config.json");
  const base = await readJson(root, "extension/manifests/base.json");
  const entries = await readCatalogEntries(root);
  const modules = {
    "reskin:catalog": catalogData(entries),
    "reskin:cards": catalogCards(entries),
    "reskin:fonts": await embeddedFonts(root),
    "reskin:card": await cardDocument(root),
    "reskin:boot": await readText(root, "extension/content/lifecycle/boot.css"),
  };
  const icon = (await readFile(join(root, "extension/pages/icons/icon-32.png"))).toString("base64");
  const notice = (await notices(root)).map(({ file, text }) => `/* ${file}\n\n${text.endsWith("\n") ? text : `${text}\n`}*/\n`).join("");
  const code = await bundle(root, modules);
  return `${metadata(config, { icon, description: base.description })}// Generated by userscript/build.mjs from the GitHub Reskin packages. Do not edit by hand.\n${notice}${code}`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const script = await build();
  await mkdir(join(ROOT, "dist/userscript"), { recursive: true });
  await writeFile(join(ROOT, OUTPUT), script);
  console.log(`Wrote ${OUTPUT}: ${script.length} characters, ${Buffer.byteLength(script)} bytes`);
}
