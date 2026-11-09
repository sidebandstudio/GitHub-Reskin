// The popup on the installed extension: instant commit to an open GitHub tab, one-change Undo,
// Full/Calm, Extra theme text, on/off, search, groups, keyboard use, failure recovery, miniatures
// that follow the preferences, and popup geometry in every state, short windows and real zoom.
import { readFileSync } from "node:fs";
import { SLOTS } from "../../../extension/content/github/selectors.js";
import { resolveTheme } from "../../../packages/engine/index.js";
import { MODE_INDEX, standardSeed } from "../../../packages/primer/index.js";
import { CHOOM, CHOOM_CANVAS, expect, openGitHub, openPage, painted, storage, test, waitPainted } from "./helpers.mjs";

const frieren = JSON.parse(readFileSync(new URL("../../../themes/anime/longroad-petals.reskin.json", import.meta.url), "utf8"));
const FRIEREN_CANVAS = resolveTheme(frieren, { seed: standardSeed(MODE_INDEX, "light"), policy: "themed", reducedMotion: false, forcedColors: false }).tokens.canvas;
const card = (popup, show) => popup.locator(".rs-card", { hasText: show });
// Choom's flavor on the profile fixture, from the theme's slots and the adapter's profile slots:
// the owned slots as painted() lists them, and their copy in any order.
const choom = JSON.parse(readFileSync(new URL("../../../themes/anime/choom-circuit.reskin.json", import.meta.url), "utf8")).flavor.slots;
const PROFILE_SLOTS = new Set(SLOTS.filter((slot) => slot.route === "profile").map((slot) => slot.slot));
const FLAVOR = Object.keys(choom).filter((slot) => PROFILE_SLOTS.has(slot)).sort();
const CHOOM_COPY = FLAVOR.map((slot) => choom[slot]).sort();
const copyOf = (state) => [...state.copy].sort();
const TEXT = "Extra theme text";

test("a new install paints Choom Circuit on GitHub with its flavor, and the popup leads with the anime", async ({ extension }) => {
  const github = await openGitHub(extension);
  const state = await waitPainted(github, (s) => s.owned.length > 0);
  expect(state).toMatchObject({ boot: "ready", styled: true, canvas: CHOOM_CANVAS });
  expect(state.owned).toEqual(FLAVOR);
  expect(FLAVOR).toEqual(expect.arrayContaining(["footer.signoff", "profile.achievements.heading", "profile.tag"]));
  expect(copyOf(state)).toEqual(CHOOM_COPY);

  const popup = await openPage(extension, "popup");
  await expect(popup.locator("[data-rs=summary-show]")).toHaveText("Cyberpunk: Edgerunners");
  await expect(popup.locator("[data-rs=summary-name]")).toHaveText("Choom Circuit");
  await expect(popup.locator(".rs-group[aria-pressed=true]")).toContainText("Anime13");
  await expect(popup.locator(".rs-card")).toHaveCount(13);
  await expect(popup.locator(".rs-card").first()).toHaveAttribute("aria-pressed", "true");
  await expect(popup.locator(".rs-card").first()).toHaveAccessibleName(/^Cyberpunk: Edgerunners Choom Circuit Selected$/);
  await expect(popup.locator(".rs-card").nth(1)).toHaveAccessibleName(/^Neon Genesis Evangelion Violet Synchrony$/);
  await expect(popup.locator("[data-rs=count]")).toHaveText("13 themes");
  // No import or builder entry point in this stage.
  await expect(popup.getByRole("button", { name: /import|customize/i })).toHaveCount(0);
  expect(extension.requests.every((url) => url.startsWith("https://github.com/octo-sample"))).toBe(true);
});

