// npm run qa:live -- --read-only: DONE.md's live public GitHub check of the release candidate.
// It unpacks the Chrome and Firefox packages from artifacts/, checks them against SHA256SUMS,
// installs each into a fresh logged-out profile, and visits the public pages ARCHITECTURE.md
// names: the Sideband repository, the reference profiles in owner order, a file and a merged pull
// request's diff in that repository, the first public Gist of a reference profile, an empty issue
// search and a missing path. It never signs in, stars, follows, comments or edits.
//
// Each page loads natively and with the extension, per engine and viewport. GitHub's text, every
// label, title, alt and placeholder, the controls and the accessibility tree, without the
// extension's own nodes, must match the native load, and rendered text may not read worse than
// WCAG AA where GitHub's own reads at AA. In Chromium the page is checked again in Calm, and
// errors and requests from the extension fail it. Then Chromium switches through every catalog
// theme on the first profile, the repository and the diff: each must be the theme selected, with
// its own canvas, readable, and the thirteen anime themes must differ. Firefox gets the add-on as
// a temporary install and keeps its default theme, because Playwright cannot open its pages.
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
import { catalogCards, readCatalogEntries } from "../packages/ui/bundle.mjs";
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
// DONE.md's catalog: thirteen anime themes and twelve Classics.
export const ANIME_THEMES = 13;
export const CLASSIC_THEMES = 12;
// The pages the theme sweep visits, by target name, and the appearances on each.
const SWEEP = { "profile-1": ["full", "calm"], repo: ["full"], diff: ["full"] };
const CHOOM = "anime.cyberpunk-edgerunners";
const NAVIGATION_LIMIT = 150;
const SETUP_TIMEOUT = 60000;
const CONTRAST = 4.5;
const LARGE_CONTRAST = 3;

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

