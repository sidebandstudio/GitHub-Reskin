// The generated userscript: deterministic, within budget, with metadata that requests nothing,
// no network or page-storage API, every font and notice embedded, and the popup's card intact in
// the frame document. The static rules live in userscript/verify.mjs; these tests also prove they
// catch a bad script.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build, cardDocument, GRANTS, MAX_BYTES, metadata, updateUrl } from "../../userscript/build.mjs";
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

test("the frame document is the popup's card with Close, the storage note and Export, and no script", async () => {
  const { srcdoc } = await cardDocument();
  assert.ok(!/<script|\son\w+=|javascript:/i.test(srcdoc), "the frame document runs nothing itself");
  assert.ok(!/<img\b|<link\b/i.test(srcdoc), "the mark is inline and the styles embedded, so the frame loads nothing");
  for (const part of ['data-rs="enabled"', 'data-rs="gallery"', 'data-rs="undo"', 'name="appearance"', 'data-rs="text"', 'data-rs="motion"', 'data-us="close"', 'data-us="storage-note"', 'data-us="export"', 'data-us="session-label"']) {
    assert.ok(srcdoc.includes(part), part);
  }
  assert.ok(!srcdoc.includes("data-rs-open"), "the extension's Settings page does not exist here");
  // esbuild requotes the embedded string, so look for its parts rather than its JSON form.
  for (const part of ["us-storage-row", "Close GitHub Reskin", "Export theme file"]) assert.ok(script.includes(part), `the script embeds the card: ${part}`);
});
