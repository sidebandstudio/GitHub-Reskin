// Structured appearance in real engines: Choom Circuit's page wallpaper, header rule, avatar frame,
// condensed heading role and owned tag/stamp CSS, in the preview and on the adversarial GitHub-like
// page, under Full, Calm and without CSS consent. The two hosts must compute the same styles.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PREFS, expect, inFrame, mount, painted, rgb, test } from "./helpers.mjs";

const CHOOM = JSON.parse(readFileSync(fileURLToPath(new URL("../../appearance/fixtures/choom-circuit.reskin.json", import.meta.url)), "utf8"));
const CALM = { ...PREFS, extras: false };

// Computed facts both hosts share: the same selectors on the same class names.
function facts(doc) {
  const view = doc.defaultView;
  const style = (selector, pseudo) => {
    const node = doc.querySelector(selector);
    return node ? view.getComputedStyle(node, pseudo) : null;
  };
  const pick = (s, keys) => (s ? Object.fromEntries(keys.map((k) => [k, s[k]])) : null);
  return {
    body: pick(style("body"), ["backgroundColor", "backgroundImage", "backgroundSize", "backgroundRepeat"]),
    header: pick(style(".AppHeader"), ["backgroundColor", "backgroundImage"]),
    avatar: pick(style(".h-card .avatar-user"), ["borderTopLeftRadius", "boxShadow"]),
    name: pick(style(".vcard-names"), ["fontFamily", "letterSpacing", "textTransform"]),
    tag: pick(style('[data-reskin-slot="profile.tag"]'), ["textTransform", "letterSpacing", "borderTopColor", "borderTopStyle", "boxShadow", "fontFamily", "fontSize"]),
    pinned: pick(style('[data-reskin-slot="profile.pinned.heading"]'), ["fontFamily", "textShadow"]),
  };
}

const previewFacts = (page) => inFrame(page, facts);

async function openNative(page, fixtureApp, prefs, cssAllowed) {
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.evaluate(([t, p, c]) => window.reskinNative.apply(t, p, { cssAllowed: c }), [CHOOM, prefs, cssAllowed]);
  return page.evaluate(`(${facts.toString()})(document)`);
}

test("Choom Full paints the wallpaper, header rule, avatar frame, condensed headings and owned CSS", async ({ page, fixtureApp }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, fixtureApp, { theme: CHOOM, cssAllowed: true });
  const f = await previewFacts(page);
  expect(f.body.backgroundColor).toBe(rgb("#0a0a17"));
  expect(f.body.backgroundImage.match(/gradient\(/g)).toHaveLength(4);
  // 100vh is the screen's height, not the height of the frame, which fits the whole page.
  // The scanlines repeat every 3px, so they are drawn as one tiled period.
  expect(f.body.backgroundSize).toBe("100% 900px, 48px 48px, 48px 48px, 100% 3px");
  expect(f.body.backgroundRepeat).toMatch(/^no-repeat, repeat, repeat, repeat$/);
  expect(f.header.backgroundColor).toBe(rgb("#070710"));
  expect(f.header.backgroundImage).toMatch(/^linear-gradient\(0deg, rgb\(252, 238, 10\) 1px, (?:transparent|rgba\(0, 0, 0, 0\)) 1px\)$/);
  expect(f.avatar).toEqual({ borderTopLeftRadius: "50%", boxShadow: `${rgb("#2d2a52")} 0px 0px 0px 1px` });
  expect(f.name.fontFamily).toMatch(/^Bahnschrift, "DIN Alternate", "Roboto Condensed"/);
  expect(parseFloat(f.name.letterSpacing)).toBeGreaterThan(0);
  expect(f.tag.textTransform).toBe("uppercase");
  expect(f.tag.borderTopColor).toBe(rgb("#fcee0a"));
  expect(f.tag.fontSize).toBe("11px");
  expect(f.tag.boxShadow).toMatch(/10px/);
  expect(f.pinned.fontFamily).toMatch(/^Bahnschrift/);
  expect(f.pinned.textShadow).toMatch(/12px/);
  // Reading panels stay opaque over the wallpaper.
  expect(await inFrame(page, (doc) => doc.defaultView.getComputedStyle(doc.querySelector(".markdown-body")).backgroundColor)).toBe(rgb("#0a0a17"));
});

