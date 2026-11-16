// Generates github-reskin.user.js from the product packages: release.config.json's
// `userscript.builder` is scripts/userscript.mjs, which delegates here, and scripts/build.mjs calls
// build() for the userscript target. One esbuild IIFE of userscript/main.mjs with the same
// build-time modules as the extension (packages/ui/bundle.mjs: the validated catalog with its CSS
// proofs, and the picker cards), the format/engine viewer entries, every bundled font as base64,
// the boot gate CSS, the popup's card and the settings page's builder for the frame, and the
// preview fixture's images. No @require, no remote @icon, nothing
// fetched at runtime. Reads only checked-in files and lockfile-installed packages; same inputs,
// same bytes.
//   node userscript/build.mjs            writes dist/userscript/github-reskin.user.js
// The site build publishes the same script at <site>/downloads/, its @updateURL.
import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FONTS } from "../packages/appearance/registry.js";
import { catalogCards, catalogData, readCatalogEntries } from "../packages/ui/bundle.mjs";
import { CSS_NOTE, IMPORT_CSS_NOTE } from "./copy.js";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Where the build writes the script. Pages serves it at updateUrl().
export const OUTPUT = "dist/userscript/github-reskin.user.js";
// A frozen copy, not regenerated. The first userscripts check this path on main for updates, and
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

// Replaces exactly one occurrence, so a change to the extension's markup fails the build instead of
// shipping a card without its Close button or storage note, or a builder with a CSS Enable control.
function replaceOnce(text, find, replacement, what, file = "extension/pages/popup.html") {
  const at = text.indexOf(find);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`${file}: expected one ${what}`);
  return text.slice(0, at) + replacement + text.slice(at + find.length);
}

// The extension's mark, inline and decorative, so the frame loads no image.
async function inlineMark(root) {
  const mark = (await readText(root, "extension/pages/icon.svg"))
    .trim()
    .replace(/ role="img" aria-labelledby="title desc"/, ' class="rs-mark" aria-hidden="true" focusable="false"')
    .replace(/<title[^>]*>[\s\S]*?<\/title>|<desc[^>]*>[\s\S]*?<\/desc>/g, "")
    .replace(/width="16" height="16"/, 'width="28" height="28"');
  if (!/^<svg [^>]*class="rs-mark" aria-hidden="true"/.test(mark)) throw new Error("extension/pages/icon.svg changed shape; update inlineMark");
  return mark;
}

