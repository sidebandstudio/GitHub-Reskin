// npm run qa:userscript [-- --firefox <firefox executable>]: DONE.md's check of the release
// userscript in real managers, not the test stand-in. It installs artifacts/github-reskin-<version>.user.js
// into Violentmonkey and Tampermonkey through each manager's own install page, in Chromium and in an
// actual Firefox release (--firefox, RESKIN_FIREFOX or the usual install path), and on public GitHub,
// logged out and read-only, checks that:
//   the script runs and themes the page with the default theme
//   the panel opens from an address ending in #reskin, with its controls, which it has only where
//     the manager keeps the script apart from GitHub's own JavaScript, and a theme picked there applies
//   typing in the panel stays out of GitHub's shortcuts, and Escape closes it and returns focus
//   the pick survives a reload
//   a theme file imports and saves in Make a theme, and applies
//   disabling the script in the manager's dashboard leaves GitHub native
// Violentmonkey is pinned to its 2.50.0 release builds and Tampermonkey for Firefox to 5.5.0 from
// AMO, each checked against its SHA-256. Tampermonkey for Chrome comes from the Chrome Web Store,
// which serves only its current version, so its version and hash are recorded instead. Downloads
// are kept in artifacts/qa-cache/managers/. Safari's Userscripts manager is a check for a person.
// Writes artifacts/reports/userscript/report.json and screenshots, and any failure exits 1.
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { unzipSync } from "fflate";
import { catalogCards, readCatalogEntries } from "../packages/ui/bundle.mjs";
import { sha256, treeHash } from "./build.mjs";
import { artifactName } from "./package.mjs";
import { findFirefox, IMPORTED, launch as launchFirefox } from "./qa-firefox.mjs";
import { deadline, provenance } from "./qa-live.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OUT = "artifacts/reports/userscript";
const CACHE = "artifacts/qa-cache/managers";
const GITHUB = "https://github.com/sidebandstudio/GitHub-Reskin";
const CHOOM = "anime.cyberpunk-edgerunners";
const FRIEREN = "anime.frieren";
const VIOLENTMONKEY = "https://github.com/violentmonkey/violentmonkey/releases/download/v2.50.0";

// In a manager's page: clicks the first enabled button whose words start with Install. Firefox's
// managers take this click; in Chrome, Tampermonkey's install page wants a trusted one.
function clickInstall() {
  return new Promise((resolve) => {
    const end = Date.now() + 15000;
    const look = () => {
      const button = [...document.querySelectorAll("button, input[type=button], input[type=submit]")].find((element) => /^Install\b/.test((element.textContent || element.value || "").trim()) && !element.disabled);
      if (button) {
        button.click();
        resolve(true);
      } else if (Date.now() > end) resolve(false);
      else setTimeout(look, 200);
    };
    look();
  });
}

// In Violentmonkey's dashboard: the GitHub Reskin row's enable switch.
function violentmonkeyDisable() {
  return new Promise((resolve) => {
    const end = Date.now() + 15000;
    const look = () => {
      const row = [...document.querySelectorAll(".script")].find((element) => /GitHub Reskin/.test(element.textContent));
      const toggle = row?.querySelector("a[data-hotkey=space]");
      if (toggle) {
        toggle.click();
        setTimeout(() => resolve(true), 800);
      } else if (Date.now() > end) resolve(false);
      else setTimeout(look, 200);
    };
    look();
  });
}

// In Tampermonkey's dashboard: the GitHub Reskin row's enabler.
function tampermonkeyDisable() {
  return new Promise((resolve) => {
    const end = Date.now() + 15000;
    const look = () => {
      const toggle = [...document.querySelectorAll(".enabler")].find((element) => /GitHub Reskin/.test(element.closest("tr")?.textContent ?? ""));
      if (toggle) {
        toggle.click();
        setTimeout(() => resolve(true), 800);
      } else if (Date.now() > end) resolve(false);
      else setTimeout(look, 200);
    };
    look();
  });
}

