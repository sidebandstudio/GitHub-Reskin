// @font-face rules and the runtime resource adapters: only packaged locations, never theme data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FONTS, embeddedResources, extensionResources, fontFaceCss, fontStack, isFontResourceUrl, noResources, roleFontFaceCss, roleFontIds, siteResources } from "../../packages/appearance/index.js";
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
  // Each reviewed weight has its own face; an unreviewed weight is refused, never synthesized.
  assert.match(fontFaceCss("barlow", "/assets/fonts/barlow/barlow-500.woff2", 500), /^@font-face\{font-family:"Reskin Barlow";src:url\("\/assets\/fonts\/barlow\/barlow-500\.woff2"\) format\("woff2"\);font-weight:500;/);
  assert.match(fontFaceCss("barlow", "/assets/fonts/barlow/barlow.woff2"), /font-weight:400;/);
  assert.throws(() => fontFaceCss("nunito-sans", "/assets/fonts/nunito-sans/nunito-sans.woff2", 600), /no reviewed weight 600/);
});

test("role faces cover the heading and body families at every reviewed weight, once each", () => {
  const site = siteResources("/");
  const roles = (heading, body) => ({ font: heading.source === "bundled" ? heading.id : "system", appearance: { fonts: { heading, body } } });
  const bundled = (id) => ({ id, source: "bundled" });
  const system = { id: "system", source: "system" };
  assert.deepEqual(roleFontIds(roles(bundled("cinzel"), bundled("source-sans-3"))), ["cinzel", "source-sans-3"]);
  const css = roleFontFaceCss(roles(bundled("cinzel"), bundled("source-sans-3")), site);
  assert.deepEqual([...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]), ["/assets/fonts/cinzel/cinzel.woff2", "/assets/fonts/source-sans-3/source-sans-3.woff2", "/assets/fonts/source-sans-3/source-sans-3-600.woff2", "/assets/fonts/source-sans-3/source-sans-3-700.woff2"]);
  assert.equal(roleFontFaceCss(roles(bundled("barlow"), bundled("barlow")), site).match(/@font-face/g).length, 4);
  assert.deepEqual(roleFontIds(roles({ id: "roboto-condensed", source: "native-stack" }, system)), ["roboto-condensed"]);
  assert.equal(roleFontFaceCss(roles(system, system), site), "");
  assert.equal(roleFontFaceCss(roles(bundled("barlow"), system), noResources), "");
  // A resolution without role fonts falls back to its legacy heading font.
  assert.deepEqual(roleFontIds({ font: "bungee" }), ["bungee"]);
});

test("only packaged font locations are accepted", () => {
  for (const url of ["/assets/fonts/rajdhani/rajdhani.woff2", "assets/fonts/rajdhani/rajdhani.woff2", "chrome-extension://abcdefgh/assets/fonts/rajdhani/rajdhani.woff2", "moz-extension://1234-abcd/assets/fonts/x/x.woff2", "data:font/woff2;base64,d09GMgABAAA="]) assert.ok(isFontResourceUrl(url), url);
  for (const url of ["https://fonts.example/x.woff2", "//cdn.example/x.woff2", "../x.woff2", "/a/../x.woff2", "/.hidden/x.woff2", "javascript:alert(1)", "/x.woff2) ; background:url(evil", 'x.woff2"', "data:text/css;base64,AAAA", "/x.ttf", null]) assert.ok(!isFontResourceUrl(url), String(url));
  assert.throws(() => fontFaceCss("rajdhani", "https://fonts.example/r.woff2"), /packaged resource/);
});

test("resource adapters map IDs and fixture paths to each runtime's packaged files", () => {
  const ext = extensionResources({ getURL: (path) => `chrome-extension://abcdef/${path}` });
  assert.equal(ext.fontUrl("fraunces"), "chrome-extension://abcdef/assets/fonts/fraunces/fraunces.woff2");
  assert.equal(ext.fontUrl("fraunces", 700), "chrome-extension://abcdef/assets/fonts/fraunces/fraunces-700.woff2");
  assert.equal(ext.fontUrl("fraunces", 400), null);
  assert.equal(ext.fontUrl("system"), null);
  assert.equal(ext.assetUrl("packages/preview/fixture/assets/avatar-whoisaldo.webp"), "chrome-extension://abcdef/packages/preview/fixture/assets/avatar-whoisaldo.webp");
  assert.equal(ext.assetUrl("https://avatars.example/u/1"), null);
  const site = siteResources("/GitHub-Reskin/");
  assert.equal(site.fontUrl("bungee"), "/GitHub-Reskin/assets/fonts/bungee/bungee.woff2");
  assert.throws(() => siteResources("https://example.com/"), /absolute path/);
  const embedded = embeddedResources({ fonts: { rajdhani: "d09GMgAB", "rajdhani-700": "d09GMgAC" }, assets: { "packages/preview/fixture/assets/avatar-whoisaldo.webp": "data:image/webp;base64,UklGRg==" } });
  assert.equal(embedded.fontUrl("rajdhani"), "data:font/woff2;base64,d09GMgAB");
  assert.equal(embedded.fontUrl("rajdhani", 700), "data:font/woff2;base64,d09GMgAC");
  assert.equal(embedded.fontUrl("bungee"), null);
  assert.equal(embedded.assetUrl("packages/preview/fixture/assets/avatar-whoisaldo.webp"), "data:image/webp;base64,UklGRg==");
  assert.equal(noResources.fontUrl("rajdhani"), null);
  assert.throws(() => extensionResources({}), /getURL/);
});

// The families whose OFL notices declare a Reserved Font Name, by the name's distinctive word.
const RESERVED = { "josefin-sans": /Josefin/i, orbitron: /Orbitron/i, "ibm-plex-sans": /Plex/i, "source-sans-3": /Source/i };

test("each WOFF2 has its weight, printable ASCII and no Reserved Font Name", () => {
  assert.equal(FONTS.length, 18);
  assert.equal(FONTS.flatMap((font) => font.files).length, 35);
  for (const font of FONTS) {
    assert.equal(font.files[font.weights.indexOf(font.weight)].path, font.path, font.id);
    for (const file of font.files) {
      const tables = readWoff2(readFileSync(`${ROOT}${file.path}`));
      assert.equal(weightClass(tables), file.weight, file.path);
      const points = codePoints(tables);
      // Orbitron never drew the circumflex accent upstream; it falls back per character.
      for (let c = 0x20; c <= 0x7e; c++) assert.ok(points.has(c) || (font.id === "orbitron" && c === 0x5e), `${file.path} U+${c.toString(16)}`);
      const familyNames = names(tables).filter((n) => [1, 4, 6, 16].includes(n.nameID)).map((n) => n.value);
      if (RESERVED[font.id]) assert.ok(familyNames.every((n) => !RESERVED[font.id].test(n)), familyNames.join());
    }
  }
});
