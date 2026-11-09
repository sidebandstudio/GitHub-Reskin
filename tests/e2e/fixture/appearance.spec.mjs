// Structured appearance in real engines: Choom Circuit's page wallpaper, header rule, avatar frame,
// condensed heading role and owned tag/stamp CSS, in the preview and on the adversarial GitHub-like
// page, under Full, Calm and without CSS consent. The two hosts must compute the same styles.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PREFS, expect, inFrame, mount, painted, rgb, test, update } from "./helpers.mjs";

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
  // A width change replaces the frame, and a scrollbar that comes or goes can replace it once
  // more, so each read retries on the frame shown when it runs.
  const narrow = () =>
    inFrame(page, (doc) => {
      if (!doc.querySelector("[data-rs-flow] [data-reskin-slot]")) return null;
      const stamp = doc.querySelector('[data-reskin-slot="error.notFound.caption"]').getBoundingClientRect();
      const art = doc.querySelector(".error-illustration").getBoundingClientRect();
      const h1 = doc.querySelector(".error-page h1").getBoundingClientRect();
      return { below: stamp.top >= art.bottom, beforeHeading: stamp.bottom <= h1.top, width: stamp.width <= doc.documentElement.clientWidth };
    }).catch(() => null);
  await expect.poll(narrow).toEqual({ below: true, beforeHeading: true, width: true });
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

// The review's probes: a high-contrast island, native, protected and island children of a themed
// heading, code inside it, and the profile card inside a high-contrast island.
// A frame color of its own, since the fixture has no high-contrast CSS and an island's native
// avatar ring inherits the themed border color.
const TYPED = { ...CHOOM, typography: { uppercaseHeadings: true, headingLetterSpacing: 0.1 }, shape: { ...CHOOM.shape, avatar: { shape: "circle", frame: { style: "solid", width: 3, color: "#ff00ff" } } } };
const ISLAND = 'data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_high_contrast"';

async function probeIslands(page, fixtureApp, island) {
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.evaluate((attrs) => {
    const section = document.createElement("section");
    section.innerHTML = `<h2 id="themed">Themed heading <span id="marked" data-reskin-native>marked child</span> <span id="guarded" data-reskin-protected>protected child</span> <span id="nested" ${attrs}>island child</span> <code id="code">const lowerCase = true</code></h2><span id="themed-avatar" class="avatar avatar-user" style="display:inline-block;width:32px;height:32px"></span><div ${attrs}><h2 id="island">Island heading <code id="island-code">x</code></h2><span id="island-avatar" class="avatar avatar-user" style="display:inline-block;width:32px;height:32px"></span></div>`;
    document.querySelector("main.application-main").append(section);
    const card = document.querySelector(".h-card");
    const wrap = document.createElement("div");
    for (const [, name, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) wrap.setAttribute(name, value);
    card.before(wrap);
    wrap.append(card);
  }, island);
  const read = () =>
    page.evaluate(() =>
      Object.fromEntries(["themed", "marked", "guarded", "nested", "code", "island", "island-code", "island-avatar", "themed-avatar"].map((id) => {
        const s = getComputedStyle(document.getElementById(id));
        return [id, { font: s.fontFamily, tracking: s.letterSpacing, transform: s.textTransform, radius: s.borderTopLeftRadius, shadow: s.boxShadow }];
      })),
    );
  return { read, owned: () => page.evaluate(() => ({ card: document.querySelectorAll(".h-card [data-reskin-owned]").length, page: document.querySelectorAll("[data-reskin-owned]").length })) };
}

for (const [label, prefs] of [["Full", PREFS], ["Calm", CALM]]) {
  test(`${label}: high-contrast islands and native children keep GitHub's type, avatar and decoration; code keeps its tracking and case`, async ({ page, fixtureApp }) => {
    const probe = await probeIslands(page, fixtureApp, ISLAND);
    const before = await probe.read();
    await page.evaluate(([t, p]) => window.reskinNative.apply(t, p, { cssAllowed: true }), [TYPED, prefs]);
    const after = await probe.read();
    // The themed heading itself takes the role.
    expect(after.themed.font).toMatch(/^Bahnschrift/);
    expect(after.themed.transform).toBe("uppercase");
    expect(parseFloat(after.themed.tracking)).toBeGreaterThan(1);
    for (const id of ["marked", "guarded", "nested", "island", "island-code"]) expect(after[id], id).toEqual(before[id]);
    expect(after["island-avatar"]).toMatchObject({ font: before["island-avatar"].font, radius: before["island-avatar"].radius });
    expect(after["island-avatar"].shadow).not.toMatch(/255, 0, 255|3px/);
    expect(after["themed-avatar"]).toMatchObject({ radius: "50%", shadow: "rgb(255, 0, 255) 0px 0px 0px 3px" });
    expect(after.code).toEqual({ ...before.code, tracking: "normal", transform: "none" });
    expect(after.code.font).toMatch(/mono/i);
    const owned = await probe.owned();
    expect(owned.card).toBe(0);
    if (label === "Full") expect(owned.page).toBeGreaterThan(0);
  });
}

test("an unknown island keeps its heading native, and the page follows the Primer adapter's suppression", async ({ page, fixtureApp }) => {
  const probe = await probeIslands(page, fixtureApp, 'data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_future"');
  const before = await probe.read();
  const body = () => page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  await page.evaluate((t) => window.reskinNative.apply(t, { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true }, { cssAllowed: true }), TYPED);
  const after = await probe.read();
  expect(after.island).toEqual(before.island);
  expect(after.nested).toEqual(before.nested);
  expect(after.code).toEqual(before.code);
  // An unknown island suppresses the root island it inherits from, so nothing of C5 is drawn.
  expect(after.themed).toEqual(before.themed);
  expect(await body()).toBe("none");
  expect((await probe.owned()).page).toBe(0);
});

test("the live 404 stamp follows its illustration through resizes and a late size change", async ({ page, fixtureApp }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixtureApp.url("views.html"));
  await page.waitForFunction(() => window.reskinViews);
  await page.evaluate((t) => window.reskinViews.render({ view: "404", theme: t, preferences: { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true }, cssAllowed: true }), CHOOM);
  const state = () =>
    page.evaluate(() => {
      const stamp = document.querySelector('[data-reskin-slot="error.notFound.caption"]').getBoundingClientRect();
      const art = document.querySelector(".error-illustration").getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      return {
        corner: document.querySelector("[data-rs-corner]") !== null,
        flow: document.querySelector("[data-rs-flow]") !== null,
        inArt: stamp.left >= art.left && stamp.right <= art.right && stamp.top >= art.top && stamp.bottom <= art.bottom,
        inView: stamp.left >= 0 && stamp.right <= width,
        scroll: document.documentElement.scrollWidth <= width,
      };
    });
  const corner = { corner: true, flow: false, inArt: true, inView: true, scroll: true };
  const flow = { corner: false, flow: true, inView: true, scroll: true };
  expect(await state()).toEqual(corner);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(state).toMatchObject(flow);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(state).toEqual(corner);
  // A late image or font that narrows the illustration without a viewport change.
  await page.evaluate(() => (document.querySelector(".error-illustration").style.maxWidth = "360px"));
  await expect.poll(state).toMatchObject(flow);
  await page.evaluate(() => document.querySelector(".error-illustration").style.removeProperty("max-width"));
  await expect.poll(state).toEqual(corner);
});

