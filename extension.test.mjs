import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import "./extension/github-modes.js";
import "./extension/themes.js";
import "./extension/slang.js";

const { THEMES, DEFAULTS, palette, css, load, contrast, isHex, slang } = globalThis.GitHubReskin;

test("every theme keeps text, muted text, links and button text readable", () => {
  for (const theme of THEMES) {
    for (const key of ["bg", "text", "accent", "graph", "surface", "border", "muted"]) {
      if (theme[key] !== undefined) assert.ok(isHex(theme[key]), `${theme.id}.${key}`);
    }
    const p = palette({ theme: theme.id });
    assert.ok(contrast(p.text, p.bg) >= 4.5, `${theme.id} text ${contrast(p.text, p.bg).toFixed(2)}`);
    assert.ok(contrast(p.muted, p.bg) >= 4.5, `${theme.id} muted ${contrast(p.muted, p.bg).toFixed(2)}`);
    assert.ok(contrast(p.link, p.bg) >= 4.5, `${theme.id} link`);
    assert.ok(contrast("#ffffff", p.strong) >= 4.5, `${theme.id} button text`);
  }
});

test("edited colors replace the theme's, and broken ones are ignored", () => {
  const custom = { bg: "#000000", text: "#ffffff", accent: "#ff0000", graph: "#00ff00" };
  const edited = palette({ theme: "dracula", custom });
  assert.equal(edited.bg, "#000000");
  assert.equal(edited.shades[4], "#00ff00");
  assert.notEqual(edited.surface, THEMES.find((t) => t.id === "dracula").surface);

  assert.equal(palette({ theme: "dracula", custom: { ...custom, bg: "black" } }).bg, "#282a36");
  assert.equal(palette({ theme: "missing" }).bg, THEMES[0].bg);
});

