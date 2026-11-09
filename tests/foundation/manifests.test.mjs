import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ACCEPTED_FIREFOX_WARNINGS } from "../../scripts/check.mjs";
import { ROOT, entrySourcePaths, extensionFiles, extensionManifest, loadEntry, loadReleaseConfig, manifestPaths, manifestProblems, noticeProblems } from "../../scripts/build.mjs";

const config = await loadReleaseConfig();
const entry = await loadEntry(config);

test("Chrome gets the common manifest without Gecko keys, and no new permissions", async () => {
  const chrome = await extensionManifest("chrome", config);
  assert.equal(chrome.browser_specific_settings, undefined);
  assert.doesNotMatch(JSON.stringify(chrome), /gecko/i);
  assert.deepEqual(chrome.permissions, ["storage"]);
  assert.deepEqual(chrome.content_scripts[0].matches, ["https://github.com/*", "https://gist.github.com/*"]);
  assert.equal(chrome.content_scripts[0].run_at, "document_start");
  assert.deepEqual(manifestProblems(chrome, "chrome", config), []);
});

test("Firefox keeps the studio Gecko ID, minimum 140, no data collection and no Android key", async () => {
  const firefox = await extensionManifest("firefox", config);
  assert.deepEqual(firefox.browser_specific_settings, {
    gecko: { id: "github-reskin@sideband.studio", strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } },
  });
  assert.deepEqual(manifestProblems(firefox, "firefox", config), []);
});

// The runtime entry: C4's background per browser, boot.css before the content script, the pages
// and fonts readable only by the two GitHub origins.
test("the generated manifests name the reskin-2 runtime, its background per browser and its pages", async () => {
  assert.equal(config.extension.entry, "reskin-2");
  const chrome = await extensionManifest("chrome", config);
  const firefox = await extensionManifest("firefox", config);
  assert.deepEqual(chrome.background, { service_worker: "background.js" });
  assert.deepEqual(firefox.background, { scripts: ["background.js"] });
  for (const manifest of [chrome, firefox]) {
    assert.deepEqual(manifest.content_scripts, [{ matches: config.extension.hostMatches, run_at: "document_start", css: ["content/lifecycle/boot.css"], js: ["content.js"] }]);
    assert.equal(manifest.action.default_popup, "pages/popup.html");
    assert.equal(manifest.options_ui.page, "pages/settings.html");
    assert.deepEqual(manifest.web_accessible_resources.map((r) => r.matches), [config.extension.hostMatches]);
    assert.ok(manifest.web_accessible_resources[0].resources.every((path) => /^assets\/fonts\/([a-z0-9-]+)\/\1(-[4-7]00)?\.woff2$/.test(path)));
    for (const path of manifestPaths(manifest)) assert.ok(entry.files.includes(path), path);
  }
  const { browser_specific_settings, background, ...chromeRest } = firefox;
  const { background: chromeBackground, ...chromeOnly } = chrome;
  assert.deepEqual(chromeOnly, chromeRest);
});

test("the entry's generated files come from its builder, and every other file from extension/", async () => {
  assert.equal(entry.builder, "packages/ui/bundle.mjs");
  for (const path of entry.generated) assert.ok(entry.files.includes(path), path);
  for (const path of entrySourcePaths(entry).filter((p) => p !== entry.builder)) assert.ok(existsSync(join(ROOT, path)), path);
  await assert.rejects(extensionFiles("chrome", { config, entry: { ...entry, generated: [...entry.generated, "pages/extra.js"] } }), /must be entry files: pages\/extra\.js/);
  await assert.rejects(extensionFiles("chrome", { config, entry: { ...entry, files: [...entry.files, "pages/extra.js"], generated: [...entry.generated, "pages/extra.js"] } }), /does not generate pages\/extra\.js/);
  await assert.rejects(extensionFiles("chrome", { config, entry: { ...entry, builder: undefined } }), /needs a builder/);
});

test("manifest checks catch new permissions, hosts, Gecko keys in Chrome and the wrong Gecko ID", async () => {
  const chrome = await extensionManifest("chrome", config);
  const firefox = await extensionManifest("firefox", config);
  const problems = (manifest, browser) => manifestProblems(manifest, browser, config).join("\n");
  assert.match(problems({ ...chrome, permissions: ["storage", "tabs"] }, "chrome"), /permissions/);
  assert.match(problems({ ...chrome, host_permissions: ["<all_urls>"] }, "chrome"), /host_permissions/);
  assert.match(problems({ ...chrome, browser_specific_settings: firefox.browser_specific_settings }, "chrome"), /browser_specific_settings/);
  const gecko = (patch) => ({ ...firefox, browser_specific_settings: { gecko: { ...firefox.browser_specific_settings.gecko, ...patch } } });
  assert.match(problems(gecko({ id: "github-reskin@alitleis.dev" }), "firefox"), /Gecko ID/);
  assert.match(problems(gecko({ strict_min_version: "128.0" }), "firefox"), /minimum/);
  assert.match(problems({ ...firefox, browser_specific_settings: { ...firefox.browser_specific_settings, gecko_android: {} } }, "firefox"), /gecko_android/);
  assert.match(problems({ ...firefox, background: { service_worker: "worker.js" } }, "firefox"), /background scripts/);
  const local = { ...chrome, content_scripts: [{ ...chrome.content_scripts[0], matches: [...config.extension.hostMatches, "http://127.0.0.1/*"] }] };
  assert.match(problems(local, "chrome"), /matches/);
  assert.match(problems({ ...chrome, content_security_policy: { extension_pages: "script-src 'self' https://cdn.example" } }, "chrome"), /CSP/);
});