test("a theme click commits to the open GitHub tab at once, and Undo restores the previous theme once", async ({ extension }) => {
  const github = await openGitHub(extension);
  await waitPainted(github, (s) => s.canvas === CHOOM_CANVAS && s.owned.length === FLAVOR.length);
  const popup = await openPage(extension, "popup");
  await expect(popup.locator("[data-rs=undo]")).toBeHidden();

  await card(popup, "Frieren").click();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Applied to GitHub.");
  await expect(card(popup, "Frieren")).toHaveAttribute("aria-pressed", "true");
  await expect(popup.locator("[data-rs=summary-show]")).toHaveText("Frieren: Beyond Journey's End");
  await waitPainted(github, (s) => s.canvas === FRIEREN_CANVAS);
  expect((await storage(extension.worker))["reskin.settings"].selectedThemeId).toBe("anime.frieren");

  // Undo survives closing the popup.
  await popup.close();
  const again = await openPage(extension, "popup");
  await expect(again.locator("[data-rs=undo]")).toBeVisible();
  await again.locator("[data-rs=undo]").click();
  await expect(again.locator("[data-rs=status]")).toHaveText("Theme change undone.");
  await expect(again.locator("[data-rs=undo]")).toBeHidden();
  await expect(again.locator("[data-rs=summary-name]")).toHaveText("Choom Circuit");
  // The same document gets Choom's colors and its whole flavor back, without a reload.
  const state = await waitPainted(github, (s) => s.canvas === CHOOM_CANVAS && s.owned.length === FLAVOR.length);
  expect(state.owned).toEqual(FLAVOR);
  expect(copyOf(state)).toEqual(CHOOM_COPY);
  expect((await storage(extension.worker))["reskin.settings"].selectedThemeId).toBe(CHOOM);

  // A new choice makes Undo available again.
  await card(again, "Dandadan").click();
  await expect(again.locator("[data-rs=undo]")).toBeVisible();
});

test("Calm keeps the colors and removes flavor; Full, Extra theme text and theme changes restore it on the same document", async ({ extension }) => {
  const github = await openGitHub(extension);
  await waitPainted(github, (s) => s.owned.length === FLAVOR.length);
  const origin = await github.evaluate(() => performance.timeOrigin);
  const popup = await openPage(extension, "popup");
  const selectedMini = popup.locator(".rs-card[aria-pressed=true] .rs-mini");
  await expect(selectedMini).toHaveAttribute("data-full", "");
  await expect(selectedMini.locator(".rs-mini-tag")).toHaveText("// choom");

  await popup.getByRole("radio", { name: "Calm" }).check();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Saved.");
  let state = await waitPainted(github, (s) => s.owned.length === 0);
  expect(state).toMatchObject({ styled: true, canvas: CHOOM_CANVAS });
  // The miniature shows Calm too: no wallpaper, tag or heading addition.
  await expect(selectedMini).not.toHaveAttribute("data-full", "");
  await expect(selectedMini.locator(".rs-mini-tag, .rs-mini-flourish, .rs-mini-wall")).toHaveCount(0);
  // Child switches stay editable under Calm and keep their values.
  await expect(popup.getByRole("switch", { name: TEXT })).toBeEnabled();
  await expect(popup.getByRole("switch", { name: TEXT })).toBeChecked();

  await popup.getByRole("radio", { name: "Full" }).check();
  state = await waitPainted(github, (s) => s.owned.length === FLAVOR.length);
  expect(copyOf(state)).toEqual(CHOOM_COPY);

  await popup.getByRole("switch", { name: TEXT }).uncheck();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Saved.");
  state = await waitPainted(github, (s) => s.copy.length === 0);
  expect(state.canvas).toBe(CHOOM_CANVAS);
  await expect(selectedMini.locator(".rs-mini-tag")).toHaveCount(0);
  await popup.getByRole("switch", { name: TEXT }).check();
  state = await waitPainted(github, (s) => s.copy.length === FLAVOR.length);
  expect(copyOf(state)).toEqual(CHOOM_COPY);

  // Theme changes and Undo keep the flavor following the theme on this same document.
  await card(popup, "Frieren").click();
  await waitPainted(github, (s) => s.canvas === FRIEREN_CANVAS && s.copy.includes("// travel journal"));
  await popup.locator("[data-rs=undo]").click();
  state = await waitPainted(github, (s) => s.canvas === CHOOM_CANVAS && s.owned.length === FLAVOR.length);
  expect(copyOf(state)).toEqual(CHOOM_COPY);
  expect(await github.evaluate(() => performance.timeOrigin)).toBe(origin);

  // Switching themes never turns a preference back on.
  await popup.getByRole("switch", { name: TEXT }).uncheck();
  await card(popup, "Solo Leveling").click();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Applied to GitHub.");
  await expect(popup.getByRole("switch", { name: TEXT })).not.toBeChecked();
  const settings = (await storage(extension.worker))["reskin.settings"];
  expect(settings.preferences).toMatchObject({ appearance: "full", text: false, motion: true });
});

test("Full and Calm and Extra theme text are explained before anyone touches them", async ({ extension }) => {
  const popup = await openPage(extension, "popup");
  await expect(popup.getByRole("group", { name: "Appearance" })).toHaveAccessibleDescription("Full adds backgrounds and extras. Calm keeps colors and fonts.");
  await expect(popup.getByRole("switch", { name: TEXT })).toHaveAccessibleDescription("Adds labels like // choom. Your own words stay the same.");
  await expect(popup.getByText("Full adds backgrounds and extras. Calm keeps colors and fonts.")).toBeVisible();
});

