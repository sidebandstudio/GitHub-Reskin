// Accessibility of the userscript panel, in Chromium and Firefox: axe finds nothing serious or
// critical in the frame (durable and session storage, wide and narrow), every control has a name,
// a theme card is reached and chosen with the keyboard alone, focus stays visible, and Escape
// gives focus back to the page element that had it.
import { axeViolations, blocking } from "../../helpers/a11y.mjs";
import { CHOOM_CANVAS, FRIEREN, FRIEREN_CANVAS, PANEL, PROFILE_URL, expect, openPanel, painted, panelDocument, panelFrame, test } from "./helpers.mjs";

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