test("a test fixture build adds only local matches, and production never names localhost", async () => {
  const fixture = await extensionFiles("chrome", { config, entry, testFixture: { matches: ["http://127.0.0.1/*"] } });
  assert.deepEqual(fixture.manifest.content_scripts[0].matches, [...config.extension.hostMatches, "http://127.0.0.1/*"]);
  const production = await extensionFiles("chrome", { config, entry });
  assert.doesNotMatch(production.files["manifest.json"].toString(), /localhost|127\.0\.0\.1/);
  await assert.rejects(extensionFiles("chrome", { config, entry, testFixture: { matches: ["https://example.com/*"] } }), /must be http:\/\/127\.0\.0\.1/);
});

test("a frozen input cannot change under the build, and entry files stay inside and complete", async () => {
  const changed = { ...entry, frozen: { "content/lifecycle/boot.css": "0".repeat(64) }, notices: [...entry.notices, { file: "LICENSE", license: "MIT", covers: ["content/lifecycle/boot.css"], upstream: "test" }] };
  await assert.rejects(extensionFiles("firefox", { config, entry: changed }), /boot\.css is frozen/);
  await assert.rejects(extensionFiles("firefox", { config, entry: { ...entry, files: [...entry.files, "../package.json"] } }), /must stay inside/);
  const missing = { ...entry, files: entry.files.filter((path) => path !== "pages/popup.html") };
  await assert.rejects(extensionFiles("chrome", { config, entry: missing }), /names files the entry lacks: pages\/popup\.html/);
});

test("the bundles embedding Primer-derived mode data ship with the upstream Primer notice", async () => {
  assert.deepEqual(noticeProblems(entry), []);
  assert.deepEqual(entry.notices[0], { file: "licenses/primer-primitives.txt", license: "MIT", covers: ["background.js", "content.js", "pages/pages.js"], upstream: "https://github.com/primer/primitives" });
  for (const notice of entry.notices.slice(1)) assert.equal(notice.license, "OFL-1.1", notice.file);
  const notice = await readFile(join(ROOT, "licenses/primer-primitives.txt"), "utf8");
  assert.match(notice, /Copyright \(c\) 2018 GitHub Inc\./);
  assert.match(notice, /The above copyright notice and this permission notice shall be included/);
  const { files } = await extensionFiles("firefox", { config, entry });
  assert.equal(files["licenses/primer-primitives.txt"].toString(), notice);

  const bootCss = createHash("sha256").update(await readFile(join(ROOT, "extension/content/lifecycle/boot.css"))).digest("hex");
  const uncovered = { ...entry, frozen: { "content/lifecycle/boot.css": bootCss }, notices: [] };
  assert.match(noticeProblems(uncovered).join("\n"), /frozen extension\/content\/lifecycle\/boot\.css has no upstream license notice/);
  await assert.rejects(extensionFiles("chrome", { config, entry: uncovered }), /no upstream license notice/);
  const wrong = { ...entry, notices: [{ ...entry.notices[0], covers: ["gone.js"] }] };
  assert.match(noticeProblems(wrong).join("\n"), /covers gone\.js, which the entry lacks/);
});

test("lint:firefox accepts one reviewed warning, and only for this exact desktop-only manifest", async () => {
  assert.deepEqual(Object.keys(ACCEPTED_FIREFOX_WARNINGS), ["KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION"]);
  const { applies, reason } = ACCEPTED_FIREFOX_WARNINGS.KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION;
  assert.match(reason, /desktop-only/);
  const firefox = await extensionManifest("firefox", config);
  assert.equal(applies(firefox), true);
  const gecko = firefox.browser_specific_settings.gecko;
  for (const changed of [
    { gecko: { ...gecko, strict_min_version: "142.0" } },
    { gecko, gecko_android: { strict_min_version: "142.0" } },
    { gecko: { ...gecko, data_collection_permissions: { required: ["none"], optional: ["technicalAndInteraction"] } } },
  ]) {
    assert.equal(applies({ ...firefox, browser_specific_settings: changed }), false, JSON.stringify(changed));
  }
});
