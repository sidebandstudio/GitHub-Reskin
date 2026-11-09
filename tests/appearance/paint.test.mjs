// Structured appearance: paints, reading backings, avatar, type roles and the theme's owned CSS,
// under Full, Calm and every child switch. The Choom fixture is a snapshot of S1's faithful port
// (themes/anime/choom-circuit.reskin.json on s1-anime-themes).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { repairTheme, resolveTheme } from "../../packages/engine/index.js";
import { compileAppearance, ownedNodePlan, planAppearance } from "../../packages/appearance/index.js";
import { ownedThemeCss } from "../../packages/appearance/compile.js";
import { gradientFills, layerCss, repeatPeriod, structuredCss, structuredPlan } from "../../packages/appearance/paint.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const seeds = { dark: read("tests/fixtures/seeds/standard-dark.json"), light: read("tests/fixtures/seeds/standard-light.json") };
const FULL = Object.freeze({ enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true });
const CALM = Object.freeze({ ...FULL, extras: false });
const resolve = (theme) => resolveTheme(repairTheme(theme, seeds[theme.base]).theme, { seed: seeds[theme.base], policy: "themed", reducedMotion: false, forcedColors: false });
const choom = read("tests/appearance/fixtures/choom-circuit.reskin.json");
const r = resolve(choom);

