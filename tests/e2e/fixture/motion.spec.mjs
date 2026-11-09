// Motion: one finite pass on explicit selection only, and only where the visitor can see it;
// nothing on load, view change or under reduced motion and Motion off; never a loop, and only
// transform and opacity move. A pass stops when its box leaves the visible page and never replays.
import { PREFS, decorated, expect, inFrame, mount, painted, test } from "./helpers.mjs";

const FIRST = decorated("nord", { rail: {}, grid: {} });
const MOVING = decorated("dracula", { drift: { shape: "petal", count: 4, durationMs: 1200 }, echo: { durationMs: 200 }, seal: {} });

const animations = (page) =>
  inFrame(page, (doc) =>
    doc.getAnimations().map((a) => {
      const timing = a.effect.getComputedTiming();
      const frames = a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p)));
      return { iterations: timing.iterations, end: timing.endTime, frames, playState: a.playState };
    }),
  );
const running = async (page) => (await animations(page)).filter((a) => a.playState === "running");
const select = (page, theme) => page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [theme, PREFS]);

// The moving box is the pinned heading's strip, the first slot with drift. At 390px the README is
// hidden and it sits inside the first screen.
test("selecting a theme plays one finite pass where it is visible; load and view changes do not", async ({ page, fixtureApp }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await mount(page, fixtureApp, { theme: MOVING });
  expect(await animations(page)).toEqual([]);
  await select(page, FIRST);
  await select(page, MOVING);
  await painted(page);
  const played = await running(page);
  expect(played.length).toBeGreaterThan(0);
  expect(played.length).toBeLessThanOrEqual(6);
  for (const a of played) {
    expect(a.iterations).toBe(1);
    expect(a.end).toBeLessThanOrEqual(1200);
    expect(a.frames.every((p) => p === "opacity" || p === "transform")).toBe(true);
  }
  await page.waitForTimeout(1400);
  expect(await running(page)).toEqual([]);
  await page.evaluate(() => window.reskinPreview.setView("empty"));
  await painted(page);
  await page.evaluate(() => window.reskinPreview.setView("profile"));
  await painted(page);
  expect(await animations(page)).toEqual([]);
});

test("a tall preview at the top of a short viewport plays nothing below the fold", async ({ page, fixtureApp }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page, fixtureApp, { theme: FIRST });
  const geometry = await page.evaluate(() => {
    const frame = document.querySelector("#preview iframe:not([aria-hidden])").getBoundingClientRect();
    const strip = document.querySelector("#preview iframe[aria-hidden]").contentDocument.querySelector('[data-reskin-owned="profile.pinned.heading"]');
    return { frameHeight: frame.height, viewport: innerHeight, strip: strip ? frame.top + strip.getBoundingClientRect().top : null };
  });
  expect(geometry.frameHeight).toBeGreaterThan(geometry.viewport);
  expect(geometry.strip).toBeGreaterThan(geometry.viewport);
  await select(page, MOVING);
  await painted(page);
  expect(await page.locator("[data-reskin-preview]").getAttribute("data-playing")).toBe("0");
  expect(await animations(page)).toEqual([]);
  // Scrolling it into view afterwards does not replay the selection's pass.
  await page.evaluate((y) => window.scrollTo(0, y - 200), geometry.strip);
  await page.waitForTimeout(150);
  expect(await animations(page)).toEqual([]);
});

test("a running pass stops at once when its box scrolls out of view, and does not replay", async ({ page, fixtureApp }) => {
  // Short enough that the page scrolls the pinned strip out of view.
  await page.setViewportSize({ width: 390, height: 400 });
  await mount(page, fixtureApp, { theme: FIRST });
  await select(page, MOVING);
  await painted(page);
  expect((await running(page)).length).toBeGreaterThan(0);
  const playedIn = await page.locator("[data-reskin-preview] iframe:not([aria-hidden])").elementHandle();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // The frame that was moving is replaced by its resting state.
  await expect.poll(() => playedIn.evaluate((node) => node.isConnected)).toBe(false);
  await painted(page);
  expect(await animations(page)).toEqual([]);
  expect(await page.locator("[data-reskin-motion]").count()).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  expect(await animations(page)).toEqual([]);
});

test("Motion off and reduced motion keep the static resting state", async ({ page, fixtureApp }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await mount(page, fixtureApp, { theme: FIRST });
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: { ...p, motion: false } }), [MOVING, PREFS]);
  await painted(page);
  expect(await animations(page)).toEqual([]);
  // Drift rests as one fleck per strip.
  const flecks = (doc) => [...doc.querySelectorAll(".rs-box--strip")].map((strip) => strip.querySelectorAll(".rs-fx-drift").length);
  expect(await inFrame(page, flecks)).toEqual(expect.arrayContaining([1]));
  expect((await inFrame(page, flecks)).every((n) => n <= 1)).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await mount(page, fixtureApp, { theme: FIRST });
  await select(page, MOVING);
  await painted(page);
  expect(await animations(page)).toEqual([]);
  const resting = await inFrame(page, (doc) => ({ drift: [...doc.querySelectorAll(".rs-box--strip")].map((strip) => strip.querySelectorAll(".rs-fx-drift").length), echo: doc.querySelectorAll(".rs-fx-echo").length, keyframes: [...doc.styleSheets].some((s) => [...s.cssRules].some((r) => r.type === 7)) }));
  // Each box that draws echo keeps its two static copies; drift rests as one fleck per strip.
  expect(resting.drift.every((n) => n <= 1) && resting.drift.includes(1)).toBe(true);
  expect(resting.echo % 2).toBe(0);
  expect(resting.echo).toBeGreaterThan(0);
  expect(resting.keyframes).toBe(false);
});

test("on the adapter path a pass plays only inside the viewport and stops when its box leaves it", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  const box = () => page.evaluate(() => document.querySelector('[data-reskin-owned="profile.pinned.heading"] .rs-box')?.getBoundingClientRect().top ?? null);
  const playing = () => page.evaluate(() => document.querySelectorAll("[data-rs-play]").length);
  // A viewport too short to show the pinned heading: nothing plays.
  await page.setViewportSize({ width: 1024, height: 240 });
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, p, { play: true }), [MOVING, PREFS]);
  expect(await box()).toBeGreaterThan(240);
  expect(await playing()).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  // In view it plays; scrolled away mid-pass it returns to rest.
  await page.setViewportSize({ width: 1024, height: 1400 });
  expect(await page.evaluate(() => window.reskinNative.play())).toBe(true);
  expect(await playing()).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1024, height: 240 });
  await expect.poll(playing).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
});