test("the Flatlined stamp sits in the 404 illustration's blank corner, and flows below it at 390px", async ({ page, fixtureApp }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, fixtureApp, { theme: CHOOM, view: "404", cssAllowed: true });
  const wide = await inFrame(page, (doc) => {
    const art = doc.querySelector(".error-illustration").getBoundingClientRect();
    const stamp = doc.querySelector('[data-reskin-slot="error.notFound.caption"]');
    const r = stamp.getBoundingClientRect();
    const code = doc.querySelector(".error-illustration .code").getBoundingClientRect();
    const h1 = doc.querySelector(".error-page h1").getBoundingClientRect();
    return {
      corner: stamp.closest("[data-rs-corner]") !== null,
      inside: r.left >= art.left && r.right <= art.right && r.top >= art.top && r.bottom <= art.bottom,
      clear: r.right < code.left || r.left > code.right || r.bottom < code.top || r.top > code.bottom,
      above: r.bottom <= h1.top,
      right: r.left > art.left + art.width / 2,
      transform: doc.defaultView.getComputedStyle(stamp).transform,
      text: stamp.textContent,
      hidden: stamp.closest("[aria-hidden]") !== null,
    };
  });
  expect(wide).toMatchObject({ corner: true, inside: true, clear: true, above: true, right: true, text: "Flatlined", hidden: true });
  expect(wide.transform).not.toBe("none");
  // The real message and links stay.
  expect(await inFrame(page, (doc) => doc.querySelector(".error-page h1").textContent)).toBe("Page not found");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForFunction(() => document.querySelector("#preview iframe:not([aria-hidden])")?.getBoundingClientRect().width < 400);
  await painted(page);
  await expect.poll(() => inFrame(page, (doc) => doc.querySelector("[data-rs-flow] [data-reskin-slot]") !== null)).toBe(true);
  const narrow = await inFrame(page, (doc) => {
    const stamp = doc.querySelector('[data-reskin-slot="error.notFound.caption"]').getBoundingClientRect();
    const art = doc.querySelector(".error-illustration").getBoundingClientRect();
    const h1 = doc.querySelector(".error-page h1").getBoundingClientRect();
    return { below: stamp.top >= art.bottom, beforeHeading: stamp.bottom <= h1.top, width: stamp.width <= doc.documentElement.clientWidth };
  });
  expect(narrow).toEqual({ below: true, beforeHeading: true, width: true });
});

test("Calm keeps solid paints, avatar and heading role, and drops wallpaper, rule, decoration and owned CSS", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: CHOOM, preferences: CALM, cssAllowed: true });
  const f = await previewFacts(page);
  expect(f.body).toMatchObject({ backgroundColor: rgb("#0a0a17"), backgroundImage: "none" });
  expect(f.header).toEqual({ backgroundColor: rgb("#070710"), backgroundImage: "none" });
  expect(f.avatar.borderTopLeftRadius).toBe("50%");
  expect(f.name.fontFamily).toMatch(/^Bahnschrift/);
  expect(f.tag).toBeNull();
  expect(await inFrame(page, (doc) => doc.querySelectorAll("[data-reskin-owned]").length)).toBe(0);
  // Fonts off removes the role and its tracking.
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p, cssAllowed: true }), [CHOOM, { ...CALM, fonts: false }]);
  await painted(page);
  const off = await previewFacts(page);
  expect(off.name.fontFamily).not.toMatch(/Bahnschrift/);
  expect(off.name.letterSpacing).toBe("normal");
});

test("without CSS consent the owned nodes keep their own look and no scope marker is issued", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: CHOOM });
  const f = await previewFacts(page);
  expect(f.body.backgroundImage.match(/gradient\(/g)).toHaveLength(4);
  expect(f.tag.textTransform).toBe("none");
  expect(await inFrame(page, (doc) => doc.querySelectorAll("[data-reskin-css]").length)).toBe(0);
  const html = await page.evaluate(() => window.reskinPreview.srcdoc());
  expect(html).not.toContain("data-reskin-slot=\\\"profile.tag\\\"]{width");
  expect(html).not.toMatch(/\[data-reskin-slot="profile\.tag"\]\{/);
});

for (const [label, prefs] of [["Full", PREFS], ["Calm", CALM]]) {
  test(`live GitHub markup and the preview compute the same ${label} appearance`, async ({ page, fixtureApp }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const live = await openNative(page, fixtureApp, prefs, true);
    await mount(page, fixtureApp, { theme: CHOOM, preferences: prefs, cssAllowed: true });
    const preview = await previewFacts(page);
    expect(live.body).toEqual(preview.body);
    expect(live.header).toEqual(preview.header);
    expect(live.avatar).toEqual(preview.avatar);
    expect(live.name).toEqual(preview.name);
    expect(live.tag).toEqual(preview.tag);
    expect(live.pinned).toEqual(preview.pinned);
    if (label === "Full") expect(live.tag?.textTransform).toBe("uppercase");
  });
}

test("live structured appearance never edits the page and leaves with its style node", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const before = await page.evaluate(() => ({ text: document.body.textContent.length, header: document.querySelector(".AppHeader").outerHTML, aria: document.documentElement.getAttribute("data-reskin-css") }));
  await page.evaluate((t) => window.reskinNative.apply(t, { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true }, { cssAllowed: true }), CHOOM);
  expect(await page.evaluate(() => document.querySelector(".AppHeader").outerHTML)).toBe(before.header);
  // Code keeps its native family and metrics.
  const code = await page.evaluate(() => getComputedStyle(document.querySelector("pre code")));
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("pre")).letterSpacing)).toBe("normal");
  expect(code).toBeTruthy();
  await page.evaluate(() => window.reskinNative.remove());
  expect(await page.evaluate(() => [getComputedStyle(document.body).backgroundImage, document.documentElement.getAttribute("data-reskin-css")])).toEqual(["none", before.aria]);
});