test("off leaves GitHub native, a choice while off is saved for later, and on applies it", async ({ extension }) => {
  const github = await openGitHub(extension);
  await waitPainted(github, (s) => s.styled);
  const popup = await openPage(extension, "popup");

  await popup.getByRole("switch", { name: "Reskin" }).uncheck();
  await expect(popup.locator("[data-rs=summary-note]")).toHaveText("Off. Your next theme is ready when you turn Reskin on.");
  let state = await waitPainted(github, (s) => !s.styled);
  expect(state).toMatchObject({ boot: "native", owned: [] });

  await card(popup, "Death Note").click();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Saved. Reskin is off, so GitHub stays as it is until you turn it on.");
  await expect(card(popup, "Death Note")).toHaveAttribute("aria-pressed", "true");
  await github.waitForTimeout(300);
  expect((await painted(github)).styled).toBe(false);

  await popup.getByRole("switch", { name: "Reskin" }).check();
  state = await waitPainted(github, (s) => s.styled);
  expect(state.canvas).not.toBe(CHOOM_CANVAS);
  expect((await storage(extension.worker))["reskin.settings"]).toMatchObject({ enabled: true, selectedThemeId: "anime.death-note" });
});

test("search spans the groups with a visible count, groups switch, and keyboard selection works", async ({ extension }) => {
  const popup = await openPage(extension, "popup");
  await popup.getByRole("searchbox", { name: "Search themes or shows" }).fill("dracula");
  await expect(popup.locator("[data-rs=count]")).toHaveText("1 theme found");
  await expect(popup.locator(".rs-card")).toHaveCount(1);
  await popup.getByRole("searchbox").fill("zzz");
  await expect(popup.locator("[data-rs=empty]")).toContainText('No themes match "zzz".');
  await popup.getByRole("button", { name: "Clear search" }).click();
  await expect(popup.locator(".rs-card")).toHaveCount(13);

  await popup.getByRole("button", { name: /^Classics/ }).click();
  await expect(popup.locator(".rs-card")).toHaveCount(12);
  await expect(popup.getByRole("button", { name: /^Classics/ })).toHaveAttribute("aria-pressed", "true");
  await popup.getByRole("button", { name: /^My themes/ }).click();
  await expect(popup.locator("[data-rs=empty]")).toContainText("Your saved themes will appear here.");
  // The last group is remembered.
  await popup.getByRole("button", { name: /^Classics/ }).click();
  await popup.reload();
  await expect(popup.getByRole("button", { name: /^Classics/ })).toHaveAttribute("aria-pressed", "true");

  const nord = popup.locator(".rs-card", { hasText: "Nord" });
  await nord.focus();
  await popup.keyboard.press("Space");
  await expect(nord).toHaveAttribute("aria-pressed", "true");
  await expect(nord).toBeFocused();
  await popup.locator(".rs-card", { hasText: "Dracula" }).focus();
  await popup.keyboard.press("Enter");
  await expect(popup.locator("[data-rs=summary-show]")).toHaveText("Dracula");
});

test("a failed save keeps the committed theme visible and offers Retry", async ({ extension }) => {
  const popup = await openPage(extension, "popup");
  // The background answers this one commit with a storage failure, as a full or denied write would.
  await popup.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let failed = false;
    Object.defineProperty(chrome.runtime, "sendMessage", {
      configurable: true,
      value: (message) => (message.type === "commit" && !failed ? ((failed = true), Promise.resolve({ ok: false, code: "storage", issues: [{ message: "Storage failed" }] })) : send(message)),
    });
  });
  await card(popup, "Frieren").click();
  await expect(popup.getByRole("alert")).toContainText("We couldn't save that change. Your previous choice is still applied.");
  await expect(popup.locator(".rs-card").first()).toHaveAttribute("aria-pressed", "true");
  await expect(card(popup, "Frieren")).toHaveAttribute("aria-pressed", "false");
  await expect(popup.locator("[data-rs=summary-name]")).toHaveText("Choom Circuit");
  await popup.getByRole("button", { name: "Retry" }).click();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Applied to GitHub.");
  await expect(popup.getByRole("alert")).toBeHidden();
  await expect(card(popup, "Frieren")).toHaveAttribute("aria-pressed", "true");
});

// The controls a popup visitor needs, wherever the popup puts them.
const CONTROLS = ["[data-rs=enabled]", "[data-rs=summary-show]", "[data-rs=search]", "[data-rs=appearance]", "[data-rs=text]", "[data-rs=motion]", "[data-rs=undo]", "[data-rs-clear]", "[data-rs-open=settings]", ".rs-popup-footer a"];

