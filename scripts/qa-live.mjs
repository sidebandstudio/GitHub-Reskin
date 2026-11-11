// npm run qa:live -- --read-only: DONE.md's live public GitHub check of the release candidate.
// It unpacks the Chrome and Firefox packages from artifacts/, installs each into a fresh logged-out
// profile, and visits the public pages ARCHITECTURE.md names: the Sideband repository, the
// reference profiles in owner order, a file and a merged pull request's diff in that
// repository, the first public Gist of a reference profile, an empty issue search and a missing
// path. It never signs in, stars, follows, comments or edits.
//
// Each page loads twice per engine and viewport, natively and with the extension. GitHub's text
// and every label, title, alt and placeholder, without the extension's own nodes, must match the
// native load. In Chromium the page is checked again in Calm, and extension errors and requests
// fail it. Then Chromium switches through every catalog theme on the first profile, the
// repository and the diff: each must apply, read at 4.5:1 for default and muted text, and the
// anime themes must differ. Firefox gets the add-on as a temporary install and keeps its default
// theme, because Playwright cannot open its pages.
//
// Writes artifacts/reports/live/report.json, the screenshots and contact sheets. A GitHub outage
// or rate limit and a GitHub markup change are counted apart from product failures, and any
// failure exits 1: an outage is not a pass.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "@playwright/test";
import { unzipSync } from "fflate";
import { INTERACTIVE } from "../extension/content/github/selectors.js";
import { readCatalogEntries } from "../packages/ui/bundle.mjs";
import { artifactName } from "./package.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OUT = "artifacts/reports/live";
export const REPO = "sidebandstudio/GitHub-Reskin";
// A small merged pull request with added and deleted lines. Its page must classify as a diff.
export const DEMO_PULL = 28;
// The owner's order, from UX.md.
export const REFERENCE_PROFILES = Object.freeze(["whoisaldo", "Alitleis123", "torvalds"]);
export const VIEWPORTS = Object.freeze([
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]);
// The pages the theme sweep visits, by target name.
const SWEEP = ["profile-1", "repo", "diff"];
const NAVIGATION_LIMIT = 150;
const CONTRAST = 4.5;

/**
 * GitHub's REST API as {status, body}, used only to find a public Gist. A GITHUB_TOKEN or GH_TOKEN
 * in the environment lifts the shared 60-an-hour limit; the browsers stay logged out either way.
 */
async function githubApi(path) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const headers = { accept: "application/vnd.github+json", "user-agent": "github-reskin-qa", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`https://api.github.com/${path}`, { headers, signal: AbortSignal.timeout(20000) });
  const limited = response.headers.get("x-ratelimit-remaining") === "0";
  return { status: response.status, limited, body: response.ok ? await response.json() : null };
}

/**
 * The pages to visit, each {name, url, route, status?}, with the Gist found at test time. A target
 * GitHub's API could not supply has `error` instead of a url.
 */
export async function resolveTargets(api = githubApi) {
  const site = (path) => `https://github.com/${path}`;
  const targets = [
    { name: "repo", url: site(REPO), route: "repository" },
    ...REFERENCE_PROFILES.map((user, index) => ({ name: `profile-${index + 1}`, url: site(user), route: "profile" })),
    { name: "file", url: site(`${REPO}/blob/main/README.md`), route: "repository" },
    { name: "diff", url: site(`${REPO}/pull/${DEMO_PULL}/files`), route: "pull-files" },
  ];
  let gist = null;
  let gistError = null;
  for (const user of REFERENCE_PROFILES) {
    const gists = await api(`users/${user}/gists?per_page=10`).catch((error) => ({ status: null, error }));
    if (!gists.body) gistError = apiError(gists, "");
    gist = gists.body?.find((entry) => entry.public);
    if (gist) break;
  }
  targets.push(gist ? { name: "gist", url: gist.html_url, route: "gist" } : { name: "gist", route: "gist", error: gistError ?? "no reference profile has a public Gist" });
  targets.push({ name: "empty", url: site(`${REPO}/issues?q=${encodeURIComponent("is:issue label:reskin-qa-no-such-label")}`), route: "issues" });
  targets.push({ name: "404", url: site(`${REPO}/reskin-qa-no-such-page`), route: "not-found", status: 404 });
  return targets;
}

