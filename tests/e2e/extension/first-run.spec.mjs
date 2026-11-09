// The first-run tab: opened once on a genuine install, never on a reload or update, with Choom
// Circuit selected, a working Before/After preview, instant theme choice and Open GitHub.
import { chromium } from "@playwright/test";
import { CHOOM, expect, storage, test } from "./helpers.mjs";

const onboardingTabs = (extension) => extension.context.pages().filter((page) => page.url() === extension.url("onboarding"));

test("a genuine install opens the welcome tab once, with Choom Circuit already selected", async ({ extension, packageDir }) => {
  await expect.poll(() => onboardingTabs(extension).length).toBe(1);
  const welcome = onboardingTabs(extension)[0];
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
  await expect.poll(() => onboardingTabs(extension).length).toBe(1);
  const welcome = onboardingTabs(extension)[0];
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
  await expect.poll(() => onboardingTabs(extension).length).toBe(1);
  const welcome = onboardingTabs(extension)[0];
  await welcome.setViewportSize({ width: 390, height: 844 });
  await expect(welcome.locator("[data-reskin-preview]")).toHaveAttribute("data-policy", "themed", { timeout: 15000 });
  expect(await welcome.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth)).toBe(true);
});
