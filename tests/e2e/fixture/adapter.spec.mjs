// The GitHub adapter path on an adversarial page: compiled CSS plus mountAppearance at located
// anchors, next to authored text that repeats GitHub's section names and slot copy, and native
// controls with real accessible names.
import { PREFS, decorated, expect, test } from "./helpers.mjs";

const THEME = decorated("tokyo-night", { rail: { shape: "wave" }, seal: { shape: "sprig" }, drift: { shape: "ember", count: 4 } }, { font: "cormorant-garamond" });

async function open(page, fixtureApp) {
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
}

const authored = () =>
  ["#readme", ".comment-body", ".js-issue-title", "pre", ".user-profile-bio", ".pinned-item-desc", ".vcard-names", "form"].map((selector) => {
    const node = document.querySelector(selector);
    return [selector, node.textContent, node.querySelectorAll("[data-reskin-owned]").length];
  });

test("no authored text, control name or native structure changes, and removal restores the page exactly", async ({ page, fixtureApp }) => {
  await open(page, fixtureApp);
  const before = { html: await page.evaluate(() => document.body.innerHTML), text: await page.evaluate(authored), aria: await page.locator("body").ariaSnapshot() };
  const applied = await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [THEME, PREFS]);
  expect(applied.policy).toBe("themed");
  expect(applied.owned).toBeGreaterThan(0);
  expect(applied.owned).toBeLessThanOrEqual(24);
  expect(await page.evaluate(authored)).toEqual(before.text);
  expect(await page.locator("body").ariaSnapshot()).toBe(before.aria);
  for (const name of ["Follow", "Star sentinel-repo", "Year", "Find a repository"]) await expect(page.getByRole(/^Star|Follow/.test(name) ? "button" : name === "Year" ? "combobox" : "searchbox", { name, exact: true })).toHaveCount(1);
  const slots = await page.evaluate(() => [...document.querySelectorAll("[data-reskin-owned]")].map((n) => [n.dataset.reskinOwned, n.getAttribute("aria-hidden"), n.closest(".markdown-body,.comment-body,.js-issue-title,button,form,summary") === null]));
  expect(slots.map(([slot]) => slot).sort()).toEqual(["contributions.caption", "profile.activity.heading", "profile.organizations.heading", "profile.pinned.heading", "profile.tag"]);
  for (const [, hidden, outside] of slots) {
    expect(hidden).toBe("true");
    expect(outside).toBe(true);
  }
  expect(await page.evaluate(() => [...document.querySelectorAll("[data-reskin-owned] *, [data-reskin-owned]")].filter((n) => n.matches("a,button,input,[tabindex]")).length)).toBe(0);
  await page.evaluate(() => window.reskinNative.remove());
  expect(await page.evaluate(() => document.body.innerHTML)).toBe(before.html);
  expect(await page.evaluate(() => document.querySelectorAll("[data-reskin-style], [data-reskin-owned]").length)).toBe(0);
});

test("anchors into authored content or controls are refused", async ({ page, fixtureApp }) => {
  await open(page, fixtureApp);
  const html = await page.evaluate(() => document.body.innerHTML);
  const applied = await page.evaluate(([t, p]) => window.reskinNative.apply(t, p, { hostile: true }), [THEME, PREFS]);
  expect(applied.anchors).toBeGreaterThanOrEqual(5);
  expect(applied.owned).toBe(0);
  expect(await page.evaluate(() => document.body.innerHTML)).toBe(html);
});

test("sentinel strings appear only where the page authored them", async ({ page, fixtureApp }) => {
  await open(page, fixtureApp);
  const count = () => page.evaluate(() => (document.body.textContent.match(/SENTINEL-[A-Z-]+-[0-9a-f]{4}/g) || []).sort());
  const before = await count();
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [THEME, PREFS]);
  expect(await count()).toEqual(before);
  const copy = await page.evaluate(() => [...document.querySelectorAll(".rs-copy")].map((n) => n.textContent));
  expect(copy).toContain("Pinned sentinel copy");
  expect(copy.every((text) => !/SENTINEL/.test(text))).toBe(true);
});

test("effects never move native content on the adapter path", async ({ page, fixtureApp }) => {
  await open(page, fixtureApp);
  const boxes = () => page.evaluate(() => [...document.body.querySelectorAll("*")].filter((n) => !n.closest("[data-reskin-owned]")).map((n) => {
    const r = n.getBoundingClientRect();
    return [n.tagName, n.id, r.x, r.y, r.width, r.height];
  }));
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, { ...p, extras: false }), [THEME, PREFS]);
  const bare = await boxes();
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, { ...p, text: false }), [THEME, PREFS]);
  expect(await page.evaluate(() => document.querySelectorAll(".rs-fx").length)).toBeGreaterThan(0);
  expect(await boxes()).toEqual(bare);
  // Text held on: the contribution caption's copy takes its line, and the activity overview after
  // it stays exactly where it is whether Effects draw the caption's edge or not. A rail alone
  // leaves room in the 24-node budget for the caption's edge.
  const rail = decorated("tokyo-night", { rail: { shape: "wave" } });
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, { ...p, effects: false }), [rail, PREFS]);
  const textOnly = await boxes();
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [rail, PREFS]);
  expect(await page.evaluate(() => document.querySelectorAll('[data-reskin-owned="contributions.caption"] .rs-box--edge .rs-fx-rail').length)).toBe(1);
  expect(await boxes()).toEqual(textOnly);
  const overview = textOnly.find(([, id]) => id === "user-activity-overview");
  expect(overview).toBeTruthy();
});

test("appended heading and tag decoration survives beside its own copy, with GitHub's text unchanged", async ({ page, fixtureApp }) => {
  await open(page, fixtureApp);
  const native = () => page.evaluate(() => ["h1.vcard-names", ".js-pinned-items-reorder-container > h2", "#js-contribution-activity > h2", ".h-card .border-top > h2"].map((s) => {
    const node = document.querySelector(s);
    let own = "";
    for (const child of node.childNodes) if (child.nodeType === 3 || !child.hasAttribute?.("data-reskin-owned")) own += child.textContent;
    return own;
  }));
  const before = await native();
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [THEME, PREFS]);
  const placed = await page.evaluate(() => [...document.querySelectorAll("[data-reskin-owned]")].map((n) => [n.dataset.reskinOwned, n.parentElement.matches("h2, .vcard-names-container") ? "inside" : "beside", n.querySelectorAll(".rs-fx").length]));
  for (const slot of ["profile.pinned.heading", "profile.activity.heading", "profile.organizations.heading", "profile.tag"]) {
    const entry = placed.find(([s]) => s === slot);
    expect(entry, slot).toBeTruthy();
    expect(entry[1], slot).toBe("inside");
  }
  expect(placed.find(([s]) => s === "profile.pinned.heading")[2]).toBeGreaterThan(0);
  expect(await native()).toEqual(before);
});

test("forced colors removes every owned node and theme decoration", async ({ page, fixtureApp }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, fixtureApp);
  const applied = await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [THEME, PREFS]);
  expect(applied.policy).toBe("forced-colors");
  expect(await page.evaluate(() => document.querySelectorAll("[data-reskin-owned]").length)).toBe(0);
  expect(await page.evaluate(() => document.querySelector("[data-reskin-style]").textContent.trim())).toBe("");
});
