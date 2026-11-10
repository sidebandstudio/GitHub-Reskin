// The bundled fonts under GitHub's font CSP, in Chromium and Firefox. github.com allows fonts only
// from its asset host, so the fixture sends the same font-src. The userscript hands the theme's
// faces to the page as bytes (FontFace from the embedded WOFF2), which that policy allows: the
// faces load, nothing is refused, and no request is made. The picker's card faces load the same
// way in its frame. Where a browser or manager offers no FontFace, the theme keeps its colors and
// the system fallback stack.
import { FONTS } from "../../../packages/appearance/registry.js";
import { CHOOM_CANVAS, expect, openPanel, painted, panelDocument, test } from "./helpers.mjs";

// GitHub's own directive, as github.com sends it.
const GITHUB_FONT_CSP = { "content-security-policy": "font-src github.githubassets.com" };
const FAMILIES = FONTS.map((font) => font.cssFamily);

const watchCsp = () => {
  if (window.top !== window) return;
  window.__fontViolations = [];
  document.addEventListener("securitypolicyviolation", (event) => event.effectiveDirective === "font-src" && window.__fontViolations.push(event.blockedURI.slice(0, 24)));
};

// The bundled families the painted theme names, and which of them the page has loaded.
const pageFonts = (families) => {
  const css = document.getElementById("reskin-style")?.textContent ?? "";
  const named = families.filter((family) => css.includes(`"${family}"`));
  const loaded = [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replace(/^"|"$/g, ""));
  return { named, loaded: [...new Set(loaded)], ready: named.filter((family) => document.fonts.check(`16px "${family}"`) && loaded.includes(family)), violations: window.__fontViolations ?? [], fontFaceRules: (css.match(/@font-face/g) ?? []).length };
};

test("the theme's bundled faces load from embedded bytes under GitHub's font CSP, with no refusal or request", async ({ manager }) => {
  const gm = await manager({ kind: "sync", headers: GITHUB_FONT_CSP, before: watchCsp });
  const page = await gm.open();
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });
  await expect.poll(async () => (await page.evaluate(pageFonts, FAMILIES)).ready.length).toBeGreaterThan(0);
  const fonts = await page.evaluate(pageFonts, FAMILIES);
  expect(fonts.named.length).toBeGreaterThan(0);
  expect(fonts.ready).toEqual(fonts.named);
  // No @font-face URL for the CSP to refuse.
  expect(fonts).toMatchObject({ violations: [], fontFaceRules: 0 });

  // The picker's cards show their heading faces the same way, in the frame.
  await openPanel(page);
  const frame = await panelDocument(page);
  await expect.poll(() => frame.evaluate((families) => [...document.fonts].filter((face) => face.status === "loaded" && families.includes(face.family.replace(/^"|"$/g, ""))).length, FAMILIES)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__fontViolations)).toEqual([]);
  // Embedded: nothing was fetched for them.
  expect(gm.requests.filter((url) => /\.woff2?($|\?)/.test(url))).toEqual([]);
});

test("without FontFace the theme keeps its colors and the system fallback stack", async ({ manager }) => {
  const gm = await manager({
    kind: "sync",
    headers: GITHUB_FONT_CSP,
    before: () => {
      if (window.top !== window) return;
      window.__errors = [];
      window.addEventListener("error", (event) => window.__errors.push(String(event.message)));
      window.addEventListener("unhandledrejection", (event) => window.__errors.push(String(event.reason)));
      delete window.FontFace;
    },
  });
  const page = await gm.open();
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", styled: true, canvas: CHOOM_CANVAS });
  await page.waitForTimeout(300);
  const fonts = await page.evaluate(pageFonts, FAMILIES);
  expect(fonts.named.length).toBeGreaterThan(0);
  expect(fonts.loaded).toEqual([]);
  // The stack names the face first and the system fallback after it.
  const stack = await page.evaluate((family) => (document.getElementById("reskin-style").textContent.match(new RegExp(`"${family}",[^;}!]+`)) ?? [""])[0], fonts.named[0]);
  expect(stack).toMatch(/(sans-serif|serif|monospace)\s*$/);
  expect(await page.evaluate(() => window.__errors)).toEqual([]);
});
