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
  // Copy comes first in the 24-node budget: copy in all seven profile slots leaves no room for the
  // caption's edge, so this theme gives the footer sign-off and the Achievements heading none.
  const slots = Object.fromEntries(Object.entries(THEME.flavor.slots).filter(([slot]) => !["footer.signoff", "profile.achievements.heading"].includes(slot)));
  const theme = { ...THEME, flavor: { ...THEME.flavor, slots } };
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate(([t, p]) => window.reskinGithub.apply(t, { ...p, effects: false, fonts: false }), [theme, PREFS]);
  const textOnly = await nativeBoxes(page);
  await page.evaluate(([t, p]) => window.reskinGithub.apply(t, { ...p, fonts: false }), [theme, PREFS]);
  expect(await page.evaluate(() => document.querySelectorAll('[data-reskin-owned="contributions.caption"] .rs-box--edge').length)).toBe(1);
  expect(await nativeBoxes(page)).toEqual(textOnly);
  expect(textOnly.some(([, id]) => id === "user-activity-overview")).toBe(true);
});

c3Test("the Achievements heading and the footer sign-off take their decoration after GitHub's own nodes, never inside them", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const native = await page.evaluate(() => ({ heading: document.querySelector(".d-md-block > h2").outerHTML, copyright: document.querySelector("footer .flex-shrink-0 > span").outerHTML }));
  const applied = await page.evaluate(([t, p]) => window.reskinGithub.apply(t, p), [THEME, { ...PREFS, fonts: false }]);
  expect(applied.anchors).toEqual(expect.arrayContaining([{ slot: "profile.achievements.heading", insert: "after" }, { slot: "footer.signoff", insert: "after" }]));
  expect(applied.slots).toEqual(expect.arrayContaining(["profile.achievements.heading", "footer.signoff"]));
  const placed = await page.evaluate(() => {
    const at = (slot) => document.querySelector(`[data-reskin-owned="${slot}"]:not([data-reskin-slot])`);
    const heading = at("profile.achievements.heading");
    const signoff = at("footer.signoff");
    return {
      heading: { after: heading?.previousElementSibling?.matches(".d-md-block > h2"), copy: heading?.querySelector(".rs-copy")?.textContent, box: Boolean(heading?.querySelector(".rs-box--strip")), hidden: heading?.getAttribute("aria-hidden") },
      signoff: { tag: signoff?.tagName, after: signoff?.previousElementSibling?.matches("footer .flex-shrink-0 > span"), copy: signoff?.querySelector(".rs-copy")?.textContent, hidden: signoff?.getAttribute("aria-hidden") },
      heading_html: document.querySelector(".d-md-block > h2").outerHTML,
      copyright_html: document.querySelector("footer .flex-shrink-0 > span").outerHTML,
    };
  });
  expect(placed.heading).toEqual({ after: true, copy: "Cred sentinel copy", box: true, hidden: "true" });
  expect(placed.signoff).toEqual({ tag: "P", after: true, copy: "Signoff sentinel line.", hidden: "true" });
  expect([placed.heading_html, placed.copyright_html]).toEqual([native.heading, native.copyright]);
});
