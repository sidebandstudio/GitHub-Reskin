// Nested GitHub mode islands in real Chromium and Firefox. The page loads all fourteen frozen
// GitHub mode stylesheets, a stand-in stylesheet for a mode GitHub might add later, and one
// compiled theme. Computed custom properties show which elements are themed and which keep
// GitHub's own colors, without recompiling when the system scheme or forced colors change.
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

const declared = Object.fromEntries(MODES.map((id) => [id, readModeFile(raw[id], id, MODE_INDEX.modes[id].base)]));
function native(id, name, seen = 0) {
  const value = id === "dark_future" ? readModeFile(FUTURE, "dark_future", "dark").get(name) : declared[id].get(name);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref && seen < 8 ? native(id, ref[1], seen + 1) : value;
}

// A dark theme with sentinel colors nobody's GitHub mode uses.
const SENTINEL = { "/tokens/canvas": "#101a2b", "/tokens/text": "#fafbe0", "/tokens/link": "#7fd4ff", "/graph/4": "#39ff14", "/semantics/success/text": "#55ee99" };
const resolved = resolvedFromSeed(MODE_INDEX.modes.dark, SENTINEL);
const compiled = compileGitHub(resolved, { seedMode: "dark", policy: "themed" }, PREFS).css;

const page = (root) => `<!doctype html>
<html lang="en" ${root}><head>${MODES.map((id) => `<style>${raw[id]}</style>`).join("")}<style>${FUTURE}</style><style id="reskin">${compiled}</style></head>
<body>
  <svg><path id="root-blob" class="js-highlight-blob" fill="#ff0000" d="M0 0h1v1z"/></svg>
  <div id="hc" data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_high_contrast">
    <svg><path id="hc-blob" class="js-highlight-blob" fill="#ff0000" d="M0 0h1v1z"/></svg>
    <div id="hc-inner"></div>
    <div id="hc-nested" data-color-mode="light" data-light-theme="light" data-dark-theme="dark"><i id="hc-nested-inner"></i></div>
  </div>
  <div id="lhc" data-color-mode="light" data-light-theme="light_tritanopia_high_contrast" data-dark-theme="dark"><i id="lhc-inner"></i></div>
  <div id="cb" data-color-mode="light" data-light-theme="light_colorblind" data-dark-theme="dark"><i id="cb-inner"></i></div>
  <div id="future" data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_future"><i id="future-inner"></i></div>
  <div id="island" data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_dimmed"><i id="island-inner"></i></div>
  <div data-color-mode="light"><footer role="contentinfo"><i id="brand-inner"></i></footer></div>
</body></html>`;

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
    const open = async (root = ROOT, colorScheme = "light") => {
      const context = await browser.newContext({ colorScheme });
      const p = await context.newPage();
      await p.setContent(page(root));
      const read = (id, prop) => p.evaluate(([id, prop]) => getComputedStyle(id === "root" ? document.documentElement : document.getElementById(id)).getPropertyValue(prop).trim().toLowerCase(), [id, prop]);
      return { p, read, close: () => context.close() };
    };

    test("the themed root and same-plan islands take the theme; high-contrast, other-family and unknown islands keep GitHub's colors", async () => {
      const { read, close } = await open();
      assert.equal(await read("root", "--bgColor-default"), "#101a2b");
      assert.equal(await read("root", "color-scheme"), "dark");
      assert.equal(await read("island-inner", "--bgColor-default"), "#101a2b", "a dimmed island is a standard mode, themed with the theme's base");
      for (const [id, mode] of [["hc-inner", "dark_high_contrast"], ["lhc-inner", "light_tritanopia_high_contrast"], ["cb-inner", "light_colorblind"], ["future-inner", "dark_future"]]) {
        for (const prop of ["--bgColor-default", "--fgColor-default", "--fgColor-accent", "--fgColor-success", "--diffBlob-additionLine-bgColor", "--prettylights-syntax-keyword", "--contribution-default-bgColor-4", "--display-blue-fgColor"]) {
          assert.equal(await read(id, prop), native(mode, prop).toLowerCase(), `${id} ${prop} is ${mode}'s own value, not inherited from the themed root`);
        }
      }
      // A standard island inside a high-contrast island gets its own policy again.
      assert.equal(await read("hc-nested-inner", "--bgColor-default"), "#101a2b");
      await close();
    });

    test("non-inherited graph rules reach themed islands only", async () => {
      const { p, close } = await open();
      const fill = (id) => p.evaluate((id) => getComputedStyle(document.getElementById(id)).fill, id);
      assert.equal(await fill("root-blob"), "rgb(57, 255, 20)");
      assert.equal(await fill("hc-blob"), "rgb(255, 0, 0)");
      await close();
    });

    test("the Primer Brand footer island takes the brand mapping", async () => {
      const { read, close } = await open();
      assert.equal(await read("brand-inner", "--brand-color-text-default"), "#fafbe0");
      await close();
    });

    test("auto mode follows the system scheme with the same stylesheet: a high-contrast night theme stays native", async () => {
      const root = 'data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_high_contrast"';
      const day = await open(root, "light");
      assert.equal(await day.read("root", "--bgColor-default"), "#101a2b");
      await day.close();
      const night = await open(root, "dark");
      assert.equal(await night.read("root", "--bgColor-default"), native("dark_high_contrast", "--bgColor-default"));
      assert.notEqual(await night.read("root", "--fgColor-default"), "#fafbe0");
      await night.close();
    });

    test("forced colors removes every theme override", async () => {
      const { p, read, close } = await open();
      await p.emulateMedia({ forcedColors: "active" });
      assert.equal(await p.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
      assert.equal(await read("root", "--bgColor-default"), native("light", "--bgColor-default"));
      assert.equal(await read("island-inner", "--bgColor-default"), native("dark_dimmed", "--bgColor-default"));
      assert.notEqual(await read("brand-inner", "--brand-color-text-default"), "#fafbe0");
      await close();
    });
  });
}
