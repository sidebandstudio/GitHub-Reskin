// npm run qa:firefox [-- --firefox <firefox executable>]: DONE.md's check of the release candidate
// in an actual Firefox release, separate from Playwright's patched Firefox. It installs
// artifacts/github-reskin-<version>-firefox.zip as a temporary add-on in a fresh profile, as
// web-ext run does, and checks the first-run tab, a theme chosen there reaching public GitHub,
// the add-on's fonts loading under GitHub's CSP, importing a theme file and exporting it again,
// the settings surviving a restart, and the on/off switch. GitHub is visited logged out and only
// read.
//
// Playwright's WebDriver BiDi mode drives the GitHub tab. Firefox's remote debugging protocol,
// the one web-ext and about:debugging use, installs the add-on and drives and photographs its own
// pages, which WebDriver BiDi does not reach. Writes artifacts/reports/firefox/report.json and
// the screenshots, and prints how to repeat the run by hand. Without a Firefox it fails.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { firefox } from "@playwright/test";
import { catalogCards, readCatalogEntries } from "../packages/ui/bundle.mjs";
import { unpack } from "./qa-live.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OUT = "artifacts/reports/firefox";
const GITHUB = "https://github.com/sidebandstudio/GitHub-Reskin";
const CHOOM = "anime.cyberpunk-edgerunners";
const FRIEREN = "anime.frieren";
// A three-color theme file, as someone would import one.
export const IMPORTED = Object.freeze({ schemaVersion: 1, name: "Firefox Check", base: "dark", colors: { background: "#14212b", text: "#e8f1f7", accent: "#ff806c" } });

/** The Firefox to use: --firefox, RESKIN_FIREFOX, or the platform's usual install path. */
export function findFirefox(args, env = process.env, exists = existsSync) {
  const flag = args.indexOf("--firefox");
  const given = flag >= 0 ? args[flag + 1] : env.RESKIN_FIREFOX;
  if (given) return exists(given) ? given : null;
  const usual = {
    win32: [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean).map((dir) => join(dir, "Mozilla Firefox", "firefox.exe")),
    darwin: ["/Applications/Firefox.app/Contents/MacOS/firefox"],
    linux: ["/usr/bin/firefox", "/snap/bin/firefox"],
  }[process.platform] ?? [];
  return usual.find((path) => exists(path)) ?? null;
}

/** How to repeat the run by hand with web-ext, in a visible Firefox. */
export function procedure({ firefoxPath, zip }) {
  return [
    "To repeat this by hand in a visible Firefox:",
    `  1. Unzip ${zip} into an empty folder.`,
    `  2. npx web-ext run --source-dir <that folder> --firefox "${firefoxPath ?? "<path to firefox>"}" --start-url ${GITHUB}`,
    "     web-ext makes a fresh temporary profile and installs the folder as a temporary add-on.",
    "  3. One welcome tab opens. Pick Frieren there; the GitHub tab turns cream, with the theme's own fonts.",
    "  4. In the add-on's settings, Make a theme > Import > Choose file, import a .reskin.json, save it, then export it from Backup & help.",
    "  5. Quit with Ctrl+C and run step 2 again with --profile-create-if-missing --keep-profile-changes --firefox-profile <a folder>: the theme stays.",
    "  6. Turn GitHub Reskin off in its popup: GitHub goes back to its own look. Turn it on again.",
  ].join("\n");
}

/**
 * A Firefox remote debugging client: request(packet) resolves with the reply from packet.to, and
 * on(listener) sees every packet, including events.
 */
export function remoteClient(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host });
    const waiting = new Map();
    const listeners = new Set();
    let buffer = Buffer.alloc(0);
    let greeted = false;
    const client = {
      request(packet) {
        return new Promise((done, fail) => {
          waiting.set(packet.to, [...(waiting.get(packet.to) ?? []), { done, fail }]);
          const body = Buffer.from(JSON.stringify(packet));
          socket.write(Buffer.concat([Buffer.from(`${body.length}:`), body]));
        });
      },
      on(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close: () => socket.destroy(),
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const colon = buffer.indexOf(":");
        if (colon < 0) return;
        const length = Number(buffer.subarray(0, colon).toString());
        if (buffer.length < colon + 1 + length) return;
        const packet = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
        buffer = buffer.subarray(colon + 1 + length);
        if (!greeted) {
          greeted = true;
          resolve(client);
          continue;
        }
        for (const listener of listeners) listener(packet);
        // Events carry a type; a reply has none, or carries an error.
        const queue = waiting.get(packet.from);
        if (queue?.length && (!packet.type || packet.error)) {
          const { done, fail } = queue.shift();
          if (packet.error) fail(new Error(`${packet.error}: ${packet.message}`));
          else done(packet);
        }
      }
    });
    socket.on("error", reject);
    socket.on("close", () => {
      for (const queue of waiting.values()) for (const { fail } of queue) fail(new Error("Firefox closed the debugging connection"));
      waiting.clear();
    });
  });
}

