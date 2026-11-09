// Fonts: only the selected face loads, read once by the controller from the runtime adapter's
// packaged path and embedded in the scriptless frame; a blocked or missing file falls back
// natively; body and code keep their own families. On the GitHub-like page, a theme's bundled body
// face loads beside its heading face, and code keeps its native family.
import { PREFS, classic, decorated, expect, inFrame, mount, test } from "./helpers.mjs";

const theme = (font) => decorated("gruvbox", { rules: { style: "ticks" } }, { font });

test("one selected face loads, and nothing loads with Fonts off", async ({ page, fixtureApp }) => {
  const fonts = [];
  page.on("request", (request) => request.url().endsWith(".woff2") && fonts.push(new URL(request.url()).pathname));
  await mount(page, fixtureApp, { theme: theme("fraunces") });
  await inFrame(page, (doc) => doc.fonts.ready.then(() => null));
  await expect.poll(() => fonts).toEqual(["/assets/fonts/fraunces/fraunces.woff2"]);
  expect(await inFrame(page, (doc) => [...doc.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")))).toEqual(["Reskin Fraunces"]);
  const families = await inFrame(page, (doc) => {
    const style = (selector) => doc.defaultView.getComputedStyle(doc.querySelector(selector)).fontFamily;
    return { body: style("body"), readme: style(".markdown-body"), copy: style(".rs-copy--heading"), size: doc.defaultView.getComputedStyle(doc.querySelector(".rs-copy--heading")).fontSize };
  });
  expect(families.body).not.toMatch(/Reskin/);
  expect(families.readme).not.toMatch(/Reskin/);
  expect(families.copy).toMatch(/^"Reskin Fraunces", Georgia/);
  expect(families.size).toBe("20px");

  fonts.length = 0;
  await mount(page, fixtureApp, { theme: theme("bungee"), preferences: { ...PREFS, fonts: false } });
  await page.waitForTimeout(300);
  expect(fonts).toEqual([]);
  expect(await inFrame(page, (doc) => doc.defaultView.getComputedStyle(doc.querySelector(".rs-copy--heading")).fontFamily)).not.toMatch(/Reskin/);
});

test("a blocked font file falls back to the native stack and the preview stays complete", async ({ page, fixtureApp }) => {
  await page.route("**/*.woff2", (route) => route.fulfill({ status: 404, body: "" }));
  await mount(page, fixtureApp, { theme: theme("rajdhani") });
  await inFrame(page, (doc) => doc.fonts.ready.then(() => null));
  const state = await inFrame(page, (doc) => {
    const copy = doc.querySelector('[data-reskin-owned="profile.pinned.heading"] .rs-copy--heading');
    return { status: [...doc.fonts].map((f) => f.status), text: copy.textContent, width: copy.getBoundingClientRect().width, loaded: [...doc.fonts].some((f) => f.status === "loaded"), family: doc.defaultView.getComputedStyle(copy).fontFamily };
  });
  // Without an embedded copy the frame gets no face at all, so it never tries the network.
  expect(state.status).toEqual([]);
  expect(state.loaded).toBe(false);
  expect(state.family).toMatch(/^"Reskin Rajdhani", /);
  expect(state.text).toBe("Pinned sentinel copy");
  expect(state.width).toBeGreaterThan(0);
});

test("on the GitHub-like page the body face loads beside the heading face, at the weights its text uses, and code stays native", async ({ page, fixtureApp }) => {
  const fonts = [];
  page.on("request", (request) => request.url().endsWith(".woff2") && fonts.push(new URL(request.url()).pathname));
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const theme = { ...classic("gruvbox"), fonts: { heading: "cinzel", body: "ibm-plex-sans" } };
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [theme, PREFS]);
  await page.evaluate(() => document.fonts.ready);
  const state = await page.evaluate(() => {
    const family = (selector) => getComputedStyle(document.querySelector(selector)).fontFamily;
    return {
      readme: family(".markdown-body p"),
      heading: family(".markdown-body h2, h2"),
      code: family("pre"),
      loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family.replace(/"/g, "")} ${f.weight}`),
    };
  });
  expect(state.readme).toMatch(/^"Reskin Industrial Sans", /);
  expect(state.heading).toMatch(/^"Reskin Cinzel", /);
  expect(state.code).not.toMatch(/Reskin/);
  expect(state.loaded).toEqual(expect.arrayContaining(["Reskin Industrial Sans 400", "Reskin Cinzel 600"]));
  // Only the two selected families load, and only weights the page's text uses.
  expect(fonts.length).toBeGreaterThanOrEqual(2);
  expect(fonts.every((path) => /^\/assets\/fonts\/(ibm-plex-sans|cinzel)\//.test(path))).toBe(true);
  expect(fonts).toContain("/assets/fonts/ibm-plex-sans/ibm-plex-sans.woff2");
  expect(new Set(fonts).size).toBe(fonts.length);
});
