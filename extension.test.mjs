import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./extension/github-modes.js";
import "./extension/themes.js";

const { THEMES, DEFAULTS, palette, css, contrast, isHex } = globalThis.GitHubReskin;

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

// Removes every @media (prefers-reduced-motion: no-preference) block, braces included.
function withoutMotionBlocks(text) {
  const start = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/g;
  let rest = text;
  let match;
  while ((match = start.exec(rest))) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; depth && i < rest.length; i++) depth += rest[i] === "{" ? 1 : rest[i] === "}" ? -1 : 0;
    rest = rest.slice(0, match.index) + rest.slice(i);
    start.lastIndex = match.index;
  }
  return rest;
}

const popupCss = readFileSync(new URL("./extension/popup.css", import.meta.url), "utf8");
const stylesheets = () => [...THEMES.map((t) => [t.id, css(palette({ theme: t.id }))]), ["popup.css", popupCss]];

test("animations and transitions run only when reduced motion is off", () => {
  const cyberpunk = css(palette({ theme: "cyberpunk" }));
  assert.match(cyberpunk, /prefers-reduced-motion:no-preference\)\{[^]*animation:/);
  // The popup's on/off switch has always slid. Its Cyberpunk styles start at that comment.
  const popupEffects = popupCss.slice(popupCss.indexOf("/* Cyberpunk"));
  assert.match(popupEffects, /animation:/);
  for (const [name, text] of [...THEMES.map((t) => [t.id, css(palette({ theme: t.id }))]), ["popup.css", popupEffects]]) {
    assert.doesNotMatch(withoutMotionBlocks(text), /@keyframes|animation|transition/, name);
  }
});

test("the CSS loads nothing from the network", () => {
  for (const [name, text] of stylesheets()) {
    assert.doesNotMatch(text, /@import|https?:|url\(\s*["']?\/\//i, name);
  }
});
