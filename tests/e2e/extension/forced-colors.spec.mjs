// Forced colors on the installed extension, in Chromium and in Firefox: the theme's own CSS scope
// marker, the stylesheet and the owned decoration are present only while forced colors are off,
// and follow the mode as it changes on an open page. Firefox installs the Firefox build as a
// temporary add-on through its remote debugging protocol (web-ext's client), since Playwright
// cannot load a Firefox extension itself.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firefox } from "@playwright/test";
import { build } from "../../../scripts/build.mjs";
import { requireBrowser } from "../../helpers/browsers.mjs";
import { CHOOM_CANVAS, PROFILE_HTML, PROFILE_URL, expect, openGitHub, test, waitFor } from "./helpers.mjs";

// What forced colors may leave: GitHub's own page with no theme CSS, marker or owned node.
const state = (page) =>
  page.evaluate(() => ({
    forced: matchMedia("(forced-colors: active)").matches,
    boot: document.documentElement.getAttribute("data-reskin-boot"),
    scope: document.documentElement.getAttribute("data-reskin-css"),
    styled: Boolean(document.getElementById("reskin-style")?.textContent),
    owned: document.querySelectorAll("[data-reskin-owned]:not(style)").length,
    canvas: getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim(),
  }));

async function expectForcedColorsGate(page, label) {
  // Full Choom: the theme's reviewed CSS is scoped on, with its decoration.
  const themed = { forced: false, boot: "ready", scope: "active", styled: true, canvas: CHOOM_CANVAS };
  // Decoration follows the stylesheet, so the first themed state is the one with both.
  const first = await waitFor(page, state, (now) => Object.entries(themed).every(([key, value]) => now[key] === value) && now.owned > 0);
  expect(first, `${label} themed`).toMatchObject(themed);
  expect(first.owned, label).toBeGreaterThan(0);

  await page.emulateMedia({ forcedColors: "active" });
  await expect.poll(() => state(page), { message: `${label} forced` }).toMatchObject({ forced: true, boot: "native", scope: null, styled: false, owned: 0 });

  await page.emulateMedia({ forcedColors: "none" });
  await expect.poll(() => state(page), { message: `${label} restored` }).toMatchObject({ forced: false, boot: "ready", scope: "active", styled: true, canvas: CHOOM_CANVAS });
  await expect.poll(async () => (await state(page)).owned, { message: `${label} restored decoration` }).toBeGreaterThan(0);
}

test("Chromium: forced colors take the theme CSS, its scope marker and decoration away, and turning them off restores all three", async ({ extension }) => {
  const github = await openGitHub(extension);
  await expectForcedColorsGate(github, "chromium");

  // A page that loads under forced colors never sets the marker.
  const page = await extension.context.newPage();
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(PROFILE_URL);
  await page.waitForFunction(() => document.documentElement.getAttribute("data-reskin-boot") === "native");
  await page.waitForTimeout(300);
  expect(await state(page)).toMatchObject({ scope: null, styled: false, owned: 0 });
});

test("Firefox: the installed add-on follows forced colors the same way", async () => {
  test.setTimeout(90000);
  requireBrowser("firefox");
  const { connectWithMaxRetries } = await import(new URL("../../../node_modules/web-ext/lib/firefox/remote.js", import.meta.url).href);
  const out = await mkdtemp(join(tmpdir(), "reskin-e2e-firefox-package-"));
  const profile = await mkdtemp(join(tmpdir(), "reskin-e2e-firefox-"));
  const port = 6000 + Math.floor(Math.random() * 1000);
  const built = await build({ target: "firefox", outDir: out });
  const context = await firefox.launchPersistentContext(profile, {
    headless: true,
    args: ["-start-debugger-server", String(port)],
    firefoxUserPrefs: { "devtools.debugger.remote-enabled": true, "devtools.chrome.enabled": true, "devtools.debugger.prompt-connection": false },
  });
  try {
    await context.route("https://github.com/**", (route) =>
      route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: PROFILE_HTML }) : route.abort(),
    );
    const remote = await connectWithMaxRetries({ port, maxRetries: 50, retryInterval: 200 });
    try {
      await remote.installTemporaryAddon(built.dir);
    } finally {
      remote.disconnect();
    }
    // The install opens the welcome tab; a page opened before it settles can land in a window
    // Playwright's Firefox cannot address.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    // The add-on's first storage write may land after the first load; a reload reads it.
    await expect.poll(async () => {
      await page.goto(PROFILE_URL);
      await page.waitForTimeout(500);
      return (await state(page)).boot;
    }, { timeout: 20000 }).toBe("ready");
    await expectForcedColorsGate(page, "firefox");
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});
