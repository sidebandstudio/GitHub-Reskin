// Nested GitHub mode islands in real Chromium and Firefox. Pages load all fourteen frozen GitHub
// mode stylesheets, GitHub's own island rules from primer.css and one compiled theme. Computed
// styles show which elements are themed and which keep GitHub's own colors, without recompiling
// when the system scheme or forced colors change.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, firefox } from "playwright";
import { readModeFile } from "../../packages/primer/convert.js";
import { compileGitHub, MODE_INDEX } from "../../packages/primer/index.js";
import { PREFS, readText, resolvedFromSeed } from "./helpers.mjs";

const MODES = Object.keys(MODE_INDEX.modes);
const raw = Object.fromEntries(MODES.map((id) => [id, readText(`vendor/primer/source/${id}.css`)]));
// A mode the frozen data has never seen, in GitHub's own selector shape.
const FUTURE = raw.dark_high_contrast.replaceAll("dark_high_contrast", "dark_future").replace(/#010409/g, "#0a0b0c");
// primer.css (github.githubassets.com/assets/primer-5e94d7f3a59af8da.css, 2026-11-08): every island
// paints its own text and canvas and sets its own color-scheme.
const PRIMER_ISLANDS = `[data-color-mode]{color:var(--fgColor-default);background-color:var(--bgColor-default)}
:root,[data-color-mode=light][data-light-theme*=light],[data-color-mode=dark][data-dark-theme*=light]{color-scheme:light}
[data-color-mode=light][data-light-theme*=dark],[data-color-mode=dark][data-dark-theme*=dark]{color-scheme:dark}
@media (prefers-color-scheme:light){[data-color-mode=auto][data-light-theme*=light]{color-scheme:light}[data-color-mode=auto][data-light-theme*=dark]{color-scheme:dark}}
@media (prefers-color-scheme:dark){[data-color-mode=auto][data-dark-theme*=light]{color-scheme:light}[data-color-mode=auto][data-dark-theme*=dark]{color-scheme:dark}}`;

const declared = Object.fromEntries(MODES.map((id) => [id, readModeFile(raw[id], id, MODE_INDEX.modes[id].base)]));
function native(id, name, seen = 0) {
  const value = id === "dark_future" ? readModeFile(FUTURE, "dark_future", "dark").get(name) : declared[id].get(name);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref && seen < 8 ? native(id, ref[1], seen + 1) : value;
}

// A dark theme with sentinel colors nobody's GitHub mode uses.
const SENTINEL = { "/tokens/canvas": "#101a2b", "/tokens/text": "#fafbe0", "/tokens/link": "#7fd4ff", "/graph/3": "#2bd9a0", "/graph/4": "#39ff14", "/semantics/success/text": "#55ee99", "/tokens/selectionText": "#fdf0c4", "/tokens/selectionBackground": "#20406a" };
const resolved = resolvedFromSeed(MODE_INDEX.modes.dark, SENTINEL);
const compiled = compileGitHub(resolved, { seedMode: "dark", policy: "themed" }, PREFS).css;
const GREEN = "rgb(64, 196, 99)";

const blob = (id) => `<svg><path id="${id}" class="js-highlight-blob" fill="#40c463" stroke="#40c463" d="M0 0h1v1z"/></svg>`;
const label = (id) => `<span id="${id}" class="hx_IssueLabel" style="--label-r:215;--label-g:58;--label-b:74;--label-h:353;--label-s:66;--label-l:53;--perceived-lightness:0.36;--lightness-switch:1">bug</span>`;
const footer = (id) => `<div data-color-mode="light"><footer role="contentinfo"><i id="${id}"></i></footer></div>`;
// The profile timeline's commit bar as GitHub rendered it on github.com/whoisaldo, 2026-11-08.
const bar = (id, color = "#30a14e") => `<div class="Progress mt-1 color-bg-default" role="img" aria-label="63% of commits in November were made to octo/sample"><span id="${id}" class="Progress-item rounded-2" style="width: 63%;background-color: ${color}"></span></div>`;

const STANDARD = `
  ${blob("root-blob")}${label("root-label")}
  <div id="hc" data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_high_contrast">
    <p id="hc-text">native words <b id="hc-child">here</b></p>${blob("hc-blob")}${label("hc-label")}
    <div id="hc-inner"></div>
    <div id="hc-nested" data-color-mode="light" data-light-theme="light" data-dark-theme="dark">
      <i id="hc-nested-inner"></i>${blob("hc-nested-blob")}${label("hc-nested-label")}${footer("hc-nested-brand")}
    </div>
  </div>
  <div id="lhc" data-color-mode="light" data-light-theme="light_tritanopia_high_contrast" data-dark-theme="dark"><i id="lhc-inner"></i></div>
  <div id="cb" data-color-mode="light" data-light-theme="light_colorblind" data-dark-theme="dark"><i id="cb-inner"></i></div>
  <div id="island" data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_dimmed"><i id="island-inner"></i></div>
  ${footer("brand-inner")}`;

const PROFILE = `<main><div id="js-contribution-activity">
  <ul><li>${bar("bar")}</li><li>${bar("bar-light", "#9be9a8")}</li></ul>
  <div class="markdown-body">${bar("authored-bar")}</div>
  <div data-color-mode="dark" data-light-theme="light_high_contrast" data-dark-theme="dark_high_contrast">${bar("hc-bar")}</div>
</div>${bar("outside-bar")}</main>
<span class="Progress position-fixed"><span id="loader" class="Progress-item color-bg-accent-emphasis" style="width: 30%"></span></span>`;

const page = (root, body, extra = "") => `<!doctype html>
<html lang="en" ${root}><head>${MODES.map((id) => `<style>${raw[id]}</style>`).join("")}<style>${PRIMER_ISLANDS}</style>${extra}</head>
<body>${body}</body></html>`;

const ROOT = 'data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"';

for (const [name, engine] of [["Chromium", chromium], ["Firefox", firefox]]) {
  describe(`mode islands in ${name}`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch();
    });
    after(async () => {
      await browser?.close();
    });
    // Opens a page, optionally reads it before the theme, then adds the compiled stylesheet.
    const open = async ({ root = ROOT, body = STANDARD, extra = "", colorScheme = "light", beforeTheme } = {}) => {
      const context = await browser.newContext({ colorScheme });
      const p = await context.newPage();
      await p.setContent(page(root, body, extra));
      const earlier = beforeTheme ? await beforeTheme(p) : undefined;
      await p.addStyleTag({ content: compiled });
      const read = (id, prop) => p.evaluate(([id, prop]) => getComputedStyle(id === "root" ? document.documentElement : document.getElementById(id)).getPropertyValue(prop).trim().toLowerCase(), [id, prop]);
      return { p, read, earlier, close: () => context.close() };
    };

    test("the themed root and same-plan islands take the theme; high-contrast and other-family islands keep GitHub's colors", async () => {
      const { read, close } = await open();
      assert.equal(await read("root", "--bgColor-default"), "#101a2b");
      assert.equal(await read("root", "color-scheme"), "dark");
      assert.equal(await read("island-inner", "--bgColor-default"), "#101a2b", "a dimmed island is a standard mode, themed with the theme's base");
      for (const [id, mode] of [["hc-inner", "dark_high_contrast"], ["lhc-inner", "light_tritanopia_high_contrast"], ["cb-inner", "light_colorblind"]]) {
        for (const prop of ["--bgColor-default", "--fgColor-default", "--fgColor-accent", "--fgColor-success", "--diffBlob-additionLine-bgColor", "--prettylights-syntax-keyword", "--contribution-default-bgColor-4", "--display-blue-fgColor"]) {
          assert.equal(await read(id, prop), native(mode, prop).toLowerCase(), `${id} ${prop} is ${mode}'s own value, not inherited from the themed root`);
        }
      }
      // A standard island inside a high-contrast island gets its own policy again.
      assert.equal(await read("hc-nested-inner", "--bgColor-default"), "#101a2b");
      await close();
    });

    test("an island of an unknown mode leaves the whole document native, with or without its own stylesheet", async () => {
      const body = `<div id="future" data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_future"><i id="future-inner"></i>${blob("future-blob")}</div>${blob("root-blob")}${label("root-label")}${bar("bar")}`;
      for (const extra of ["", `<style>${FUTURE}</style>`]) {
        const { p, read, close } = await open({ body: `<main><div id="js-contribution-activity">${body}</div></main>`, extra });
        assert.equal(await read("root", "--bgColor-default"), native("light", "--bgColor-default"));
        assert.equal(await read("root", "--reskin-on"), "");
        const inner = await read("future-inner", "--bgColor-default");
        assert.equal(inner, extra ? "#0a0b0c" : native("light", "--bgColor-default"), "the unknown island keeps its own reset or GitHub's inherited root colors");
        assert.equal(await read("future-inner", "--contribution-default-bgColor-4"), (extra ? native("dark_future", "--contribution-default-bgColor-4") : native("light", "--contribution-default-bgColor-4")).toLowerCase());
        for (const id of ["root-blob", "future-blob"]) assert.equal(await p.evaluate((id) => getComputedStyle(document.getElementById(id)).fill, id), GREEN, id);
        assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("bar")).backgroundColor), "rgb(48, 161, 78)");
        await close();
      }
    });

    test("malformed islands leave the whole document native: a missing theme attribute, the wrong one, a stray mode", async () => {
      for (const island of ['data-color-mode="dark"', 'data-color-mode="dark" data-light-theme="light"', 'data-color-mode="sepia" data-light-theme="light" data-dark-theme="dark"', 'data-color-mode="light" data-light-theme="Light"']) {
        const { p, read, close } = await open({ body: `<div id="odd" ${island}><span id="odd-inner">words</span>${blob("odd-blob")}</div>${blob("root-blob")}` });
        assert.equal(await read("root", "--bgColor-default"), native("light", "--bgColor-default"), island);
        assert.equal(await read("odd-inner", "--bgColor-default"), native("light", "--bgColor-default"), island);
        assert.equal(await read("odd-inner", "--fgColor-default"), native("light", "--fgColor-default"), island);
        for (const id of ["root-blob", "odd-blob"]) assert.equal(await p.evaluate((id) => getComputedStyle(document.getElementById(id)).fill, id), GREEN, `${island} ${id}`);
        await close();
      }
    });

    test("the Primer Brand footer island takes the brand mapping, and any other island without theme attributes does not", async () => {
      let { read, close } = await open();
      assert.equal(await read("brand-inner", "--brand-color-text-default"), "#fafbe0");
      assert.equal(await read("root", "--bgColor-default"), "#101a2b");
      await close();
      ({ read, close } = await open({ body: `${footer("brand-inner")}<div data-color-mode="light"><div>Brand section</div></div>` }));
      assert.equal(await read("root", "--bgColor-default"), native("light", "--bgColor-default"));
      assert.notEqual(await read("brand-inner", "--brand-color-text-default"), "#fafbe0");
      await close();
    });

    test("graph, label and footer rules follow the nearest island: standard, then high contrast, then standard again", async () => {
      const { p, read, close } = await open();
      const style = (id, prop) => p.evaluate(([id, prop]) => getComputedStyle(document.getElementById(id))[prop], [id, prop]);
      assert.equal(await style("root-blob", "fill"), "rgb(57, 255, 20)");
      assert.equal(await style("root-blob", "stroke"), "rgb(57, 255, 20)");
      assert.equal(await style("hc-blob", "fill"), GREEN, "the high-contrast island keeps its graph");
      assert.equal(await style("hc-nested-blob", "fill"), "rgb(57, 255, 20)", "a standard island inside it is themed again");
      // Dark theme base: translucent label fill. GitHub's own formula for the native dark
      // high-contrast island is not in these pages, so its label keeps the plain inline values.
      assert.equal(await style("root-label", "backgroundColor"), "rgba(215, 58, 74, 0.18)");
      assert.equal(await style("hc-nested-label", "backgroundColor"), "rgba(215, 58, 74, 0.18)");
      assert.equal(await style("hc-label", "backgroundColor"), "rgba(0, 0, 0, 0)");
      assert.equal(await read("hc-nested-brand", "--brand-color-text-default"), "#fafbe0");
      await close();
    });

    test("selection: a native island, its children and the boundary itself paint exactly as without the theme", async () => {
      const ids = ["hc", "hc-text", "hc-child", "hc-nested-inner", "root-label"];
      const selection = (p) => p.evaluate((ids) => Object.fromEntries(ids.map((id) => { const s = getComputedStyle(document.getElementById(id), "::selection"); return [id, [s.color, s.backgroundColor]]; })), ids);
      const shoot = async (p) => {
        const box = await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("hc-text")); getSelection().removeAllRanges(); getSelection().addRange(r); return document.getElementById("hc-text").getBoundingClientRect().toJSON(); });
        // Whole pixels inside the paragraph, so no edge row samples the page canvas around the island.
        const clip = { x: Math.ceil(box.left), y: Math.ceil(box.top), width: Math.floor(box.right) - Math.ceil(box.left), height: Math.floor(box.bottom) - Math.ceil(box.top) };
        return { pixels: await p.screenshot({ clip }), computed: await selection(p) };
      };
      const { p, earlier, close } = await open({ beforeTheme: shoot });
      const now = await shoot(p);
      assert.ok(earlier.pixels.equals(now.pixels), "selected text in the high-contrast island paints as it did before the theme");
      const themedInk = ["rgb(253, 240, 196)", "rgb(32, 64, 106)"];
      if (name === "Firefox") {
        // Gecko matches per element: the native subtree keeps HighlightText on Highlight, and the
        // standard island inside it and the themed root take the theme.
        for (const id of ["hc", "hc-text", "hc-child"]) assert.notDeepEqual(now.computed[id], themedInk, id);
        assert.deepEqual(now.computed["hc-nested-inner"], themedInk);
        assert.deepEqual(now.computed["root-label"], themedInk);
      } else {
        // Highlight styles inherit, so a page holding a native island keeps the browser's own
        // selection everywhere: no selection rule reaches any element.
        for (const id of ["hc", "hc-text", "hc-child"]) assert.deepEqual(now.computed[id], earlier.computed[id], id);
        for (const id of ids) assert.notDeepEqual(now.computed[id], themedInk, id);
      }
      await close();
    });

    test("selection: a page without native islands takes the theme's selection colors throughout", async () => {
      const { p, close } = await open({ body: `${label("root-label")}<div data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_dimmed"><b id="dimmed-text">words</b></div>` });
      for (const id of ["root-label", "dimmed-text"]) {
        assert.deepEqual(await p.evaluate((id) => { const s = getComputedStyle(document.getElementById(id), "::selection"); return [s.color, s.backgroundColor]; }, id), ["rgb(253, 240, 196)", "rgb(32, 64, 106)"], id);
      }
      await close();
    });

    test("activity bars take the resolved graph color; authored, unrelated, native-island and forced-color bars keep GitHub's", async () => {
      const { p, close } = await open({ body: PROFILE });
      const bg = (id) => p.evaluate((id) => getComputedStyle(document.getElementById(id)).backgroundColor, id);
      const width = (id) => p.evaluate((id) => document.getElementById(id).style.width, id);
      assert.equal(await bg("bar"), "rgb(43, 217, 160)");
      assert.equal(await bg("bar-light"), "rgb(43, 217, 160)");
      assert.equal(await width("bar"), "63%");
      assert.equal(await p.evaluate(() => document.querySelector("[role=img]").getAttribute("aria-label")), "63% of commits in November were made to octo/sample");
      assert.equal(await bg("authored-bar"), "rgb(48, 161, 78)");
      assert.equal(await bg("hc-bar"), "rgb(48, 161, 78)");
      assert.equal(await bg("outside-bar"), "rgb(48, 161, 78)");
      assert.notEqual(await bg("loader"), "rgb(43, 217, 160)");
      await p.emulateMedia({ forcedColors: "active" });
      assert.notEqual(await bg("bar"), "rgb(43, 217, 160)");
      await close();
    });

    test("auto mode follows the system scheme with the same stylesheet: a high-contrast night theme stays native", async () => {
      const root = 'data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_high_contrast"';
      const day = await open({ root, colorScheme: "light" });
      assert.equal(await day.read("root", "--bgColor-default"), "#101a2b");
      await day.close();
      const night = await open({ root, colorScheme: "dark" });
      assert.equal(await night.read("root", "--bgColor-default"), native("dark_high_contrast", "--bgColor-default"));
      assert.notEqual(await night.read("root", "--fgColor-default"), "#fafbe0");
      assert.equal(await night.p.evaluate(() => getComputedStyle(document.getElementById("root-blob")).fill), GREEN);
      await night.close();
    });

    test("forced colors removes every theme override", async () => {
      const { p, read, close } = await open();
      await p.emulateMedia({ forcedColors: "active" });
      assert.equal(await p.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
      assert.equal(await read("root", "--bgColor-default"), native("light", "--bgColor-default"));
      assert.equal(await read("island-inner", "--bgColor-default"), native("dark_dimmed", "--bgColor-default"));
      assert.notEqual(await read("brand-inner", "--brand-color-text-default"), "#fafbe0");
      assert.equal(await read("root", "--reskin-on"), "");
      await close();
    });
  });
}
