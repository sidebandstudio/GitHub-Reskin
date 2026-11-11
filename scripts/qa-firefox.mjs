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
import { FONT_BY_ID } from "../packages/appearance/registry.js";
import { catalogCards, readCatalogEntries } from "../packages/ui/bundle.mjs";
import { deadline, provenance, unpack } from "./qa-live.mjs";

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
  const run = [
    "npx web-ext run --source-dir <add-on folder>",
    `--firefox "${firefoxPath ?? "<path to firefox>"}"`,
    "--firefox-profile <profile folder> --profile-create-if-missing --keep-profile-changes",
    "--pref extensions.webextensions.keepStorageOnUninstall=true --pref extensions.webextensions.keepUuidOnUninstall=true",
    `--start-url ${GITHUB}`,
  ].join(" ");
  return [
    "To repeat this by hand in a visible Firefox:",
    `  1. Unzip ${zip} into an empty <add-on folder>, and make an empty <profile folder>.`,
    `  2. ${run}`,
    "     web-ext installs the add-on folder as a temporary add-on in that profile, and keeps the profile and the add-on's storage.",
    "  3. One welcome tab opens. Pick Frieren there; the GitHub tab turns cream, in the theme's own fonts.",
    "  4. In the add-on's settings, Make a theme > Import > Choose file, pick a .reskin.json, Preview theme, Use theme and Save as theme. Export it from Backup & help.",
    "  5. Press Ctrl+C in the terminal to quit, then run step 2's command again: no welcome tab, and GitHub keeps the saved theme.",
    "  6. Turn GitHub Reskin off in its popup: GitHub goes back to its own look. Turn it on again.",
    "  After steps 3, 4, 5 and 6, take a screenshot with Firefox's screenshot tool (Ctrl+Shift+S, Save visible) into artifacts/reports/firefox/manual/.",
  ].join("\n");
}

/**
 * A Firefox remote debugging client: request(packet) resolves with the reply from packet.to, or
 * rejects after `ms`, and on(listener) sees every packet, including events. When the connection
 * closes, pending requests reject and listeners see {type: "connection-closed"}. A run stops on a
 * timeout, since a late reply would answer the next request to that actor.
 */
export function remoteClient(port, { host = "127.0.0.1", ms = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host });
    const waiting = new Map();
    const listeners = new Set();
    let buffer = Buffer.alloc(0);
    let greeted = false;
    const greeting = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Firefox's debugging server did not greet within ${ms / 1000} s`));
    }, ms);
    const client = {
      request(packet) {
        return new Promise((done, fail) => {
          const entry = { done, fail };
          entry.timer = setTimeout(() => {
            const queue = waiting.get(packet.to) ?? [];
            queue.splice(queue.indexOf(entry), 1);
            fail(new Error(`Firefox did not answer ${packet.type} within ${ms / 1000} s`));
          }, ms);
          waiting.set(packet.to, [...(waiting.get(packet.to) ?? []), entry]);
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
          clearTimeout(greeting);
          resolve(client);
          continue;
        }
        for (const listener of listeners) listener(packet);
        // Events carry a type; a reply has none, or carries an error.
        const queue = waiting.get(packet.from);
        if (queue?.length && (!packet.type || packet.error)) {
          const { done, fail, timer } = queue.shift();
          clearTimeout(timer);
          if (packet.error) fail(new Error(`${packet.error}: ${packet.message}`));
          else done(packet);
        }
      }
    });
    socket.on("error", (error) => {
      clearTimeout(greeting);
      reject(error);
    });
    socket.on("close", () => {
      for (const queue of waiting.values())
        for (const { fail, timer } of queue) {
          clearTimeout(timer);
          fail(new Error("Firefox closed the debugging connection"));
        }
      waiting.clear();
      for (const listener of listeners) listener({ type: "connection-closed" });
    });
  });
}

