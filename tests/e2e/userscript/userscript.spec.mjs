// The generated userscript in Chromium and Firefox with each kind of manager: document-start paint
// and sign-in kept native, the 1.1.0 migration and a disabled reload, the panel's instant commit,
// Undo, on/off, Full/Calm and Text/Motion, focus and size cleanup, no keys reaching GitHub, cross-
// tab refresh by change events or on visibility, the labeled session preview and no requests.
import { CHOOM, CHOOM_CANVAS, FRIEREN, FRIEREN_CANVAS, LOGIN_URL, PANEL, PROFILE_URL, expect, openPanel, painted, panelDocument, panelFrame, settingsOf, test, waitSettled } from "./helpers.mjs";

test("paints GitHub from manager storage at document start and leaves sign-in native", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  await expect.poll(() => painted(page)).toEqual({ boot: "ready", styled: true, canvas: CHOOM_CANVAS });
  // First run writes the defaults through the manager, never the page.
  expect(await settingsOf(gm, page)).toMatchObject({ settingsVersion: 2, enabled: true, selectedThemeId: CHOOM, preferences: { appearance: "full" } });
  const pageStorage = await page.evaluate((shim) => ({ local: Object.keys(localStorage).filter((key) => key !== shim), session: Object.keys(sessionStorage) }), "__reskin_test_gm__");
  expect(pageStorage).toEqual({ local: [], session: [] });

  await page.goto(LOGIN_URL);
  await waitSettled(page);
  expect(await painted(page)).toMatchObject({ boot: "native", styled: false });
  expect(await page.evaluate(() => document.querySelectorAll("[data-reskin-owned], [data-reskin-css]").length)).toBe(0);
});

test("migrates the 1.1.0 userscript's saved theme, off switch and colors, and a disabled tab reloads native", async ({ manager }) => {
  const gm = await manager({ kind: "async", seed: { theme: "nord", enabled: false } });
  const page = await gm.open();
  await expect.poll(async () => (await settingsOf(gm, page))?.selectedThemeId).toBe("nord");
  const store = await gm.store(page);
  expect(store["reskin.settings"].enabled).toBe(false);
  for (const legacy of ["theme", "enabled", "custom"]) expect(store[legacy], legacy).toBeUndefined();
  await page.reload();
  await waitSettled(page);
  expect(await painted(page)).toMatchObject({ boot: "native", styled: false });

  const custom = await manager({ kind: "sync", seed: { theme: "dracula", custom: { bg: "#101010", text: "#f0f0f0", accent: "#ff5577", graph: "#55ff99" } } });
  const tab = await custom.open();
  await expect.poll(async () => (await settingsOf(custom, tab))?.customThemes?.length).toBe(1);
  const settings = await settingsOf(custom, tab);
  expect(settings.selectedThemeId).toBe(settings.customThemes[0].id);
  expect(settings.customThemes[0].document.colors).toMatchObject({ background: "#101010", text: "#f0f0f0", accent: "#ff5577" });
  await expect.poll(() => painted(tab)).toMatchObject({ boot: "ready", styled: true, canvas: "#101010" });
});