// Black ink on white, as in the review: a red-to-green ramp passes at both ends and fails between.
const { css: _css, flavor: _flavor, code: _code, ...BARE } = CHOOM;
const INK = { ...BARE, name: "Ink", base: "light", colors: { accent: "#000000", background: "#ffffff", contribution: "#1a7f37", text: "#000000" }, overrides: { mutedText: "#000000", border: "#d0d7de", surface: "#ffffff" } };
const paints = (page) => inFrame(page, (doc) => [doc.body, doc.querySelector(".AppHeader")].map((node) => doc.defaultView.getComputedStyle(node).backgroundImage));

test("bright repeating stripes and a gradient whose middle fails are not drawn under text", async ({ page, fixtureApp }) => {
  const stripes = { gradientCss: { size: "auto", value: "repeating-linear-gradient(#ffffff 0 2px,transparent 2px 3px)" } };
  await mount(page, fixtureApp, { theme: { ...CHOOM, backgrounds: { page: { color: "#0a0a17", layers: [stripes] }, header: { color: "#070710", layers: [stripes] } } } });
  expect(await paints(page)).toEqual(["none", "none"]);
  const ramps = [
    { gradient: { type: "linear", angle: 90, stops: [{ color: "#ff0000", position: 0 }, { color: "#009900", position: 100 }] } },
    { gradientCss: { size: "auto", value: "linear-gradient(90deg,#ff0000,#009900)" } },
  ];
  for (const layer of ramps) {
    await update(page, { ...INK, backgrounds: { page: { color: "#ffffff", layers: [layer] } } });
    expect((await paints(page))[0]).toBe("none");
  }
  // Each end alone reads, so it is drawn.
  await update(page, { ...INK, backgrounds: { page: { color: "#ffffff", layers: [{ gradientCss: { size: "auto", value: "linear-gradient(90deg,#ff0000,#ff0000)" } }] } } });
  expect((await paints(page))[0]).toMatch(/^linear-gradient\(/);
});