async function connect(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await remoteClient(port);
    } catch {
      await new Promise((done) => setTimeout(done, 200));
    }
  }
  throw new Error(`Firefox's debugging server never answered on port ${port}`);
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Polls `check` until it returns a truthy value or `ms` pass, and returns the last value. */
async function until(check, ms = 15000) {
  const end = Date.now() + ms;
  let value;
  while (!(value = await check()) && Date.now() < end) await wait(250);
  return value;
}

/**
 * Firefox with the add-on installed as a temporary add-on: {context, addon, close}. `addon` reaches
 * the add-on's frames: evaluate(match, fn, ...args) runs fn in the newest frame whose URL contains
 * `match` and resolves with its JSON result, and screenshot(match, path) photographs that tab.
 */
async function launch({ executablePath, profile, dir, uuid, id, downloads }) {
  const port = 6000 + Math.floor(Math.random() * 2000);
  const context = await firefox.launchPersistentContext(profile, {
    channel: "moz-firefox",
    executablePath,
    headless: true,
    // WebDriver BiDi's download behavior decides where a download goes, so it is this folder.
    downloadsPath: downloads,
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1280, height: 800 },
    args: ["-start-debugger-server"],
    firefoxUserPrefs: {
      "devtools.debugger.remote-enabled": true,
      "devtools.chrome.enabled": true,
      "devtools.debugger.prompt-connection": false,
      "devtools.debugger.remote-port": port,
      // A fixed moz-extension host, and storage kept across a reinstall, as web-ext run keeps them.
      "extensions.webextensions.uuids": JSON.stringify({ [id]: uuid }),
      "extensions.webextensions.keepStorageOnUninstall": true,
      "extensions.webextensions.keepUuidOnUninstall": true,
    },
  });
  let client;
  try {
    client = await connect(port);
    const root = await client.request({ to: "root", type: "getRoot" });
    await client.request({ to: root.addonsActor, type: "installTemporaryAddon", addonPath: dir });
    const addon = await until(async () => (await client.request({ to: "root", type: "listAddons" })).addons.find((entry) => entry.id === id));
    const watcher = await client.request({ to: addon.actor, type: "getWatcher" });
    const frames = [];
    client.on((packet) => {
      if (packet.type === "target-available-form") frames.push(packet.target);
      const gone = packet.type === "target-destroyed-form" ? frames.findIndex((form) => form.actor === packet.target.actor) : -1;
      if (gone >= 0) frames.splice(gone, 1);
    });
    await client.request({ to: watcher.actor, type: "watchTargets", targetType: "frame" });
    const frame = (match) => until(async () => frames.findLast((form) => form.url?.includes(match)));
    const evaluate = async (match, fn, ...args) => {
      const form = await frame(match);
      if (!form) throw new Error(`no add-on frame at ${match}`);
      const result = new Promise((resolve) => {
        const off = client.on((packet) => {
          if (packet.type === "evaluationResult" && packet.from === form.consoleActor) {
            off();
            resolve(packet);
          }
        });
      });
      await client.request({ to: form.consoleActor, type: "evaluateJSAsync", text: `(async () => JSON.stringify(await (${fn})(...${JSON.stringify(args)})))()`, mapped: { await: true } });
      const packet = await result;
      if (packet.exceptionMessage) throw new Error(`${match}: ${packet.exceptionMessage}`);
      return typeof packet.result === "string" ? JSON.parse(packet.result) : undefined;
    };
    const screenshot = async (match, path) => {
      const form = await frame(match);
      const { value } = await client.request({ to: root.screenshotActor, type: "capture", args: { browsingContextID: form.browsingContextID, rect: { left: 0, top: 0, width: 1280, height: 800 }, dpr: 1, snapshotScale: 1, fileScale: 1 } });
      if (!value?.data) throw new Error(`no screenshot of ${match}: ${JSON.stringify(value?.messages)}`);
      await writeFile(path, Buffer.from(value.data.split(",")[1], "base64"));
    };
    const close = async () => {
      client.close();
      await context.close();
    };
    return { context, addon: { evaluate, screenshot, frame }, close };
  } catch (error) {
    client?.close();
    await context.close();
    throw error;
  }
}