test("css repaints GitHub's variables and every graph level", () => {
  const out = css(palette(DEFAULTS));
  assert.match(out, /--bgColor-default:#0a0a17 !important;/);
  for (let level = 0; level <= 4; level++) {
    assert.match(out, new RegExp(`\\.ContributionCalendar-day\\[data-level="${level}"\\]\\{fill:#[0-9a-f]{6} !important`));
  }
  assert.match(out, /color-scheme:dark !important/);
  assert.match(css(palette({ theme: "solarized-light" })), /color-scheme:light !important/);
});

test("dark themes bring GitHub's dark code and diff colors, light themes the light ones", () => {
  const dark = css(palette({ theme: "editing-suite" }));
  const light = css(palette({ theme: "solarized-light" }));
  assert.match(dark, /--prettylights-syntax-keyword:#ff7b72 !important/);
  assert.match(light, /--prettylights-syntax-keyword:#cf222e !important/);
  // High contrast and colorblind palettes point some diff colors elsewhere, so those are reset too.
  assert.match(light, /--diffBlob-additionWord-fgColor:var\(--fgColor-default\) !important/);
  // The theme's own colors come after GitHub's, so they win.
  assert.ok(dark.lastIndexOf("--bgColor-default:#0a0a0b") > dark.indexOf("--bgColor-default:"));
});

test("an unreadable text color falls back to black or white for derived colors", () => {
  const p = palette({ theme: "editing-suite", custom: { bg: "#ffffff", text: "#ededea", accent: "#f2a93b", graph: "#f2a93b" } });
  assert.equal(p.text, "#ededea");
  assert.equal(p.ink, "#000000");
  assert.ok(contrast(p.muted, p.bg) >= 4.5);
  assert.ok(contrast(p.link, p.bg) >= 4.5);
});

test("Cyberpunk is the first theme and the default", () => {
  assert.equal(THEMES[0].id, "cyberpunk");
  assert.equal(DEFAULTS.theme, "cyberpunk");
  assert.equal(palette(DEFAULTS).effects, "cyberpunk");
});

test("only themes with effects get the effects CSS, and it follows edited colors", () => {
  for (const theme of THEMES) {
    const out = css(palette({ theme: theme.id }));
    assert.equal(out.includes("reskin-effects:"), Boolean(theme.effects), theme.id);
  }
  const custom = { bg: "#101010", text: "#f0f0f0", accent: "#ff2a6d", graph: "#39ff14" };
  const out = css(palette({ theme: "cyberpunk", custom }));
  const effects = out.slice(out.indexOf("reskin-effects:"));
  assert.match(effects, /#ff2a6d/);
  assert.match(effects, /#39ff14/);
  assert.doesNotMatch(out, /#fcee0a|#00f0ff/);
});

test("only Cyberpunk swaps GitHub's labels for street slang, with its colors or edited ones", () => {
  for (const theme of THEMES) {
    const out = css(palette({ theme: theme.id }));
    assert.equal(out.includes("reskin-slang"), theme.effects === "cyberpunk", theme.id);
  }
  const custom = { bg: "#101010", text: "#f0f0f0", accent: "#ff2a6d", graph: "#39ff14" };
  const out = css(palette({ theme: "cyberpunk", custom }));
  assert.match(out, /\.vcard-names:not\([^{]*\)::before\{content:"\/\/ choom" \/ ""/);
  assert.match(out.slice(out.indexOf("reskin-slang")), /#ff2a6d/);
});

test("screen readers hear GitHub's words, not the slang", () => {
  const out = slang(palette(DEFAULTS));
  // Every added word has empty alternative text.
  const contents = [...out.matchAll(/content:([^;}]*)/g)].map(([, value]) => value);
  assert.ok(contents.length > 10, `${contents.length} contents`);
  for (const value of contents) assert.match(value, /^"[^"]+" \/ ""$/, value);
  // GitHub's labels are shrunk, which keeps them in the accessibility tree, and each gets slang in its place.
  assert.doesNotMatch(out, /display:\s*none|visibility:\s*hidden|content-visibility/);
  const shrunk = [...out.matchAll(/^([^{}\n]+)\{[^}]*font-size:0 !important\}$/gm)].map(([, selector]) => selector);
  assert.ok(shrunk.length > 10, `${shrunk.length} labels`);
  for (const selector of shrunk) assert.ok(out.includes(`\n${selector}::before{content:"`), selector);
  assert.doesNotMatch(out, /@import|https?:|url\(/i);
});

// What people wrote, as GitHub's Markdown rendered it on 2026-10-31 (api.github.com/markdown),
// made to look like the labels slang.js swaps: heading links to achievements, releases and
// contributors, an itemprop follows link, a Pro title, the graph legend's ids and GitHub's classes.
const AUTHORED = `<h2><a href="https://github.com/whoisaldo?tab=achievements">My personal trophies</a></h2>
<h2><a href="https://github.com/acme/repo/releases"><span>Download version 27</span></a></h2>
<h2><a href="https://github.com/acme/repo/graphs/contributors"><span>Top 10 contributors</span></a></h2>
<h2>Crews I run with</h2><a itemprop="follows" href="https://github.com/acme">acme</a>
<p><span title="Label: Pro">Pro tip 3</span> <span>Less than 5</span><span id="user-content-contribution-graph-legend-level-0">x</span><span id="user-content-contribution-graph-legend-level-4">y</span><span>More than 9</span></p>
<div id="user-content-js-contribution-activity"><h2>Contribution activity in 2025</h2></div>
<div><h2>Pinned 3 repos</h2></div>
o<span>Footer 2026</span>
<div>Card</div>
<div><a target="_blank" rel="noopener noreferrer" href="x.png"><img src="x.png" style="max-width: 100%;"></a></div>`;

test("slang changes only GitHub's own labels, never what people wrote", () => {
  const out = slang(palette(DEFAULTS));
  // The rules inside an @supports are checked too, but not the @supports itself.
  const selectors = [...out.matchAll(/^([^{}\n@][^{}\n]*)\{/gm)].map(([, selector]) => selector.replace(/::(before|after)$/, ""));
  assert.ok(selectors.length > 30, `${selectors.length} selectors`);
  // Nothing inside a README, comment, issue or pull request title, or file, gists' included, ever matches.
  const exclusion = ":not(:is(.markdown-body,.comment-body,.js-comment-body,.markdown-title,.file,.blob-wrapper,.react-code-file-contents) *)";
  for (const selector of selectors) assert.ok(selector.endsWith(exclusion), selector);
  // Each starts inside a part of GitHub's page named by a class, id or data attribute, never at a
  // bare element or link someone could write, like h2 a[href$='/releases'].
  const authored = {
    classes: [...AUTHORED.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => value.split(" ")),
    ids: [...AUTHORED.matchAll(/id="([^"]*)"/g)].map(([, value]) => value),
    data: [...AUTHORED.matchAll(/(data-[\w-]+)=/g)].map(([, name]) => name),
  };
  assert.deepEqual(authored.classes, []);
  assert.deepEqual(authored.data, []);
  assert.ok(authored.ids.every((id) => id.startsWith("user-content-")));
  for (const selector of selectors) {
    const container = selector.split(" ")[0];
    const names = (container.match(/[.#][\w-]+|\[data-[\w-]+/g) || []).map((token) => token.slice(1));
    assert.ok(names.length, selector);
    for (const name of names) assert.ok(![...authored.classes, ...authored.ids, ...authored.data].includes(name), selector);
  }
  // Counts beside a label keep their size: Releases' and Contributors' counters are never the label,
  // and whatever sits in Pinned's heading beside the word, its spinner and saved note, is put back.
  for (const link of ["/releases'", "/graphs/contributors'"]) {
    const label = selectors.find((selector) => selector.includes(link));
    assert.ok(label.includes("span:not(.Counter,[data-component='CounterLabel'])"), label);
  }
  assert.match(out, /^\.Layout-main \.js-pinned-items-reorder-container > h2 > \*:not\([^{]*\)\{font-size:12px\}$/m);
});

// The value css() gives a variable last, which is the one that applies.
const cssVar = (out, name) => [...out.matchAll(new RegExp(`${name}:(#[0-9a-f]{6})`, "g"))].at(-1)[1];

test("Cyberpunk primary buttons keep readable text at rest, on hover and when pressed", () => {
  // Every theme's accent, greys around where black and white text cross over, and light and dark extremes.
  const accents = [...THEMES.map((t) => t.accent), "#707070", "#767676", "#777777", "#7b7b7b", "#808080", "#868686", "#fff6a8", "#1b1464", "#000000", "#ffffff"];
  for (const [bg, text] of [["#0a0a17", "#e4f3ff"], ["#ffffff", "#000000"]]) {
    for (const accent of accents) {
      const out = css(palette({ theme: "cyberpunk", custom: { bg, text, accent, graph: "#00f0ff" } }));
      const fg = cssVar(out, "--button-primary-fgColor-rest");
      assert.equal(cssVar(out, "--button-primary-iconColor-rest"), fg);
      for (const state of ["rest", "hover", "active"]) {
        const ratio = contrast(fg, cssVar(out, `--button-primary-bgColor-${state}`));
        assert.ok(ratio >= 4.5, `${accent} on ${bg}, ${state}: ${ratio.toFixed(2)}`);
      }
    }
  }
  // The theme's own colors keep their hover and pressed shades.
  const out = css(palette(DEFAULTS));
  assert.equal(cssVar(out, "--button-primary-bgColor-hover"), "#fcf12f");
  assert.equal(cssVar(out, "--button-primary-bgColor-active"), "#ded109");
});

test("on a light edited background, Cyberpunk's neon icons, caret and marks still read", () => {
  const p = palette({ theme: "cyberpunk", custom: { bg: "#ffffff", text: "#000000", accent: "#fcee0a", graph: "#00f0ff" } });
  const out = css(p);
  const effects = out.slice(out.indexOf("reskin-effects:"));
  const pick = (pattern) => effects.match(pattern)[1];
  // Non-text UI needs 3:1 (WCAG 1.4.11), text 4.5:1.
  const ui = {
    "selected tab icon": pick(/\[aria-current='page'\]\) svg\{color:(#[0-9a-f]{6})/),
    "selected tab underline": pick(/\[aria-current='page'\]\)::after\{background:(#[0-9a-f]{6})/),
    caret: pick(/caret-color:(#[0-9a-f]{6})/),
    "scrollbar thumb": pick(/scrollbar-color:(#[0-9a-f]{6})/),
    "underline nav": cssVar(out, "--underlineNav-borderColor-active"),
    "focus outline": cssVar(out, "--focus-outlineColor"),
    "accent border": cssVar(out, "--borderColor-accent-emphasis"),
    "focus ring": pick(/:focus-visible\{box-shadow:0 0 0 3px (#[0-9a-f]{6})/),
  };
  const text = {
    "selected tab text": pick(/\[aria-current='page'\]\)\{color:(#[0-9a-f]{6})/),
    link: cssVar(out, "--fgColor-link"),
    "accent text": cssVar(out, "--fgColor-accent"),
  };
  for (const bg of [p.bg, p.surface, p.inset, p.raised]) {
    for (const [name, color] of Object.entries(ui)) assert.ok(contrast(color, bg) >= 3, `${name} ${color} on ${bg}: ${contrast(color, bg).toFixed(2)}`);
    for (const [name, color] of Object.entries(text)) assert.ok(contrast(color, bg) >= 4.5, `${name} ${color} on ${bg}: ${contrast(color, bg).toFixed(2)}`);
  }
  assert.ok(contrast(pick(/::selection\{background-color:(#[0-9a-f]{6})/), pick(/::selection\{[^}]*;color:(#[0-9a-f]{6})/)) >= 4.5, "selected text");
  // The default dark Cyberpunk keeps its raw neon for these.
  const dark = css(palette(DEFAULTS));
  assert.equal(cssVar(dark, "--focus-outlineColor"), "#fcee0a");
  assert.match(dark, /caret-color:#fcee0a/);
});

// Every variable css() paints a page background, surface, inset or raised panel with, links included,
// and the accent tint GitHub puts branch names and topics on in accent text.
const PAGE_BGS = ["--bgColor-default", "--bgColor-muted", "--bgColor-inset", "--header-bgColor", "--headerSearch-bgColor", "--page-header-bgColor", "--card-bgColor", "--overlay-bgColor", "--control-bgColor-rest", "--button-default-bgColor-rest", "--sideNav-bgColor-selected", "--bgColor-accent-muted"];

const LINK_VARS = new RegExp(`(${[...PAGE_BGS, "--fgColor-link", "--fgColor-accent"].join("|")}):(#[0-9a-f]{6})`, "g");

// The lowest contrast Cyberpunk's links and accent text get on any of those, with the given colors.
function worstLink(custom) {
  const out = css(palette({ theme: "cyberpunk", custom: { graph: "#00f0ff", ...custom } }));
  // Later values replace earlier ones, as in the cascade.
  const vars = Object.fromEntries([...out.matchAll(LINK_VARS)].map(([, name, value]) => [name, value]));
  return Math.min(...["--fgColor-link", "--fgColor-accent"].flatMap((fg) => PAGE_BGS.map((bg) => contrast(vars[fg], vars[bg]))));
}

test("Cyberpunk links and accent text reach 4.5:1 on every page background for any accent", () => {
  const levels = Array.from({ length: 16 }, (_, i) => (i * 17).toString(16).padStart(2, "0"));
  // The last text color reads on the background (4.6:1) but not on the slightly lighter surfaces.
  for (const [bg, text] of [["#0a0a17", "#e4f3ff"], ["#ffffff", "#000000"], ["#000000", "#767676"]]) {
    for (const r of levels) for (const g of levels) for (const b of levels) {
      const accent = `#${r}${g}${b}`;
      const ratio = worstLink({ bg, text, accent });
      assert.ok(ratio >= 4.5, `${accent} on ${bg}: ${ratio.toFixed(2)}`);
    }
  }
});

test("Cyberpunk links and accent text reach 4.5:1 on mid grey and mid colored backgrounds too", () => {
  // Around the middle, where the surfaces can fall either side of where black and white text cross over.
  const greys = Array.from({ length: 33 }, (_, i) => (0x60 + i).toString(16).padStart(2, "0")).map((v) => `#${v}${v}${v}`);
  const colors = ["#ff0000", "#e00000", "#00a000", "#008f00", "#0000ff", "#3060ff", "#d06000", "#c08000", "#8000ff", "#a020a0", "#008080", "#009999", "#e0407f", "#6a8a3a"];
  const texts = ["#ffffff", "#000000", "#e4f3ff", "#111111", "#f0f0f0", "#ffff99", "#001a33", "#ccffff"];
  const accents = [...new Set([...THEMES.map((t) => t.accent), "#000000", "#ffffff", "#757575", "#808080", "#ff2a6d", "#39ff14", "#1b1464", "#fff6a8"])];
  let cases = 0;
  for (const bg of [...greys, ...colors]) {
    for (const text of texts.filter((c) => contrast(c, bg) >= 4.5)) {
      for (const accent of accents) {
        const ratio = worstLink({ bg, text, accent });
        assert.ok(ratio >= 4.5, `${accent} with ${text} on ${bg}: ${ratio.toFixed(2)}`);
        cases++;
      }
    }
  }
  assert.ok(cases > 1000, `${cases} cases`);
  // The reported case: white text on #757575 and a black accent.
  assert.ok(worstLink({ bg: "#757575", text: "#ffffff", accent: "#000000" }) >= 4.5);
  // The accent tint is mixed from the graph color, so that changes too. The reported case: a
  // green accent and a yellow graph on the default background, 4.15:1 on the tint.
  assert.ok(worstLink({ bg: "#0a0a17", text: "#e4f3ff", accent: "#337755", graph: "#fcee0a" }) >= 4.5);
  const levels = Array.from({ length: 6 }, (_, i) => (i * 51).toString(16).padStart(2, "0"));
  for (const [bg, text] of [["#0a0a17", "#e4f3ff"], ["#ffffff", "#000000"], ["#757575", "#ffffff"], ["#808080", "#000000"], ["#3060ff", "#ffffff"]]) {
    for (const graph of ["#fcee0a", "#ffffff", "#000000", "#39ff14", "#1b1464"]) {
      for (const r of levels) for (const g of levels) for (const b of levels) {
        const accent = `#${r}${g}${b}`;
        const ratio = worstLink({ bg, text, accent, graph });
        assert.ok(ratio >= 4.5, `${accent} and graph ${graph} with ${text} on ${bg}: ${ratio.toFixed(2)}`);
      }
    }
  }
  // Where some color already reads on every surface, Cyberpunk leaves GitHub's surfaces to the palette.
  assert.doesNotMatch(css(palette(DEFAULTS)).slice(css(palette(DEFAULTS)).indexOf("reskin-effects:")), /--overlay-bgColor/);
});

// A stand-in for chrome.storage.local that records what gets saved. With `deferred`, each read
// takes what's stored when it starts and returns it only when its `release` is called.
function fakeStorage(data, deferred = false) {
  const saved = [];
  const reads = [];
  return {
    data,
    saved,
    reads,
    get(keys) {
      const value = Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
      if (!deferred) return Promise.resolve(value);
      return new Promise((resolve) => reads.push({ release: () => resolve(value) }));
    },
    async set(patch) {
      // A copy, since the popup's objects come from another realm.
      patch = structuredClone(patch);
      saved.push(patch);
      Object.assign(data, patch);
    },
  };
}

// Just enough of the DOM for popup.js. Returns the popup's controls once settings have loaded.
// With `frame`, popup.js runs on a GitHub page, as in the userscript, and the card goes into a
// frame's document. The page's own document then throws if the card touches it.
async function openPopup(storage, { frame = false } = {}) {
  const all = [];
  const element = (tag) => {
    const listeners = {};
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      style: { setProperty() {} },
      classList: { toggle() {} },
      setAttribute() {},
      removeAttribute() {},
      append: (...kids) => el.children.push(...kids),
      addEventListener: (type, fn) => (listeners[type] = fn),
      fire: (type) => listeners[type]({ target: el }),
      querySelectorAll: () => all.filter((e) => e.tagName === "INPUT"),
    };
    all.push(el);
    return el;
  };
  const ids = Object.fromEntries(["themes", "colors", "enabled", "reset", "warning", "status"].map((id) => [id, element("div")]));
  const main = element("main");
  main.inert = true;
  const cardDocument = {
    documentElement: element("html"),
    body: element("body"),
    activeElement: null,
    createElement: element,
    getElementById: (id) => ids[id],
    querySelector: () => main,
  };
  const page = new Proxy({}, { get: (_, key) => assert.fail(`The card used the page's document.${String(key)}`) });
  const document = frame ? page : cardDocument;
  const location = { protocol: frame ? "https:" : "chrome-extension:" };
  const chrome = { storage: { local: storage } };
  vm.runInNewContext(readFileSync(new URL("./extension/popup.js", import.meta.url), "utf8"), { GitHubReskin: globalThis.GitHubReskin, document, location, chrome });
  if (frame) {
    // On a GitHub page, popup.js waits for the userscript to give it the frame.
    assert.equal(ids.themes.children.length, 0);
    globalThis.GitHubReskin.card(cardDocument);
  }
  const loaded = async () => {
    while (main.inert) await new Promise((resolve) => setTimeout(resolve));
  };
  return {
    loaded,
    pick: (id) => ids.themes.children.find((b) => b.dataset.id === id).fire("click"),
    toggle: (on) => {
      ids.enabled.checked = on;
      ids.enabled.fire("change");
    },
    reset: () => ids.reset.fire("click"),
    setColor: (key, value) => {
      const picker = ids.colors.children.flatMap((row) => row.children).find((e) => e.type === "color" && e.dataset.key === key);
      picker.value = value;
      picker.fire("input");
    },
  };
}

test("an upgrade from 1.0 keeps edited colors on Editing Suite, and new installs get Cyberpunk", async () => {
  const fresh = fakeStorage({});
  assert.deepEqual(await load(fresh), DEFAULTS);
  assert.equal((await load(fresh)).theme, "cyberpunk");
  assert.deepEqual(fresh.saved, []);

  // 1.0 saved only the colors when you edited them.
  const custom = { bg: "#101010", text: "#f0f0f0", accent: "#ff2a6d", graph: "#39ff14" };
  const upgraded = fakeStorage({ custom });
  const settings = await load(upgraded);
  assert.equal(settings.theme, "editing-suite");
  assert.deepEqual(settings.custom, custom);
  assert.equal(palette(settings).bg, "#101010");
  assert.equal(palette(settings).effects, null);
  // Loading never writes. Each load works the theme out again.
  assert.equal((await load(upgraded)).theme, "editing-suite");
  assert.deepEqual(upgraded.saved, []);

  for (const theme of ["cyberpunk", "nord"]) {
    const chosen = fakeStorage({ theme, custom, enabled: false });
    assert.deepEqual(await load(chosen), { enabled: false, theme, custom });
    assert.deepEqual(chosen.saved, []);
  }
});

test("every popup change saves the theme it was made on", async () => {
  const custom = { bg: "#101010", text: "#f0f0f0", accent: "#ff2a6d", graph: "#39ff14" };
  const actions = [
    ["turning it off", (popup) => popup.toggle(false), { theme: "editing-suite", enabled: false }],
    ["resetting the colors", (popup) => popup.reset(), { theme: "editing-suite", custom: null }],
    ["editing a color", (popup) => popup.setColor("graph", "#00F0FF"), { theme: "editing-suite", custom: { ...custom, graph: "#00f0ff" } }],
    ["picking a theme", (popup) => popup.pick("nord"), { theme: "nord", custom: null }],
  ];
  for (const [name, act, expected] of actions) {
    // Colors edited in 1.0, with no theme saved.
    const storage = fakeStorage({ custom: { ...custom } });
    const popup = await openPopup(storage);
    await popup.loaded();
    act(popup);
    assert.deepEqual(storage.saved, [expected], name);
  }
});

test("in a userscript frame, the card saves the same way and never uses GitHub's page", async () => {
  const custom = { bg: "#101010", text: "#f0f0f0", accent: "#ff2a6d", graph: "#39ff14" };
  const storage = fakeStorage({ custom: { ...custom } });
  const card = await openPopup(storage, { frame: true });
  await card.loaded();
  card.setColor("graph", "#00F0FF");
  card.toggle(false);
  card.pick("nord");
  assert.deepEqual(storage.saved, [
    { theme: "editing-suite", custom: { ...custom, graph: "#00f0ff" } },
    { theme: "editing-suite", enabled: false },
    { theme: "nord", custom: null },
  ]);
});

test("a late load in another tab can't undo a theme picked in the popup", async () => {
  const custom = { bg: "#101010", text: "#f0f0f0", accent: "#ff2a6d", graph: "#39ff14" };
  const storage = fakeStorage({ custom }, true);
  // The content script and the popup both read the 1.0 settings before either is done.
  const tab = load(storage);
  const popup = await openPopup(storage);
  assert.equal(storage.reads.length, 2);
  storage.reads[1].release();
  await popup.loaded();
  popup.pick("cyberpunk");
  storage.reads[0].release();
  assert.equal((await tab).theme, "editing-suite");
  await new Promise((resolve) => setTimeout(resolve));
  assert.deepEqual(storage.saved, [{ theme: "cyberpunk", custom: null }]);
  assert.equal(storage.data.theme, "cyberpunk");
  // The tab repaints on that change with a fresh load.
  const fresh = load(storage);
  storage.reads[2].release();
  assert.equal((await fresh).theme, "cyberpunk");
});

// Runs content.js against a stand-in page. Returns its stylesheet, the localStorage cache, and a
// way to report a storage change.
function openTab(storage) {
  const style = { textContent: "" };
  const cache = new Map();
  const listeners = [];
  const document = { createElement: () => style, documentElement: { append() {} } };
  const localStorage = { getItem: (k) => cache.get(k) ?? null, setItem: (k, v) => cache.set(k, v), removeItem: (k) => cache.delete(k) };
  const chrome = { storage: { local: storage, onChanged: { addListener: (fn) => listeners.push(fn) } } };
  vm.runInNewContext(readFileSync(new URL("./extension/content.js", import.meta.url), "utf8"), { GitHubReskin: globalThis.GitHubReskin, document, localStorage, chrome });
  return { style, cache, change: (changes) => listeners.forEach((fn) => fn(changes, "local")) };
}

test("a tab's first read finishing late can't repaint over a newer change", async () => {
  const storage = fakeStorage({ theme: "editing-suite" }, true);
  const tab = openTab(storage);
  // The popup picks Cyberpunk while the tab's first read is still out.
  storage.data.theme = "cyberpunk";
  tab.change({ theme: { oldValue: "editing-suite", newValue: "cyberpunk" } });
  assert.equal(storage.reads.length, 2);
  storage.reads[1].release();
  await new Promise((resolve) => setTimeout(resolve));
  storage.reads[0].release();
  await new Promise((resolve) => setTimeout(resolve));
  const cyberpunk = css(palette({ ...DEFAULTS, theme: "cyberpunk" }));
  assert.equal(tab.style.textContent, cyberpunk);
  assert.equal(tab.cache.get("github-reskin-css"), cyberpunk);
});

// sha256 of css() for every theme without effects, plus one with edited colors. It was
// computed from main before effects existed. Change it only when you mean to change how
// those themes look, or after regenerating extension/github-modes.js.
const PLAIN_CSS_SHA256 = "eb1b9710b801c12a8be39e3940f48b03fc554d2daeb3df8c3e36e31d82382c8f";

test("themes without effects keep exactly the CSS they had before", () => {
  const custom = { bg: "#000000", text: "#ffffff", accent: "#ff0000", graph: "#00ff00" };
  const outputs = THEMES.filter((t) => !t.effects).map((t) => css(palette({ theme: t.id })));
  outputs.push(css(palette({ theme: "editing-suite", custom })));
  assert.equal(createHash("sha256").update(outputs.join("\n---\n")).digest("hex"), PLAIN_CSS_SHA256);
});

// Splits out every block that starts with the global regex `start`, braces included.
function splitBlocks(text, start) {
  const blocks = [];
  let rest = text;
  let match;
  while ((match = start.exec(rest))) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; depth && i < rest.length; i++) depth += rest[i] === "{" ? 1 : rest[i] === "}" ? -1 : 0;
    blocks.push(rest.slice(match.index + match[0].length, i - 1));
    rest = rest.slice(0, match.index) + rest.slice(i);
    start.lastIndex = match.index;
  }
  return { blocks, rest };
}

// Splits out every @media (prefers-reduced-motion: <value>) block, braces included.
const splitMotionBlocks = (text, value) =>
  splitBlocks(text, new RegExp(`@media\\s*\\(\\s*prefers-reduced-motion\\s*:\\s*${value}\\s*\\)\\s*\\{`, "g"));

// The selectors in a list, split at commas outside parentheses.
function selectorList(text) {
  const list = [""];
  let depth = 0;
  for (const c of text) {
    depth += c === "(" ? 1 : c === ")" ? -1 : 0;
    if (c === "," && !depth) list.push("");
    else list[list.length - 1] += c;
  }
  return list.map((selector) => selector.trim());
}

// [selectors, declarations] for each innermost rule.
const rules = (text) => [...text.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selectors, body]) => [selectors.trim(), body]);

const popupCss = readFileSync(new URL("./extension/popup.css", import.meta.url), "utf8");
const stylesheets = () => [...THEMES.map((t) => [t.id, css(palette({ theme: t.id }))]), ["popup.css", popupCss]];

test("animations and transitions run only when reduced motion is off", () => {
  const cyberpunk = css(palette({ theme: "cyberpunk" }));
  assert.match(cyberpunk, /prefers-reduced-motion:no-preference\)\{[^]*animation:/);
  assert.match(popupCss, /animation:/);
  for (const [name, text] of stylesheets()) {
    const { rest } = splitMotionBlocks(text.replace(/\/\*[^]*?\*\//g, ""), "no-preference");
    const { blocks, rest: always } = splitMotionBlocks(rest, "reduce");
    assert.doesNotMatch(always, /@keyframes|animation/, name);
    // The popup's on/off switch has always slid. Cyberpunk turns that off under reduced motion.
    const stopped = new Set();
    for (const [selectors, body] of rules(blocks.join(""))) {
      if (/transition:\s*none/.test(body)) for (const selector of selectors.split(",")) stopped.add(selector.trim());
    }
    for (const [selector, body] of rules(always)) {
      if (/transition:(?!\s*none)/.test(body)) assert.ok(stopped.has(`[data-effects="cyberpunk"] ${selector}`), `${name}: ${selector}`);
    }
  }
});

test("the CSS loads nothing from the network", () => {
  for (const [name, text] of stylesheets()) {
    assert.doesNotMatch(text, /@import|https?:|url\(\s*["']?\/\//i, name);
  }
});

test("where corner-shape doesn't draw, Gecko included, Cyberpunk's bevels become square corners", () => {
  const gate = /@supports \(not \(corner-shape: ?bevel\)\) or \(-moz-appearance: ?none\) ?\{/;
  assert.match(css(palette({ theme: "cyberpunk" })), gate);
  assert.match(popupCss, gate);
});

test("every Cyberpunk bevel, slang's tags included, has a square fallback in Gecko's gate", () => {
  const gate = /@supports \(not \(corner-shape: ?bevel\)\) or \(-moz-appearance: ?none\) ?\{/g;
  const p = palette({ theme: "cyberpunk" });
  for (const [name, text] of [["css", css(p)], ["slang", slang(p)]]) {
    const { blocks, rest } = splitBlocks(text.replace(/\/\*[^]*?\*\//g, ""), gate);
    assert.ok(blocks.length, name);
    const squared = new Set(rules(blocks.join("")).filter(([, body]) => /border-radius:0( !important)?(;|$)/.test(body)).flatMap(([selectors]) => selectorList(selectors)));
    const beveled = rules(rest).filter(([, body]) => /corner-shape:\s*bevel/.test(body)).flatMap(([selectors]) => selectorList(selectors));
    assert.ok(beveled.length, name);
    for (const selector of beveled) assert.ok(squared.has(selector), `${name}: ${selector}`);
  }
  // The choom tag and the 404 stamp glow, so they get no clip-path bevel.
  const { blocks } = splitBlocks(slang(p), gate);
  assert.doesNotMatch(blocks.join(""), /clip-path/);
});

test("Cyberpunk's marketing footer reads on its inset background, and only Cyberpunk has it", () => {
  const footer = (out) => out.match(/\nfooter\[class\*='footer__'\]\[role='contentinfo'\],footer\[class\*='footer__'\]\[role='contentinfo'\] \[data-color-mode\]\{([^}]*)\}/)?.[1];
  for (const theme of THEMES) assert.equal(Boolean(footer(css(palette({ theme: theme.id })))), theme.effects === "cyberpunk", theme.id);
  const greys = ["#606060", "#757575", "#808080", "#8a8a8a"];
  const customs = [
    { bg: "#0a0a17", text: "#e4f3ff" },
    { bg: "#ffffff", text: "#000000" },
    { bg: "#000000", text: "#767676" },
    ...greys.flatMap((bg) => ["#ffffff", "#000000"].filter((text) => contrast(text, bg) >= 4.5).map((text) => ({ bg, text }))),
  ];
  for (const custom of [null, ...customs]) {
    for (const accent of custom ? ["#fcee0a", "#000000", "#ffffff", "#808080", "#337755"] : [null]) {
      const settings = custom ? { theme: "cyberpunk", custom: { ...custom, accent, graph: "#fcee0a" } } : DEFAULTS;
      const vars = Object.fromEntries([...footer(css(palette(settings))).matchAll(/(--[\w-]+):(#[0-9a-f]{6})/g)].map(([, name, value]) => [name, value]));
      const canvas = vars["--brand-color-canvas-subtle"];
      assert.equal(vars["--brand-color-canvas-default"], canvas);
      assert.equal(vars["--brand-button-secondary-bgColor-rest"], canvas);
      const pairs = [
        ["text", "--brand-color-text-default", canvas, 4.5],
        ["muted text", "--brand-color-text-muted", canvas, 4.5],
        ["links", "--brand-Link-color-default", canvas, 4.5],
        ["menu item on hover", "--brand-color-text-default", vars["--brand-ActionMenu-color-item-hover"], 4.5],
        ["top edge and heading dot", "--brand-color-accent-primary", canvas, 3],
        ["primary button", "--brand-button-primary-fgColor-rest", vars["--brand-button-primary-bgColor-rest"], 4.5],
        ["primary button on hover", "--brand-button-primary-fgColor-rest", vars["--brand-button-primary-bgColor-hover"], 4.5],
        ["primary button pressed", "--brand-button-primary-fgColor-rest", vars["--brand-button-primary-bgColor-active"], 4.5],
        ["secondary button", "--brand-button-secondary-fgColor-rest", canvas, 4.5],
      ];
      for (const [what, fg, bg, min] of pairs) {
        const ratio = contrast(vars[fg], bg);
        assert.ok(ratio >= min, `${what} with ${JSON.stringify(settings.custom)}: ${ratio.toFixed(2)}`);
      }
    }
  }
  // The default footer uses the theme's own text and muted colors.
  const defaults = footer(css(palette(DEFAULTS)));
  assert.match(defaults, /--brand-color-text-default:#e4f3ff !important/);
  assert.match(defaults, /--brand-color-text-muted:#9a9ccc !important/);
});

test("Cyberpunk issue labels follow its background, not the OS light or dark setting", () => {
  const threshold = (out) => out.match(/IssueLabel'\]\)\{--lightness-threshold:([.\d]+)/)[1];
  assert.equal(threshold(css(palette({ theme: "cyberpunk" }))), ".6");
  assert.equal(threshold(css(palette({ theme: "cyberpunk", custom: { bg: "#ffffff", text: "#000000", accent: "#fcee0a", graph: "#00f0ff" } }))), ".453");
});

test("Cyberpunk's top glow is drawn once and scrolls with the page", () => {
  const body = css(palette({ theme: "cyberpunk" })).match(/\nbody\{([^}]*)\}/)[1];
  assert.doesNotMatch(body, /background-attachment/);
  assert.match(body, /background-size:100% 100vh,/);
  assert.match(body, /background-repeat:no-repeat,/);
});