/** Each manager and engine: where it comes from, its install page, and its dashboard switch. */
export const MANAGERS = Object.freeze([
  { name: "Violentmonkey", engine: "chromium", file: "Violentmonkey-mv3-v2.50.0.zip", url: `${VIOLENTMONKEY}/Violentmonkey-mv3-v2.50.0.zip`, sha256: "72f1de5a2edc4bc3cd3b3ca06c2b3631cdde4f06f8ed9e8b2b565bf77258b36c", install: "/confirm/", dashboard: "options/index.html#scripts", disable: violentmonkeyDisable },
  {
    name: "Tampermonkey",
    engine: "chromium",
    file: "tampermonkey-chrome.crx",
    url: "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=156.0&acceptformat=crx3&x=id%3Ddhdgffkkebhmkfjojejmpbldmpobfkfo%26uc",
    sha256: null,
    install: "/ask.html",
    dashboard: "options.html#nav=dashboard",
    disable: tampermonkeyDisable,
  },
  { name: "Violentmonkey", engine: "firefox", file: "Violentmonkey-webext-v2.50.0.zip", url: `${VIOLENTMONKEY}/Violentmonkey-webext-v2.50.0.zip`, sha256: "ef9c61a6ef9c975d4823c26b493d2017464f240bba39c476da1cd7795382d8b1", install: "/confirm/", dashboard: "options/index.html#scripts", background: "_generated_background_page", disable: violentmonkeyDisable },
  {
    name: "Tampermonkey",
    engine: "firefox",
    file: "tampermonkey-5.5.0.xpi",
    url: "https://addons.mozilla.org/firefox/downloads/file/4797143/tampermonkey-5.5.0.xpi",
    sha256: "190031c78dbc5696114835601f2c8e6b855ad1e134df5df278f8fc158c065908",
    install: "/ask.html",
    dashboard: "options.html#nav=dashboard",
    background: "background.html",
    disable: tampermonkeyDisable,
  },
]);

/** A Chrome Web Store CRX3's ZIP: the bytes after its "Cr24" header. */
export function crxZip(bytes) {
  if (bytes.subarray(0, 4).toString() !== "Cr24") return bytes;
  return bytes.subarray(12 + bytes.readUInt32LE(8));
}

