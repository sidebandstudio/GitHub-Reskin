// Two tabs saving through their pickers, in Chromium and Firefox, with the origin's real Web Locks.
// The consent and isolation review's two reproductions of an acknowledged save silently undone:
// a tab whose manager write is paused after its revision check while the other tab saves, and a
// manager that delivers one tab's write to the other only later. Each ends with both changes
// kept and no error, or with the late tab told to try again, never with one change gone.
import { expect, openPanel, settingsOf, test } from "./helpers.mjs";

const both = async (gm, page) => {
  const settings = await settingsOf(gm, page);
  return { enabled: settings.enabled, text: settings.preferences.text };
};

test("a tab whose write is paused after its check holds the lock: the other tab's save waits for it and both changes stand", async ({ manager }) => {
  const gm = await manager({ kind: "async" });
  const a = await gm.open();
  const b = await gm.open();
  const frameA = await openPanel(a);
  const frameB = await openPanel(b);
  await b.evaluate(() => (window.__gmLog.pause = "reskin.state"));
  await frameB.getByRole("switch", { name: "Extra theme text" }).click();
  await b.waitForFunction(() => window.__gmLog.paused);
  await frameA.getByRole("switch", { name: "Reskin" }).click();
  await a.waitForTimeout(400);
  // A waits for B's lock: nothing of A's is stored yet.
  expect(await both(gm, a)).toEqual({ enabled: true, text: true });
  await b.evaluate(() => window.__gmLog.resume());
  await expect.poll(() => both(gm, a)).toEqual({ enabled: false, text: false });
  await expect(frameA.locator("[data-rs=error]")).toBeHidden();
  await expect(frameB.locator("[data-rs=error]")).toBeHidden();
  await expect(frameA.getByRole("switch", { name: "Reskin" })).not.toBeChecked();
});

test("a write the manager delivers late is waited for, never replaced; one that never arrives ends in Retry", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const a = await gm.open();
  const b = await gm.open();
  const frameA = await openPanel(a);
  const frameB = await openPanel(b);
  for (const page of [a, b]) await page.evaluate(() => window.__gmLog.holdBack());
  await frameA.getByRole("switch", { name: "Reskin" }).click();
  await expect.poll(() => both(gm, a)).toEqual({ enabled: false, text: true });
  // B has not been given A's write. Its save waits inside the lock until it is.
  await frameB.getByRole("switch", { name: "Extra theme text" }).click();
  await b.waitForTimeout(400);
  expect(await both(gm, a)).toEqual({ enabled: false, text: true });
  await b.evaluate(() => window.__gmLog.deliver());
  await expect.poll(() => both(gm, a)).toEqual({ enabled: false, text: false });
  await expect(frameB.locator("[data-rs=error]")).toBeHidden();

  // Delivery that does not come within the wait: B is told and offered Retry, A's save stands.
  for (const page of [a, b]) await page.evaluate(() => window.__gmLog.holdBack());
  await frameA.getByRole("switch", { name: "Reskin" }).click();
  await expect.poll(() => both(gm, a)).toEqual({ enabled: true, text: false });
  await frameB.getByRole("switch", { name: "Extra theme text" }).click();
  await expect(frameB.locator("[data-rs=error]")).toBeVisible({ timeout: 15000 });
  await expect(frameB.locator("[data-rs=retry]")).toBeVisible();
  expect(await both(gm, a)).toEqual({ enabled: true, text: false });
  await b.evaluate(() => window.__gmLog.deliver());
  await frameB.locator("[data-rs=retry]").click();
  await expect.poll(() => both(gm, a)).toEqual({ enabled: true, text: true });
});
