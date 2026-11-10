// The first-run tab: opened once on a genuine install, never on a reload or update, with Choom
// Circuit selected, a working Before/After preview, instant theme choice and Open GitHub, with the
// result, Undo and Open GitHub in the first screen and a preview that scrolls.
import { chromium } from "@playwright/test";
import { CHOOM, expect, openGitHub, storage, test, waitFor, waitPainted } from "./helpers.mjs";

const onboardingTabs = (extension) => extension.context.pages().filter((page) => page.url() === extension.url("onboarding"));

// The welcome tab, once the background's install handler has opened it and its page has loaded.
// Waits on the browser's own page event, not a fixed poll: initialization finishes later on a
// loaded machine, and only the test's timeout bounds it.
async function welcomeTab(extension) {
  const url = extension.url("onboarding");
  const page = onboardingTabs(extension)[0] ?? (await extension.context.waitForEvent("page", { timeout: 0 }));
  await page.waitForURL(url, { timeout: 0 });
  await page.waitForLoadState("domcontentloaded", { timeout: 0 });
  expect(onboardingTabs(extension)).toHaveLength(1);
  return page;
}

test("a genuine install opens the welcome tab once, with Choom Circuit already selected", async ({ extension, packageDir }) => {
  const welcome = await welcomeTab(extension);
  await welcome.setViewportSize({ width: 1440, height: 900 });
  await expect(welcome.getByRole("heading", { level: 1 })).toHaveText("Pick your GitHub world.");
  await expect(welcome.locator("[data-rs=summary-show]")).toHaveText("Cyberpunk: Edgerunners");
  await expect(welcome.locator("[data-rs=summary-name]")).toHaveText("Choom Circuit");
  await expect(welcome.getByRole("button", { name: "Cyberpunk: Edgerunners" })).toHaveAttribute("aria-pressed", "true");
  await expect(welcome.getByRole("link", { name: "Open GitHub" })).toHaveAttribute("href", "https://github.com/whoisaldo");
  await expect(welcome.getByText("Not affiliated with or endorsed by GitHub.", { exact: false })).toBeVisible();
  const settings = (await storage(extension.worker))["reskin.settings"];
  expect(settings).toMatchObject({ enabled: true, selectedThemeId: CHOOM, onboardingCompleted: false });

  // A browser restart is not an install: the same profile opens no second welcome tab and keeps
  // its settings. (An update reaches the same onInstalled path with reason "update"; C4's
  // background tests cover it.)
  await extension.context.close();
  const context = await chromium.launchPersistentContext(extension.profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${packageDir}`, `--load-extension=${packageDir}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    expect((await worker.evaluate(() => chrome.storage.local.get(null)))["reskin.settings"].selectedThemeId).toBe(CHOOM);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(context.pages().filter((page) => page.url().includes("/pages/onboarding.html"))).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test("the welcome preview shows the selected theme and Before/After, and a choice there commits", async ({ extension }) => {
  const welcome = await welcomeTab(extension);
  await welcome.setViewportSize({ width: 1440, height: 900 });
  const host = welcome.locator("[data-reskin-preview]");
  await expect(host).toHaveAttribute("data-policy", "themed", { timeout: 15000 });
  const choomHash = await host.getAttribute("data-source-hash");

  await welcome.getByRole("radio", { name: "Before" }).check();
  await expect(host).toHaveAttribute("data-completed", /\d+/);
  await welcome.getByRole("radio", { name: "After" }).check();

  await welcome.getByRole("button", { name: "Frieren" }).click();
  await expect(welcome.locator("[data-rs=status]")).toHaveText("Applied to GitHub.");
  await expect(welcome.locator("[data-rs=summary-name]")).toHaveText("Longroad Petals");
  await expect.poll(() => host.getAttribute("data-source-hash")).not.toBe(choomHash);
  await expect(welcome.locator("[data-rs=undo]")).toBeVisible();
  await expect.poll(async () => (await storage(extension.worker))["reskin.settings"].onboardingCompleted).toBe(true);

  // All 13 anime opens the full gallery in place.
  await welcome.getByRole("button", { name: "All 13 anime" }).click();
  await expect(welcome.getByRole("button", { name: "All 13 anime" })).toHaveAttribute("aria-expanded", "true");
  await expect(welcome.locator(".rs-card")).toHaveCount(13);
  await welcome.locator(".rs-card", { hasText: "Chainsaw Man" }).click();
  await expect(welcome.locator("[data-rs=summary-show]")).toHaveText("Chainsaw Man");
});

test("the welcome page reflows to 390px without page-wide horizontal scrolling", async ({ extension }) => {
  const welcome = await welcomeTab(extension);
  await welcome.setViewportSize({ width: 390, height: 844 });
  await expect(welcome.locator("[data-reskin-preview]")).toHaveAttribute("data-policy", "themed", { timeout: 15000 });
  expect(await welcome.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth)).toBe(true);
});

// The element is on the first screen; a tall one (the preview) needs only its first 160px there.
const inFirstScreen = (page, selector) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.top >= 0 && Math.min(r.bottom, r.top + 160) <= innerHeight;
  });