// In an add-on page: the first button whose name starts with `text`, clicked once it exists.
async function clickButton(text, scope = "") {
  const end = Date.now() + 15000;
  for (;;) {
    const root = scope ? document.querySelector(scope) : document;
    const button = [...(root?.querySelectorAll("button, [role=button]") ?? [])].find((element) => (element.getAttribute("aria-label") ?? element.textContent).trim().startsWith(text) && !element.hidden && element.offsetParent !== null);
    if (button) {
      button.click();
      return true;
    }
    if (Date.now() > end) return false;
    await new Promise((done) => setTimeout(done, 200));
  }
}

// In an add-on page: waits for a selector's text to match, and returns it.
async function textOf(selector, pattern, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const text = document.querySelector(selector)?.textContent.trim() ?? "";
    if (new RegExp(pattern).test(text) || Date.now() > end) return text;
    await new Promise((done) => setTimeout(done, 200));
  }
}

// In the GitHub tab: what the add-on did there.
function pageState() {
  const root = document.documentElement;
  return {
    boot: root.getAttribute("data-reskin-boot"),
    styled: Boolean(document.getElementById("reskin-style")?.textContent),
    owned: document.querySelectorAll("[data-reskin-owned]").length,
    canvas: getComputedStyle(root).getPropertyValue("--bgColor-default").trim(),
    body: getComputedStyle(document.body).fontFamily,
  };
}

