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
// The marketing footer as GitHub renders it on github.com and its 404 page, 2026-11-08.
const footer = (id, inside = "") => `<react-partial partial-name="marketing-footer"><div><div data-color-mode="light"><footer role="contentinfo"><i id="${id}"></i>${inside}</footer></div></div></react-partial>`;
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

const STD = 'data-color-mode="light" data-light-theme="light" data-dark-theme="dark"';
const HC = 'data-color-mode="light" data-light-theme="light_high_contrast" data-dark-theme="dark_high_contrast"';
const UNKNOWN = 'data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_future"';
const self = (id, attrs) => `<svg><path id="${id}-blob" ${attrs} class="js-highlight-blob" fill="#40c463" stroke="#40c463" d="M0 0h1v1z"/></svg>${label(`${id}-label`).replace("<span ", `<span ${attrs} `)}`;

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
    const open = async ({ root = ROOT, body = STANDARD, extra = "", colorScheme = "light", beforeTheme, css = compiled } = {}) => {
      const context = await browser.newContext({ colorScheme });
      const p = await context.newPage();
      await p.setContent(page(root, body, extra));
      const earlier = beforeTheme ? await beforeTheme(p) : undefined;
      await p.addStyleTag({ content: css });
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

    test("an island of an unknown mode leaves its nearest island native, here the root, with or without its own stylesheet", async () => {
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

    test("malformed islands leave their nearest island native, here the root: a missing theme attribute, the wrong one, a stray mode", async () => {
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

    // Everything that decides whether an element looks native: the inherited colors, the Reskin
    // switch and the element's own paint.
    const paint = (ids) => (p) => p.evaluate((ids) => Object.fromEntries(ids.map((id) => {
      const s = getComputedStyle(id === "root" ? document.documentElement : document.getElementById(id));
      return [id, ["--bgColor-default", "--fgColor-default", "--reskin-on", "background-color", "color", "fill", "stroke", "border-color"].map((prop) => s.getPropertyValue(prop).trim())];
    })), ids);
    const themedInk = ["rgb(253, 240, 196)", "rgb(32, 64, 106)"];
    const selectionOf = (p, id) => p.evaluate((id) => { const s = getComputedStyle(document.getElementById(id), "::selection"); return [s.color, s.backgroundColor]; }, id);

    test("islands without theme attributes keep GitHub's colors when they hold only text, nothing, or lose their children", async () => {
      for (const [attrs, content] of [['data-color-mode="dark"', "bare leaf text"], ['data-color-mode="dark"', ""], ['data-color-mode="dark" data-light-theme="light"', "malformed leaf"], [UNKNOWN, "unknown leaf"], ['data-color-mode="dark"', '<span id="kid">child</span>']]) {
        const ids = ["root", "leaf"];
        const { p, read, earlier, close } = await open({ body: `<div id="leaf" ${attrs}>${content}</div><div id="safe" ${STD}><i id="safe-inner"></i></div>`, beforeTheme: paint(ids) });
        if (content.startsWith("<span")) await p.evaluate(() => document.getElementById("kid").remove());
        assert.deepEqual(await paint(ids)(p), earlier, `${attrs} ${content || "empty"}`);
        assert.notDeepEqual(await selectionOf(p, "leaf"), themedInk);
        assert.equal(await read("safe-inner", "--bgColor-default"), "#101a2b", "an island the leaf does not inherit from stays themed");
        await close();
      }
    });

    test("a graph or label that is itself an island follows its own mode, not its parent's", async () => {
      const ids = ["hc-blob", "hc-label"];
      const { p, earlier, close } = await open({ body: `${blob("root-blob")}${self("hc", HC)}<div ${HC}>${self("reopened", STD)}</div>`, beforeTheme: paint(ids) });
      const style = (id, prop) => p.evaluate(([id, prop]) => getComputedStyle(document.getElementById(id))[prop], [id, prop]);
      assert.equal(await style("root-blob", "fill"), "rgb(57, 255, 20)");
      assert.deepEqual(await paint(ids)(p), earlier, "a high-contrast graph or label below the themed root keeps GitHub's paint");
      assert.equal(await style("reopened-blob", "fill"), "rgb(57, 255, 20)", "a standard graph island inside a high-contrast island is themed");
      assert.equal(await style("reopened-label", "backgroundColor"), "rgba(215, 58, 74, 0.18)");
      await close();
      for (const attrs of ['data-color-mode="dark"', UNKNOWN]) {
        const own = ["root", "odd-blob", "odd-label"];
        const odd = await open({ body: self("odd", attrs), beforeTheme: paint(own) });
        assert.deepEqual(await paint(own)(odd.p), odd.earlier, attrs);
        await odd.close();
      }
    });

    test("an unsafe island suppresses only its nearest island with theme attributes", async () => {
      const style = (p, id) => p.evaluate((id) => getComputedStyle(document.getElementById(id)).fill, id);
      // An unrelated unknown island: the root is its nearest island, a sibling island stays themed.
      let ids = ["root", "unknown"];
      let t = await open({ body: `<div id="unknown" ${UNKNOWN}>unknown</div><div id="safe" ${STD}><i id="safe-inner"></i>${blob("safe-blob")}</div>`, beforeTheme: paint(ids) });
      assert.deepEqual(await paint(ids)(t.p), t.earlier);
      assert.equal(await t.read("safe-inner", "--bgColor-default"), "#101a2b");
      assert.equal(await style(t.p, "safe-blob"), "rgb(57, 255, 20)");
      await t.close();
      // Behind a high-contrast island, whose reset already protects it: nothing is suppressed.
      ids = ["unknown"];
      t = await open({ body: `<section ${HC}><div id="unknown" ${UNKNOWN}>unknown</div></section><div ${STD}><i id="safe-inner"></i></div>`, beforeTheme: paint(ids) });
      assert.deepEqual(await paint(ids)(t.p), t.earlier);
      assert.equal(await t.read("root", "--bgColor-default"), "#101a2b");
      assert.equal(await t.read("safe-inner", "--bgColor-default"), "#101a2b");
      await t.close();
      // Inside a nested standard island: that island keeps GitHub's light mode, the root stays themed.
      ids = ["std", "std-inner", "loose"];
      t = await open({ body: `<div id="std" ${STD}><i id="std-inner"></i><div id="loose" data-color-mode="dark">bare</div>${blob("std-blob")}</div>${blob("root-blob")}`, beforeTheme: paint(ids) });
      assert.deepEqual(await paint(ids)(t.p), t.earlier);
      assert.equal(await t.read("std-inner", "--bgColor-default"), native("light", "--bgColor-default"));
      assert.equal(await t.read("root", "--bgColor-default"), "#101a2b");
      assert.equal(await style(t.p, "std-blob"), GREEN);
      assert.equal(await style(t.p, "root-blob"), "rgb(57, 255, 20)");
      await t.close();
      // Four islands deep: the fourth is suppressed, the islands above it stay themed.
      ids = ["deep", "deep-inner"];
      t = await open({ body: `<div ${STD}><i id="second-inner"></i>${blob("second-blob")}<div ${HC}><div id="deep" ${STD}><i id="deep-inner"></i>${blob("deep-blob")}<span data-color-mode="dark">bare</span></div></div></div>`, beforeTheme: paint(ids) });
      assert.deepEqual(await paint(ids)(t.p), t.earlier);
      assert.equal(await style(t.p, "deep-blob"), GREEN);
      assert.equal(await t.read("second-inner", "--bgColor-default"), "#101a2b");
      assert.equal(await style(t.p, "second-blob"), "rgb(57, 255, 20)");
      assert.equal(await t.read("root", "--bgColor-default"), "#101a2b");
      await t.close();
    });

    test("the Brand footer is recognized only in GitHub's structure, and keeps GitHub's Brand colors around an unsafe island", async () => {
      // The partial's island passes its parent's mode through to plain content beside the footer.
      let t = await open({ body: footer("brand-inner").replace("</footer>", '</footer><div id="beside"></div>') });
      assert.equal(await t.read("beside", "--bgColor-default"), "#101a2b");
      assert.equal(await t.read("brand-inner", "--brand-color-text-default"), "#fafbe0");
      await t.close();
      // An island without theme attributes beside the footer, and a bare footer island outside the
      // marketing partial, are not the Brand footer.
      for (const body of [footer("brand-inner").replace("</footer>", '</footer><div data-color-mode="dark">section</div>'), '<div data-color-mode="light"><footer role="contentinfo"><i id="brand-inner"></i></footer></div>']) {
        const { read, close } = await open({ body });
        assert.equal(await read("root", "--bgColor-default"), native("light", "--bgColor-default"), body);
        assert.notEqual(await read("brand-inner", "--brand-color-text-default"), "#fafbe0", body);
        await close();
      }
      // A high-contrast island in the footer protects an unknown island from the root's colors,
      // but not from Brand properties set on the footer, so those stay GitHub's.
      t = await open({ body: footer("brand-inner", `<div ${HC}><div ${UNKNOWN}><i id="deep-inner"></i></div></div>`) });
      assert.equal(await t.read("root", "--bgColor-default"), "#101a2b");
      assert.notEqual(await t.read("brand-inner", "--brand-color-text-default"), "#fafbe0");
      assert.notEqual(await t.read("deep-inner", "--brand-color-text-default"), "#fafbe0");
      await t.close();
    });

    // Native Brand sentinels on the root, and an element painted with them, so a Brand value the
    // footer passes down shows as a change in paint.
    const BRAND_NATIVE = "<style>:root{--brand-color-text-default:#112233;--brand-color-canvas-subtle:#eeeeee}.brand-paint{color:var(--brand-color-text-default);background:var(--brand-color-canvas-subtle)}</style>";
    const brandPaint = (id) => `<span id="${id}" class="brand-paint">Brand words</span>`;
    const footerWith = (own, inside) => `<react-partial partial-name="marketing-footer"><div><div data-color-mode="light"><footer id="footer" ${own} role="contentinfo">${inside}</footer></div></div></react-partial>`;

    test("a high-contrast island in the Brand footer, or the footer itself, keeps GitHub's Brand colors", async () => {
      for (const [own, inside, ids] of [
        ["", `<div id="hc" ${HC}>${brandPaint("probe")}</div><div id="menu" data-color-mode="dark">${brandPaint("menu-probe")}</div>`, ["hc", "probe"]],
        ["", `<div id="menu" data-color-mode="dark"><div id="hc" ${HC}>${brandPaint("probe")}</div></div>`, ["hc", "probe"]],
        [HC, brandPaint("probe"), ["footer", "probe"]],
      ]) {
        const t = await open({ body: footerWith(own, inside), extra: BRAND_NATIVE, beforeTheme: paint(ids) });
        assert.deepEqual(await paint(ids)(t.p), t.earlier, `${own} ${inside}`);
        assert.equal(await t.read("probe", "--brand-color-text-default"), "#112233");
        assert.equal(await t.read("root", "--bgColor-default"), "#101a2b", "the high-contrast island suppresses nothing");
        // A Brand island beside it cannot reach the high-contrast island and keeps the theme.
        if (inside.includes("menu-probe")) assert.equal(await t.read("menu-probe", "--brand-color-text-default"), "#fafbe0");
        await t.close();
      }
      // A standard footer island and a standard island in the footer keep the Brand mapping.
      for (const [own, inside] of [[STD, brandPaint("probe")], ["", `<div ${STD}>${brandPaint("probe")}</div>`]]) {
        const t = await open({ body: footerWith(own, inside), extra: BRAND_NATIVE });
        assert.equal(await t.read("probe", "--brand-color-text-default"), "#fafbe0", `${own} ${inside}`);
        await t.close();
      }
    });

    test("an island without theme attributes in the Brand footer is recognized only with GitHub's light or dark value", async () => {
      const ids = ["root", "footer", "probe"];
      for (const [inside, change] of [
        ['<div id="probe" data-color-mode="sepia">Unknown words</div>'],
        ['<div id="probe" data-color-mode="sepia"></div>'],
        ['<div id="probe" data-color-mode="auto">Auto words</div>'],
        ['<div id="probe" data-color-mode="light">Words</div>', "sepia"],
      ]) {
        const t = await open({ body: footerWith("", inside), extra: BRAND_NATIVE, beforeTheme: change ? undefined : paint(ids) });
        let earlier = t.earlier;
        if (change) {
          // Recognized first, then changed at runtime to a value GitHub never renders.
          assert.equal(await t.read("probe", "--bgColor-default"), "#101a2b");
          assert.equal(await t.read("probe", "--brand-color-text-default"), "#fafbe0");
          await t.p.evaluate((mode) => { document.getElementById("probe").dataset.colorMode = mode; }, change);
          const plain = await t.p.context().newPage();
          await plain.setContent(page(ROOT, footerWith("", inside.replace('"light"', `"${change}"`)), BRAND_NATIVE));
          earlier = await paint(ids)(plain);
          await plain.close();
        }
        assert.deepEqual(await paint(ids)(t.p), earlier, inside);
        assert.notEqual(await t.read("footer", "--brand-color-text-default"), "#fafbe0", inside);
        assert.notDeepEqual(await selectionOf(t.p, "probe"), themedInk, inside);
        await t.close();
      }
      // GitHub's own light and dark values in the footer pass the theme through.
      for (const mode of ["light", "dark"]) {
        const t = await open({ body: footerWith("", `<div id="probe" data-color-mode="${mode}">Words</div>`), extra: BRAND_NATIVE });
        assert.equal(await t.read("probe", "--bgColor-default"), "#101a2b", mode);
        assert.equal(await t.read("probe", "--brand-color-text-default"), "#fafbe0", mode);
        await t.close();
      }
      // The partial's own island takes only those values too.
      const t = await open({ body: footerWith("", '<i id="probe"></i>').replace('<div data-color-mode="light">', '<div data-color-mode="sepia">'), extra: BRAND_NATIVE });
      assert.equal(await t.read("root", "--bgColor-default"), native("light", "--bgColor-default"));
      assert.equal(await t.read("probe", "--brand-color-text-default"), "#112233");
      await t.close();
    });

    test("graph, label and Brand rules hold through one to six nested standard islands, and fail closed only at an unsafe or native one", async () => {
      const deep = (n, inner) => `${`<div ${STD}>`.repeat(n - 1)}<div id="deep" ${STD}>${inner}</div>${"</div>".repeat(n - 1)}`;
      const content = `${blob("blob")}${label("label")}${footer("brand")}`;
      const fill = (p) => p.evaluate(() => getComputedStyle(document.getElementById("blob")).fill);
      const labelBackground = (p) => p.evaluate(() => getComputedStyle(document.getElementById("label")).backgroundColor);
      for (let n = 1; n <= 6; n++) {
        let t = await open({ body: deep(n, content) });
        assert.equal(await t.read("deep", "--reskin-on"), "1", `${n} deep`);
        assert.equal(await fill(t.p), "rgb(57, 255, 20)", `${n} deep graph`);
        assert.equal(await labelBackground(t.p), "rgba(215, 58, 74, 0.18)", `${n} deep label`);
        assert.equal(await t.read("brand", "--brand-color-text-default"), "#fafbe0", `${n} deep Brand`);
        await t.close();
        // A high-contrast island at that depth keeps GitHub's graph, and a standard one inside it
        // is themed again.
        t = await open({ body: deep(n, `<div ${HC}>${blob("hc-blob")}<div ${STD}>${content}</div></div>`) });
        assert.equal(await t.p.evaluate(() => getComputedStyle(document.getElementById("hc-blob")).fill), GREEN, `${n} deep high contrast`);
        assert.equal(await fill(t.p), "rgb(57, 255, 20)", `${n} deep reopened graph`);
        assert.equal(await labelBackground(t.p), "rgba(215, 58, 74, 0.18)", `${n} deep reopened label`);
        await t.close();
        // An island without theme attributes suppresses its nearest island, here the deepest.
        t = await open({ body: deep(n, `${content}<span data-color-mode="dark">bare</span>`) });
        assert.equal(await t.read("deep", "--reskin-on"), "", `${n} deep suppressed`);
        assert.equal(await fill(t.p), GREEN, `${n} deep suppressed graph`);
        assert.equal(await t.read("root", "--reskin-on"), "1", `${n} deep root`);
        await t.close();
      }
      if (name !== "Firefox") return;
      // Gecko before Firefox 151 has no style queries and matches selectors alone: themed through
      // every depth of themed islands, and native wherever its nearest island is not eligible.
      const css = compiled.replace(/@container style\(--reskin-on: 1\)\{\n(?:.*\n){3}\}\n/g, "");
      assert.doesNotMatch(css, /@container/);
      for (let n = 1; n <= 6; n++) {
        let t = await open({ body: deep(n, content), css });
        assert.equal(await fill(t.p), "rgb(57, 255, 20)", `${n} deep graph without style queries`);
        assert.equal(await labelBackground(t.p), "rgba(215, 58, 74, 0.18)", `${n} deep label without style queries`);
        assert.equal(await t.read("brand", "--brand-color-text-default"), "#fafbe0", `${n} deep Brand without style queries`);
        await t.close();
        t = await open({ body: deep(n, `<div ${HC}>${blob("hc-blob")}</div>${content}<span data-color-mode="dark">bare</span>`), css });
        assert.equal(await t.p.evaluate(() => getComputedStyle(document.getElementById("hc-blob")).fill), GREEN, `${n} deep high contrast without style queries`);
        assert.equal(await fill(t.p), GREEN, `${n} deep suppressed graph without style queries`);
        assert.equal(await t.read("brand", "--brand-color-text-default"), "", `${n} deep suppressed Brand without style queries`);
        await t.close();
      }
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
