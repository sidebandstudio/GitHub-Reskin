// Two loading checks of the installed extension for the release, now that the content script
// carries one theme at a time. Switching a GitHub tab to each bundled theme for the first time,
// when its record is new to the page, reaches that theme's colors from the popup's commit; the
// times are reported, since this path's tail is the background's commit and the storage hop, which
// the change leaves as they were (first-switch.spec.mjs gates the content script's part). And a
// GitHub page never shows unthemed while it loads: every animation frame in which the root is
// visible already has Reskin's style, with a bundled theme, a light Classic and a saved theme whose
// Advanced CSS needs the content script's parser chunk, also at a 4x CPU slowdown.
import { fileURLToPath } from "node:url";
import { catalogCards, readCatalogEntries } from "../../../packages/ui/bundle.mjs";
import { CHOOM, CHOOM_CANVAS, commit, expect, openPage, PROFILE_URL, test, waitPainted } from "../extension/helpers.mjs";
import { FIXTURE, record, summary } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LOADS = 10;

/** Commits selectTheme from an extension page and returns the time just before the commit was sent. */
const select = (popup, id) =>
  popup.evaluate(async (id) => {
    const got = await chrome.runtime.sendMessage({ type: "get", requestId: "loading-get" });
    const sent = Date.now();
    const reply = await chrome.runtime.sendMessage({ type: "commit", requestId: `loading-commit-${sent}`, expectedRevision: got.settings.revision, action: { type: "selectTheme", id } });
    if (!reply.ok) throw new Error(`selectTheme ${id} failed: ${JSON.stringify(reply)}`);
    return sent;
  }, id);

/** Resolves with the time the tab's computed canvas first equals `canvas` after a DOM change. */
const arm = (page, canvas) =>
  page.evaluate((canvas) => {
    window.__styled = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim() !== canvas) return;
        observer.disconnect();
        resolve(Date.now());
      });
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
  }, canvas);

async function openTab(extension) {
  const page = await extension.context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(PROFILE_URL);
  await waitPainted(page, (now) => now.boot === "ready" && now.styled);
  return page;
}

test("switching a GitHub tab to each bundled theme for the first time reaches that theme's colors, timed for the report", async ({ extension }, info) => {
  test.setTimeout(180000);
  const cards = catalogCards(await readCatalogEntries(ROOT));
  const page = await openTab(extension);
  expect((await waitPainted(page, (now) => now.canvas === CHOOM_CANVAS)).canvas).toBe(CHOOM_CANVAS);
  const popup = await openPage(extension, "popup");
  const times = {};
  for (const card of cards.filter((card) => card.id !== CHOOM)) {
    await arm(page, card.mini.canvas);
    const sent = await select(popup, card.id);
    times[card.id] = (await page.evaluate(() => window.__styled)) - sent;
  }
  expect(Object.keys(times)).toHaveLength(cards.length - 1);
  const result = summary(Object.values(times));
  await record(info, "first-switch", { firstSwitch: result, perTheme: times, fixture: FIXTURE });
});

// From before the document's first frame, what each animation frame paints: whether the root is
// visible (the boot gate holds it at opacity 0 until the lifecycle ends it) and whether Reskin's
// style is in place.
const FRAMES = `(() => {
  if (window !== window.top) return;
  const frames = [];
  window.__frames = frames;
  const look = () => {
    const root = document.documentElement;
    if (root) {
      const style = getComputedStyle(root);
      frames.push({ visible: style.opacity !== "0" && style.visibility !== "hidden", boot: root.getAttribute("data-reskin-boot"), styled: Boolean(document.getElementById("reskin-style")?.textContent) });
    }
    if (frames.length < 240) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
})();`;

/** Loads the profile `count` times in a fresh tab each time and returns each load's frames. */
async function loads(extension, count, { slowdown = 1 } = {}) {
  const runs = [];
  for (let i = 0; i < count; i++) {
    const page = await extension.context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript({ content: FRAMES });
    if (slowdown > 1) await (await extension.context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: slowdown });
    await page.goto(PROFILE_URL);
    await page.waitForFunction(() => window.__frames?.some((frame) => frame.visible) && document.readyState === "complete");
    await page.waitForTimeout(300);
    runs.push(await page.evaluate(() => window.__frames));
    await page.close();
  }
  return runs;
}

// Each visible frame that is not Reskin's themed page, per load.
const unthemed = (runs) => runs.map((frames) => frames.filter((frame) => frame.visible && !(frame.boot === "ready" && frame.styled)));

async function saveApprovedCss(extension) {
  const choom = (await readCatalogEntries(ROOT)).find((entry) => entry.id === CHOOM).document;
  const builder = await openPage(extension, "settings", { width: 1280, height: 900 });
  const saved = await commit(builder, { type: "saveCustom", document: { ...choom, name: "My Choom" }, select: true });
  expect(saved.ok, JSON.stringify(saved.issues ?? null)).toBe(true);
  const id = saved.settings.selectedThemeId;
  const editor = "loading-editor-000000000001";
  const ticket = await commit(builder, { type: "approveCss", editor, target: id, css: choom.css });
  expect(ticket.approval?.ticket, JSON.stringify(ticket.issues ?? null)).toBeTruthy();
  const granted = await commit(builder, { type: "setCssConsent", id, granted: true, editor, approval: ticket.approval.ticket });
  expect(granted.ok, JSON.stringify(granted.issues ?? null)).toBe(true);
  await builder.close();
}

test("a GitHub page never shows unthemed while it loads, with a bundled theme, a light Classic or a saved theme with Advanced CSS, also at a 4x CPU slowdown", async ({ extension }, info) => {
  test.setTimeout(240000);
  const popup = await openPage(extension, "popup");
  const scenarios = {};
  const report = {};
  for (const [name, setup] of [
    ["bundled", async () => {}],
    ["light classic", async () => expect((await commit(popup, { type: "selectTheme", id: "solarized-light" })).ok).toBe(true)],
    ["saved with Advanced CSS", () => saveApprovedCss(extension)],
  ]) {
    await setup();
    scenarios[name] = unthemed(await loads(extension, LOADS));
    scenarios[`${name} at 4x`] = unthemed(await loads(extension, 3, { slowdown: 4 }));
    report[name] = { loads: LOADS, unthemedFrames: scenarios[name].map((frames) => frames.length), slowdown4x: { loads: 3, unthemedFrames: scenarios[`${name} at 4x`].map((frames) => frames.length) } };
  }
  await record(info, "loading", { loading: report, fixture: FIXTURE });
  for (const [name, runs] of Object.entries(scenarios)) expect(runs, `${name}: visible frames without Reskin's style`).toEqual(runs.map(() => []));
});
