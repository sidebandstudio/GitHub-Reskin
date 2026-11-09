// The real C3 content adapter: its guarded profile fixture served as github.com, its locateSlots
// anchors (four of them appended inside GitHub's own hosts), C3's compiler and this package's
// decoration. The tests exist whenever C3's extension/content/github and tests/primer fixtures
// are in the checkout. Until C3 merges, the fixture app bundles a stand-in and this file registers
// no tests (the required projects fail on a skip, so none is marked).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP, PREFS, decorated, expect, test } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PROFILE = join(ROOT, "tests/primer/fixtures/profile.html");
const C3 = existsSync(PROFILE) && existsSync(join(ROOT, "extension/content/github/index.js"));
// One effect per box leaves room in the 24-node budget for every slot's decoration.
const THEME = decorated("dracula", { rail: { shape: "notch" } }, { font: "rajdhani" });

const c3Test = C3 ? test : () => {};

async function open(page) {
  const html = readFileSync(PROFILE, "utf8").replace("</head>", '<script type="module" src="/__reskin/app.js"></script></head>');
  const app = readFileSync(join(APP, "app.js"), "utf8");
  await page.route("https://github.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/__reskin/app.js") return route.fulfill({ contentType: "text/javascript", body: app });
    if (route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html", body: html });
    return route.abort();
  });
  await page.goto("https://github.com/octo-sample");
  await page.waitForFunction(() => window.reskinGithub?.available);
}

const nativeBoxes = (page) =>
  page.evaluate(() => [...document.body.querySelectorAll("*")].filter((n) => !n.closest("[data-reskin-owned]")).map((n) => {
    const r = n.getBoundingClientRect();
    return [n.tagName, n.id, Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100, Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100];
  }));

c3Test("C3's append anchors keep their decoration and GitHub's words, and removal restores the page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const before = await page.evaluate(() => ({ html: document.body.innerHTML, text: document.body.textContent }));
  const applied = await page.evaluate(([t, p]) => window.reskinGithub.apply(t, p), [THEME, { ...PREFS, fonts: false }]);
  expect(applied.policy).toBe("themed");
  const appended = applied.anchors.filter((a) => a.insert === "append").map((a) => a.slot).sort();
  expect(appended).toEqual(["profile.activity.heading", "profile.organizations.heading", "profile.pinned.heading", "profile.tag"]);
  expect(applied.slots.sort()).toEqual(applied.anchors.map((a) => a.slot).sort());
  expect(applied.owned).toBeLessThanOrEqual(24);
  // Every appended strip or badge draws its effects.
  const drawn = await page.evaluate((slots) => slots.map((slot) => document.querySelectorAll(`[data-reskin-owned="${slot}"] .rs-fx`).length), appended);
  for (const count of drawn) expect(count).toBeGreaterThan(0);
  // GitHub's own words are unchanged; only owned copy was added.
  const added = await page.evaluate(() => [...document.querySelectorAll("[data-reskin-owned] .rs-copy")].map((n) => n.textContent).join(""));
  expect(await page.evaluate(() => document.body.textContent)).toHaveLength(before.text.length + added.length);
  await page.evaluate(() => window.reskinGithub.remove());
  expect(await page.evaluate(() => document.body.innerHTML)).toBe(before.html);
});

c3Test("with Text on, toggling Effects never moves the activity overview after C3's caption anchor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate(([t, p]) => window.reskinGithub.apply(t, { ...p, effects: false, fonts: false }), [THEME, PREFS]);
  const textOnly = await nativeBoxes(page);
  await page.evaluate(([t, p]) => window.reskinGithub.apply(t, { ...p, fonts: false }), [THEME, PREFS]);
  expect(await page.evaluate(() => document.querySelectorAll('[data-reskin-owned="contributions.caption"] .rs-box--edge').length)).toBe(1);
  expect(await nativeBoxes(page)).toEqual(textOnly);
  expect(textOnly.some(([, id]) => id === "user-activity-overview")).toBe(true);
});
