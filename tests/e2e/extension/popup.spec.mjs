// The popup on the installed extension: instant commit to an open GitHub tab, one-change Undo,
// Full/Calm, Text, on/off, search, groups, keyboard use, failure recovery and popup geometry.
import { readFileSync } from "node:fs";
import { resolveTheme } from "../../../packages/engine/index.js";
import { MODE_INDEX, standardSeed } from "../../../packages/primer/index.js";
import { CHOOM, CHOOM_CANVAS, expect, openGitHub, openPage, painted, storage, test, waitPainted } from "./helpers.mjs";

const frieren = JSON.parse(readFileSync(new URL("../../../themes/anime/longroad-petals.reskin.json", import.meta.url), "utf8"));
const FRIEREN_CANVAS = resolveTheme(frieren, { seed: standardSeed(MODE_INDEX, "light"), policy: "themed", reducedMotion: false, forcedColors: false }).tokens.canvas;
const card = (popup, show) => popup.locator(".rs-card", { hasText: show });

test("a new install paints Choom Circuit on GitHub with its flavor, and the popup leads with the anime", async ({ extension }) => {
  const github = await openGitHub(extension);
  const state = await waitPainted(github, (s) => s.owned.length > 0);
  expect(state).toMatchObject({ boot: "ready", styled: true, canvas: CHOOM_CANVAS });
  expect(state.owned).toEqual(["profile.activity.heading", "profile.organizations.heading", "profile.pinned.heading", "profile.tag"]);
  expect(state.copy).toContain("// choom");

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
  await waitPainted(github, (s) => s.canvas === CHOOM_CANVAS);
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
  await waitPainted(github, (s) => s.canvas === CHOOM_CANVAS);
  expect((await storage(extension.worker))["reskin.settings"].selectedThemeId).toBe(CHOOM);

  // A new choice makes Undo available again.
  await card(again, "Dandadan").click();
  await expect(again.locator("[data-rs=undo]")).toBeVisible();
});

test("Calm keeps the colors and removes flavor; Text off removes only the copy; both survive theme changes", async ({ extension }) => {
  const github = await openGitHub(extension);
  await waitPainted(github, (s) => s.owned.length === 4);
  const popup = await openPage(extension, "popup");

  await popup.getByRole("radio", { name: "Calm" }).check();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Saved.");
  await expect(popup.locator("[data-rs=calm-note]")).toBeVisible();
  let state = await waitPainted(github, (s) => s.owned.length === 0);
  expect(state).toMatchObject({ styled: true, canvas: CHOOM_CANVAS });
  // Child switches stay editable under Calm and keep their values.
  await expect(popup.getByRole("switch", { name: "Text" })).toBeEnabled();
  await expect(popup.getByRole("switch", { name: "Text" })).toBeChecked();

  // Full brings the flavor back. C4's lifecycle counts every decoration pass of one page load
  // against its 10 ms optional-work budget, so on the same document it returns with the next
  // navigation; a fresh load shows it at once.
  await popup.getByRole("radio", { name: "Full" }).check();
  await expect(popup.locator("[data-rs=calm-note]")).toBeHidden();
  await github.reload();
  await waitPainted(github, (s) => s.owned.length === 4);
  await popup.getByRole("switch", { name: "Text" }).uncheck();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Saved.");
  await github.reload();
  state = await waitPainted(github, (s) => s.boot === "ready" && s.styled);
  expect(state.copy).toEqual([]);
  expect(state.canvas).toBe(CHOOM_CANVAS);

  // Switching themes never turns a preference back on.
  await card(popup, "Solo Leveling").click();
  await expect(popup.locator("[data-rs=status]")).toHaveText("Applied to GitHub.");
  await expect(popup.getByRole("switch", { name: "Text" })).not.toBeChecked();
  const settings = (await storage(extension.worker))["reskin.settings"];
  expect(settings.preferences).toMatchObject({ appearance: "full", text: false, motion: true });
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

test("the popup fits 400x600 and 320x600: one inner scroller, primary controls in view", async ({ extension }) => {
  for (const viewport of [{ width: 400, height: 600 }, { width: 320, height: 600 }]) {
    const popup = await openPage(extension, "popup", viewport);
    const layout = await popup.evaluate(() => {
      const gallery = document.querySelector("[data-rs=gallery]");
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      return {
        pageScrolls: document.scrollingElement.scrollHeight > innerHeight || document.scrollingElement.scrollWidth > innerWidth,
        galleryScrolls: gallery.scrollHeight > gallery.clientHeight,
        bottoms: ["[data-rs=enabled]", "[data-rs=summary-show]", "[data-rs=appearance]", "[data-rs=motion]", ".rs-popup-footer"].map((s) => box(s).bottom),
        rows: new Set([...document.querySelectorAll(".rs-card")].slice(0, 4).map((c) => Math.round(c.getBoundingClientRect().top))).size,
        cardsVisible: [...document.querySelectorAll(".rs-card")].filter((c) => c.getBoundingClientRect().bottom <= gallery.getBoundingClientRect().bottom + 1).length,
      };
    });
    expect(layout.pageScrolls, JSON.stringify(viewport)).toBe(false);
    expect(layout.galleryScrolls).toBe(true);
    for (const bottom of layout.bottoms) expect(bottom).toBeLessThanOrEqual(viewport.height);
    expect(layout.rows).toBe(2);
    expect(layout.cardsVisible).toBeGreaterThanOrEqual(2);
    await popup.close();
  }
});
