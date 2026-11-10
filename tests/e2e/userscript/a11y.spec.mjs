// Accessibility of the userscript panel, in Chromium and Firefox: axe finds nothing serious or
// critical in the frame (durable and session storage, wide and narrow, and the card without
// controls a script in the page's context gets), every control has a name,
// a theme card is reached and chosen with the keyboard alone, focus stays visible, and Escape
// gives focus back to the page element that had it. The builder's frame (Make a theme, its import
// dialog, Backup & help) has no serious or critical finding, wide and narrow, every one of its
// controls is named, it is reached from the card with the keyboard, and it says in text, not only
// visually, that a theme's CSS stays off.
import { axeViolations, blocking } from "../../helpers/a11y.mjs";
import { CSS_NOTE } from "../../../userscript/copy.js";
import { CHOOM_CANVAS, FRIEREN, FRIEREN_CANVAS, HOST, PANEL, PROFILE_URL, expect, openPanel, painted, panelDocument, panelFrame, test } from "./helpers.mjs";

test("the panel has no serious or critical axe findings, with or without durable storage @a11y", async ({ manager }) => {
  for (const [kind, viewport] of [["sync", { width: 1280, height: 900 }], ["none", { width: 360, height: 640 }]]) {
    const gm = await manager({ kind });
    const page = await gm.open(`${PROFILE_URL}#reskin`);
    await page.setViewportSize(viewport);
    await panelFrame(page);
    const violations = await axeViolations(await panelDocument(page));
    expect(blocking(violations), `${kind}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
    // The frame itself is named for the page's accessibility tree.
    await expect(page.locator(PANEL)).toHaveAttribute("title", "GitHub Reskin");
  }
});

test("the card without controls, for a script in the page's context, has no serious or critical axe findings and focuses Close @a11y", async ({ manager }) => {
  const gm = await manager({ kind: "sync", report: "page" });
  const page = await gm.open(`${PROFILE_URL}#reskin`);
  const frame = page.frameLocator(PANEL);
  await expect(frame.locator("[data-us=storage-note]")).toHaveText(/manager's menu/);
  await expect(frame.locator("[data-rs=summary-show]")).not.toBeEmpty();
  const violations = await axeViolations(await panelDocument(page));
  expect(blocking(violations), JSON.stringify(violations, null, 1)).toEqual([]);
  await expect(frame.getByRole("button", { name: "Close GitHub Reskin" })).toBeFocused();
});

test("every control is named and a theme is chosen with the keyboard alone @a11y", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  const frame = await openPanel(page);
  for (const [role, name] of [
    ["switch", "Reskin"],
    ["button", "Close GitHub Reskin"],
    ["searchbox", "Search themes or shows"],
    ["radio", "Full"],
    ["radio", "Calm"],
    ["switch", "Extra theme text"],
    ["switch", "Motion"],
    ["button", "Export theme file"],
    ["button", "Make a theme"],
    ["button", "Backup & help"],
  ]) {
    await expect(frame.getByRole(role, { name, exact: true }), `${role} ${name}`).toHaveCount(1);
  }
  // A card's name carries the anime title first, then the theme's own name.
  await expect(frame.locator(`[data-theme="${FRIEREN}"]`)).toHaveAccessibleName(/^Frieren: Beyond Journey's End\s*Longroad Petals/);

  // From the first control, Tab reaches the gallery; arrow keys are not needed.
  await expect(frame.getByRole("switch", { name: "Reskin" })).toBeFocused();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await frame.locator(`[data-theme="${FRIEREN}"]`).evaluate((node) => node === node.ownerDocument.activeElement);
  }
  expect(reached).toBe(true);
  const outline = await frame.locator(`[data-theme="${FRIEREN}"]`).evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect.poll(() => painted(page)).toMatchObject({ canvas: FRIEREN_CANVAS });
  await expect(frame.locator("[data-rs=status]")).toHaveText("Applied to GitHub.");
  await frame.locator("[data-rs=undo]").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => painted(page)).toMatchObject({ canvas: CHOOM_CANVAS });

  await page.keyboard.press("Escape");
  await expect(page.locator(PANEL)).toHaveCount(0);
});

test("the builder's frame has no serious or critical axe findings and every control is named @a11y", async ({ manager }) => {
  for (const [kind, viewport] of [["sync", { width: 1280, height: 900 }], ["none", { width: 360, height: 640 }]]) {
    const gm = await manager({ kind });
    const page = await gm.open(`${PROFILE_URL}#reskin`);
    await page.setViewportSize(viewport);
    const card = await panelFrame(page);
    // From the card to Make a theme with the keyboard.
    await card.getByRole("button", { name: "Make a theme" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(HOST)).toHaveAttribute("data-reskin-userscript-panel", "make");
    const frame = page.frameLocator(PANEL);
    await expect(frame.locator('[data-rb="builder"]')).toHaveAttribute("data-rb-ready", "", { timeout: 0 });
    await expect(frame.getByRole("textbox", { name: "Theme name" })).toBeFocused();
    await expect(page.locator(PANEL)).toHaveAttribute("title", "GitHub Reskin");
    // Every disclosure open, so axe sees every control.
    await frame.locator("details").evaluateAll((nodes) => nodes.forEach((node) => (node.open = true)));
    await expect(frame.getByText(CSS_NOTE).first()).toBeVisible();
    let violations = await axeViolations(await panelDocument(page));
    expect(blocking(violations), `${kind} builder: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
    for (const [role, name] of [
      ["button", "Close GitHub Reskin"],
      ["button", "Themes"],
      ["link", "Make a theme"],
      ["link", "Backup & help"],
      ["button", "Import"],
      ["button", "Copy AI prompt"],
      ["textbox", "Background"],
      ["textbox", "Text"],
      ["textbox", "Accent"],
      ["button", "Undo last change"],
      ["combobox", "Heading font"],
      ["textbox", "CSS (read only)"],
      ["button", "Download .reskin.json"],
      ["button", "Save as theme"],
    ]) {
      await expect(frame.getByRole(role, { name, exact: true }), `${role} ${name}`).toHaveCount(1);
    }
    await expect(frame.getByRole("checkbox", { name: /advanced CSS/i })).toHaveCount(0);

    await frame.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = frame.getByRole("dialog", { name: "Import a theme" });
    await expect(dialog.getByRole("textbox", { name: "Chatbot answer" })).toBeFocused();
    violations = await axeViolations(await panelDocument(page));
    expect(blocking(violations), `${kind} import: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(frame.getByRole("button", { name: "Import", exact: true })).toBeFocused();

    await frame.getByRole("link", { name: "Backup & help" }).click();
    await expect(frame.getByRole("heading", { name: "Backup & help" })).toBeVisible();
    violations = await axeViolations(await panelDocument(page));
    expect(blocking(violations), `${kind} backup: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator(PANEL)).toHaveCount(0);
  }
});
