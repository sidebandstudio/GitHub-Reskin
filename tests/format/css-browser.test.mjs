// The review's browser-confirmed probes (reviews/c2b-r1.md findings 2 and 5) in Chromium and
// Firefox: whatever the sanitizer and compiler admit for an owned decoration renders within the
// 360x96px, 4px border, 24px blur, 8px translation and 8deg rotation bounds, and the probes that
// rendered 100000px or 16px/16deg there are refused before they reach a page. Pages run offline
// under a no-network CSP. Without Playwright's browsers, as in a bare `node --test`, the test is
// skipped; `npm test` counts that skip as a failure. The second review's probes (reviews/c2b-r2.md
// blockers 1 and 3) add shadows read from the engine's exported variables for a theme whose
// radius is 999px, and the movement of the box's center under a rotation and its origin.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { chromium, firefox } from "@playwright/test";
import { cssVariables, resolveTheme } from "../../packages/engine/index.js";
import { compileCss, sanitizeCss } from "../../packages/format/index.js";

const SLOT = '[data-reskin-slot="profile.tag"]';
const CASES = [
  // [id, declarations, admitted]
  ["width-clamp", "width:calc(clamp(100000px,10px,1px))", false],
  ["border-clamp", "border-width:calc(clamp(100000px,10px,1px));border-style:solid", false],
  ["translate-clamp", "transform:translateX(calc(clamp(100000px,0px,8px)))", false],
  ["blur-clamp", "box-shadow:0 0 calc(clamp(100000px,10px,1px)) rgb(0 0 0 / .8)", false],
  ["translate-sum", "transform:translateX(8px) translateX(8px)", false],
  ["rotate-sum", "transform:rotate(8deg) rotate(8deg)", false],
  ["rotate-then-translate", "transform:rotate(8deg) translate(8px,8px)", false],
  ["width-clamp-in-range", "width:calc(clamp(10px,100000px,360px))", true],
  ["border-boundary", "border-width:4px;border-style:solid", true],
  ["blur-boundary", "box-shadow:0 0 calc(clamp(0px,30px,24px)) rgb(0 0 0 / .8)", true],
  ["translate-rotate-boundary", "transform:translate(8px,-8px) rotate(8deg)", true],
  ["rotate-boundary", "transform:rotate(-8deg)", true],
  ["blur-radius-variable", "box-shadow:0 0 var(--reskin-radius) rgb(0 0 0 / .8)", false],
  ["spread-radius-variable", "box-shadow:0 0 0 var(--reskin-radius) rgb(0 0 0 / .8)", false],
  ["text-blur-radius-variable", "text-shadow:0 0 var(--reskin-radius) rgb(0 0 0 / .8)", false],
  ["blur-local-alias", "--theme-b:var(--reskin-radius);box-shadow:0 0 var(--theme-b) rgb(0 0 0 / .8)", false],
  ["blur-spread-boundary-variable-color", "box-shadow:0 0 24px 4px var(--reskin-accent);text-shadow:0 0 24px rgb(0 0 0 / .8)", true],
  ["origin-distant", "width:20px;height:20px;transform-origin:360px 360px;transform:rotate(8deg)", false],
  ["origin-split", `transform-origin:360px 360px}${SLOT}{transform:rotate(8deg)`, false],
  ["origin-media", `transform:rotate(8deg)}@media (min-width:1px){${SLOT}{transform-origin:360px 360px}`, false],
  ["origin-centered-wide", "width:360px;height:96px;transform-origin:center;transform:translate(8px,-8px) rotate(8deg)", true],
  ["origin-centered-split", `width:360px;height:96px;transform-origin:50% 50% 0}${SLOT}{transform:translate(-8px,8px) rotate(-8deg)`, true],
];

// The page variables of a valid theme whose corner radius is 999px.
const seed = JSON.parse(readFileSync(new URL("../fixtures/seeds/colorblind-dark.json", import.meta.url), "utf8"));
const theme = { schemaVersion: 1, name: "Probe", base: "dark", colors: { background: "#111111", text: "#ffffff", accent: "#ffcc00" }, shape: { corners: { radius: 999 } } };
const variables = Object.entries(cssVariables(resolveTheme(theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false })))
  .map(([name, value]) => `${name}:${value}`)
  .join(";");

const installed = [chromium, firefox].every((type) => existsSync(type.executablePath()));

// Width and height of the box, border width, blur and spread radii, translation and rotation,
// from the computed style, and how far the center of the box's bounding rectangle moves when its
// transform is removed, which also counts the movement its origin causes.
function measure() {
  const element = document.getElementById("target");
  const style = getComputedStyle(element);
  const matrix = style.transform === "none" ? [1, 0, 0, 1, 0, 0] : style.transform.match(/-?[\d.e+-]+/g).map(Number);
  const [a, b, , , e, f] = matrix;
  const lengths = (shadow) => (shadow === "none" ? [] : shadow.replace(/rgba?\([^)]*\)/, "").trim().split(/\s+/).map((n) => Number(n.replace("px", ""))));
  const [, , blur = 0, spread = 0] = lengths(style.boxShadow);
  const [, , textBlur = 0] = lengths(style.textShadow);
  const center = () => {
    const r = element.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const [cx, cy] = center();
  element.style.setProperty("transform", "none", "important");
  const [nx, ny] = center();
  element.style.removeProperty("transform");
  return { width: parseFloat(style.width), border: parseFloat(style.borderTopWidth), blur, spread, textBlur, x: e, y: f, rotate: (Math.atan2(b, a) * 180) / Math.PI, dx: cx - nx, dy: cy - ny };
}

test("r1 browser probes: admitted owned CSS renders within its bounds in Chromium and Firefox", { skip: installed ? false : "Playwright's Chromium and Firefox are not installed" }, async () => {
  const compiled = CASES.map(([id, declarations, admitted]) => {
    const sanitized = sanitizeCss(`${SLOT}{${declarations}}`);
    const result = sanitized.ok ? compileCss(sanitized.value, { cssAllowed: true }) : sanitized;
    return { id, admitted, css: result.ok ? result.css : null };
  });
  for (const type of [chromium, firefox]) {
    const browser = await type.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      await page.route("**/*", (route) => route.abort());
      for (const { id, admitted, css } of compiled) {
        const at = `${type.name()} ${id}`;
        if (css === null) {
          assert.equal(admitted, false, `${at} should be admitted`);
          continue;
        }
        await page.setContent(
          `<html data-reskin-css="active"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>:root{${variables}}#host{width:360px;height:96px;margin:120px}[data-reskin-owned]{display:block;width:20px;height:20px}${css}</style></head><body><div id="host"><div id="target" data-reskin-owned data-reskin-slot="profile.tag">Tag</div></div></body></html>`,
        );
        const m = await page.evaluate(measure);
        assert.ok(m.width <= 360 && m.border <= 4 && m.blur <= 24 && m.spread <= 4 && m.textBlur <= 24, `${at}: ${JSON.stringify(m)}`);
        assert.ok(Math.abs(m.x) <= 8.001 && Math.abs(m.y) <= 8.001 && Math.abs(m.rotate) <= 8.001, `${at}: ${JSON.stringify(m)}`);
        assert.ok(Math.abs(m.dx) <= 8.01 && Math.abs(m.dy) <= 8.01, `${at}: the center moves ${JSON.stringify(m)}`);
        assert.equal(admitted, true, `${at} rendered ${JSON.stringify(m)} but should be refused`);
      }
    } finally {
      await browser.close();
    }
  }
});