const apiError = (answer, fallback) =>
  answer.error?.message ?? (answer.limited ? "GitHub's API rate limit is used up; set GITHUB_TOKEN" : answer.status === null || answer.status === 200 ? fallback : `GitHub's API answered ${answer.status}`);

/** WCAG contrast of two [r, g, b] colors in 0..255. */
export function contrast(a, b) {
  const luminance = (rgb) =>
    rgb.map((v) => v / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/**
 * How two page snapshots differ: {same, missing, added}, where missing are items of the native
 * page the themed one lacks and added the reverse, each at most `limit` long.
 */
export function compareSnapshots(native, themed, limit = 5) {
  const count = (items) => items.reduce((map, item) => map.set(item, (map.get(item) ?? 0) + 1), new Map());
  const less = (a, b) => {
    const left = count(b);
    return a.filter((item) => (left.get(item) ? (left.set(item, left.get(item) - 1), false) : true));
  };
  const same = native.length === themed.length && native.every((item, i) => item === themed[i]);
  return { same, missing: less(native, themed).slice(0, limit), added: less(themed, native).slice(0, limit) };
}

const PARTS = ["text", "names", "controls"];
const sameSnapshot = (a, b) => PARTS.every((part) => compareSnapshots(a[part], b[part]).same);

/**
 * Judges the themed loads of a page against its native loads: {kind: null} when some pair is
 * the same, "product" when every native load agrees, every themed load agrees and they differ,
 * and "github" when GitHub's own loads disagreed. `native` and `themed` are the pair to report.
 */
export function snapshotVerdict(natives, themeds) {
  for (const native of natives) for (const themed of themeds) if (sameSnapshot(native, themed)) return { kind: null, native, themed };
  const steady = (loads) => loads.every((load) => sameSnapshot(load, loads[0]));
  return { kind: steady(natives) && steady(themeds) ? "product" : "github", native: natives.at(-1), themed: themeds.at(-1) };
}

/** Palette keys that make an identity: the canvas, the text and the accent. */
export const IDENTITY = Object.freeze(["--bgColor-default", "--fgColor-default", "--fgColor-accent"]);

/** Pairs of themes whose identity colors are all the same, as [id, id]. */
export function sameIdentities(palettes) {
  const key = (palette) => JSON.stringify(IDENTITY.map((name) => palette[name]));
  const seen = new Map();
  const pairs = [];
  for (const [id, palette] of palettes) {
    if (seen.has(key(palette))) pairs.push([seen.get(key(palette)), id]);
    else seen.set(key(palette), id);
  }
  return pairs;
}

/** The failure kind for a page that did not arrive or did not match the route it should have. */
export function arrivalFailure({ status, error, text = "" }, expected) {
  if (status === 429 || /secondary rate limit|exceeded a rate limit/i.test(text)) return { kind: "github", detail: "rate limited" };
  if (status === null || status === undefined) return { kind: "github", detail: error ?? "no answer" };
  if (status >= 500) return { kind: "github", detail: `HTTP ${status}` };
  if (status !== (expected.status ?? 200)) return { kind: "markup", detail: `HTTP ${status}, expected ${expected.status ?? 200}` };
  return null;
}

// In the page: GitHub's own text and names, without the extension's nodes, scripts, styles or
// times that tick. textContent and attributes do not depend on CSS, so a theme cannot move them.
function pageSnapshot(interactive) {
  const outside = (node) => !node.closest("[data-reskin-owned],script,style,noscript,template,relative-time,time,local-time");
  const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim();
  const text = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.parentElement && outside(node.parentElement) && clean(node.data)) text.push(clean(node.data));
  const names = [];
  for (const element of document.body.querySelectorAll("[aria-label],[aria-description],[title],[alt],[placeholder]"))
    if (outside(element)) for (const name of ["aria-label", "aria-description", "title", "alt", "placeholder"]) if (element.hasAttribute(name)) names.push(`${element.localName} ${name}=${clean(element.getAttribute(name))}`);
  const controls = [...document.body.querySelectorAll(interactive)].filter(outside).map((element) => `${element.localName} ${clean(element.textContent).slice(0, 80)}`);
  return { text, names, controls };
}

// In the page: the theme's colors as sRGB bytes and whether it painted.
function pageState(names) {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const context = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  const rgb = (value) => {
    context.fillStyle = "rgba(1, 2, 3, 0.5)";
    context.fillStyle = value;
    if (!value || context.fillStyle === "rgba(1, 2, 3, 0.5)") return null;
    context.clearRect(0, 0, 1, 1);
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  const sheet = document.getElementById("reskin-style");
  let hash = 0;
  for (const char of sheet?.textContent ?? "") hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return {
    boot: root.getAttribute("data-reskin-boot"),
    styled: Boolean(sheet?.isConnected && sheet.textContent),
    styleHash: hash,
    palette: Object.fromEntries(names.map((name) => [name, rgb(style.getPropertyValue(name).trim())])),
  };
}

const PALETTE = [...IDENTITY, "--fgColor-muted"];

/** Text, names and controls stop changing for a second, or ten seconds pass. */
async function settle(page) {
  let last = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const size = await page.evaluate(() => `${document.body?.textContent.length}:${document.querySelectorAll("*").length}`).catch(() => null);
    if (size !== null && size === last) return;
    last = size;
  }
}

/** Opens a page in a bounded number of tries, as {status, error, text}. */
async function visit(page, url, budget) {
  for (let attempt = 1; ; attempt++) {
    if (budget.rateLimited) return { status: null, error: "skipped after GitHub rate-limited this run" };
    if (budget.navigations >= NAVIGATION_LIMIT) return { status: null, error: `skipped after ${NAVIGATION_LIMIT} page loads` };
    budget.navigations++;
    let response = null;
    let error = null;
    try {
      response = await page.goto(url, { waitUntil: "load", timeout: 60000 });
    } catch (thrown) {
      error = thrown.message.split("\n")[0];
    }
    const status = response?.status() ?? null;
    const text = status === 429 || status === 403 ? await page.evaluate(() => document.body?.innerText ?? "").catch(() => "") : "";
    if (status === 429 || /secondary rate limit|exceeded a rate limit/i.test(text)) {
      budget.rateLimited = true;
      return { status, text };
    }
    if ((status !== null && status < 500) || attempt === 3) {
      if (status !== null && status < 500) await settle(page);
      return { status, error, text };
    }
    await page.waitForTimeout(10000 * attempt);
  }
}

/** The route bundle C6's content script classifies with, as an expression for page.evaluate. */
async function routeExpression(root) {
  const { build } = await import("esbuild");
  const result = await build({ entryPoints: [join(root, "extension/content/github/routes.js")], bundle: true, write: false, format: "iife", globalName: "__reskinQaRoutes", logLevel: "silent" });
  return `(() => { ${result.outputFiles[0].text}; return __reskinQaRoutes.classifyRoute(document); })()`;
}

/** Unpacks one release package from artifacts/ and returns {dir, file, sha256}. */
export async function unpack(root, version, kind) {
  const file = join(root, "artifacts", artifactName(version, kind));
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) throw new Error(`${relative(root, file)} is missing. Run npm run package first.`);
  const dir = await mkdtemp(join(tmpdir(), `reskin-qa-${kind}-`));
  for (const [path, data] of Object.entries(unzipSync(bytes))) {
    if (path.endsWith("/")) continue;
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), data);
  }
  return { dir, file: relative(root, file).replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex") };
}

