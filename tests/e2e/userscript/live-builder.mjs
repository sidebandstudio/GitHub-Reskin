// Live public GitHub captures of the userscript's builder, as live.mjs does for the card: the
// generated script injected at document start with the test manager shim (Tampermonkey-style GM_*
// storage) in Playwright Chromium and Firefox, on https://github.com/whoisaldo. Not a CI test: it
// needs the network and GitHub's current markup. A fresh logged-out context; it never signs in or
// changes anything on GitHub.
//   node tests/e2e/userscript/live-builder.mjs --out <dir> [--script <github-reskin.user.js>]
// For each browser: the builder as it opens, a theme made from three colors and its preview, the
// profile once that theme is saved, a chatbot's answer in the import dialog, and the profile with
// the imported theme saved. capture.json records each file with the painted state, CSP reports and
// any request the userscript added outside GitHub's own hosts.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, firefox } from "@playwright/test";
import { PANEL, SHIM_KEY, STATE_KEY, injection } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PROFILE = "https://github.com/whoisaldo";
const ANSWER = await readFile(join(ROOT, "tests/ui/fixtures/ai-answer.txt"), "utf8");
const THREE = { name: "Night Market", background: "#1b1030", text: "#f3e9ff", accent: "#ff9f1c" };

const WATCH = () => {
  if (window.top !== window) return;
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (event) => window.__csp.push({ directive: event.effectiveDirective, blocked: event.blockedURI.slice(0, 32) }));
};

const state = (page) =>
  page.evaluate(() => ({
    boot: document.documentElement.getAttribute("data-reskin-boot"),
    styled: Boolean(document.getElementById("reskin-style")?.isConnected && document.getElementById("reskin-style").textContent),
    canvas: getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim(),
    scope: document.documentElement.getAttribute("data-reskin-css"),
    blockedFonts: window.__csp.filter((v) => v.directive === "font-src").length,
    otherViolations: window.__csp.filter((v) => v.directive !== "font-src"),
  }));

async function visit(page, url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    if (response && response.status() < 500) {
      await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
      await page.waitForFunction(() => ["ready", "native", "timeout"].includes(document.documentElement.getAttribute("data-reskin-boot")), null, { timeout: 15000 });
      await page.waitForTimeout(1200);
      return;
    }
    await page.waitForTimeout(10000);
  }
  throw new Error(`GitHub did not serve ${url}`);
}

async function openBuilder(page) {
  await page.evaluate(() => window.__gmLog.menu[0].fn());
  const card = page.frameLocator(PANEL);
  await card.locator("[data-rs=summary-show]").waitFor();
  await card.getByRole("button", { name: "Make a theme" }).click();
  const frame = page.frameLocator(PANEL);
  await frame.locator('[data-rb="builder"][data-rb-ready]').waitFor({ timeout: 30000 });
  const fresh = frame.getByRole("button", { name: "Start with your saved theme" });
  if (await fresh.isVisible()) await fresh.click();
  return frame;
}

// The preview has painted the newest state.
const previewSettled = (frame) => frame.locator('[data-rb="preview"] [data-reskin-preview]').evaluate((host) => new Promise((done) => (host.getAttribute("data-requested") === host.getAttribute("data-completed") ? done() : host.addEventListener("reskin-preview-complete", () => done(), { once: true }))));

