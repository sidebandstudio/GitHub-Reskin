// Fonts: only the selected face loads, from the runtime adapter's packaged path; a blocked or
// missing file falls back natively; body and code keep their own families.
import { PREFS, decorated, expect, inFrame, mount, test } from "./helpers.mjs";

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
    const copy = doc.querySelector(".rs-copy--heading");
    return { status: [...doc.fonts].map((f) => f.status), text: copy.textContent, width: copy.getBoundingClientRect().width, loaded: doc.fonts.check('600 18px "Reskin Rajdhani"') && [...doc.fonts].some((f) => f.status === "loaded") };
  });
  expect(state.status).toEqual(["error"]);
  expect(state.loaded).toBe(false);
  expect(state.text).toBe("Pinned sentinel copy");
  expect(state.width).toBeGreaterThan(0);
});
