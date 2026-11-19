// Assertions about the installed extension on the platform fixture app, shared by lint:chrome and
// the platform Playwright tests.
import { DEFAULT_THEME_ID } from "../../packages/contracts/index.js";

// Choom Circuit's canvas (the 1.1.0 Cyberpunk canvas it ports). A new install has no theme, so the
// checks pick Choom Circuit first.
export const CHOOM_CANVAS = "#0a0a17";

/** Picks Choom Circuit from the installed extension's popup page, as a person would, and closes it. */
export async function pickChoom(context) {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/pages/popup.html`);
    const reply = await page.evaluate(async (id) => {
      const got = await chrome.runtime.sendMessage({ type: "get", requestId: "platform-get" });
      return chrome.runtime.sendMessage({ type: "commit", requestId: "platform-commit", expectedRevision: got.settings.revision, action: { type: "selectTheme", id } });
    }, DEFAULT_THEME_ID);
    if (!reply?.ok) throw new Error(`Picking Choom Circuit failed: ${JSON.stringify(reply)}`);
  } finally {
    await page.close();
  }
}

export async function expectThemed(page) {
  await page.waitForFunction(() => document.getElementById("reskin-style")?.textContent.length > 0, null, { timeout: 10000 });
  const background = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim());
  if (background !== CHOOM_CANVAS) throw new Error(`the content script painted --bgColor-default ${background}, expected ${CHOOM_CANVAS}`);
  return background;
}
