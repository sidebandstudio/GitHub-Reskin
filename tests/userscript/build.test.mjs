// The generated userscript: deterministic, within budget, with metadata that requests nothing,
// no network or page-storage API, every font and notice embedded, and the popup's card intact in
// the frame document. The static rules live in userscript/verify.mjs; these tests also prove they
// catch a bad script.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build, builderDocument, cardDocument, DEFINE, fixtureAssets, GRANTS, INJECT, MAX_BYTES, metadata, updateUrl } from "../../userscript/build.mjs";
import { CSS_NOTE, IMPORT_CSS_NOTE } from "../../userscript/copy.js";
import { REVIEWED_PREVIEW_READ } from "../../userscript/verify.mjs";
import { metadataEntries, scriptProblems } from "../../userscript/verify.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const config = JSON.parse(await readFile(new URL("../../release.config.json", import.meta.url), "utf8"));
const script = await build();

test("the same inputs build the same bytes, within the 3.5 MiB budget", async () => {
  assert.equal(await build(), script);
  assert.ok(Buffer.byteLength(script) <= MAX_BYTES, `${Buffer.byteLength(script)} bytes`);
  assert.ok(Buffer.byteLength(script) > 1024 * 1024, "the catalog, engine and fonts are embedded");
});

test("the generated script passes every static check", async () => {
  assert.deepEqual(await scriptProblems(script, { config, root }), []);
});