test("the result, Undo and Open GitHub stay in the first screen while choosing, at 1440 and 390", async ({ extension }) => {
  const welcome = await welcomeTab(extension);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const label = JSON.stringify(viewport);
    await welcome.setViewportSize(viewport);
    await welcome.evaluate(() => scrollTo(0, 0));
    for (const selector of ["[data-rs=summary-show]", "[data-rs-open-github]", ".rs-chip", "[data-rs-preview]"]) {
      expect(await inFirstScreen(welcome, selector), `${label} ${selector}`).toBe(true);
    }
  }

  // Wide: the full list stays bounded beside the preview, and the result never moves away.
  await welcome.setViewportSize({ width: 1440, height: 900 });
  await welcome.getByRole("button", { name: "All 13 anime" }).click();
  const gallery = welcome.locator("[data-rs=gallery]");
  expect(await gallery.evaluate((el) => el.getBoundingClientRect().height <= innerHeight * 0.6 && el.scrollHeight > el.clientHeight)).toBe(true);
  await welcome.locator(".rs-card", { hasText: "Death Note" }).click();
  await expect(welcome.locator("[data-rs=summary-show]")).toHaveText("Death Note");
  for (const selector of ["[data-rs=summary-show]", "[data-rs-open-github]", "[data-rs=undo]", "[data-rs=status]"]) {
    expect(await inFirstScreen(welcome, selector), `1440 ${selector}`).toBe(true);
  }
  await expect(welcome.getByRole("button", { name: "All 13 anime" })).toHaveAttribute("aria-expanded", "true");

  // Narrow: a choice from the list closes it, the show joins the quick picks, and the result with
  // Undo and Open GitHub is on screen.
  await welcome.setViewportSize({ width: 390, height: 844 });
  const card = welcome.locator(".rs-card", { hasText: "Chainsaw Man" });
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(welcome.locator("[data-rs=summary-show]")).toHaveText("Chainsaw Man");
  await expect(welcome.locator("#rs-all")).toBeHidden();
  await expect(welcome.getByRole("button", { name: "All 13 anime" })).toHaveAttribute("aria-expanded", "false");
  await expect(welcome.getByRole("button", { name: "All 13 anime" })).toBeFocused();
  await expect(welcome.locator("[data-rs=quick]").getByRole("button", { name: "Chainsaw Man" })).toHaveAttribute("aria-pressed", "true");
  await expect(welcome.locator("[data-rs=undo]")).toBeInViewport();
  await expect(welcome.locator("[data-rs-open-github]")).toBeInViewport();
  // A quick pick hides the extra chip again.
  await welcome.getByRole("button", { name: "Frieren" }).click();
  await expect(welcome.locator("[data-rs-picked]")).toBeHidden();
});