async function frameCss(root, files) {
  const css = (await Promise.all(files.map((path) => readText(root, path)))).join("\n");
  if (/<\/style/i.test(css)) throw new Error("The frame stylesheet would end its style element early");
  return css;
}
const frameHtml = (title, css, bodyAttributes, html) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css}</style></head><body${bodyAttributes}>${html}</body></html>`;

/**
 * The frame's card document: the popup's body with the mark inlined, a Close button, the storage
 * note with Export, and Make a theme and Backup & help in place of the Settings link, with ui.css,
 * popup.css and frame.css inline.
 */
export async function cardDocument(root = ROOT) {
  const popup = await readText(root, "extension/pages/popup.html");
  const body = /<body([^>]*)>([\s\S]*)<\/body>/.exec(popup);
  if (!body) throw new Error("extension/pages/popup.html has no body");
  let html = body[2];
  html = replaceOnce(html, '<img class="rs-mark" src="icon.svg" alt="" width="28" height="28" />', await inlineMark(root), "mark image");
  html = replaceOnce(html, "</header>", '  <button type="button" class="us-close" data-us="close" aria-label="Close GitHub Reskin"><span aria-hidden="true">×</span></button>\n    </header>', "header");
  html = replaceOnce(
    html,
    '<button type="button" class="rs-link-button" data-rs-open="settings">Settings</button>',
    '<span class="us-pages"><button type="button" class="rs-link-button" data-us="make">Make a theme</button>\n      <button type="button" class="rs-link-button" data-us="backup">Backup &amp; help</button></span>',
    "Settings link",
  );
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
  const css = await frameCss(root, ["extension/pages/ui.css", "extension/pages/popup.css", "userscript/frame.css"]);
  return { srcdoc: frameHtml("GitHub Reskin", css, body[1], html) };
}

// Where the settings page offers to enable a theme's Advanced CSS, the userscript says CSS_NOTE and
// IMPORT_CSS_NOTE (copy.js). No Enable control is left: the builder's own CSS and import dialog
// parts stay, as inert, hidden inputs the builder can read, and no person can reach.
const HIDDEN_ENABLE = (part) => `<input type="checkbox" data-rb="${part}" hidden disabled inert tabindex="-1" aria-hidden="true" />`;

// The section of settings.html that starts at `open` and ends just before `next`.
function section(html, open, next) {
  const start = html.indexOf(open);
  const end = html.indexOf(next, start + 1);
  if (start < 0 || end < 0 || html.indexOf(open, start + 1) >= 0) throw new Error(`extension/pages/settings.html: expected one ${open}`);
  return html.slice(start, end).trimEnd();
}

/**
 * The builder's frame document: settings.html's Make a theme and Backup & help sections under the
 * frame's own header, with a Themes button back to the card, the storage note, and the Advanced
 * CSS parts that would ask for approval replaced by CSS_NOTE and IMPORT_CSS_NOTE. ui.css, page.css
 * and frame.css inline.
 */
export async function builderDocument(root = ROOT) {
  const file = "extension/pages/settings.html";
  const settings = await readText(root, file);
  const once = (text, find, replacement, what) => replaceOnce(text, find, replacement, what, file);
  let make = section(settings, '<section id="make"', '<section id="preferences"');
  make = once(make, '<p class="rb-warning" id="rb-css-warning" data-rb="css-warning"></p>', `<p class="rb-warning" data-rb="css-warning" hidden></p>\n              <p class="rs-note us-css-note" id="us-css-note">${CSS_NOTE}</p>`, "Advanced CSS warning");
  make = once(make, '<label for="rb-css">CSS</label>', '<label for="rb-css">CSS (read only)</label>', "CSS label");
  make = once(make, 'data-rb="css" aria-describedby="rb-css-meter rb-css-warning"', 'data-rb="css" readonly aria-describedby="us-css-note rb-css-meter"', "CSS editor");
  make = once(make, '<label class="rb-check"><input type="checkbox" data-rb="css-enable" aria-describedby="rb-css-warning" />Enable advanced CSS</label>', HIDDEN_ENABLE("css-enable"), "Enable advanced CSS");
  make = once(make, '<p class="rb-warning" id="rb-import-css-warning" data-rb="import-css-warning"></p>', `<p class="rb-warning" data-rb="import-css-warning" hidden></p>\n              <p class="rs-note us-css-note">${IMPORT_CSS_NOTE}</p>`, "import CSS warning");
  make = once(make, '<p class="rs-note" data-rb="import-css-size"></p>', '<p class="rs-note" data-rb="import-css-size" hidden></p>', "import CSS size");
  make = once(make, '<label class="rb-check"><input type="checkbox" data-rb="import-css-enable" aria-describedby="rb-import-css-warning" />Enable advanced CSS</label>', HIDDEN_ENABLE("import-css-enable"), "import Enable advanced CSS");
  let backup = section(settings, '<section id="backup"', "</main>");
  backup = once(
    backup,
    "<dd>Reload GitHub once to see your theme. If it still doesn't change, allow GitHub access in your browser's extension settings, then reload the page.</dd>",
    `<dd>Reload GitHub once to see your theme. If it still doesn't change, check that GitHub Reskin is turned on for github.com in your userscript manager, then reload the page.</dd>
            <dt>Moving themes to or from the extension</dt>
            <dd>The userscript keeps its own settings. Export a theme here and import the file in the extension, or the other way round.</dd>
            <dt>A theme's advanced CSS is off</dt>
            <dd>${CSS_NOTE}</dd>`,
    "help for an unchanged GitHub",
  );
  if (/<script|\son[a-z]+=/i.test(make + backup)) throw new Error(`${file}: the builder sections would carry a script`);
  const html = `
    <header class="rs-top rs-page-header">
      ${await inlineMark(root)}
      <p class="rs-title">GitHub Reskin</p>
      <button type="button" class="us-close" data-us="close" aria-label="Close GitHub Reskin"><span aria-hidden="true">×</span></button>
    </header>
    <main class="rs-main">
      <section class="us-storage" aria-label="Saving">
        <span class="us-session-label" data-us="session-label" hidden></span>
        <p class="rs-note" data-us="storage-note"></p>
      </section>
      <nav class="rs-views" aria-label="GitHub Reskin sections">
        <button type="button" class="us-view" data-us="themes">Themes</button>
        <a href="#make" data-rs-view="make">Make a theme</a>
        <a href="#backup" data-rs-view="backup">Backup &amp; help</a>
      </nav>
      ${make}
      ${backup}
    </main>`;
  const css = await frameCss(root, ["extension/pages/ui.css", "extension/pages/page.css", "userscript/frame.css"]);
  return { srcdoc: frameHtml("GitHub Reskin: Make a theme", css, ' class="rs-page us-builder" data-page="settings"', html) };
}

/** The preview fixture's images as data URLs keyed by asset path, as embeddedResources reads them. */
export async function fixtureAssets(root = ROOT) {
  const dir = "packages/preview/fixture/assets";
  const names = (await readdir(join(root, dir))).filter((name) => /^[a-z0-9-]+\.(webp|svg)$/.test(name)).sort();
  const assets = {};
  for (const name of names) assets[`${dir}/${name}`] = `data:image/${name.endsWith(".svg") ? "svg+xml" : "webp"};base64,${(await readFile(join(root, dir, name))).toString("base64")}`;
  return assets;
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

// Violentmonkey runs a script with window's functions bound to the window, so css-tree's lexer,
// which calls a bare hasOwnProperty, would ask the window whether it has a type and find none:
// every theme would fail validation and pages would stay native. Bundled, it means Object's own.
export const DEFINE = Object.freeze({ hasOwnProperty: "Object.prototype.hasOwnProperty" });
// Bare globals that come from the script's own realm instead, see own-globals.js.
export const INJECT = Object.freeze(["userscript/own-globals.js"]);

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
    // Dependencies (css-tree and fflate, through the builder) resolve through their symlinked
    // path, so a rebuild from the source archive, whose node_modules is a link, writes the same
    // module path comments and bytes.
    preserveSymlinks: true,
    define: DEFINE,
    inject: INJECT.map((path) => join(root, path)),
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
    "reskin:builder": await builderDocument(root),
    "reskin:assets": await fixtureAssets(root),
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
