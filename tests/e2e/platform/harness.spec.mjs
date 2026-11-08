// Platform smoke in both engines: the config gives each project its own browser, the fixture
// server serves the platform app, and the shared axe helper finds real problems. These prove the
// runners, not the product.
import { request } from "node:http";
import { blocking, axeViolations } from "../../helpers/a11y.mjs";
import { expect, test } from "../../helpers/e2e.mjs";

const status = (url) => new Promise((done, fail) => request(url, (res) => done(res.statusCode)).on("error", fail).end());

test("each platform project runs in its own engine", async ({ browserName }, info) => {
  expect(info.project.name).toBe(`platform-${browserName}`);
  expect(info.project.testDir.replaceAll("\\", "/")).toMatch(/\/tests\/e2e\/platform$/);
});

test("the fixture server serves the platform app on a free local port", async ({ page, platformApp }) => {
  expect(platformApp.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  const response = await page.goto(platformApp.url);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(page).toHaveTitle("Reskin platform fixture");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Platform fixture");
  expect(await status(new URL("missing.html", platformApp.url))).toBe(404);
});

test("the platform app has no serious or critical axe findings, and keyboard focus reaches its controls", { tag: "@a11y" }, async ({ page, platformApp }) => {
  await page.goto(platformApp.url);
  expect(blocking(await axeViolations(page))).toEqual([]);
  const focused = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    focused.push(await page.evaluate(() => document.activeElement?.id));
  }
  expect(focused).toEqual(["skip", "name", "save"]);
  await expect(page.getByRole("button", { name: "Save" })).toBeFocused();
});

test("the accessibility probe reports real findings", { tag: "@a11y" }, async ({ page, platformApp }) => {
  await page.goto(new URL("inaccessible.html", platformApp.url).href);
  const ids = blocking(await axeViolations(page)).map((violation) => violation.id);
  expect(ids).toEqual(expect.arrayContaining(["button-name", "image-alt"]));
});
