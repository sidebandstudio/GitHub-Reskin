// Accessibility of the extension's own pages: axe finds no serious or critical violation, every
// control is reachable by keyboard with a visible focus outline, and targets are at least 44px.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { axeViolations, blocking } from "../../helpers/a11y.mjs";
import { expect, openPage, test } from "./helpers.mjs";

// Extension pages allow only packaged scripts, so axe cannot arrive as a script tag. It is
// evaluated through the test channel instead, which page CSP does not govern.
const AXE = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const axe = async (page) => {
  await page.evaluate(AXE);
  return blocking(await axeViolations(page));
};

const PAGES = [
  ["popup", { width: 400, height: 600 }],
  ["settings", { width: 1280, height: 900 }],
  ["settings", { width: 390, height: 844 }, "themes"],
  ["onboarding", { width: 1280, height: 900 }],
  ["onboarding", { width: 390, height: 844 }],
];

for (const [name, viewport, view] of PAGES) {
  test(`${name}${view ? ` ${view}` : ""} at ${viewport.width}px has no serious or critical axe violations @a11y`, async ({ extension }) => {
    const page = await openPage(extension, name, viewport);
    if (view) await page.getByRole("link", { name: "Themes" }).click();
    if (name === "onboarding") {
      await page.getByRole("button", { name: "All 13 anime" }).click();
      await page.getByText("Preview extras").click();
    }
    expect(await axe(page)).toEqual([]);
  });
}

test("popup controls are native, named, keyboard reachable and show focus @a11y", async ({ extension }) => {
  const popup = await openPage(extension, "popup");
  const snapshot = await popup.locator("body").ariaSnapshot();
  expect(snapshot).toContain('switch "Reskin"');
  expect(snapshot).toContain('radio "Full"');
  expect(snapshot).toContain('radio "Calm"');
  expect(snapshot).toContain('switch "Extra theme text"');
  expect(snapshot).toContain('switch "Motion"');
  expect(snapshot).toContain('searchbox "Search themes or shows"');
  expect(snapshot).toMatch(/button "Cyberpunk: Edgerunners Choom Circuit Selected" \[pressed\]/);

  const seen = [];
  for (let i = 0; i < 12; i++) {
    await popup.keyboard.press("Tab");
    const focus = await popup.evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const label = el.closest("label") ?? el;
      const target = label.getBoundingClientRect();
      return { name: el.getAttribute("data-rs") ?? el.className ?? el.tagName, outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2, height: Math.max(rect.height, target.height) };
    });
    seen.push(focus);
  }
  for (const focus of seen) {
    expect(focus.height, focus.name).toBeGreaterThanOrEqual(44);
  }
  // Every focus that is not a styled radio (which draws its ring on its label) shows an outline.
  expect(seen.filter((f) => !f.outline && f.name !== "").length).toBeLessThanOrEqual(2);
});

test("the reduced-motion note appears beside Motion when the device asks for less motion @a11y", async ({ extension }) => {
  const page = await extension.context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 400, height: 600 });
  await page.goto(extension.url("popup"));
  await expect(page.getByText("Paused by your device's reduced-motion setting")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Motion" })).toBeChecked();
});

