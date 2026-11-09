// @font-face rules and the runtime resource adapters: only packaged locations, never theme data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FONTS, embeddedResources, extensionResources, fontFaceCss, fontStack, isFontResourceUrl, noResources, siteResources } from "../../packages/appearance/index.js";
import { codePoints, names, readWoff2, weightClass } from "../../packages/appearance/woff2.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;

test("fontFaceCss emits one swap face for a bundled font and nothing for system", () => {
  const css = fontFaceCss("bungee", "/GitHub-Reskin/assets/fonts/bungee/bungee.woff2");
  assert.match(css, /^@font-face\{font-family:"Reskin Bungee";src:url\("\/GitHub-Reskin\/assets\/fonts\/bungee\/bungee\.woff2"\) format\("woff2"\);font-weight:400;/);
  assert.match(css, /font-display:swap/);
  assert.match(css, /unicode-range:U\+0020-007E/);
  assert.equal(fontFaceCss("system", "anything"), "");
  assert.throws(() => fontFaceCss("comic-sans", "/x.woff2"), /Unknown font/);
  assert.equal(fontStack("system"), 'system-ui, -apple-system, "Segoe UI", sans-serif');
  assert.match(fontStack("josefin-sans"), /^"Reskin Geometric Accent", /);
});

test("only packaged font locations are accepted", () => {
  for (const url of ["/assets/fonts/rajdhani/rajdhani.woff2", "assets/fonts/rajdhani/rajdhani.woff2", "chrome-extension://abcdefgh/assets/fonts/rajdhani/rajdhani.woff2", "moz-extension://1234-abcd/assets/fonts/x/x.woff2", "data:font/woff2;base64,d09GMgABAAA="]) assert.ok(isFontResourceUrl(url), url);
  for (const url of ["https://fonts.example/x.woff2", "//cdn.example/x.woff2", "../x.woff2", "/a/../x.woff2", "/.hidden/x.woff2", "javascript:alert(1)", "/x.woff2) ; background:url(evil", 'x.woff2"', "data:text/css;base64,AAAA", "/x.ttf", null]) assert.ok(!isFontResourceUrl(url), String(url));
  assert.throws(() => fontFaceCss("rajdhani", "https://fonts.example/r.woff2"), /packaged resource/);
});

test("resource adapters map IDs and fixture paths to each runtime's packaged files", () => {
  const ext = extensionResources({ getURL: (path) => `chrome-extension://abcdef/${path}` });
  assert.equal(ext.fontUrl("fraunces"), "chrome-extension://abcdef/assets/fonts/fraunces/fraunces.woff2");
  assert.equal(ext.fontUrl("system"), null);
  assert.equal(ext.assetUrl("packages/preview/fixture/assets/avatar-whoisaldo.webp"), "chrome-extension://abcdef/packages/preview/fixture/assets/avatar-whoisaldo.webp");
  assert.equal(ext.assetUrl("https://avatars.example/u/1"), null);
  const site = siteResources("/GitHub-Reskin/");
  assert.equal(site.fontUrl("bungee"), "/GitHub-Reskin/assets/fonts/bungee/bungee.woff2");
  assert.throws(() => siteResources("https://example.com/"), /absolute path/);
  const embedded = embeddedResources({ fonts: { rajdhani: "d09GMgAB" }, assets: { "packages/preview/fixture/assets/avatar-whoisaldo.webp": "data:image/webp;base64,UklGRg==" } });
  assert.equal(embedded.fontUrl("rajdhani"), "data:font/woff2;base64,d09GMgAB");
  assert.equal(embedded.fontUrl("bungee"), null);
  assert.equal(embedded.assetUrl("packages/preview/fixture/assets/avatar-whoisaldo.webp"), "data:image/webp;base64,UklGRg==");
  assert.equal(noResources.fontUrl("rajdhani"), null);
  assert.throws(() => extensionResources({}), /getURL/);
});

test("each WOFF2 has its registry weight, printable ASCII and no Reserved Font Name", () => {
  for (const font of FONTS) {
    const tables = readWoff2(readFileSync(`${ROOT}${font.path}`));
    assert.equal(weightClass(tables), font.weight, font.id);
    const points = codePoints(tables);
    for (let c = 0x20; c <= 0x7e; c++) assert.ok(points.has(c), `${font.id} U+${c.toString(16)}`);
    const familyNames = names(tables).filter((n) => [1, 4, 6, 16].includes(n.nameID)).map((n) => n.value);
    if (font.id === "josefin-sans") assert.ok(familyNames.every((n) => !/Josefin/.test(n)), familyNames.join());
  }
});