/** The manager's package from the cache or its source, checked, unpacked: {dir, sha256, version, id}. */
async function fetchManager(root, manager) {
  const file = join(root, CACHE, manager.file);
  let bytes = await readFile(file).catch(() => null);
  if (!bytes || (manager.sha256 && sha256(bytes) !== manager.sha256)) {
    const response = await fetch(manager.url, { redirect: "follow", signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`${manager.name} for ${manager.engine}: ${manager.url} answered ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (manager.sha256 && sha256(bytes) !== manager.sha256) throw new Error(`${manager.file} does not have its pinned SHA-256`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  const dir = await mkdtemp(join(tmpdir(), "reskin-qa-manager-"));
  for (const [path, data] of Object.entries(unzipSync(crxZip(bytes)))) {
    if (path.endsWith("/")) continue;
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), data);
  }
  const manifest = JSON.parse((await readFile(join(dir, "manifest.json"), "utf8")).replace(/^\uFEFF/, ""));
  return { dir, sha256: sha256(bytes), version: manifest.version, id: manifest.browser_specific_settings?.gecko?.id ?? manifest.applications?.gecko?.id ?? null };
}

const until = async (check, ms = 15000) => {
  const end = Date.now() + ms;
  let value;
  while (!(value = await check()) && Date.now() < end) await new Promise((done) => setTimeout(done, 250));
  return value;
};

/** Chromium with the manager loaded and allowed to run user scripts: {context, install(url), disable(), close}. */
async function chromiumManager(manager, unpacked, record) {
  const profile = await mkdtemp(join(tmpdir(), "reskin-qa-userscript-chromium-"));
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, locale: "en-US", timezoneId: "UTC", viewport: { width: 1280, height: 800 }, args: [`--disable-extensions-except=${unpacked.dir}`, `--load-extension=${unpacked.dir}`] });
  const close = () => context.close().finally(() => rm(profile, { recursive: true, force: true }));
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker", { timeout: 60000 });
    const id = new URL(worker.url()).host;
    // An MV3 manager runs user scripts only once its Allow User Scripts switch is on.
    const settings = await context.newPage();
    await settings.goto(`chrome://extensions/?id=${id}`);
    const allow = settings.locator("#allow-user-scripts");
    await allow.click();
    const allowed = await until(async () => (await allow.getAttribute("checked")) !== null, 5000);
    await settings.close();
    record("user scripts allowed in the manager's Chrome settings", allowed);
    const base = `chrome-extension://${id}/`;
    return {
      context,
      async install(url) {
        // A manager still starting up lets the address load as text, so it is opened again.
        const opener = await context.newPage();
        let page = null;
        for (let attempt = 0; attempt < 4 && !page; attempt++) {
          await opener.goto(url).catch(() => {});
          page = await until(() => context.pages().find((p) => p.url().startsWith(`${base}${manager.install.slice(1)}`)), 8000);
        }
        if (!page) return false;
        const button = page.getByRole("button", { name: /^Install\b/ }).first();
        if (!(await button.isEnabled({ timeout: 15000 }).catch(() => false))) return false;
        await button.click();
        return true;
      },
      async disable() {
        const page = await context.newPage();
        await page.goto(`${base}${manager.dashboard}`);
        return page.evaluate(manager.disable);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Firefox with the manager as a temporary add-on: {context, install(url), disable(), close}. */
async function firefoxManager(manager, unpacked, executablePath) {
  const scratch = await mkdtemp(join(tmpdir(), "reskin-qa-userscript-firefox-"));
  await mkdir(join(scratch, "downloads"));
  const session = await launchFirefox({ executablePath, profile: join(scratch, "profile"), dir: unpacked.dir, uuid: randomUUID(), id: unpacked.id, downloads: join(scratch, "downloads") });
  return {
    context: session.context,
    async install(url) {
      const opener = await session.context.newPage();
      await opener.goto(url).catch(() => {});
      return session.addon.evaluate(manager.install.slice(1), clickInstall);
    },
    async disable() {
      await session.addon.evaluate(manager.background, (path) => browser.tabs.create({ url: browser.runtime.getURL(path) }).then(() => true), manager.dashboard);
      return session.addon.evaluate(manager.dashboard.split("#")[0], manager.disable);
    },
    close: () => session.close().finally(() => rm(scratch, { recursive: true, force: true })),
  };
}

// In the GitHub tab: what the userscript did there.
function pageState() {
  const root = document.documentElement;
  return {
    runs: root.hasAttribute("data-reskin-userscript"),
    boot: root.getAttribute("data-reskin-boot"),
    styled: Boolean(document.getElementById("reskin-style")?.textContent),
    canvas: getComputedStyle(root).getPropertyValue("--bgColor-default").trim(),
    active: document.activeElement?.localName ?? null,
    dialog: Boolean(document.querySelector("dialog[open]")),
  };
}

/** The panel's frame once it shows the selected theme, or null. */
const panelFrame = (page, ms = 15000) =>
  until(async () => {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame() || frame.url() !== "about:srcdoc") continue;
      const named = await frame.locator("[data-rs=summary-show]").textContent({ timeout: 500 }).catch(() => "");
      if (named) return frame;
    }
    return null;
  }, ms);

/** Opens GitHub at `url` as a new load, the way a person types it, in the front tab: Firefox shows
 * only that one, and the panel opens only on a page someone can see. */
async function load(page, url) {
  await page.bringToFront();
  await page.goto("about:blank");
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
}

/** Runs DONE.md's real-manager check and writes its report. Resolves to {exitCode, testCount}. */
export async function qaUserscript({ args = [], root = DEFAULT_ROOT } = {}) {
  const config = JSON.parse(await readFile(join(root, "release.config.json"), "utf8"));
  const out = join(root, OUT);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    candidate: null,
    harness: { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() },
    managers: [],
    checks: [],
    notes: ["Safari's Userscripts manager is checked by a person.", "The panel's file input gets its file through Playwright, so the browser's own file picker is not exercised."],
  };
  const record = (where, check, pass, detail, screenshot) => {
    report.checks.push({ manager: where, check, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }), ...(screenshot ? { screenshot } : {}) });
    console.log(`${pass ? "ok  " : "FAIL"} ${where}: ${check}${detail === undefined ? "" : ` (${JSON.stringify(detail)})`}`);
  };
  const shot = (name) => join(OUT, `${name}.png`).replaceAll("\\", "/");
  let server = null;
  try {
    const file = join(root, "artifacts", artifactName(config.version, "userscript"));
    const script = await readFile(file).catch(() => {
      throw new Error(`artifacts/${artifactName(config.version, "userscript")} is missing. Run npm run package first.`);
    });
    const hash = sha256(script);
    report.candidate = await provenance(root, { userscript: { file: `artifacts/${artifactName(config.version, "userscript")}`, sha256: hash, tree: treeHash({ "github-reskin.user.js": hash }) } }, config.version);
    const canvasOf = Object.fromEntries(catalogCards(await readCatalogEntries(root)).map((card) => [card.id, card.mini.canvas]));
    // Managers install a script from a page whose address ends in .user.js.
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(script);
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const scriptUrl = `http://127.0.0.1:${server.address().port}/github-reskin.user.js`;
    const firefoxPath = findFirefox(args);

    for (const manager of MANAGERS) {
      const where = `${manager.name} in ${manager.engine === "chromium" ? "Chromium" : "Firefox"}`;
      const slug = `${manager.name.toLowerCase()}-${manager.engine}`;
      if (manager.engine === "firefox" && !firefoxPath) {
        record(where, "an actual Firefox release to run it in", false, "Pass --firefox <path> or set RESKIN_FIREFOX.");
        continue;
      }
      let env = null;
      let unpacked = null;
      try {
        unpacked = await fetchManager(root, manager);
        report.managers.push({ name: manager.name, engine: manager.engine, version: unpacked.version, sha256: unpacked.sha256, pinned: Boolean(manager.sha256), source: manager.url });
        env = await deadline(manager.engine === "chromium" ? chromiumManager(manager, unpacked, (check, pass, detail) => record(where, check, pass, detail)) : firefoxManager(manager, unpacked, firefoxPath), 120000, `Starting ${where}`);
        record(where, "installs through the manager's own install page", await env.install(scriptUrl));

        const page = await env.context.newPage();
        // The manager registers a new script within moments; the first loads may run without it.
        let state = await until(async () => {
          await load(page, GITHUB);
          const now = await page.evaluate(pageState);
          return now.runs && now.boot === "ready" && now;
        }, 45000) || (await page.evaluate(pageState));
        await page.screenshot({ path: join(root, shot(`${slug}-1-themed`)) });
        record(where, "runs on GitHub and themes it in Choom Circuit", state.runs && state.boot === "ready" && state.styled && state.canvas === canvasOf[CHOOM], state, shot(`${slug}-1-themed`));

        await load(page, `${GITHUB}#reskin`);
        let panel = await panelFrame(page);
        await page.screenshot({ path: join(root, shot(`${slug}-2-panel`)) });
        record(where, "the panel opens from an address ending in #reskin", Boolean(panel), undefined, shot(`${slug}-2-panel`));
        // The panel has its controls only where the manager keeps the script apart from GitHub's
        // own JavaScript; otherwise it shows a session preview that saves nothing, by design.
        const controls = panel ? await panel.locator("[data-theme]").count() : 0;
        if (panel) {
          const note = controls ? null : (await panel.locator("[data-us=storage-note]").textContent().catch(() => "")).trim();
          record(where, "the manager keeps the script apart from GitHub's page, so the panel has its controls", controls > 0, controls ? `${controls} themes` : note);
        }
        if (panel && !controls) {
          await page.keyboard.press("Escape");
          const closed = await until(async () => !(await panelFrame(page, 300)), 3000);
          state = await page.evaluate(pageState);
          record(where, "Escape closes the panel and returns focus to the page", Boolean(closed) && state.active === "body", { closed: Boolean(closed), active: state.active });
        }
        if (controls) {
          await panel.locator(`[data-theme="${FRIEREN}"]`).click();
          state = await until(async () => {
            const now = await page.evaluate(pageState);
            return now.canvas === canvasOf[FRIEREN] && now;
          }, 5000) || (await page.evaluate(pageState));
          record(where, "a theme picked in the panel applies", state.canvas === canvasOf[FRIEREN], { canvas: state.canvas });
          const search = panel.getByPlaceholder(/Search themes/);
          await search.click();
          await page.keyboard.type("/fri");
          const typed = await search.inputValue();
          state = await page.evaluate(pageState);
          record(where, "typing in the panel stays out of GitHub's shortcuts", typed === "/fri" && !state.dialog, { typed, githubDialog: state.dialog });
          await page.keyboard.press("Escape");
          const closed = await until(async () => !(await panelFrame(page, 300)), 3000);
          state = await page.evaluate(pageState);
          record(where, "Escape closes the panel and returns focus to the page", Boolean(closed) && state.active === "body", { closed: Boolean(closed), active: state.active });
        }

        if (controls) {
          await page.reload({ waitUntil: "load" });
          await page.waitForTimeout(1500);
          state = await page.evaluate(pageState);
          record(where, "the pick survives a reload", state.boot === "ready" && state.canvas === canvasOf[FRIEREN] && !(await panelFrame(page, 300)), { boot: state.boot, canvas: state.canvas });
        }

        // Make a theme: import a file, save it, and see it applied.
        let saved = null;
        if (controls) {
          await load(page, `${GITHUB}#reskin`);
          panel = await panelFrame(page);
        }
        if (controls && panel) {
          await panel.getByRole("button", { name: "Make a theme" }).click();
          const builder = await until(async () => {
            for (const frame of page.frames()) if (frame.url() === "about:srcdoc" && (await frame.locator('[data-rb="builder"][data-rb-ready]').count().catch(() => 0))) return frame;
            return null;
          });
          if (builder) {
            const fresh = builder.getByRole("button", { name: "Start with your saved theme" });
            if (await fresh.isVisible().catch(() => false)) await fresh.click();
            await builder.getByRole("button", { name: "Import", exact: true }).click();
            const dialog = builder.getByRole("dialog", { name: "Import a theme" });
            await dialog.getByRole("button", { name: "Choose file" }).click();
            await dialog.getByLabel("Theme file (.json or .reskin.json)").setInputFiles({ name: "manager-check.reskin.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(IMPORTED)) });
            await dialog.getByRole("button", { name: "Preview theme" }).click();
            await dialog.getByRole("button", { name: "Use theme" }).click();
            const copy = builder.getByRole("button", { name: "Save a copy" });
            if (await copy.isVisible().catch(() => false)) await copy.click();
            else await builder.getByRole("button", { name: "Save as theme" }).click();
            saved = await until(async () => {
              const status = (await builder.locator('[data-rb="status"]').textContent().catch(() => "")).trim();
              return /^Saved /.test(status) && status;
            }, 10000);
          }
        }
        if (controls) {
          state = await page.evaluate(pageState);
          await page.screenshot({ path: join(root, shot(`${slug}-3-imported`)) });
          record(where, "a theme file imports and saves in Make a theme, and applies", saved === `Saved ${IMPORTED.name} and applied it to GitHub.` && state.canvas === IMPORTED.colors.background, { status: saved, canvas: state.canvas }, shot(`${slug}-3-imported`));
        }

        const disabled = await env.disable();
        state = await until(async () => {
          await load(page, GITHUB);
          const now = await page.evaluate(pageState);
          return !now.runs && now;
        }, 20000) || (await page.evaluate(pageState));
        await page.screenshot({ path: join(root, shot(`${slug}-4-disabled`)) });
        record(where, "disabled in the manager's dashboard, GitHub stays native", disabled && !state.runs && !state.styled && state.boot === null, { switched: disabled, runs: state.runs, styled: state.styled }, shot(`${slug}-4-disabled`));
      } catch (error) {
        record(where, "completed", false, error.message.split("\n")[0]);
      } finally {
        await env?.close().catch(() => {});
        if (unpacked) await rm(unpacked.dir, { recursive: true, force: true });
      }
    }
  } catch (error) {
    record("all", "ran", false, error.message.split("\n")[0]);
  } finally {
    server?.close();
  }
  report.finishedAt = new Date().toISOString();
  const failures = report.checks.filter((check) => !check.pass);
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`qa:userscript: ${report.checks.length} checks, ${failures.length} failed. Report: ${OUT}/report.json`);
  return { exitCode: failures.length ? 1 : 0, testCount: report.checks.length };
}