async function captureBrowser(name, launcher, script, out) {
  const browser = await launcher.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const requests = [];
  context.on("request", (request) => requests.push(request.url()));
  await context.addInitScript(WATCH);
  await context.addInitScript({ content: injection("sync", script) });
  const page = await context.newPage();
  const records = [];
  const shot = async (file, extra = {}) => {
    await page.screenshot({ path: join(out, file) });
    records.push({ file, url: page.url(), browser: name, viewport: page.viewportSize(), ...extra, state: await state(page) });
  };
  const status = (frame) => frame.locator('[data-rb="status"]').textContent();

  await visit(page, PROFILE);
  let frame = await openBuilder(page);
  await previewSettled(frame).catch(() => {});
  await page.waitForTimeout(600);
  await shot(`${name}-builder-open.png`, { step: "builder opened" });

  await frame.getByRole("textbox", { name: "Theme name" }).fill(THREE.name);
  await frame.getByRole("textbox", { name: "Theme name" }).press("Tab");
  for (const [label, value] of [["Background", THREE.background], ["Text", THREE.text], ["Accent", THREE.accent]]) {
    await frame.getByRole("textbox", { name: label, exact: true }).fill(value);
    await frame.getByRole("textbox", { name: label, exact: true }).press("Tab");
  }
  await page.waitForTimeout(400);
  await previewSettled(frame).catch(() => {});
  await page.waitForTimeout(600);
  await shot(`${name}-three-colors.png`, { step: "three colors in the draft" });
  await frame.getByRole("button", { name: "Save as theme" }).click();
  await frame.locator('[data-rb="status"]').filter({ hasText: /^Saved / }).waitFor();
  const savedThree = await status(frame);
  await page.waitForTimeout(800);
  await shot(`${name}-three-colors-saved-panel.png`, { step: "saved", status: savedThree });
  await page.keyboard.press("Escape");
  await visit(page, PROFILE);
  await shot(`${name}-three-colors-profile.png`, { step: "profile with the saved three-color theme" });

  frame = await openBuilder(page);
  await frame.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = frame.getByRole("dialog", { name: "Import a theme" });
  await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(ANSWER);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await dialog.locator('[data-rb="import-show"]').filter({ hasText: /\S/ }).waitFor();
  await page.waitForTimeout(1500);
  await shot(`${name}-import-dialog.png`, { step: "chatbot answer previewed" });
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await frame.getByRole("button", { name: "Save as theme" }).click();
  await frame.locator('[data-rb="status"]').filter({ hasText: /^Saved / }).waitFor();
  const savedImport = await status(frame);
  await page.keyboard.press("Escape");
  await visit(page, PROFILE);
  await shot(`${name}-imported-profile.png`, { step: "profile with the imported theme", status: savedImport });

  const settings = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), SHIM_KEY).then((store) => store[STATE_KEY]?.records["reskin.settings"]);
  const offGitHub = [...new Set(requests)].filter((url) => !/^https:\/\/(github\.com|github\.githubassets\.com|avatars\.githubusercontent\.com|[a-z0-9-]+\.githubusercontent\.com|collector\.github\.com|api\.github\.com|camo\.githubusercontent\.com)\//.test(url) && !url.startsWith("data:") && !url.startsWith("blob:"));
  await browser.close();
  return { records, saved: settings?.customThemes.map((theme) => theme.document.name), selected: settings?.selectedThemeId, offGitHub };
}

const { values } = parseArgs({ options: { out: { type: "string" }, script: { type: "string" } } });
if (!values.out) throw new Error("--out <dir> is required");
const out = resolve(values.out);
await mkdir(out, { recursive: true });
const script = await readFile(values.script ? resolve(values.script) : join(ROOT, "userscript/github-reskin.user.js"), "utf8");
const result = {};
for (const [name, launcher] of [["chromium", chromium], ["firefox", firefox]]) result[name] = await captureBrowser(name, launcher, script, out);
await writeFile(join(out, "capture.json"), `${JSON.stringify({ script: { bytes: Buffer.byteLength(script) }, ...result }, null, 2)}\n`);
for (const [name, { records, saved, offGitHub }] of Object.entries(result)) {
  for (const record of records) console.log(`${record.file}: ${JSON.stringify(record.state)}${record.status ? ` (${record.status})` : ""}`);
  console.log(`${name}: saved ${JSON.stringify(saved)}; requests outside GitHub's own hosts: ${offGitHub.length ? offGitHub.join(", ") : "none"}`);
}