test("the preview region scrolls by wheel and keyboard and shows the contribution graph", async ({ extension }) => {
  const welcome = await welcomeTab(extension);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const label = JSON.stringify(viewport);
    await welcome.setViewportSize(viewport);
    const region = welcome.getByRole("region", { name: "Preview of a GitHub profile, scrollable" });
    await expect(welcome.locator("[data-reskin-preview]")).toHaveAttribute("data-policy", "themed", { timeout: 15000 });
    await expect.poll(() => region.evaluate((el) => el.scrollHeight > el.clientHeight + 40), { message: label }).toBe(true);
    await region.evaluate((el) => (el.scrollTop = 0));
    // The graph's heading is in the first view of the region, so a crop of the graph shows without
    // scrolling. The layout document lays out the same view and can be measured.
    const regionHeight = await region.evaluate((el) => el.clientHeight);
    const graphHeading = await welcome.locator("[data-reskin-preview] iframe[inert]").evaluate((frame) => {
      const heading = [...frame.contentDocument.querySelectorAll("h2")].find((node) => /contributions in the last year/.test(node.textContent));
      return heading ? heading.getBoundingClientRect().bottom : Infinity;
    });
    expect(graphHeading, label).toBeLessThan(regionHeight - 20);

    await region.hover();
    await welcome.mouse.wheel(0, 300);
    await expect.poll(() => region.evaluate((el) => el.scrollTop), { message: `${label} wheel` }).toBeGreaterThan(0);
    await region.evaluate((el) => (el.scrollTop = 0));
    await region.focus();
    // Keyboard scrolling may be smooth; each scroll's scrollend says where it stopped.
    // The listener is in place before the key goes down.
    // A scrollend left over from the reset above may still arrive; only the end of a scroll that
    // moved the region counts.
    const scrollBy = async (key) => {
      await region.evaluate((el) => {
        const from = el.scrollTop;
        el.reskinScrollEnd = new Promise((resolve) => {
          const ended = () => el.scrollTop !== from && (el.removeEventListener("scrollend", ended), resolve(el.scrollTop));
          el.addEventListener("scrollend", ended);
        });
      });
      await welcome.keyboard.press(key);
      return region.evaluate((el) => el.reskinScrollEnd);
    };
    expect(await scrollBy("PageDown"), `${label} PageDown`).toBeGreaterThan(0);
    expect(await scrollBy("Home"), `${label} Home`).toBe(0);
  }
});

// The theme's own CSS names GitHub's elements as well as its owned slots. The preview compiles it
// against the same registry as github.com, so its owned slots look as they do there.
test("the welcome preview paints Choom's own tag and heading treatment as on GitHub", async ({ extension }) => {
  const welcome = await welcomeTab(extension);
  await welcome.setViewportSize({ width: 1440, height: 900 });
  await expect(welcome.locator("[data-reskin-preview]")).toHaveAttribute("data-policy", "themed", { timeout: 15000 });
  const SLOTS = ["profile.tag", "profile.pinned.heading"];
  const read = (doc, slots) =>
    Object.fromEntries(slots.map((slot) => {
      const node = doc.querySelector(`[data-reskin-slot="${slot}"]`);
      if (!node) return [slot, null];
      const cs = getComputedStyle(node);
      return [slot, { color: cs.color, border: cs.borderTopColor, borderWidth: cs.borderTopWidth, textShadow: cs.textShadow, boxShadow: cs.boxShadow, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform }];
    }));
  // The shown frame is sandboxed, so its document is read from inside it; the layout frame lays
  // out the same document and must agree.
  const inFrames = () => Promise.all(welcome.frames().filter((f) => f.url() === "about:srcdoc").map((f) => f.evaluate(([slots, source]) => new Function("doc", "slots", `return (${source})(doc, slots)`)(document, slots), [SLOTS, read.toString()]).catch(() => null)));
  await expect.poll(async () => (await inFrames()).filter((r) => r?.["profile.tag"]).length).toBeGreaterThanOrEqual(2);
  const frames = (await inFrames()).filter((r) => r?.["profile.tag"]);
  const preview = frames[0];
  for (const other of frames) expect(other).toEqual(preview);
  // The tag glows in the theme's yellow with a link-colored border, as Choom's CSS draws it.
  expect(preview["profile.tag"].textShadow).not.toBe("none");
  expect(preview["profile.tag"].boxShadow).not.toBe("none");
  expect(preview["profile.tag"].borderWidth).toBe("1px");
  expect(preview["profile.tag"].border).toBe(preview["profile.tag"].color);
  expect(preview["profile.pinned.heading"].textShadow).not.toBe("none");

  const github = await openGitHub(extension);
  await waitPainted(github, (state) => state.owned.includes("profile.tag"));
  // The theme's own CSS applies once admission has classified the page and set its scope marker.
  // Admission has a 10 ms budget and, on a loaded machine, leaves the CSS off until the page is
  // shown again; a pageshow asks it to classify again, as in admission.spec.mjs.
  const scoped = () =>
    github.evaluate(() => {
      const active = document.documentElement.getAttribute("data-reskin-css") === "active";
      if (!active) window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
      return active;
    });
  await waitFor(github, scoped, Boolean);
  const live = await github.evaluate(([slots, source]) => new Function("doc", "slots", `return (${source})(doc, slots)`)(document, slots), [SLOTS, read.toString()]);
  expect(preview).toEqual(live);
});