// Whether the page or the popup body scrolls, how many cards the gallery shows, and where each
// shown control sits.
const popupLayout = (popup) =>
  popup.evaluate((controls) => {
    const gallery = document.querySelector("[data-rs=gallery]");
    const shown = (el) => el && el.getClientRects().length > 0;
    const body = document.body;
    return {
      scrolls: document.scrollingElement.scrollHeight > innerHeight || body.scrollHeight > body.clientHeight + 1,
      sideways: document.scrollingElement.scrollWidth > innerWidth || body.scrollWidth > body.clientWidth + 1,
      galleryScrolls: shown(gallery) && gallery.scrollHeight > gallery.clientHeight,
      rows: new Set([...document.querySelectorAll(".rs-card")].slice(0, 4).map((c) => Math.round(c.getBoundingClientRect().top))).size,
      cardsVisible: shown(gallery) ? [...document.querySelectorAll(".rs-card")].filter((c) => c.getBoundingClientRect().bottom <= gallery.getBoundingClientRect().bottom + 1).length : 0,
      height: innerHeight,
      width: innerWidth,
      shown: controls.filter((selector) => [...document.querySelectorAll(selector)].some(shown)),
    };
  }, CONTROLS);

/** No sideways scrolling, and every shown control can be scrolled to and seen in full. */
async function expectReachable(popup, label, { scrolls } = {}) {
  const layout = await popupLayout(popup);
  expect(layout.sideways, label).toBe(false);
  if (scrolls !== undefined) expect(layout.scrolls, label).toBe(scrolls);
  for (const selector of layout.shown) {
    for (const control of await popup.locator(selector).all()) {
      if (!(await control.isVisible())) continue;
      await control.scrollIntoViewIfNeeded();
      await expect(control, `${label} ${selector}`).toBeInViewport({ ratio: 1 });
    }
  }
  return layout;
}

test("the popup fits 400x600 and 320x600 in every state: one inner scroller, every control in view", async ({ extension }) => {
  for (const viewport of [{ width: 400, height: 600 }, { width: 320, height: 600 }]) {
    const label = JSON.stringify(viewport);
    const popup = await extension.context.newPage();
    await popup.emulateMedia({ reducedMotion: "reduce" });
    await popup.setViewportSize(viewport);
    await popup.goto(extension.url("popup"));
    await expect(popup.locator("[data-rs=summary-show]")).not.toBeEmpty();
    let layout = await expectReachable(popup, label, { scrolls: false });
    expect(layout.galleryScrolls).toBe(true);
    expect(layout.rows).toBe(2);
    expect(layout.cardsVisible).toBeGreaterThanOrEqual(2);

    // Calm, the reduced-motion note and Undo all at once.
    await popup.getByRole("radio", { name: "Calm" }).check();
    await card(popup, "Frieren").click();
    await expect(popup.locator("[data-rs=undo]")).toBeVisible();
    await expect(popup.locator("[data-rs=motion-note]")).toBeVisible();
    layout = await expectReachable(popup, `${label} calm`, { scrolls: false });
    // A two-line show title at 320px leaves most of a row; at 400px a whole row shows.
    if (viewport.width === 400) expect(layout.cardsVisible, `${label} calm`).toBeGreaterThanOrEqual(2);

    // An empty search takes the gallery's place.
    await popup.getByRole("searchbox").fill("zzz");
    await expect(popup.locator("[data-rs=empty]")).toBeVisible();
    await expect(popup.locator("[data-rs=gallery]")).toBeHidden();
    await expectReachable(popup, `${label} empty`, { scrolls: false });
    await popup.getByRole("button", { name: "Clear search" }).click();
    await popup.getByRole("radio", { name: "Full" }).check();
    await popup.locator("[data-rs=undo]").click();
    await expect(popup.locator("[data-rs=undo]")).toBeHidden();
    await popup.close();
  }
});

test("a popup at real 200% browser zoom wraps and scrolls instead of clipping controls", async ({ extension }) => {
  const popup = await openPage(extension, "popup");
  await popup.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    await chrome.tabs.setZoom(tab.id, 2);
  });
  await expect.poll(() => popup.evaluate(() => innerWidth)).toBe(200);
  const layout = await expectReachable(popup, "200%", { scrolls: true });
  expect(layout.height).toBe(300);
  await popup.getByRole("switch", { name: "Motion" }).uncheck();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Saved.");
});