/** Runs the actual-Firefox check and writes its report. Resolves to {exitCode, testCount}. */
export async function qaFirefox({ args = [], root = DEFAULT_ROOT } = {}) {
  const config = JSON.parse(await readFile(join(root, "release.config.json"), "utf8"));
  const zip = `artifacts/github-reskin-${config.version}-firefox.zip`;
  const executablePath = findFirefox(args);
  if (!executablePath) {
    console.error(`qa:firefox needs an actual Firefox release. Pass --firefox <path> or set RESKIN_FIREFOX.\n${procedure({ firefoxPath: null, zip })}`);
    return { exitCode: 1, testCount: 0 };
  }
  const out = join(root, OUT);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const shot = (name) => join(OUT, `${name}.png`).replaceAll("\\", "/");
  const report = { startedAt: new Date().toISOString(), firefox: { path: executablePath }, candidate: { version: config.version, commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() }, checks: [] };
  const record = (step, check, pass, detail, screenshot) => {
    report.checks.push({ step, check, pass, ...(detail === undefined ? {} : { detail }), ...(screenshot ? { screenshot } : {}) });
    console.log(`${pass ? "ok  " : "FAIL"} ${step}: ${check}${detail === undefined ? "" : ` (${JSON.stringify(detail)})`}`);
  };
  const scratch = await mkdtemp(join(tmpdir(), "reskin-qa-firefox-"));
  const profile = join(scratch, "profile");
  const downloads = join(scratch, "downloads");
  await mkdir(downloads, { recursive: true });
  let session = null;
  let unpacked = null;
  try {
    unpacked = await unpack(root, config.version, "firefox");
    report.candidate.package = { file: unpacked.file, sha256: unpacked.sha256 };
    const id = JSON.parse(await readFile(join(unpacked.dir, "manifest.json"), "utf8")).browser_specific_settings.gecko.id;
    const options = { executablePath, profile, dir: unpacked.dir, uuid: randomUUID(), id, downloads };
    const canvasOf = Object.fromEntries(catalogCards(await readCatalogEntries(root)).map((card) => [card.id, card.mini.canvas]));
    const settings = () => session.addon.evaluate("_generated_background_page", async () => (await browser.storage.local.get("reskin.settings"))["reskin.settings"]);

    session = await launch(options);
    report.firefox.version = session.context.browser()?.version() ?? null;
    console.log(`qa:firefox: Firefox ${report.firefox.version} at ${executablePath}, ${zip} as a temporary add-on.\n${procedure({ firefoxPath: executablePath, zip })}`);
    record("install", "installed as a temporary add-on", true);

    // First run: one welcome tab, Choom Circuit selected.
    await session.addon.frame("pages/onboarding.html");
    await wait(2000);
    const welcomeTabs = session.context.pages().filter((page) => page.url().includes("/pages/onboarding.html")).length;
    const first = await settings();
    await session.addon.screenshot("pages/onboarding.html", join(root, shot("1-welcome")));
    record("first run", "one welcome tab, Choom Circuit selected", welcomeTabs === 1 && first?.selectedThemeId === CHOOM && first.enabled && !first.onboardingCompleted, { welcomeTabs, selected: first?.selectedThemeId }, shot("1-welcome"));

    const chose = await session.addon.evaluate("pages/onboarding.html", clickButton, "Frieren");
    const status = await session.addon.evaluate("pages/onboarding.html", textOf, "[data-rs=status]", "Applied");
    const chosen = await until(async () => {
      const now = await settings();
      return now.onboardingCompleted && now;
    }, 5000) || (await settings());
    await session.addon.screenshot("pages/onboarding.html", join(root, shot("2-welcome-frieren")));
    record("first run", "Frieren chosen in the welcome tab", chose && status === "Applied to GitHub." && chosen.selectedThemeId === FRIEREN && chosen.onboardingCompleted, { status, selected: chosen.selectedThemeId }, shot("2-welcome-frieren"));

    // GitHub, logged out: themed, and the add-on's fonts load under GitHub's CSP.
    const github = await session.context.newPage();
    await github.addInitScript(() => {
      window.__reskinViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => window.__reskinViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    await github.goto(GITHUB, { waitUntil: "load", timeout: 60000 });
    await github.waitForTimeout(2500);
    let state = await github.evaluate(pageState);
    await github.screenshot({ path: join(root, shot("3-github-frieren")) });
    record("GitHub", "themed in Frieren", state.boot === "ready" && state.styled && state.canvas === canvasOf[FRIEREN], state, shot("3-github-frieren"));
    const fonts = await github.evaluate(async () => {
      const faces = [...document.fonts];
      await Promise.all(faces.map((face) => face.load().catch(() => null)));
      return { faces: faces.map((face) => `${face.family} ${face.weight} ${face.status}`), violations: window.__reskinViolations };
    });
    const extensionFaces = fonts.faces.filter((face) => !/Mona Sans|Noto Sans Backtick/.test(face));
    record("GitHub", "the theme's fonts load and GitHub's CSP blocks nothing of the add-on's", extensionFaces.length > 0 && extensionFaces.every((face) => face.endsWith(" loaded")) && !fonts.violations.some((v) => /moz-extension/.test(v)), { ...fonts, body: state.body });
    const bodyFamily = state.body.split(",")[0].trim().replace(/^"|"$/g, "");
    record("GitHub", "body text uses one of the add-on's fonts", extensionFaces.some((face) => face.startsWith(`${bodyFamily} `) && face.endsWith(" loaded")), state.body);

    // Import a theme file in Make a theme and save it, then export it from Backup & help.
    await session.addon.evaluate("pages/onboarding.html", (url) => (location.href = url), "settings.html#make");
    const imported = await session.addon.evaluate(
      "pages/settings.html",
      async (theme) => {
        const trace = [];
        const until = async (check) => {
          for (let i = 0; i < 75 && !check(); i++) await new Promise((done) => setTimeout(done, 200));
          return check();
        };
        // An enabled, visible button with exactly these words, clicked once it exists.
        const press = async (text, scope = () => document) => {
          const find = () => [...(scope()?.querySelectorAll("button") ?? [])].find((element) => element.textContent.trim() === text && !element.disabled && element.offsetParent !== null);
          const button = await until(find);
          trace.push(`${text}: ${button ? "clicked" : "not found"}`);
          button?.click();
          return Boolean(button);
        };
        await until(() => document.querySelector('[data-rb="builder"]')?.hasAttribute("data-rb-ready"));
        const fresh = [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === "Start with your saved theme" && element.offsetParent !== null);
        fresh?.click();
        const dialog = () => document.querySelector('[data-rb="import"][open]');
        if (!(await press("Import"))) return { trace };
        if (!(await press("Choose file", dialog))) return { trace };
        const input = await until(() => dialog()?.querySelector('[data-rb="file"]'));
        const files = new DataTransfer();
        files.items.add(new File([JSON.stringify(theme, null, 2)], "firefox-check.reskin.json", { type: "application/json" }));
        input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        trace.push(`file: ${input.files.length}`);
        if (!(await press("Preview theme", dialog))) return { trace };
        if (!(await press("Use theme", dialog))) return { trace, dialog: dialog()?.innerText.slice(0, 300) };
        const name = document.querySelector('[data-rb="name"], input[aria-label="Theme name"]')?.value;
        if (!(await press("Save a copy").then((ok) => ok || press("Save as theme")))) return { trace, name };
        await until(() => /^Saved /.test(document.querySelector('[data-rb="status"]')?.textContent ?? ""));
        return { trace, name, status: document.querySelector('[data-rb="status"]')?.textContent.trim() };
      },
      IMPORTED,
    );
    const afterImport = await settings();
    await session.addon.screenshot("pages/settings.html", join(root, shot("4-imported")));
    const kept = afterImport.customThemes.find((entry) => entry.document.name === IMPORTED.name);
    record("import", "a .reskin.json file imports and saves", imported.status === `Saved ${IMPORTED.name} and applied it to GitHub.` && Boolean(kept), { ...imported, saved: afterImport.customThemes.map((entry) => entry.document.name) }, shot("4-imported"));

    await session.addon.evaluate("pages/settings.html", (hash) => (location.hash = hash), "backup");
    const exported = await session.addon.evaluate("pages/settings.html", clickButton, `Export ${IMPORTED.name}`, '[data-rk="backup"]');
    // Firefox writes a download to a .part file and renames it when done.
    const parsed = async (name) => JSON.parse(await readFile(join(downloads, name), "utf8"));
    const file = await until(async () => {
      for (const name of await readdir(downloads)) if (!name.endsWith(".part") && (await parsed(name).then(() => true, () => false))) return name;
    }, 15000);
    const theme = file ? await parsed(file) : null;
    record("export", "Backup & help exports it as a file with the same colors", exported && theme?.name === IMPORTED.name && Object.entries(IMPORTED.colors).every(([key, value]) => theme.colors?.[key] === value), { clicked: exported, file, colors: theme?.colors });

    // Restart: the same profile and a reinstall keep settings, and no second welcome tab opens.
    const before = await settings();
    await session.close();
    session = await launch(options);
    await wait(3000);
    const after = await settings();
    const again = session.context.pages().filter((page) => page.url().includes("/pages/onboarding.html")).length;
    record("restart", "settings kept and no second welcome tab", again === 0 && JSON.stringify(after) === JSON.stringify(before), { welcomeTabs: again, selected: after?.selectedThemeId, saved: after?.customThemes.map((entry) => entry.document.name) });
    const tab = await session.context.newPage();
    await tab.goto(GITHUB, { waitUntil: "load", timeout: 60000 });
    await tab.waitForTimeout(2500);
    state = await tab.evaluate(pageState);
    await tab.screenshot({ path: join(root, shot("5-github-after-restart")) });
    const expected = after.selectedThemeId === FRIEREN ? canvasOf[FRIEREN] : IMPORTED.colors.background;
    record("restart", "GitHub keeps the selected theme", state.boot === "ready" && state.canvas === expected, state, shot("5-github-after-restart"));

    // Off in the popup: GitHub goes back to its own look, and on again.
    await session.addon.evaluate("_generated_background_page", () => browser.tabs.create({ url: browser.runtime.getURL("pages/popup.html") }).then(() => true));
    const off = await session.addon.evaluate("pages/popup.html", async () => {
      const box = await (async () => {
        for (let i = 0; i < 75; i++) {
          const found = document.querySelector('[data-rs="enabled"]');
          if (found) return found;
          await new Promise((done) => setTimeout(done, 200));
        }
      })();
      if (box.checked) box.click();
      return !box.checked;
    });
    await tab.waitForTimeout(1500);
    state = await tab.evaluate(pageState);
    await tab.screenshot({ path: join(root, shot("6-github-off")) });
    record("off", "turning it off leaves GitHub native", off && !state.styled && state.owned === 0 && state.canvas !== expected, state, shot("6-github-off"));
    await session.addon.evaluate("pages/popup.html", () => {
      const box = document.querySelector('[data-rs="enabled"]');
      if (!box.checked) box.click();
      return box.checked;
    });
    await tab.waitForTimeout(1500);
    state = await tab.evaluate(pageState);
    record("off", "turning it on again restyles the open tab", state.styled && state.canvas === expected, state);
  } catch (error) {
    record("run", "completed", false, error.message.split("\n")[0]);
  } finally {
    await session?.close().catch(() => {});
    if (unpacked) await rm(unpacked.dir, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  }
  report.finishedAt = new Date().toISOString();
  const failures = report.checks.filter((check) => !check.pass);
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`qa:firefox: ${report.checks.length} checks, ${failures.length} failed. Report: ${OUT}/report.json`);
  return { exitCode: failures.length ? 1 : 0, testCount: report.checks.length };
}