/** Resolves with `promise`, or rejects once `ms` pass. */
export function deadline(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** WCAG contrast of two [r, g, b] colors in 0..255. */
export function contrast(a, b) {
  const luminance = (rgb) =>
    rgb.map((v) => v / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

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

export const PARTS = Object.freeze(["text", "names", "controls", "accessibility"]);

/**
 * Judges a page's themed loads against its native loads, part by part: {part: {kind, missing,
 * added}}. A part passes, kind null, when some native and themed load agree on it. Otherwise an
 * item that changed between GitHub's own loads, native or themed, is GitHub's, and any other
 * difference, including order alone, is the product's.
 */
export function snapshotVerdict(natives, themeds) {
  const verdict = {};
  for (const part of PARTS) {
    if (natives.some((native) => themeds.some((themed) => compareSnapshots(native[part], themed[part]).same))) {
      verdict[part] = { kind: null, missing: [], added: [] };
      continue;
    }
    const noise = new Set();
    for (const loads of [natives, themeds])
      for (const load of loads.slice(1)) {
        const changed = compareSnapshots(loads[0][part], load[part], Infinity);
        for (const item of [...changed.missing, ...changed.added]) noise.add(item);
      }
    const diff = compareSnapshots(natives.at(-1)[part], themeds.at(-1)[part], Infinity);
    const missing = diff.missing.filter((item) => !noise.has(item));
    const added = diff.added.filter((item) => !noise.has(item));
    verdict[part] =
      missing.length || added.length || !noise.size
        ? { kind: "product", missing: missing.slice(0, 5), added: added.slice(0, 5) }
        : { kind: "github", missing: diff.missing.slice(0, 5), added: diff.added.slice(0, 5) };
  }
  return verdict;
}

/**
 * Rendered texts of the themed page below WCAG AA, 4.5:1 or 3:1 when large, whose words and tag
 * read at AA on the native page or are not on it. Text over a background image is not measured.
 */
export function contrastRegressions(native, themed) {
  const low = (entry) => !entry.overImage && entry.ratio < (entry.large ? LARGE_CONTRAST : CONTRAST);
  const nativeLow = new Set(native.filter(low).map((entry) => entry.key));
  return themed.filter((entry) => low(entry) && !nativeLow.has(entry.key));
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
  // A reload can answer 304 from the browser's cache, which is the same page.
  if (status !== (expected.status ?? 200) && !(status === 304 && !expected.status)) return { kind: "markup", detail: `HTTP ${status}, expected ${expected.status ?? 200}` };
  return null;
}

/**
 * What is under test: the version and commit artifacts/build-info.json records for the packages,
 * whose hashes must match artifacts/SHA256SUMS. `packages` maps a kind to unpack()'s result.
 */
export async function provenance(root, packages) {
  const read = (name) =>
    readFile(join(root, "artifacts", name), "utf8").catch(() => {
      throw new Error(`artifacts/${name} is missing. Run npm run package first.`);
    });
  const info = JSON.parse(await read("build-info.json"));
  const sums = new Map((await read("SHA256SUMS")).trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/).reverse()));
  for (const { file, sha256 } of Object.values(packages))
    if (sums.get(file.split("/").at(-1)) !== sha256) throw new Error(`${file} does not match artifacts/SHA256SUMS. Run npm run package again.`);
  return { version: info.version, commit: info.commit, sourceDirty: info.sourceDirty, packages: Object.fromEntries(Object.entries(packages).map(([kind, { file, sha256 }]) => [kind, { file, sha256 }])) };
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

/** pageSnapshot's parts and the accessible roles and names of the body, from Playwright, by line. */
async function snapshotOf(page) {
  const parts = await page.evaluate(pageSnapshot, INTERACTIVE);
  const tree = await page.locator("body").ariaSnapshot({ timeout: 30000 });
  return { ...parts, accessibility: tree.split("\n").filter((line) => line.trim()) };
}

// In the page: each rendered text's contrast with the colors painted under it, keyed by its tag
// and words. Text with a background image under it is marked, not measured.
function pageContrast() {
  const context = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  const paint = (layers) => {
    context.clearRect(0, 0, 1, 1);
    for (const layer of layers) {
      context.fillStyle = layer;
      context.fillRect(0, 0, 1, 1);
    }
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const luminance = (rgb) => rgb.map((v) => v / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const styles = new Map();
  const style = (element) => styles.get(element) ?? styles.set(element, getComputedStyle(element)).get(element);
  const entries = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && entries.length < 2000; node = walker.nextNode()) {
    const element = node.parentElement;
    const words = node.data.replace(/\s+/g, " ").trim();
    if (!element || !words || element.closest("[data-reskin-owned],script,style,noscript,template,svg,[aria-hidden='true']")) continue;
    const own = style(element);
    const box = element.getBoundingClientRect();
    if (own.visibility !== "visible" || own.opacity === "0" || box.width <= 1 || box.height <= 1) continue;
    // The background colors under the text, nearest first, down to the first opaque one.
    const under = [];
    let overImage = false;
    for (let at = element; at; at = at.parentElement) {
      const layer = style(at);
      if (layer.backgroundImage !== "none") {
        overImage = true;
        break;
      }
      under.push(layer.backgroundColor);
      if (paint([layer.backgroundColor])[3] === 255) break;
    }
    const layers = ["#fff", ...under.reverse()];
    const [background, text] = [paint(layers), paint([...layers, own.color])].map((rgba) => rgba.slice(0, 3));
    const [high, low] = [luminance(text), luminance(background)].sort((x, y) => y - x);
    const size = parseFloat(own.fontSize);
    entries.push({ key: `${element.localName} ${words.slice(0, 60)}`, ratio: Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100, large: size >= 24 || (size >= 18.66 && Number(own.fontWeight) >= 700), overImage });
  }
  return entries;
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

/** Whether the extension's stylesheet changes from `before` within five seconds. */
const restyled = (page, before) =>
  page
    .waitForFunction(
      (before) => {
        let hash = 0;
        for (const char of document.getElementById("reskin-style")?.textContent ?? "") hash = (hash * 31 + char.charCodeAt(0)) | 0;
        return hash !== before;
      },
      before,
      { timeout: 5000 },
    )
    .then(
      () => true,
      () => false,
    );

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
const extensionUrl = (url) => typeof url === "string" && url.startsWith("chrome-extension://");

/**
 * Chromium with the unpacked package in a fresh profile: {context, id, control, seen, close}.
 * `seen` collects errors and outside requests from the extension's own pages and worker.
 */
async function chromiumWithExtension(dir, viewport) {
  const profile = await mkdtemp(join(tmpdir(), "reskin-qa-chromium-"));
  const context = await chromium.launchPersistentContext(profile, { ...CONTEXT, channel: "chromium", headless: true, viewport, args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
  const close = () => context.close().finally(() => rm(profile, { recursive: true, force: true }));
  const seen = { errors: [], requests: [] };
  context.on("weberror", (error) => {
    if (extensionUrl(error.page()?.url()) || /chrome-extension:\/\//.test(error.error().stack ?? "")) seen.errors.push(error.error().message);
  });
  context.on("console", (message) => {
    if (message.type() === "error" && [message.worker()?.url(), message.page()?.url(), message.location().url].some(extensionUrl)) seen.errors.push(message.text());
  });
  context.on("request", (request) => {
    let from = null;
    try {
      from = request.serviceWorker()?.url() ?? request.frame().page()?.url();
    } catch {}
    if (extensionUrl(from) && !extensionUrl(request.url()) && !/^(data|blob):/.test(request.url())) seen.requests.push(request.url());
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker", { timeout: SETUP_TIMEOUT });
    const id = new URL(worker.url()).host;
    // The first-run tab opens on its own after a genuine install, and is where settings are sent from.
    const welcome = await context.waitForEvent("page", { predicate: (p) => p.url().includes("/pages/onboarding.html"), timeout: 10000 }).catch(() => null);
    const control = welcome ?? (await context.newPage());
    if (!welcome) await control.goto(`chrome-extension://${id}/pages/onboarding.html`);
    return { context, id, control, seen, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Commits a settings action from an extension page, as the popup does, and returns the reply. */
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
  const close = () => context.close().finally(() => rm(profile, { recursive: true, force: true }));
  let remote = null;
  try {
    await deadline(
      (async () => {
        remote = await connectWithMaxRetries({ port, maxRetries: 50, retryInterval: 200 });
        await remote.installTemporaryAddon(dir);
      })(),
      SETUP_TIMEOUT,
      "Installing the Firefox add-on",
    );
  } catch (error) {
    await close();
    throw error;
  } finally {
    remote?.disconnect();
  }
  await new Promise((done) => setTimeout(done, 2000));
  // The first-run tab is the add-on's page, which Playwright cannot drive; it is left alone.
  return { context, close };
}

/** Records extension errors and extension-started requests on a Chromium page. */
async function watchChromium(page) {
  const seen = { errors: [], requests: [] };
  const cdp = await page.context().newCDPSession(page);
  const fromExtension = (details) => extensionUrl(details?.url) || (details?.stackTrace?.callFrames ?? details?.stack?.callFrames ?? []).some((frame) => extensionUrl(frame.url));
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    if (fromExtension(exceptionDetails)) seen.errors.push(exceptionDetails.exception?.description?.split("\n")[0] ?? exceptionDetails.text);
  });
  cdp.on("Runtime.consoleAPICalled", ({ type, args, stackTrace }) => {
    if (type === "error" && fromExtension({ stackTrace })) seen.errors.push(args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  });
  cdp.on("Network.requestWillBeSent", ({ request, initiator }) => {
    if (!extensionUrl(request.url) && fromExtension(initiator)) seen.requests.push(request.url);
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
    candidate: null,
    harness: { commit: git("rev-parse", "HEAD"), clean: git("status", "--porcelain") === "" },
    browsers: {},
    targets: [],
    checks: [],
    sweep: [],
    notes: [
      "Chromium is Playwright's build, because branded Chrome no longer loads unpacked extensions from the command line. Firefox is Playwright's build with the add-on installed as a temporary add-on.",
      "Firefox keeps the default theme and Full, because Playwright cannot open the add-on's pages to change settings. Its console does not report content script errors, so Firefox has no extension error check; npm run qa:firefox drives the add-on's pages in an actual Firefox.",
      "Contrast is measured on rendered text in the first 2000 text nodes of each page. Text with a background image under it is counted in overImage and not measured.",
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
  // Why each target failed to load, by name, so a sweep that never ran is charged to it.
  const arrival = new Map();
  try {
    const chrome = await unpack(root, config.version, "chrome");
    unpacked.push(chrome.dir);
    const gecko = await unpack(root, config.version, "firefox");
    unpacked.push(gecko.dir);
    report.candidate = await provenance(root, { chrome, firefox: gecko });
    const entries = await readCatalogEntries(root);
    const groups = { anime: entries.filter((e) => e.group === "anime").length, classics: entries.filter((e) => e.group === "classics").length };
    record({ engine: "both", check: `the catalog has ${ANIME_THEMES} anime themes and ${CLASSIC_THEMES} Classics`, pass: groups.anime === ANIME_THEMES && groups.classics === CLASSIC_THEMES && entries.length === ANIME_THEMES + CLASSIC_THEMES, kind: "product", detail: groups });
    const canvasOf = Object.fromEntries(catalogCards(entries).map((card) => [card.id, card.mini.canvas]));
    const targets = await resolveTargets(api);
    report.targets = targets;
    const route = await routeExpression(root);
    const nativeContrast = new Map();

    for (const target of targets.filter((t) => t.error)) {
      record({ engine: "both", target: target.name, check: "found at test time", pass: false, kind: "github", detail: target.error });
      arrival.set(target.name, "github");
    }
    const live = targets.filter((t) => !t.error);

    for (const engine of ["chromium", "firefox"]) {
      const launcher = engine === "chromium" ? chromium : firefox;
      for (const viewport of VIEWPORTS) {
        const size = `${viewport.width}`;
        // The same build as the extension's, so GitHub sees the same browser.
        const native = await launcher.launch({ headless: true, ...(engine === "chromium" ? { channel: "chromium" } : {}) });
        try {
          report.browsers[engine] = `${native.browserType().name()} ${native.version()}`;
          const nativeContext = await native.newContext({ ...CONTEXT, viewport });
          const themed = engine === "chromium" ? await chromiumWithExtension(chrome.dir, viewport) : await firefoxWithAddon(gecko.dir, viewport);
          try {
            for (const target of live) {
              const base = { engine, target: target.name, url: target.url, viewport: size };
              const failed = (entry) => {
                record({ ...base, pass: false, ...entry });
                if (!arrival.has(target.name)) arrival.set(target.name, entry.kind);
                return null;
              };
              // A native load's snapshot and contrast, or null once the reason it does not count is recorded.
              const loadNative = async (first) => {
                const plain = await nativeContext.newPage();
                try {
                  const answer = arrivalFailure(await visit(plain, target.url, budget), target);
                  if (answer) return failed({ check: "GitHub answered", ...answer });
                  const nativeRoute = await plain.evaluate(route);
                  if (nativeRoute !== target.route) return failed({ check: "GitHub's markup matches the route", kind: "markup", detail: `classified ${nativeRoute}, expected ${target.route}` });
                  if (first) await plain.screenshot({ path: join(root, shot(`${engine}/${target.name}-native-${size}.png`)) });
                  return { snapshot: await snapshotOf(plain), contrast: first ? await plain.evaluate(pageContrast) : null };
                } finally {
                  await plain.close();
                }
              };
              const first = await loadNative(true);
              if (!first) continue;
              const natives = [first.snapshot];
              nativeContrast.set(`${engine} ${target.name} ${size}`, first.contrast);

              const page = await themed.context.newPage();
              try {
                const seen = engine === "chromium" ? await watchChromium(page) : null;
                const load = async () => {
                  const answer = arrivalFailure(await visit(page, target.url, budget), target);
                  if (answer) failed({ check: "GitHub answered", ...answer });
                  return !answer;
                };
                if (!(await load())) continue;
                const themeds = [await snapshotOf(page)];
                let verdict = snapshotVerdict(natives, themeds);
                // GitHub can serve a profile's activity or a repository's counts differently from one
                // load to the next. One more load of each tells that apart from the extension's doing.
                if (Object.values(verdict).some((part) => part.kind)) {
                  const second = await loadNative(false);
                  if (second) natives.push(second.snapshot);
                  if (await load()) themeds.push(await snapshotOf(page));
                  verdict = snapshotVerdict(natives, themeds);
                }
                const modes = engine === "chromium" && viewport.width > 1000 ? ["full", "calm"] : ["full"];
                let full = null;
                for (const appearance of modes) {
                  const at = { ...base, appearance, theme: CHOOM };
                  if (appearance === "calm") {
                    const before = (await page.evaluate(pageState, PALETTE)).styleHash;
                    const reply = await commit(themed.control, { type: "setPreference", key: "appearance", value: "calm" });
                    const changed = await restyled(page, before);
                    await page.waitForTimeout(500);
                    record({ ...at, check: "Calm applied", pass: Boolean(reply?.ok && reply.settings.preferences.appearance === "calm" && changed), kind: "product", detail: { ok: reply?.ok ?? null, appearance: reply?.settings?.preferences.appearance ?? null, restyled: changed } });
                  }
                  const file = shot(`${engine}/${target.name}-${appearance}-${size}.png`);
                  await page.screenshot({ path: join(root, file) });
                  const state = await page.evaluate(pageState, PALETTE);
                  record({ ...at, check: "themed", pass: state.boot === "ready" && state.styled, kind: "product", detail: { boot: state.boot, styled: state.styled }, screenshot: file });
                  if (appearance === "full") {
                    full = themeds.at(-1);
                    for (const part of PARTS) {
                      const { kind, missing, added } = verdict[part];
                      const detail = kind ? { missing, added, ...(kind === "github" ? { why: "GitHub served different content on each load" } : {}) } : `${full[part].length} items`;
                      record({ ...at, check: `GitHub's ${part} unchanged`, pass: !kind, kind: kind ?? "product", detail });
                    }
                  } else {
                    // Calm is compared with Full on the same document, which GitHub cannot change between.
                    const calm = await snapshotOf(page);
                    for (const part of PARTS) {
                      const diff = compareSnapshots(full[part], calm[part]);
                      record({ ...at, check: `GitHub's ${part} unchanged by Calm`, pass: diff.same, kind: "product", detail: diff.same ? `${calm[part].length} items` : diff });
                    }
                  }
                  const measured = await page.evaluate(pageContrast);
                  const worse = contrastRegressions(first.contrast, measured);
                  record({ ...at, check: "rendered text reads at AA where GitHub's does", pass: worse.length === 0, kind: "product", detail: { measured: measured.filter((e) => !e.overImage).length, overImage: measured.filter((e) => e.overImage).length, worse: worse.slice(0, 5) } });
                }
                if (modes.includes("calm")) {
                  const reply = await commit(themed.control, { type: "setPreference", key: "appearance", value: "full" });
                  if (!reply?.ok) throw new Error("Full could not be restored after Calm");
                  await page.waitForTimeout(500);
                }
                if (seen) {
                  record({ ...base, check: "no extension errors on the page", pass: seen.errors.length === 0, kind: "product", detail: seen.errors.slice(0, 5) });
                  record({ ...base, check: "no requests from the extension on the page", pass: seen.requests.length === 0, kind: "product", detail: seen.requests.slice(0, 5) });
                }
                if (engine === "chromium" && viewport.width > 1000 && SWEEP[target.name])
                  await sweep({ page, control: themed.control, target, entries, canvasOf, native: first.contrast, root, report, record, shot });
              } finally {
                await page.close();
              }
            }
            if (themed.seen) {
              const at = { engine, viewport: size };
              record({ ...at, check: "no errors in the extension's pages and worker", pass: themed.seen.errors.length === 0, kind: "product", detail: themed.seen.errors.slice(0, 5) });
              record({ ...at, check: "no outside requests from the extension's pages and worker", pass: themed.seen.requests.length === 0, kind: "product", detail: themed.seen.requests.slice(0, 5) });
            }
          } finally {
            await themed.close().catch(() => {});
          }
        } finally {
          await native.close().catch(() => {});
        }
      }
    }

    for (const [target, appearances] of Object.entries(SWEEP))
      for (const appearance of appearances) {
        const swept = report.sweep.filter((s) => s.target === target && s.appearance === appearance).length;
        record({ engine: "chromium", target, viewport: "1440", appearance, check: "every catalog theme swept", pass: swept === entries.length, kind: arrival.get(target) ?? "product", detail: `${swept} of ${entries.length}` });
      }
    const palettes = new Map(report.sweep.filter((s) => s.target === "profile-1" && s.group === "anime" && s.appearance === "full").map((s) => [s.theme, s.palette]));
    const same = sameIdentities(palettes);
    record({ engine: "chromium", target: "profile-1", check: `the ${ANIME_THEMES} anime themes differ in canvas, text and accent`, pass: palettes.size === ANIME_THEMES && same.length === 0, kind: arrival.get("profile-1") ?? "product", detail: same.length ? same : `${palettes.size} themes` });
    for (const target of Object.keys(SWEEP)) {
      const shots = report.sweep.filter((s) => s.target === target && s.appearance === "full");
      if (shots.length) report[`contactSheet-${target}`] = await contactSheet(root, shots, shot(`chromium/contact-sheet-${target}.png`));
    }
  } catch (error) {
    record({ engine: "both", check: "ran", pass: false, kind: "setup", detail: error.message.split("\n")[0] });
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

/**
 * Selects every catalog theme on a loaded page in SWEEP's appearances. Each must be the theme the
 * settings hold, with its own canvas, and read as well as the native page.
 */
async function sweep({ page, control, target, entries, canvasOf, native, root, report, record, shot }) {
  for (const appearance of SWEEP[target.name]) {
    const set = await commit(control, { type: "setPreference", key: "appearance", value: appearance });
    if (!set?.ok) throw new Error(`the sweep could not set ${appearance}`);
    for (const { id, group, document: theme } of entries) {
      const before = (await page.evaluate(pageState, PALETTE)).styleHash;
      const reply = await commit(control, { type: "selectTheme", id });
      // The page starts in Choom Circuit and Full, so selecting it first changes nothing.
      const changed = (id === CHOOM && appearance === "full") || (await restyled(page, before));
      await page.waitForTimeout(600);
      const state = await page.evaluate(pageState, PALETTE);
      const file = shot(`chromium/sweep/${target.name}/${appearance}/${theme.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`);
      await page.screenshot({ path: join(root, file) });
      const canvas = state.palette["--bgColor-default"];
      const reads = Object.fromEntries(["--fgColor-default", "--fgColor-muted"].map((name) => [name, canvas && state.palette[name] ? Math.round(contrast(state.palette[name], canvas) * 100) / 100 : null]));
      const measured = await page.evaluate(pageContrast);
      const worse = contrastRegressions(native, measured);
      report.sweep.push({ target: target.name, theme: id, name: theme.name, inspiredBy: theme.inspiredBy ?? null, group, appearance, screenshot: file, palette: state.palette, contrast: reads });
      const at = { engine: "chromium", target: target.name, viewport: "1440", appearance, theme: id };
      const selected = reply?.ok && reply.settings.selectedThemeId === id;
      const ownCanvas = JSON.stringify(canvas) === JSON.stringify(rgbOf(canvasOf[id]));
      record({ ...at, check: "theme applied", pass: Boolean(selected && state.boot === "ready" && state.styled && changed && ownCanvas), kind: "product", detail: { selected, boot: state.boot, styled: state.styled, changed, canvas, expected: canvasOf[id] } });
      record({ ...at, check: `default and muted text read at ${CONTRAST}:1 on the canvas`, pass: Object.values(reads).every((ratio) => ratio !== null && ratio >= CONTRAST), kind: "product", detail: reads });
      record({ ...at, check: "rendered text reads at AA where GitHub's does", pass: worse.length === 0, kind: "product", detail: { measured: measured.filter((e) => !e.overImage).length, overImage: measured.filter((e) => e.overImage).length, worse: worse.slice(0, 5) } });
    }
  }
  for (const action of [
    { type: "setPreference", key: "appearance", value: "full" },
    { type: "selectTheme", id: CHOOM },
  ])
    if (!(await commit(control, action))?.ok) throw new Error(`the sweep could not restore ${JSON.stringify(action)}`);
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