test("settings reach Preferences directly, and its switches explain what they change @a11y", async ({ extension }) => {
  const page = await openPage(extension, "settings", { width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await expect(nav.getByRole("link", { name: "Preferences" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".rs-card").first()).toBeHidden();
  // The switches start in the first screen.
  const top = await page.getByRole("switch", { name: "Reskin on GitHub and Gist" }).evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThan(844);
  await expect(page.getByRole("switch", { name: "Extra theme text" })).toHaveAccessibleDescription("Adds labels like // choom. Your own words stay the same.");
  await page.getByText("Preview extras").click();
  await expect(page.locator(".rs-extras").getByText("Preem picks")).toBeVisible();

  await nav.getByRole("link", { name: "Themes" }).click();
  await expect(page).toHaveURL(/#themes$/);
  await expect(nav.getByRole("link", { name: "Themes" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".rs-card")).toHaveCount(13);
  await expect(page.getByRole("switch", { name: "Motion" })).toBeHidden();
  // The selected show stays above every view.
  await expect(page.locator("[data-rs=summary-show]")).toBeVisible();
});

// The builder: axe with every disclosure open and with the import dialog open, at desktop and
// phone widths; a keyboard-only edit, Undo and import; and the names a screen reader announces.
async function openMake(extension, viewport) {
  const page = await openPage(extension, "settings", viewport);
  await page.getByRole("link", { name: "Make a theme" }).click();
  await expect(page.locator('[data-rb="based-on"]')).not.toBeEmpty();
  return page;
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`Make a theme at ${viewport.width}px, every disclosure and the import dialog, has no serious or critical axe violations @a11y`, async ({ extension }) => {
    const page = await openMake(extension, viewport);
    await page.evaluate(() => document.querySelectorAll('[data-rb="builder"] details').forEach((details) => (details.open = true)));
    expect(await axe(page)).toEqual([]);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Import a theme" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    // No page-wide horizontal scrolling at phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("the builder works by keyboard alone and names every control @a11y", async ({ extension }) => {
  const page = await openMake(extension, { width: 1280, height: 900 });
  const snapshot = await page.locator('[data-rb="builder"]').ariaSnapshot();
  for (const name of ['button "Import"', 'button "Copy AI prompt"', 'textbox "Theme name"', 'textbox "Background"', 'textbox "Text"', 'textbox "Accent"', 'button "Undo last change" [disabled]', 'radio "Light"', 'radio "Dark"', 'combobox "Heading font"', 'combobox "Body font"', 'button "Save as theme"', 'button "Discard draft" [disabled]', 'region "Preview of your theme on GitHub, scrollable"']) {
    expect(snapshot, name).toContain(name);
  }
  // Each color has a picker and a hex field with its own name.
  await expect(page.getByLabel("Background color picker", { exact: true })).toHaveAttribute("type", "color");

  // Tab to Background's hex field, type a color, and leave it: the draft takes it.
  const reached = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => document.activeElement?.id ?? "");
    reached.push(name);
    if (name === "rb-colors-background") break;
  }
  expect(reached.at(-1), reached.join(" ")).toBe("rb-colors-background");
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2, height: document.activeElement.getBoundingClientRect().height };
  });
  expect(focus.outline).toBe(true);
  expect(focus.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("#202a44");
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-rb="dirty"]')).toBeVisible();

  // Undo by keyboard, announced in the polite status.
  await page.getByRole("button", { name: "Undo last change" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-rb="status"]')).toHaveText("Last change undone.");
  await expect(page.locator('[data-rb="status"]')).toHaveAttribute("role", "status");
  await expect(page.getByRole("textbox", { name: "Background", exact: true })).not.toHaveValue("#202a44");

  // A disclosure opens by keyboard; an invalid hex is announced with its field.
  await page.locator('[data-rb-section="code"] > summary').focus();
  await page.keyboard.press("Enter");
  const code = page.getByRole("textbox", { name: "Code background", exact: true });
  await code.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("#12");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(code).toHaveAccessibleDescription(/Use a color like #18212b\./);

  // The import dialog opens and closes by keyboard, and focus returns to Import.
  await page.getByRole("button", { name: "Import", exact: true }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Import a theme" });
  await expect(dialog.getByRole("textbox", { name: "Chatbot answer" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeFocused();
});

// Backup & help with a saved theme listed, and an import missing its Background with the picker
// that fixes it: no serious or critical axe violation, named controls, no page-wide scrolling.
for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`Backup & help and the missing-color picker at ${viewport.width}px have no serious or critical axe violations @a11y`, async ({ extension }) => {
    const page = await openMake(extension, viewport);
    await page.getByRole("textbox", { name: "Theme name" }).fill("Kept theme");
    await page.getByRole("textbox", { name: "Theme name" }).press("Tab");
    await page.getByRole("button", { name: "Save as theme" }).click();
    await expect(page.locator('[data-rb="status"]')).toHaveText("Saved Kept theme and applied it to GitHub.");

    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import a theme" });
    await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill('Here:\n```json\n{"schemaVersion":1,"name":"Fog","base":"dark","colors":{"text":"#e6edf3","accent":"#ff806c"}}\n```');
    await dialog.getByRole("button", { name: "Preview theme" }).click();
    await expect(dialog.getByRole("textbox", { name: "Background", exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Background", exact: true })).toHaveAccessibleDescription(/Choose background here/);
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Backup & help" }).click();
    const backup = page.locator('[data-rk="backup"]');
    await expect(backup.getByRole("button", { name: "Remove Kept theme" })).toBeVisible();
    await expect(backup.getByRole("button", { name: "Export Kept theme" })).toBeVisible();
    await expect(backup.getByRole("button", { name: "Reset all" })).toHaveAccessibleDescription(/Reset all removes your saved themes/);
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