async function connect(port) {
  const end = Date.now() + 30000;
  for (;;) {
    try {
      return await remoteClient(port, { ms: 10000 });
    } catch (error) {
      if (Date.now() > end) throw new Error(`Firefox's debugging server never answered on port ${port}: ${error.message}`);
      await new Promise((done) => setTimeout(done, 200));
    }
  }
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
 * Firefox with the add-on installed as a temporary add-on, after `beforeInstall(context)` has used
 * the same browser without it: {context, addon, close}. `addon` reaches
 * the add-on's frames: evaluate(match, fn, ...args) runs fn in the newest frame whose URL contains
 * `match` and resolves with its JSON result, screenshot(match, path) photographs that tab, and
 * problems collects the errors and CSP reports from the add-on's own pages and background.
 */
async function launch({ executablePath, profile, dir, uuid, id, downloads }, beforeInstall = async () => {}) {
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
    await beforeInstall(context);
    const root = await client.request({ to: "root", type: "getRoot" });
    await client.request({ to: root.addonsActor, type: "installTemporaryAddon", addonPath: dir });
    const addon = await until(async () => (await client.request({ to: "root", type: "listAddons" })).addons.find((entry) => entry.id === id));
    const watcher = await client.request({ to: addon.actor, type: "getWatcher" });
    const frames = [];
    const problems = [];
    client.on((packet) => {
      if (packet.type === "target-available-form") frames.push(packet.target);
      const gone = packet.type === "target-destroyed-form" ? frames.findIndex((form) => form.actor === packet.target.actor) : -1;
      if (gone >= 0) frames.splice(gone, 1);
      if (packet.type === "resources-available-array")
        for (const [kind, resources] of packet.array ?? [])
          for (const { pageError } of kind === "error-message" ? resources : [])
            if (pageError && (!pageError.warning || /CSP/i.test(pageError.category ?? ""))) problems.push(`${pageError.category ?? ""} ${pageError.errorMessage} (${pageError.sourceName ?? ""})`.trim());
    });
    await client.request({ to: watcher.actor, type: "watchTargets", targetType: "frame" });
    await client.request({ to: watcher.actor, type: "watchResources", resourceTypes: ["error-message"] });
    const frame = (match) => until(async () => frames.findLast((form) => form.url?.includes(match)));
    const evaluate = async (match, fn, ...args) => {
      const form = await frame(match);
      if (!form) throw new Error(`no add-on frame at ${match}`);
      let off = () => {};
      // The value arrives as its own event, which a closed connection or page never sends.
      const result = new Promise((resolve, reject) => {
        off = client.on((packet) => {
          if (packet.type === "evaluationResult" && packet.from === form.consoleActor) resolve(packet);
          else if (packet.type === "connection-closed") reject(new Error("Firefox closed the debugging connection"));
          else if (packet.type === "target-destroyed-form" && packet.target?.actor === form.actor) reject(new Error(`${match} closed during an evaluation`));
        });
      });
      // Handled now, so a disconnect while the request is pending leaves no unhandled rejection.
      result.catch(() => {});
      try {
        await client.request({ to: form.consoleActor, type: "evaluateJSAsync", text: `(async () => JSON.stringify(await (${fn})(...${JSON.stringify(args)})))()`, mapped: { await: true } });
        const packet = await deadline(result, 30000, `Evaluating in ${match}`);
        if (packet.exceptionMessage) throw new Error(`${match}: ${packet.exceptionMessage}`);
        return typeof packet.result === "string" ? JSON.parse(packet.result) : undefined;
      } finally {
        off();
      }
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
    return { context, addon: { evaluate, screenshot, frame, problems }, close };
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

// In a GitHub tab, before it loads: keeps every CSP report with what it blocked and where from.
function recordViolations() {
  window.__reskinViolations = [];
  document.addEventListener("securitypolicyviolation", (event) =>
    window.__reskinViolations.push(`${event.disposition} ${event.effectiveDirective} blocked=${event.blockedURI} source=${event.sourceFile}`),
  );
}

// In a GitHub tab: what the add-on did there, and the computed colors and fonts a theme changes.
function pageLook() {
  const root = document.documentElement;
  const css = (element, name) => (element ? getComputedStyle(element).getPropertyValue(name).trim() : null);
  const header = document.querySelector("header");
  const link = document.querySelector("main a[href]");
  return {
    boot: root.getAttribute("data-reskin-boot"),
    styled: Boolean(document.getElementById("reskin-style")?.textContent),
    owned: document.querySelectorAll("[data-reskin-owned]").length,
    canvas: css(root, "--bgColor-default"),
    look: {
      "color mode": ["data-color-mode", "data-light-theme", "data-dark-theme"].map((name) => root.getAttribute(name)).join(" "),
      "--bgColor-default": css(root, "--bgColor-default"),
      "--fgColor-default": css(root, "--fgColor-default"),
      "--fgColor-accent": css(root, "--fgColor-accent"),
      "body color": css(document.body, "color"),
      "body background": css(document.body, "background-color"),
      "body font": css(document.body, "font-family"),
      "header background": css(header, "background-color"),
      "link color": css(link, "color"),
    },
    violations: window.__reskinViolations ?? [],
  };
}

// In a GitHub tab: every font face once loaded, and how many text-bearing elements use each family first.
async function pageFonts(families) {
  const faces = [...document.fonts];
  await Promise.all(faces.map((face) => face.load().catch(() => null)));
  const first = (element) => getComputedStyle(element).fontFamily.split(",")[0].trim().replace(/^"|"$/g, "");
  const users = Object.fromEntries(families.map((family) => [family, 0]));
  for (const element of document.body.querySelectorAll("*")) {
    const family = first(element);
    if (family in users && [...element.childNodes].some((node) => node.nodeType === 3 && node.data.trim())) users[family]++;
  }
  return { faces: faces.map((face) => ({ family: face.family.replace(/^"|"$/g, ""), weight: String(face.weight), status: face.status })), body: first(document.body), users };
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
  const report = {
    startedAt: new Date().toISOString(),
    firefox: { path: executablePath },
    candidate: null,
    harness: { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() },
    checks: [],
    notes: ["The import gives the file input its file from script, so Firefox's own file picker is not exercised. Step 4 of the printed procedure covers it by hand."],
  };
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
  const problems = [];
  try {
    unpacked = await unpack(root, config.version, "firefox");
    report.candidate = await provenance(root, { firefox: unpacked }, config.version);
    const id = JSON.parse(await readFile(join(unpacked.dir, "manifest.json"), "utf8")).browser_specific_settings.gecko.id;
    const options = { executablePath, profile, dir: unpacked.dir, uuid: randomUUID(), id, downloads };
    const entries = await readCatalogEntries(root);
    const canvasOf = Object.fromEntries(catalogCards(entries).map((card) => [card.id, card.mini.canvas]));
    const settings = () => session.addon.evaluate("_generated_background_page", async () => (await browser.storage.local.get("reskin.settings"))["reskin.settings"]);

    // GitHub in the same browser and profile before the add-on is there: what native looks like and reports.
    const native = async (context) => {
      const page = await context.newPage();
      try {
        await page.addInitScript(recordViolations);
        await page.goto(GITHUB, { waitUntil: "load", timeout: 60000 });
        await page.waitForTimeout(2500);
        return await page.evaluate(pageLook);
      } finally {
        await page.close();
      }
    };

    session = await launch(options, async (context) => {
      report.baseline = await native(context);
    });
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

    // GitHub, logged out: themed, in Frieren's own fonts, and GitHub's CSP reports nothing new.
    const github = await session.context.newPage();
    await github.addInitScript(recordViolations);
    await github.goto(GITHUB, { waitUntil: "load", timeout: 60000 });
    await github.waitForTimeout(2500);
    let state = await github.evaluate(pageLook);
    await github.screenshot({ path: join(root, shot("3-github-frieren")) });
    record("GitHub", "themed in Frieren", state.boot === "ready" && state.styled && state.canvas === canvasOf[FRIEREN], { boot: state.boot, styled: state.styled, canvas: state.canvas }, shot("3-github-frieren"));
    const frieren = entries.find((entry) => entry.id === FRIEREN).document.fonts;
    const expected = { body: FONT_BY_ID[frieren.body], heading: FONT_BY_ID[frieren.heading] };
    const fonts = await github.evaluate(pageFonts, [expected.body.cssFamily, expected.heading.cssFamily]);
    const missing = Object.values(expected).flatMap((font) =>
      font.weights.map(String).filter((weight) => !fonts.faces.some((face) => face.family === font.cssFamily && face.weight === weight && face.status === "loaded")).map((weight) => `${font.cssFamily} ${weight}`),
    );
    record("GitHub", "Frieren's body and heading faces are all declared and load", missing.length === 0, { missing, faces: fonts.faces.map((face) => `${face.family} ${face.weight} ${face.status}`) });
    record("GitHub", "body text is in Frieren's body font, and headings use its heading font", fonts.body === expected.body.cssFamily && fonts.users[expected.heading.cssFamily] > 0, { body: fonts.body, users: fonts.users });
    const added = state.violations.filter((violation) => !report.baseline.violations.includes(violation));
    record("GitHub", "GitHub's CSP reports nothing the native page does not", added.length === 0 && !state.violations.some((violation) => /moz-extension/.test(violation)), { added, native: report.baseline.violations.length });

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
        // The control someone would use: enabled, and it or its label visible within the window.
        const label = input && document.querySelector(`label[for="${input.id}"]`);
        const onScreen = (element) => {
          if (!element) return false;
          element.scrollIntoView({ block: "center" });
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return style.visibility === "visible" && style.display !== "none" && box.width > 1 && box.height > 1 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
        };
        const usable = Boolean(input && !input.disabled && !input.closest("[hidden]") && (onScreen(input) || onScreen(label)));
        trace.push(`file control: ${usable ? "usable" : "not usable"}`);
        if (!usable) return { trace };
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
    problems.push(...session.addon.problems);
    await session.close();
    session = await launch(options, async (context) => {
      report.baselineAfterRestart = await native(context);
    });
    await wait(3000);
    const after = await settings();
    const again = session.context.pages().filter((page) => page.url().includes("/pages/onboarding.html")).length;
    record("restart", "settings kept and no second welcome tab", again === 0 && JSON.stringify(after) === JSON.stringify(before), { welcomeTabs: again, selected: after?.selectedThemeId, saved: after?.customThemes.map((entry) => entry.document.name) });
    const tab = await session.context.newPage();
    await tab.goto(GITHUB, { waitUntil: "load", timeout: 60000 });
    await tab.waitForTimeout(2500);
    state = await tab.evaluate(pageLook);
    await tab.screenshot({ path: join(root, shot("5-github-after-restart")) });
    const canvas = after.selectedThemeId === FRIEREN ? canvasOf[FRIEREN] : IMPORTED.colors.background;
    record("restart", "GitHub keeps the selected theme", state.boot === "ready" && state.canvas === canvas, { boot: state.boot, canvas: state.canvas, expected: canvas }, shot("5-github-after-restart"));

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
    state = await tab.evaluate(pageLook);
    await tab.screenshot({ path: join(root, shot("6-github-off")) });
    const nativeLook = report.baselineAfterRestart.look;
    const differs = Object.keys(nativeLook).filter((key) => state.look[key] !== nativeLook[key]);
    record("off", "turning it off leaves GitHub as it looked in this browser before the add-on", off && state.boot === "native" && !state.styled && state.owned === 0 && differs.length === 0, { boot: state.boot, styled: state.styled, owned: state.owned, differs: differs.map((key) => `${key}: ${state.look[key]}, natively ${nativeLook[key]}`) }, shot("6-github-off"));
    await session.addon.evaluate("pages/popup.html", () => {
      const box = document.querySelector('[data-rs="enabled"]');
      if (!box.checked) box.click();
      return box.checked;
    });
    await tab.waitForTimeout(1500);
    state = await tab.evaluate(pageLook);
    record("off", "turning it on again restyles the open tab", state.boot === "ready" && state.styled && state.canvas === canvas, { boot: state.boot, canvas: state.canvas });
    problems.push(...session.addon.problems);
    record("add-on pages", "no errors or CSP reports in the add-on's own pages and background", problems.length === 0, problems.slice(0, 5));
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