test("Choom Full draws its four page layers, header rule, circle avatar frame and condensed headings", () => {
  const plan = structuredPlan(r, FULL);
  assert.equal(plan.page.color, "#0a0a17");
  assert.deepEqual(plan.page.layers.map((l) => [l.size, l.repeat]), [["100% 100vh", "no-repeat"], ["48px 48px", "repeat"], ["48px 48px", "repeat"], ["100% 3px", "repeat"]]);
  assert.equal(plan.header.color, "#070710");
  assert.deepEqual(plan.header.layers.map((l) => l.image), ["linear-gradient(0deg,#fcee0a 1px,transparent 1px)"]);
  assert.deepEqual(plan.avatar, { shape: "circle", frame: { style: "solid", width: 1, color: "#2d2a52" } });
  assert.match(plan.fonts.heading, /^Bahnschrift, "DIN Alternate", "Roboto Condensed", "Arial Narrow"/);
  assert.equal(plan.fonts.body, null);
  assert.equal(plan.banner, null);
  assert.deepEqual(plan.notes, []);
  const css = structuredCss(plan, r, "github");
  assert.match(css, /body:not\(\[data-reskin-native\][^{]*\{background-color:#0a0a17!important;background-image:radial-gradient\(ellipse 80% 50%at 50% -10%/);
  assert.match(css, /\.AppHeader:not\([^{]*\{background-color:#070710!important;background-image:linear-gradient\(0deg,#fcee0a 1px,transparent 1px\)/);
  assert.match(css, /\.avatar-user[^{]*\{box-shadow:0 0 0 1px #2d2a52!important\}/);
  assert.match(css, /letter-spacing:0\.02em!important/);
  assert.doesNotMatch(css, /text-transform/);
  // Reading panels keep an opaque backing at no specificity under the wallpaper.
  assert.match(css, /:where\(\.Box,\.markdown-body,[^)]*\):where\([^)]*\)\)\{background-color:var\(--bgColor-default,#0a0a17\)\}/);
  // The heading role never reaches authored prose or code.
  assert.match(css, /h2:not\(\.markdown-body \*,\.comment-body \*,\.js-comment-body \*\)/);
});

test("Calm keeps solid paints, the avatar shape and the role fonts, and drops layers, banner and glow", () => {
  const neon = resolve({ ...choom, shape: { ...choom.shape, avatar: { shape: "bevel", frame: { style: "neon", width: 2, color: "#fcee0a" } } }, backgrounds: { ...choom.backgrounds, profileBanner: { color: "#11112a", layers: [{ pattern: { kind: "grid", color: "#00f0ff", opacity: 0.1, size: 24 } }] } } });
  const full = structuredPlan(neon, FULL);
  assert.equal(full.avatar.frame.style, "neon");
  assert.ok(full.banner.layers.length);
  const calm = structuredPlan(neon, CALM);
  assert.deepEqual([calm.page.layers.length, calm.page.dropped, calm.header.layers.length], [0, "calm", 0]);
  assert.equal(calm.banner, null);
  assert.equal(calm.avatar.frame.style, "solid");
  assert.ok(calm.fonts.heading);
  const css = compileAppearance(neon, CALM, "github", { css: choom.css, cssAllowed: true });
  assert.doesNotMatch(css, /gradient\(|data-reskin-owned|\.rs-|0 0 12px/);
  assert.match(css, /background-color:#0a0a17!important;background-image:none!important/);
  assert.match(css, /border-radius:0!important/);
  assert.match(css, /@supports \(corner-shape:bevel\)/);
  // Effects off inside Full drops the same decoration but keeps the theme's text and fonts.
  const quiet = structuredPlan(neon, { ...FULL, effects: false });
  assert.deepEqual([quiet.page.layers.length, quiet.page.dropped, quiet.banner, quiet.avatar.frame.style], [0, "effects-off", null, "solid"]);
});

test("Fonts off removes both roles and the type controls; disabled and native resolutions draw nothing", () => {
  const plan = structuredPlan(r, { ...FULL, fonts: false });
  assert.equal(plan.fonts, null);
  assert.equal(plan.typography, null);
  assert.doesNotMatch(structuredCss(plan, r, "github"), /font-family|letter-spacing|text-transform/);
  assert.equal(compileAppearance(r, { ...FULL, enabled: false }, "github"), "");
  const native = resolveTheme(choom, { seed: null, policy: "native-unknown", reducedMotion: false, forcedColors: false });
  assert.equal(compileAppearance(native, FULL, "github", { css: choom.css, cssAllowed: true }), "");
  // A v1 theme without appearance groups keeps GitHub's own look in Calm.
  assert.equal(compileAppearance(resolve(read("themes/classics/editing-suite.reskin.json")), CALM, "github"), "");
});

test("uppercase, tracking and a body role compile with code kept native", () => {
  const typed = resolve({ ...choom, typography: { uppercaseHeadings: true, headingLetterSpacing: 0.1, bodyLetterSpacing: 0.04 } });
  const css = structuredCss(structuredPlan(typed, FULL), typed, "preview");
  assert.match(css, /\{text-transform:uppercase\}/);
  assert.match(css, /letter-spacing:0\.1em/);
  assert.match(css, /body:not\([^{]*\{letter-spacing:0\.04em\}/);
  assert.match(css, /:is\(pre,code,kbd,samp,tt,textarea,[^)]*\)\{letter-spacing:normal\}/);
  assert.doesNotMatch(css, /!important/);
});

test("structured gradients and patterns become bounded CSS layers; images wait for the decoder", () => {
  assert.deepEqual(layerCss({ kind: "gradient", type: "linear", angle: 135, position: "center", stops: [{ color: "#112233", position: 0 }, { color: "#445566", position: 100 }], opacity: 0.5 }), {
    image: "linear-gradient(135deg,rgb(17 34 51 / 0.5) 0%,rgb(68 85 102 / 0.5) 100%)",
    size: "auto",
    repeat: "no-repeat",
    position: "0 0",
  });
  assert.equal(layerCss({ kind: "gradient", type: "radial", angle: 180, position: "top-right", stops: [{ color: "#000000", position: 0 }, { color: "#ffffff", position: 100 }], opacity: 1 }).image.slice(0, 32), "radial-gradient(circle at right ");
  for (const pattern of ["grid", "scanlines", "dots", "diagonal", "grain"]) assert.ok(layerCss({ kind: "pattern", pattern, color: "#00f0ff", opacity: 0.1, size: 24 }).image.includes("rgb(0 240 255 / 0.1)"), pattern);
  assert.equal(layerCss({ kind: "image", asset: "x", mime: "image/png" }), null);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const withImage = resolve({ ...choom, backgrounds: { page: { color: "#0a0a17", layers: [{ image: { data: png, width: 1, height: 1 } }, choom.backgrounds.page.layers[1]] } } });
  const plan = structuredPlan(withImage, FULL);
  assert.equal(plan.page.layers.length, 1);
  assert.equal(plan.notes[0].code, "deferred-capability");
});

test("text over a paint keeps 4.5:1 over every fill; hairline rules and unreadable colors are judged", () => {
  assert.deepEqual(gradientFills("linear-gradient(0deg,#fcee0a 1px,transparent 1px)"), []);
  assert.deepEqual(gradientFills("repeating-linear-gradient(color-mix(in srgb,#e4f3ff 2%,transparent)0 1px,transparent 1px 3px)"), []);
  const [mixed] = gradientFills("radial-gradient(ellipse 80% 50%at 50% -10%,color-mix(in srgb,#00f0ff 10%,transparent),transparent 70%)");
  assert.deepEqual(mixed, { hex: "#00f0ff", alpha: 0.1 });
  assert.deepEqual(gradientFills("linear-gradient(90deg,rgb(255 0 0 / 50%),#0000ff 40%)"), [{ hex: "#ff0000", alpha: 0.5 }, { hex: "#0000ff", alpha: 1 }]);
  assert.equal(gradientFills("linear-gradient(hsl(10 50% 50%),#000)"), null);
  const bright = resolve({ ...choom, backgrounds: { page: { color: "#0a0a17", layers: [{ gradient: { type: "linear", stops: [{ color: "#0a0a17", position: 0 }, { color: "#f0f0f0", position: 100 }] } }] } } });
  const loud = structuredPlan(bright, FULL);
  assert.deepEqual([loud.page.layers.length, loud.page.dropped, loud.notes[0].code], [0, "contrast", "paint-contrast"]);
  const unknown = resolve({ ...choom, backgrounds: { page: { layers: [{ gradientCss: { value: "linear-gradient(hsl(240 40% 8%),#0a0a17)" } }] } } });
  assert.equal(structuredPlan(unknown, FULL).page.dropped, "unverified");
});

test("the theme's owned CSS compiles only with the host's permission and only for owned slots", () => {
  const owned = ownedThemeCss(r, FULL, choom.css, true);
  assert.deepEqual(owned.slots.sort(), ["error.notFound.caption", "profile.activity.heading", "profile.organizations.heading", "profile.pinned.heading", "profile.tag"]);
  assert.match(owned.css, /^:where\(\[data-reskin-css="active"\]\) \[data-reskin-owned\]\[data-reskin-slot="profile\.tag"\]/);
  assert.equal(ownedThemeCss(r, FULL, choom.css, false), null);
  assert.equal(ownedThemeCss(r, CALM, choom.css, true), null);
  assert.equal(ownedThemeCss(r, { ...FULL, effects: false }, choom.css, true), null);
  // Text that is not the admitted text, and a rule for GitHub's own elements, fail closed.
  assert.equal(ownedThemeCss(r, FULL, choom.css.replace("11px", "12px"), true), null);
  const native = { ...choom, css: `${choom.css}.btn{color:var(--reskin-text)}` };
  assert.equal(ownedThemeCss(resolve(native), FULL, native.css, true), null);
  const css = compileAppearance(r, FULL, "github", { css: choom.css, cssAllowed: true });
  assert.match(css, /\[data-reskin-owned\]\{--reskin-canvas:#0a0a17;[^}]*--reskin-link:#fcee0a;/);
  for (const copy of Object.values(choom.flavor.slots)) assert.ok(!css.includes(copy), copy);
  // Fonts off strips font requests from the owned CSS too.
  assert.doesNotMatch(ownedThemeCss(r, { ...FULL, fonts: false }, choom.css, true).css, /font-family/);
});

test("the banner is one owned node, planned only in Full with a reserved anchor", () => {
  const banner = resolve({ ...choom, backgrounds: { ...choom.backgrounds, profileBanner: { color: "#11112a" } } });
  assert.equal(planAppearance(banner, FULL, ["profile.banner"]).banner, true);
  assert.equal(planAppearance(banner, FULL, []).banner, false);
  assert.equal(planAppearance(banner, CALM, ["profile.banner"]).banner, false);
  assert.deepEqual(ownedNodePlan(banner, FULL, ["profile.banner"]), [{ slot: "profile.banner", animated: false }]);
  assert.match(compileAppearance(banner, FULL, "preview"), /\.rs-banner\[data-reskin-owned\]\{background-color:#11112a;background-image:none\}/);
});

test("a tag or caption the theme's CSS styles carries no packaged effects over or beside its copy", () => {
  const slots = ["profile.tag", "profile.pinned.heading", "error.notFound.caption"];
  const plain = planAppearance(r, FULL, slots);
  assert.ok(plain.slots.find((e) => e.slot === "profile.tag").effects.length);
  const styled = planAppearance(r, FULL, slots, { styled: ownedThemeCss(r, FULL, choom.css, true).slots });
  assert.deepEqual(styled.slots.find((e) => e.slot === "profile.tag").effects, []);
  assert.ok(plain.slots.find((e) => e.slot === "error.notFound.caption").effects.length);
  assert.deepEqual(styled.slots.find((e) => e.slot === "error.notFound.caption").effects, []);
  // Heading strips keep their effects beside the styled copy.
  assert.ok(styled.slots.find((e) => e.slot === "profile.pinned.heading").effects.length);
  assert.ok(styled.owned < plain.owned);
});

test("an auto-sized straight repeating gradient is drawn as one tiled period, which paints the same pixels", () => {
  assert.deepEqual(repeatPeriod("repeating-linear-gradient(color-mix(in srgb,#e4f3ff 2%,transparent)0 1px,transparent 1px 3px)"), { axis: "y", px: 3 });
  assert.deepEqual(repeatPeriod("repeating-linear-gradient(to right,#000 0 2px,transparent 2px 6px)"), { axis: "x", px: 6 });
  // Angled, percentage and plain gradients keep their own size.
  for (const value of ["repeating-linear-gradient(45deg,#000 0 2px,transparent 2px 6px)", "repeating-linear-gradient(#000 0 2px,transparent 2px 50%)", "repeating-linear-gradient(#000 1px 2px,transparent 2px 6px)", "linear-gradient(#000 0 2px,transparent 2px)"]) assert.equal(repeatPeriod(value), null, value);
  const value = "repeating-linear-gradient(90deg,#000 0 2px,transparent 2px 6px)";
  assert.deepEqual(layerCss({ kind: "gradientCss", value }), { image: value, size: "6px 100%", repeat: "repeat", position: "0 0" });
  assert.equal(layerCss({ kind: "gradientCss", value, size: "50% 50%" }).size, "50% 50%");
  // The diagonal pattern is a tile too, never one image as large as the page.
  assert.equal(layerCss({ kind: "pattern", pattern: "diagonal", color: "#00f0ff", opacity: 0.1, size: 24 }).size, "24px 24px");
});
