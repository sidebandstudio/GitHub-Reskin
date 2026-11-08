// Motion: one finite pass on explicit selection only; nothing on load, view change or under
// reduced motion and Motion off; never a loop, and only transform and opacity move.
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

test("selecting a theme plays one finite pass; load and view changes do not", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: MOVING });
  expect(await animations(page)).toEqual([]);
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [FIRST, PREFS]);
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [MOVING, PREFS]);
  await painted(page);
  const running = await animations(page);
  expect(running.length).toBeGreaterThan(0);
  expect(running.length).toBeLessThanOrEqual(6);
  for (const a of running) {
    expect(a.iterations).toBe(1);
    expect(a.end).toBeLessThanOrEqual(1200);
    expect(a.frames.every((p) => p === "opacity" || p === "transform")).toBe(true);
  }
  await page.waitForTimeout(1400);
  expect((await animations(page)).filter((a) => a.playState === "running")).toEqual([]);
  expect(await inFrame(page, (doc) => doc.querySelectorAll("[data-rs-play]").length)).toBe(0);
  await page.evaluate(() => window.reskinPreview.setView("empty"));
  await painted(page);
  await page.evaluate(() => window.reskinPreview.setView("profile"));
  await painted(page);
  expect(await animations(page)).toEqual([]);
});

test("Motion off and reduced motion keep the static resting state", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: FIRST });
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: { ...p, motion: false } }), [MOVING, PREFS]);
  await painted(page);
  expect(await animations(page)).toEqual([]);
  expect(await inFrame(page, (doc) => doc.querySelectorAll(".rs-fx-drift").length)).toBe(1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await mount(page, fixtureApp, { theme: FIRST });
  await page.evaluate(([t, p]) => window.reskinPreview.update({ theme: t, preferences: p }), [MOVING, PREFS]);
  await painted(page);
  expect(await animations(page)).toEqual([]);
  const resting = await inFrame(page, (doc) => ({ drift: doc.querySelectorAll(".rs-fx-drift").length, echo: doc.querySelectorAll(".rs-fx-echo").length, keyframes: [...doc.styleSheets].some((s) => [...s.cssRules].some((r) => r.type === 7)) }));
  // Each box that draws echo keeps its two static copies; drift rests as one fleck per strip.
  expect(resting.drift).toBe(1);
  expect(resting.echo % 2).toBe(0);
  expect(resting.echo).toBeGreaterThan(0);
  expect(resting.keyframes).toBe(false);
});