test("the panel commits a theme at once, offers Undo, and switches on/off, Full/Calm, Text and Motion", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  const frame = await openPanel(page);
  await expect(frame.locator("[data-rs=summary-show]")).toHaveText("Cyberpunk: Edgerunners");
  await expect(frame.locator("[data-rs=summary-name]")).toHaveText("Choom Circuit");
  // Anime first: the anime title is the card's primary label.
  await expect(frame.locator(`[data-theme="${FRIEREN}"] .rs-card-primary`)).toHaveText("Frieren: Beyond Journey's End");

  await frame.locator(`[data-theme="${FRIEREN}"]`).click();
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: FRIEREN_CANVAS });
  await expect(frame.locator(`[data-theme="${FRIEREN}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(frame.locator("[data-rs=status]")).toHaveText("Applied to GitHub.");
  await frame.locator("[data-rs=undo]").click();
  await expect.poll(() => painted(page)).toMatchObject({ canvas: CHOOM_CANVAS });
  await expect(frame.locator("[data-rs=undo]")).toBeHidden();

  await frame.getByRole("radio", { name: "Calm" }).check();
  await expect.poll(async () => (await settingsOf(gm, page)).preferences).toMatchObject({ appearance: "calm", extras: false });
  await frame.getByRole("radio", { name: "Full" }).check();
  await frame.getByRole("switch", { name: "Extra theme text" }).uncheck();
  await frame.getByRole("switch", { name: "Motion" }).uncheck();
  await expect.poll(async () => (await settingsOf(gm, page)).preferences).toMatchObject({ appearance: "full", text: false, motion: false });

  await frame.getByRole("switch", { name: "Reskin" }).uncheck();
  await expect.poll(() => painted(page)).toMatchObject({ boot: "native", styled: false });
  await expect(frame.locator("[data-rs=summary-note]")).toHaveText(/Off\. Your next theme is ready/);
  // Choosing while off saves the theme and leaves GitHub native.
  await frame.locator(`[data-theme="${FRIEREN}"]`).click();
  await expect.poll(async () => (await settingsOf(gm, page)).selectedThemeId).toBe(FRIEREN);
  expect(await painted(page)).toMatchObject({ boot: "native", styled: false });
  await page.reload();
  await waitSettled(page);
  expect(await painted(page)).toMatchObject({ boot: "native", styled: false });
  await (await openPanel(page)).getByRole("switch", { name: "Reskin" }).check();
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: FRIEREN_CANVAS });
});

test("Escape and Close return focus, closing cleans up, and there is never a second panel", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "invoker";
    button.textContent = "Invoker";
    document.body.prepend(button);
    button.focus();
  });
  const frame = await openPanel(page);
  await expect(frame.getByRole("switch", { name: "Reskin" })).toBeFocused();
  expect(await page.evaluate(() => window.__resizeObservers.size)).toBe(1);
  // The menu again, and #reskin, while open: still one panel.
  await page.evaluate(() => {
    location.hash = "#reskin";
  });
  await expect(page.locator(PANEL)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator("#invoker")).toBeFocused();
  expect(await page.evaluate(() => ({ observers: window.__resizeObservers.size, hash: location.hash }))).toEqual({ observers: 0, hash: "" });

  await page.locator("#invoker").focus();
  const again = await openPanel(page);
  await again.getByRole("button", { name: "Close GitHub Reskin" }).click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator("#invoker")).toBeFocused();

  // The menu toggles: open, then closed.
  await page.evaluate(() => window.__gmLog.menu[0].fn());
  await expect(page.locator(PANEL)).toHaveCount(1);
  await page.evaluate(() => window.__gmLog.menu[0].fn());
  await expect(page.locator(PANEL)).toHaveCount(0);
  // A click on GitHub closes it too.
  await openPanel(page);
  await page.mouse.click(40, 600);
  await expect(page.locator(PANEL)).toHaveCount(0);
  expect(await page.evaluate(() => window.__gmLog.menu.length)).toBe(1);
});

test("keys typed in the panel never reach GitHub's shortcuts, and the frame fits the viewport", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  await page.evaluate(() => {
    window.__pageKeys = [];
    for (const target of [window, document]) target.addEventListener("keydown", (event) => window.__pageKeys.push(event.key), true);
  });
  const frame = await openPanel(page);
  const search = frame.getByRole("searchbox", { name: "Search themes or shows" });
  await search.click();
  await page.keyboard.type("st/frieren");
  await search.fill("frieren");
  await expect(frame.locator("[data-rs=count]")).toHaveText(/1 theme/);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.__pageKeys)).toEqual([]);

  const box = await page.locator(PANEL).boundingBox();
  expect(box.width).toBeLessThanOrEqual(400);
  expect(box.height).toBeGreaterThan(300);
  expect(box.y + box.height).toBeLessThanOrEqual(900 - 16 + 1);
  await page.setViewportSize({ width: 360, height: 500 });
  await expect.poll(async () => (await page.locator(PANEL).boundingBox()).height).toBeLessThanOrEqual(500 - 32 + 1);
  expect((await page.locator(PANEL).boundingBox()).width).toBeLessThanOrEqual(360 - 32 + 1);
});

test("another tab's choice reaches this tab through change events, or when it is shown again", async ({ manager }) => {
  for (const kind of ["sync", "async"]) {
    const gm = await manager({ kind });
    const first = await gm.open();
    const second = await gm.open();
    await expect.poll(() => painted(first)).toMatchObject({ canvas: CHOOM_CANVAS });
    await (await openPanel(second)).locator(`[data-theme="${FRIEREN}"]`).click();
    await expect.poll(() => painted(second)).toMatchObject({ canvas: FRIEREN_CANVAS });
    if (kind === "async") {
      // No change listener: the tab re-reads when it becomes visible.
      await first.waitForTimeout(300);
      expect((await painted(first)).canvas, kind).toBe(CHOOM_CANVAS);
      await first.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    }
    await expect.poll(() => painted(first), { message: kind }).toMatchObject({ canvas: FRIEREN_CANVAS });
  }
});

test("a manager without durable storage gets a labeled session preview with export, and nothing is kept", async ({ manager }) => {
  const gm = await manager({ kind: "none" });
  const page = await gm.open(`${PROFILE_URL}#reskin`);
  const frame = await panelFrame(page);
  await expect(frame.locator("[data-us=session-label]")).toHaveText("Session preview");
  await expect(frame.locator("[data-us=storage-note]")).toHaveText("This userscript manager can't save themes here. You can preview and export a file.");
  await frame.locator(`[data-theme="${FRIEREN}"]`).click();
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: FRIEREN_CANVAS });
  const download = page.waitForEvent("download");
  await frame.getByRole("button", { name: "Export theme file" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.reskin\.json$/);
  await expect(frame.locator("[data-us=status]")).toHaveText("Theme file saved to your downloads.");
  await page.goto(PROFILE_URL);
  await waitSettled(page);
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });

  // A manager with storage says where its themes are saved, with no session label.
  const durable = await manager({ kind: "safari" });
  const tab = await durable.open(`${PROFILE_URL}#reskin`);
  const card = await panelFrame(tab);
  await expect(card.locator("[data-us=session-label]")).toBeHidden();
  await expect(card.locator("[data-us=storage-note]")).toHaveText(/Saved by your userscript manager/);
});

test("the userscript makes no request of its own", async ({ manager }) => {
  const plain = await manager({ inject: false });
  await plain.open();
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  const frame = await openPanel(page);
  await frame.locator(`[data-theme="${FRIEREN}"]`).click();
  await expect.poll(() => painted(page)).toMatchObject({ canvas: FRIEREN_CANVAS });
  await page.reload();
  await waitSettled(page);
  // Only what the fixture page itself asks for; fonts are embedded, so none is fetched.
  expect([...new Set(gm.requests)].filter((url) => !plain.requests.includes(url))).toEqual([]);
});
