// overrides.accentEmphasis on the adapter path: the profile's selected year link, as GitHub marks
// it up on github.com/whoisaldo (2026-11-09), takes GitHub's own selected-state rule, which reads
// --bgColor-accent-emphasis and --fgColor-onEmphasis. In Full and Calm the override fills it on a
// themed island, a high-contrast island keeps GitHub's native fill from its vendored mode CSS, and
// without the override the fill is the theme's own accent emphasis.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PREFS, expect, rgb, test } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EMPHASIS = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/schema/valid/slots-emphasis.reskin.json"), "utf8"));
const { overrides, ...PLAIN } = EMPHASIS;
const TEAL = overrides.accentEmphasis;
// GitHub's own high-contrast mode variables, as github.com serves them.
const HIGH_CONTRAST = readFileSync(join(ROOT, "vendor/primer/source/dark_high_contrast.css"), "utf8");
const ISLAND = 'data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_high_contrast"';
// GitHub's selected filter item, from its stylesheet.
const SELECTED = ".filter-item{display:block;padding:8px 16px;border-radius:6px}.filter-item.selected{color:var(--fgColor-onEmphasis);background-color:var(--bgColor-accent-emphasis)}";
const YEARS = (id) => `<ul class="filter-list small"><li><a id="${id}" class="js-year-link filter-item tmp-px-3 mb-2 py-2 selected" aria-current="true" href="#year-2026">2026</a></li><li><a class="js-year-link filter-item tmp-px-3 mb-2 py-2" href="#year-2025">2025</a></li></ul>`;

async function open(page, fixtureApp) {
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.evaluate(([css, years, island, islandYears]) => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const list = document.createElement("div");
    list.className = "js-profile-timeline-year-list";
    list.innerHTML = years;
    document.querySelector(".js-yearly-contributions").after(list);
    const native = document.createElement("div");
    for (const [, name, value] of island.matchAll(/([\w-]+)="([^"]*)"/g)) native.setAttribute(name, value);
    native.innerHTML = islandYears;
    list.after(native);
  }, [SELECTED + HIGH_CONTRAST, YEARS("year-themed"), ISLAND, YEARS("year-native")]);
}

const fills = (page) =>
  page.evaluate(() => Object.fromEntries(["year-themed", "year-native"].map((id) => {
    const s = getComputedStyle(document.getElementById(id));
    return [id, [s.backgroundColor, s.color]];
  })));

for (const [label, prefs] of [["Full", PREFS], ["Calm", { ...PREFS, extras: false }]]) {
  test(`${label}: the accent emphasis override fills the selected year, and a high-contrast island keeps GitHub's`, async ({ page, fixtureApp }) => {
    await open(page, fixtureApp);
    const native = await fills(page);
    expect(native["year-native"]).toEqual([rgb("#194fb1"), rgb("#ffffff")]);
    const applied = await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [EMPHASIS, prefs]);
    expect(applied.policy).toBe("themed");
    const themed = await fills(page);
    expect(themed["year-themed"][0]).toBe(rgb(TEAL));
    expect(themed["year-native"]).toEqual(native["year-native"]);
    // Without the override the selected year takes the theme's own accent emphasis instead.
    await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [PLAIN, prefs]);
    const plain = await fills(page);
    expect(plain["year-themed"][0]).not.toBe(rgb(TEAL));
    expect(plain["year-themed"][0]).not.toBe(native["year-themed"][0]);
    expect(plain["year-themed"][1]).toBe(themed["year-themed"][1]);
    expect(plain["year-native"]).toEqual(native["year-native"]);
    await page.evaluate(() => window.reskinNative.remove());
    expect(await fills(page)).toEqual(native);
  });
}
