// Live public GitHub captures of the generated userscript, injected at document start with the
// test manager shim (tests/e2e/userscript/helpers.mjs, Tampermonkey-style GM_* storage) in
// Playwright Chromium and Firefox. Not a CI test: it needs the network and GitHub's current
// markup. A fresh logged-out context; it never signs in or changes anything on GitHub.
//   node tests/e2e/userscript/live.mjs --out <dir> [--script <github-reskin.user.js>]
// Writes <browser>-<theme>-<page>.png for the profile and a repository in Choom Circuit (the
// default) and Frieren's light theme, the open panel, and the sign-in page, which must stay
// native. capture.json records each URL with the painted state, blocked font loads (GitHub's CSP)
// and any request the userscript added.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, firefox } from "@playwright/test";
import { FRIEREN, PANEL, SHIM_KEY, STATE_KEY, injection } from "./helpers.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PAGES = Object.freeze([
  { name: "profile", url: "https://github.com/whoisaldo" },
  { name: "repo", url: "https://github.com/sidebandstudio/GitHub-Reskin" },
]);
const LOGIN = "https://github.com/login";

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
    owned: document.querySelectorAll("[data-reskin-owned]:not(style)").length,
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

async function captureBrowser(name, launcher, script, out) {
  const browser = await launcher.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Every request that is not a document, with and without the script, to compare.
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
  for (const theme of ["choom", "frieren"]) {
    if (theme === "frieren") {
      await visit(page, PAGES[0].url);
      await page.evaluate(() => window.__gmLog.menu[0].fn());
      const frame = page.frameLocator(PANEL);
      await frame.locator("[data-rs=summary-show]").waitFor();
      await page.waitForTimeout(500);
      await shot(`${name}-choom-panel.png`, { theme: "choom", panel: true });
      await frame.locator(`[data-theme="${FRIEREN}"]`).click();
      await page.waitForFunction(() => document.documentElement.getAttribute("data-reskin-boot") === "ready");
      await page.waitForTimeout(1200);
      await shot(`${name}-frieren-panel.png`, { theme: "frieren", panel: true });
      await page.keyboard.press("Escape");
    }
    for (const { name: pageName, url } of PAGES) {
      await visit(page, url);
      await shot(`${name}-${theme}-${pageName}.png`, { theme });
    }
  }
  await visit(page, LOGIN);
  await shot(`${name}-login.png`, { theme: "frieren" });
  const settings = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), SHIM_KEY).then((store) => store[STATE_KEY]?.records["reskin.settings"]);
  const offGitHub = [...new Set(requests)].filter((url) => !/^https:\/\/(github\.com|github\.githubassets\.com|avatars\.githubusercontent\.com|[a-z0-9-]+\.githubusercontent\.com|collector\.github\.com|api\.github\.com|camo\.githubusercontent\.com)\//.test(url) && !url.startsWith("data:"));
  await browser.close();
  return { records, selected: settings?.selectedThemeId, offGitHub };
}

const { values } = parseArgs({ options: { out: { type: "string" }, script: { type: "string" } } });
if (!values.out) throw new Error("--out <dir> is required");
const out = resolve(values.out);
await mkdir(out, { recursive: true });
const script = await readFile(values.script ? resolve(values.script) : join(ROOT, "userscript/github-reskin.user.js"), "utf8");
const result = {};
for (const [name, launcher] of [["chromium", chromium], ["firefox", firefox]]) result[name] = await captureBrowser(name, launcher, script, out);
await writeFile(join(out, "capture.json"), `${JSON.stringify({ script: { bytes: Buffer.byteLength(script) }, ...result }, null, 2)}\n`);
for (const [name, { records, offGitHub }] of Object.entries(result)) {
  for (const record of records) console.log(`${record.file}: ${JSON.stringify(record.state)}`);
  console.log(`${name}: requests outside GitHub's own hosts: ${offGitHub.length ? offGitHub.join(", ") : "none"}`);
}