const CONTEXT = { locale: "en-US", timezoneId: "UTC" };

/** Chromium with the unpacked package in a fresh profile: {context, id, control, close}. */
async function chromiumWithExtension(dir, viewport) {
  const profile = await mkdtemp(join(tmpdir(), "reskin-qa-chromium-"));
  const context = await chromium.launchPersistentContext(profile, { ...CONTEXT, channel: "chromium", headless: true, viewport, args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  // The first-run tab opens on its own after a genuine install, and is where settings are sent from.
  const welcome = await context.waitForEvent("page", { predicate: (p) => p.url().includes("/pages/onboarding.html"), timeout: 10000 }).catch(() => null);
  const control = welcome ?? (await context.newPage());
  if (!welcome) await control.goto(`chrome-extension://${id}/pages/onboarding.html`);
  return { context, id, control, close: () => context.close().finally(() => rm(profile, { recursive: true, force: true })) };
}

/** Commits a settings action from an extension page, as the popup does. */
const commit = (control, action) =>
  control.evaluate(async (action) => {
    const current = await chrome.runtime.sendMessage({ type: "get", requestId: "qa-get" });
    return chrome.runtime.sendMessage({ type: "commit", requestId: "qa-commit", expectedRevision: current.settings.revision, action });
  }, action);

/** Firefox with the unpacked package as a temporary add-on, through web-ext's remote client. */
async function firefoxWithAddon(dir, viewport) {
  const { connectWithMaxRetries } = await import(new URL("../node_modules/web-ext/lib/firefox/remote.js", import.meta.url).href);
  const port = 6000 + Math.floor(Math.random() * 1000);
  const profile = await mkdtemp(join(tmpdir(), "reskin-qa-firefox-"));
  const context = await firefox.launchPersistentContext(profile, {
    ...CONTEXT,
    headless: true,
    viewport,
    args: ["-start-debugger-server", String(port)],
    firefoxUserPrefs: { "devtools.debugger.remote-enabled": true, "devtools.chrome.enabled": true, "devtools.debugger.prompt-connection": false },
  });
  const remote = await connectWithMaxRetries({ port, maxRetries: 50, retryInterval: 200 });
  await remote.installTemporaryAddon(dir);
  remote.disconnect();
  await new Promise((done) => setTimeout(done, 2000));
  // The first-run tab is the add-on's page, which Playwright cannot drive; it is left alone.
  return { context, close: () => context.close().finally(() => rm(profile, { recursive: true, force: true })) };
}

/** Records extension errors and extension-started requests on a Chromium page. */
async function watchChromium(page) {
  const seen = { errors: [], requests: [] };
  const cdp = await page.context().newCDPSession(page);
  const extension = (url) => typeof url === "string" && url.startsWith("chrome-extension://");
  const fromExtension = (details) => extension(details?.url) || (details?.stackTrace?.callFrames ?? details?.stack?.callFrames ?? []).some((frame) => extension(frame.url));
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    if (fromExtension(exceptionDetails)) seen.errors.push(exceptionDetails.exception?.description?.split("\n")[0] ?? exceptionDetails.text);
  });
  cdp.on("Runtime.consoleAPICalled", ({ type, args, stackTrace }) => {
    if (type === "error" && fromExtension({ stackTrace })) seen.errors.push(args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  });
  cdp.on("Network.requestWillBeSent", ({ request, initiator }) => {
    if (!extension(request.url) && fromExtension(initiator)) seen.requests.push(request.url);
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  return seen;
}

/** Runs DONE.md's live check and writes its report. Resolves to {exitCode, testCount}. */
export async function qaLive({ args = [], root = DEFAULT_ROOT, api = githubApi } = {}) {
  if (!args.includes("--read-only")) {
    console.error("qa:live only runs read-only and logged out. Pass --read-only: npm run qa:live -- --read-only");
    return { exitCode: 2, testCount: 0 };
  }
  const out = join(root, OUT);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const config = JSON.parse(await readFile(join(root, "release.config.json"), "utf8"));
  const git = (...argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();
  const report = {
    startedAt: new Date().toISOString(),
    candidate: { version: config.version, commit: git("rev-parse", "HEAD"), clean: git("status", "--porcelain") === "", packages: {} },
    browsers: {},
    targets: [],
    checks: [],
    sweep: [],
    notes: [
      "Chromium is Playwright's build, because branded Chrome no longer loads unpacked extensions from the command line. Firefox is Playwright's build with the add-on installed as a temporary add-on.",
      "Firefox keeps the default theme and Full: Playwright cannot open the add-on's pages to change settings, and in Firefox its console does not report content script errors.",
    ],
  };
  const budget = { navigations: 0, rateLimited: false };
  const record = (entry) => {
    report.checks.push(entry);
    const where = [entry.engine, entry.target, entry.viewport, entry.appearance, entry.theme].filter(Boolean).join(" ");
    console.log(`${entry.pass ? "ok  " : `FAIL ${entry.kind}`} ${where}: ${entry.check}${entry.detail ? ` (${typeof entry.detail === "string" ? entry.detail : JSON.stringify(entry.detail)})` : ""}`);
  };
  const shot = (path) => join(OUT, path).replaceAll("\\", "/");
  const unpacked = [];
  try {
    const chrome = await unpack(root, config.version, "chrome");
    const gecko = await unpack(root, config.version, "firefox");
    unpacked.push(chrome.dir, gecko.dir);
    report.candidate.packages = { chrome: { file: chrome.file, sha256: chrome.sha256 }, firefox: { file: gecko.file, sha256: gecko.sha256 } };
    const targets = await resolveTargets(api);
    report.targets = targets;
    const route = await routeExpression(root);
    const entries = await readCatalogEntries(root);

    for (const target of targets.filter((t) => t.error)) record({ engine: "both", target: target.name, check: "found at test time", pass: false, kind: "github", detail: target.error });
    const live = targets.filter((t) => !t.error);

    for (const engine of ["chromium", "firefox"]) {
      const launcher = engine === "chromium" ? chromium : firefox;
      for (const viewport of VIEWPORTS) {
        const size = `${viewport.width}`;
        // The same build as the extension's, so GitHub sees the same browser.
        const native = await launcher.launch({ headless: true, ...(engine === "chromium" ? { channel: "chromium" } : {}) });
        const nativeContext = await native.newContext({ ...CONTEXT, viewport });
        const themed = engine === "chromium" ? await chromiumWithExtension(chrome.dir, viewport) : await firefoxWithAddon(gecko.dir, viewport);
        report.browsers[engine] = `${native.browserType().name()} ${native.version()}`;
        try {
          for (const target of live) {
            const base = { engine, target: target.name, url: target.url, viewport: size };
            // A native load's snapshot, or null once the reason it does not count is recorded.
            const loadNative = async (screenshot) => {
              const plain = await nativeContext.newPage();
              try {
                const failed = arrivalFailure(await visit(plain, target.url, budget), target);
                if (failed) {
                  record({ ...base, check: "GitHub answered", pass: false, ...failed });
                  return null;
                }
                const nativeRoute = await plain.evaluate(route);
                if (nativeRoute !== target.route) {
                  record({ ...base, check: "GitHub's markup matches the route", pass: false, kind: "markup", detail: `classified ${nativeRoute}, expected ${target.route}` });
                  return null;
                }
                if (screenshot) await plain.screenshot({ path: join(root, shot(`${engine}/${target.name}-native-${size}.png`)) });
                return await plain.evaluate(pageSnapshot, INTERACTIVE);
              } finally {
                await plain.close();
              }
            };
            const natives = [await loadNative(true)];
            if (!natives[0]) continue;

            const page = await themed.context.newPage();
            const seen = engine === "chromium" ? await watchChromium(page) : { errors: [], requests: [] };
            if (engine === "firefox") page.on("pageerror", (error) => /moz-extension:\/\//.test(error.stack ?? "") && seen.errors.push(error.message));
            const load = async () => {
              const failed = arrivalFailure(await visit(page, target.url, budget), target);
              if (failed) record({ ...base, check: "GitHub answered", pass: false, ...failed });
              return !failed;
            };
            if (!(await load())) {
              await page.close();
              continue;
            }
            const themedSnapshots = [await page.evaluate(pageSnapshot, INTERACTIVE)];
            // GitHub can serve a profile's activity or a repository's counts differently from one
            // load to the next. One more load of each tells that apart from the extension's doing.
            if (!natives.some((native) => sameSnapshot(native, themedSnapshots[0]))) {
              const second = await loadNative(false);
              if (second) natives.push(second);
              if (!natives.some((native) => sameSnapshot(native, themedSnapshots[0])) && (await load())) themedSnapshots.push(await page.evaluate(pageSnapshot, INTERACTIVE));
            }
            const verdict = snapshotVerdict(natives, themedSnapshots);
            const modes = engine === "chromium" && viewport.width > 1000 ? ["full", "calm"] : ["full"];
            for (const appearance of modes) {
              if (appearance === "calm") {
                await commit(themed.control, { type: "setPreference", key: "appearance", value: "calm" });
                await page.waitForTimeout(1000);
              }
              const at = { ...base, appearance, theme: "anime.cyberpunk-edgerunners" };
              const file = shot(`${engine}/${target.name}-${appearance}-${size}.png`);
              await page.screenshot({ path: join(root, file) });
              const state = await page.evaluate(pageState, PALETTE);
              record({ ...at, check: "themed", pass: state.boot === "ready" && state.styled, kind: "product", detail: { boot: state.boot, styled: state.styled }, screenshot: file });
              // Calm is compared with Full on the same document, which GitHub cannot change between.
              const [before, after, kind] = appearance === "full" ? [verdict.native, verdict.themed, verdict.kind] : [themedSnapshots.at(-1), await page.evaluate(pageSnapshot, INTERACTIVE), "product"];
              for (const part of PARTS) {
                const diff = compareSnapshots(before[part], after[part]);
                const check = appearance === "full" ? `GitHub's ${part} unchanged` : `GitHub's ${part} unchanged by Calm`;
                record({ ...at, check, pass: diff.same, kind, detail: diff.same ? `${after[part].length} items` : { ...diff, ...(kind === "github" ? { why: "GitHub served different content on each load" } : {}) } });
              }
            }
            if (modes.includes("calm")) await commit(themed.control, { type: "setPreference", key: "appearance", value: "full" });
            record({ ...base, check: "no extension errors", pass: seen.errors.length === 0, kind: "product", detail: seen.errors.slice(0, 5) });
            if (engine === "chromium") record({ ...base, check: "no extension requests", pass: seen.requests.length === 0, kind: "product", detail: seen.requests.slice(0, 5) });

            if (engine === "chromium" && viewport.width > 1000 && SWEEP.includes(target.name)) await sweep({ page, control: themed.control, target, entries, root, report, record, shot });
            await page.close();
          }
        } finally {
          await themed.close();
          await native.close();
        }
      }
    }
    const palettes = new Map(report.sweep.filter((s) => s.target === "profile-1" && s.group === "anime" && s.appearance === "full").map((s) => [s.theme, s.palette]));
    if (palettes.size) {
      const same = sameIdentities(palettes);
      record({ engine: "chromium", target: "profile-1", check: "anime themes differ in canvas, text and accent", pass: same.length === 0, kind: "product", detail: same.length ? same : `${palettes.size} themes` });
    }
    for (const target of SWEEP) {
      const shots = report.sweep.filter((s) => s.target === target && s.appearance === "full");
      if (shots.length) report[`contactSheet-${target}`] = await contactSheet(root, shots, shot(`chromium/contact-sheet-${target}.png`));
    }
  } catch (error) {
    record({ engine: "both", check: "ran", pass: false, kind: "setup", detail: error.message });
  } finally {
    await Promise.all(unpacked.map((dir) => rm(dir, { recursive: true, force: true })));
  }
  const failures = report.checks.filter((c) => !c.pass);
  report.finishedAt = new Date().toISOString();
  report.navigations = budget.navigations;
  report.failures = Object.fromEntries(["github", "markup", "product", "setup"].map((kind) => [kind, failures.filter((c) => c.kind === kind).length]));
  report.checks = report.checks.map(({ kind, ...entry }) => (entry.pass ? entry : { ...entry, kind }));
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`qa:live: ${report.checks.length} checks, ${failures.length} failed (${Object.entries(report.failures).map(([k, v]) => `${k} ${v}`).join(", ")}), ${budget.navigations} page loads. Report: ${OUT}/report.json`);
  return { exitCode: failures.length ? 1 : 0, testCount: report.checks.length };
}

/** Selects every catalog theme on a loaded page, in Full and, on the profile, in Calm. */
async function sweep({ page, control, target, entries, root, report, record, shot }) {
  const appearances = target.name === "profile-1" ? ["full", "calm"] : ["full"];
  for (const appearance of appearances) {
    await commit(control, { type: "setPreference", key: "appearance", value: appearance });
    for (const { id, group, document: theme } of entries) {
      const before = (await page.evaluate(pageState, PALETTE)).styleHash;
      await commit(control, { type: "selectTheme", id });
      // The page starts in Choom Circuit and Full, so selecting it first changes nothing.
      const unchanged = id === "anime.cyberpunk-edgerunners" && appearance === "full";
      const changed = unchanged || (await page.waitForFunction((before) => {
        let hash = 0;
        for (const char of document.getElementById("reskin-style")?.textContent ?? "") hash = (hash * 31 + char.charCodeAt(0)) | 0;
        return hash !== before;
      }, before, { timeout: 5000 }).then(() => true, () => false));
      await page.waitForTimeout(600);
      const state = await page.evaluate(pageState, PALETTE);
      const file = shot(`chromium/sweep/${target.name}/${appearance}/${theme.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`);
      await page.screenshot({ path: join(root, file) });
      const canvas = state.palette["--bgColor-default"];
      const reads = Object.fromEntries(["--fgColor-default", "--fgColor-muted"].map((name) => [name, canvas && state.palette[name] ? Math.round(contrast(state.palette[name], canvas) * 100) / 100 : null]));
      report.sweep.push({ target: target.name, theme: id, name: theme.name, inspiredBy: theme.inspiredBy ?? null, group, appearance, screenshot: file, palette: state.palette, contrast: reads });
      const at = { engine: "chromium", target: target.name, viewport: "1440", appearance, theme: id };
      record({ ...at, check: "theme applied", pass: state.boot === "ready" && state.styled && changed, kind: "product", detail: { boot: state.boot, styled: state.styled, changed } });
      record({ ...at, check: `default and muted text read at ${CONTRAST}:1`, pass: Object.values(reads).every((ratio) => ratio !== null && ratio >= CONTRAST), kind: "product", detail: reads });
    }
  }
  await commit(control, { type: "setPreference", key: "appearance", value: "full" });
  await commit(control, { type: "selectTheme", id: "anime.cyberpunk-edgerunners" });
}

/** One image of every theme's capture, labeled, for review. */
async function contactSheet(root, shots, file) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    const cells = await Promise.all(
      shots.map(async (s) => `<figure><img src="data:image/png;base64,${(await readFile(join(root, s.screenshot))).toString("base64")}"><figcaption><b>${s.inspiredBy ?? s.name}</b> ${s.inspiredBy ? s.name : ""}</figcaption></figure>`),
    );
    await page.setContent(`<style>body{margin:12px;font:13px system-ui;background:#111;color:#eee;display:grid;grid-template-columns:repeat(5,1fr);gap:12px}figure{margin:0}img{width:100%;display:block}figcaption{padding:4px 0}</style>${cells.join("")}`);
    await page.screenshot({ path: join(root, file), fullPage: true });
    return file;
  } finally {
    await browser.close();
  }
}