test("CSS checking works where a manager binds window's functions to the window, as Violentmonkey does", async () => {
  const { build: esbuild } = await import("esbuild");
  const color = async (define) => {
    const entry = 'import { lexer, parse } from "css-tree"; globalThis.matched = lexer.matchType("color", parse("transparent", { context: "value" })).matched !== null;';
    const result = await esbuild({ stdin: { contents: entry, resolveDir: root, loader: "js" }, bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent", define });
    const sandbox = vm.createContext({});
    vm.runInContext("globalThis.hasOwnProperty = Object.prototype.hasOwnProperty.bind(globalThis);", sandbox);
    vm.runInContext(result.outputFiles[0].text, sandbox);
    return sandbox.matched;
  };
  assert.equal(await color({}), false, "the bound global breaks css-tree's lexer");
  assert.equal(await color(DEFINE), true);
  // The script itself leaves no call on a global hasOwnProperty.
  assert.doesNotMatch(script, /(?<![.\w$])hasOwnProperty\.call\(/);
});

test("a bare structuredClone comes from the script's own realm, where a manager resolves globals through the page", async () => {
  const { build: esbuild } = await import("esbuild");
  const run = async (inject) => {
    const entry = "globalThis.result = (() => { const copy = structuredClone({ a: {} }); copy.a = { b: 1 }; return copy.a.b; })();";
    const result = await esbuild({ stdin: { contents: entry, resolveDir: root, loader: "js" }, bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent", define: DEFINE, inject });
    // As Violentmonkey in Firefox: globals resolve through the page first, and the page's copies
    // refuse the script's values, while the script's own global has a working structuredClone.
    const refuse = () => {
      throw new Error("Not allowed to define cross-origin object as property on [Object] or [Array] XrayWrapper");
    };
    const page = { structuredClone: (value) => new Proxy(structuredClone(value), { set: refuse, defineProperty: refuse }) };
    const sandbox = vm.createContext({ structuredClone, page });
    vm.runInContext(`with (page) {\n${result.outputFiles[0].text}\n}`, sandbox);
    return sandbox.result;
  };
  await assert.rejects(run([]), /cross-origin object/, "the page's copy refuses the script's values");
  assert.equal(await run(INJECT.map((path) => join(root, path))), 1);
});

test("metadata keeps the 1.1.0 identity, updates from Pages and requests nothing", () => {
  const entries = Object.fromEntries(metadataEntries(script).filter(([key]) => !["match", "grant"].includes(key)));
  assert.equal(entries.namespace, "https://github.com/sidebandstudio/GitHub-Reskin");
  assert.equal(entries.updateURL, "https://sidebandstudio.github.io/GitHub-Reskin/downloads/github-reskin.user.js");
  assert.equal(updateUrl(config), entries.downloadURL);
  assert.match(entries.icon, /^data:image\/png;base64,/);
  assert.equal(entries["inject-into"], "content");
  assert.equal(entries.sandbox, "DOM");
  assert.ok(!("require" in entries) && !("resource" in entries) && !("connect" in entries));
});

test("the static checks catch remote code, remote icons, network calls and page storage", async () => {
  const header = metadata(config, { icon: "AAAA", description: "x" });
  const body = script.slice(script.indexOf("// ==/UserScript==\n") + 19);
  const bad = [
    [header.replace("// ==/UserScript==", "// @require      https://example.com/x.js\n// ==/UserScript=="), /@require/],
    [header.replace(/@icon.*\n/, "@icon         https://example.com/icon.png\n"), /@icon/],
    [header.replace("// @grant        GM.getValue\n", "// @grant        GM_xmlhttpRequest\n"), /@grant/],
    [`${header}${body}\nfetch("https://example.com");`, /fetch/],
    [`${header}${body}\nlocalStorage.setItem("k", "v");`, /localStorage/],
    [`${header}${body}\nsessionStorage.k = 1;`, /page storage/],
    [`${header}${body}\nnew Function("return 1");`, /code from strings/],
    [`${header}${body}\nconst css = "a{background:url(https://example.com/x.png)}";`, /remote CSS/],
    [header, /not embedded/],
    [header.replace(/\/\/ @sandbox.*\n/, ""), /@sandbox/],
    [header.replace("@inject-into  content", "@inject-into  page"), /@inject-into/],
  ];
  for (const [candidate, pattern] of bad) {
    const problems = await scriptProblems(candidate, { config, root });
    assert.ok(problems.some((problem) => pattern.test(problem)), `${pattern}: ${problems.join("; ")}`);
  }
  assert.equal(GRANTS.some((grant) => /xmlhttp|download|resource/i.test(grant)), false);
});

test("the frame document is the popup's card with Close, the storage note, Export and the builder's two views, and no script", async () => {
  const { srcdoc } = await cardDocument();
  assert.ok(!/<script|\son\w+=|javascript:/i.test(srcdoc), "the frame document runs nothing itself");
  assert.ok(!/<img\b|<link\b/i.test(srcdoc), "the mark is inline and the styles embedded, so the frame loads nothing");
  for (const part of ['data-rs="enabled"', 'data-rs="gallery"', 'data-rs="undo"', 'name="appearance"', 'data-rs="text"', 'data-rs="motion"', 'data-us="close"', 'data-us="storage-note"', 'data-us="export"', 'data-us="session-label"', 'data-us="make"', 'data-us="backup"']) {
    assert.ok(srcdoc.includes(part), part);
  }
  assert.ok(!srcdoc.includes("data-rs-open"), "the extension's Settings page does not exist here");
  // esbuild requotes the embedded string, so look for its parts rather than its JSON form.
  for (const part of ["us-storage-row", "Close GitHub Reskin", "Export theme file"]) assert.ok(script.includes(part), `the script embeds the card: ${part}`);
});

test("the builder's frame is the settings page's Make a theme and Backup & help, with no way to enable Advanced CSS and no script", async () => {
  const { srcdoc } = await builderDocument();
  assert.ok(!/<script|\son\w+=|javascript:/i.test(srcdoc), "the frame document runs nothing itself");
  assert.ok(!/<img\b|<link\b/i.test(srcdoc), "the mark is inline and the styles embedded, so the frame loads nothing");
  for (const part of ['data-rb="builder"', 'data-rb="import"', 'data-rb="preview"', 'data-rb="image-file"', 'data-rb="save-copy"', 'data-rb="resume"', 'data-rk="backup"', 'data-rk="reset-all"', 'data-us="close"', 'data-us="themes"', 'data-us="storage-note"', 'data-us="session-label"']) {
    assert.ok(srcdoc.includes(part), part);
  }
  // Neither Enable advanced CSS is left as a control: only inert, hidden inputs the builder reads.
  assert.ok(!srcdoc.includes("Enable advanced CSS"));
  for (const part of ["css-enable", "import-css-enable"]) assert.match(srcdoc, new RegExp(`<input type="checkbox" data-rb="${part}" hidden disabled inert tabindex="-1" aria-hidden="true" />`));
  assert.match(srcdoc, /data-rb="css" readonly /);
  assert.ok(srcdoc.includes(CSS_NOTE) && srcdoc.includes(IMPORT_CSS_NOTE));
  // The extension's own help is replaced where it names the extension's settings.
  assert.ok(!srcdoc.includes("extension settings"));
  assert.ok(!srcdoc.includes('id="preferences"') && !srcdoc.includes('id="themes"'), "the card holds the themes and preferences");
});

test("the preview's fixture images are embedded as data, and its one reviewed read is the only network call in the script", async () => {
  const assets = await fixtureAssets();
  assert.ok(Object.keys(assets).length >= 10);
  for (const [path, url] of Object.entries(assets)) {
    assert.match(path, /^packages\/preview\/fixture\/assets\/[a-z0-9-]+\.(webp|svg)$/);
    assert.match(url, /^data:image\/(webp|svg\+xml);base64,/);
    assert.ok(script.includes(url.slice(0, 200)), `${path} is embedded`);
  }
  const code = script.slice(script.indexOf("// ==/UserScript==\n") + 19);
  assert.equal(code.split(REVIEWED_PREVIEW_READ).length, 2, "the preview's read appears once");
  const config = JSON.parse(await readFile(new URL("../../release.config.json", import.meta.url), "utf8"));
  const twice = script.replace(REVIEWED_PREVIEW_READ, `${REVIEWED_PREVIEW_READ};${REVIEWED_PREVIEW_READ}`);
  assert.ok((await scriptProblems(twice, { config, root })).some((problem) => /more than once|fetch/.test(problem)));
});
