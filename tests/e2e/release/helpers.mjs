// Shared setup for C9's release surface: cross-product timings that check:budgets gates, and the
// release-only accessibility checks, the add-on's pages at 320px in both engines. Each timing test
// writes what it measured with record(), one file per project and measurement under
// RESKIN_RELEASE_TIMINGS (artifacts/reports/release-timings by default), with its raw trace beside
// it when it took one; tests/release/checks.mjs merges the measurements into release-timings.json
// after the run.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { readCatalogEntries } from "../../../packages/ui/bundle.mjs";
import { PROFILE_HTML, PROFILE_URL } from "../extension/helpers.mjs";
import { adapterPaths } from "../../fixture-app/product/build.mjs";
import { axeViolations, blocking } from "../../helpers/a11y.mjs";
import { expect } from "../../helpers/e2e.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const TIMINGS_DIR = process.env.RESKIN_RELEASE_TIMINGS || join(ROOT, "artifacts/reports/release-timings");
export const PREFS = Object.freeze({ appearance: "full", enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true });

/** The nearest-rank percentile of a list of times. */
export function percentile(times, p) {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

export const summary = (times) => ({ samples: times.length, p50: percentile(times, 0.5), p95: percentile(times, 0.95), max: Math.max(...times) });

/** Writes one measurement for this project, with the browser and the machine it ran on. */
export async function record(info, name, values, browser) {
  await mkdir(TIMINGS_DIR, { recursive: true });
  const machine = { cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, load: loadavg() };
  await writeFile(join(TIMINGS_DIR, `${info.project.name}.${name}.json`), `${JSON.stringify({ project: info.project.name, browser, machine, ...values }, null, 2)}\n`);
  info.annotations.push({ type: "timing", description: `${name}: ${JSON.stringify(values)}` });
}

/** Saves a DevTools trace beside this project's timings, gzipped, and returns its file name. */
export async function saveTrace(info, name, events) {
  await mkdir(TIMINGS_DIR, { recursive: true });
  const file = `${info.project.name}.${name}.trace.json.gz`;
  await writeFile(join(TIMINGS_DIR, file), gzipSync(JSON.stringify({ traceEvents: events })));
  return file;
}

// The GitHub page the timings run on, C3's guarded profile fixture, for the report.
export const FIXTURE = Object.freeze({ url: PROFILE_URL, file: "tests/primer/fixtures/profile.html", bytes: Buffer.byteLength(PROFILE_HTML), sha256: createHash("sha256").update(PROFILE_HTML).digest("hex") });

/** The bundled catalog's theme documents, anime first. */
export const catalogThemes = async () => (await readCatalogEntries(ROOT)).map((entry) => entry.document);

/**
 * A page that resolves themes the way the builder's preview does: C5's createFixtureRenderer over
 * C3's Primer index, bundled with esbuild. window.timeResolves(states) resolves each state once and
 * returns the milliseconds each took.
 */
export async function resolvePage(serveDir) {
  const { build } = await import("esbuild");
  const dir = await mkdtemp(join(tmpdir(), "reskin-e2e-release-resolve-"));
  const adapters = adapterPaths(ROOT);
  await build({
    entryPoints: [fileURLToPath(new URL("./resolve-page.js", import.meta.url))],
    outfile: join(dir, "resolve.js"),
    absWorkingDir: ROOT,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120", "firefox140"],
    charset: "utf8",
    logLevel: "silent",
    plugins: [{ name: "reskin-adapters", setup: (b) => b.onResolve({ filter: /^reskin:(primer|github)$/ }, (args) => ({ path: adapters[args.path.slice(7)] })) }],
  });
  await writeFile(join(dir, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Resolve</title><script type="module" src="resolve.js"></script></head><body></body></html>');
  const server = await serveDir(dir, { host: "127.0.0.1" });
  return { url: server.url, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Builder-like edits of every catalog theme: each theme with `count` accent colors, so each state
 * misses the renderer's cache as a new edit does.
 */
export function edits(themes, count, offset = 0) {
  return themes.flatMap((theme, t) =>
    Array.from({ length: count }, (_, i) => {
      const n = (t * 31 + (i + offset) * 17) % 200;
      const accent = `#${(0x30 + n).toString(16).padStart(2, "0")}${(0x50 + ((n * 3) % 150)).toString(16).padStart(2, "0")}c0`;
      return { theme: { ...theme, colors: { ...theme.colors, accent } }, preferences: PREFS };
    }),
  );
}

/** Times builder-like edits in the resolve page: a warm-up pass, then the measured edits. */
export async function timeResolves(page, themes) {
  await page.waitForFunction(() => typeof window.timeResolves === "function");
  await page.evaluate((states) => window.timeResolves(states), edits(themes, 2, 100));
  return page.evaluate((states) => window.timeResolves(states), edits(themes, 4));
}

// The add-on's pages allow only packaged scripts, so axe is evaluated rather than added as a tag.
const AXE = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

/** The page's serious and critical axe violations. */
export async function axe(page) {
  await page.evaluate(AXE);
  return blocking(await axeViolations(page));
}

// WCAG's reflow width.
export const REFLOW = Object.freeze({ width: 320, height: 640 });

// A chatbot answer whose text and accent are unreadable on its background, so the import lists the
// color changes it makes.
const UNREADABLE_ANSWER = '```json\n{"schemaVersion":1,"name":"Dim","base":"dark","colors":{"background":"#101010","text":"#303030","accent":"#202020"}}\n```';

// Each view of the add-on's pages: [title, page, hash, what a person does to see all of it]. The
// release checks open each at REFLOW in both engines.
export const VIEWS = Object.freeze([
  ["the popup", "popup", "", async () => {}],
  ["Preferences", "settings", "#preferences", async () => {}],
  ["Themes", "settings", "#themes", async () => {}],
  [
    "Make a theme with every disclosure open",
    "settings",
    "#make",
    async (page) => {
      await expect(page.locator('[data-rb="builder"]')).toHaveAttribute("data-rb-ready", "");
      await page.evaluate(() => document.querySelectorAll('[data-rb="builder"] details').forEach((details) => (details.open = true)));
    },
  ],
  [
    "the import dialog with its color changes open",
    "settings",
    "#make",
    async (page) => {
      await expect(page.locator('[data-rb="builder"]')).toHaveAttribute("data-rb-ready", "");
      await page.getByRole("button", { name: "Import", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Import a theme" });
      await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(UNREADABLE_ANSWER);
      await dialog.getByRole("button", { name: "Preview theme" }).click();
      await dialog.locator('[data-rb="import-changes"] > summary').click();
      await expect(dialog.getByRole("region", { name: "Color adjustments, scrollable" })).toBeVisible();
    },
  ],
  ["Backup & help", "settings", "#backup", async (page) => expect(page.locator('[data-rk="backup"]')).toBeVisible()],
  [
    "onboarding with every anime and the extras shown",
    "onboarding",
    "",
    async (page) => {
      await page.getByRole("button", { name: "All 13 anime" }).click();
      await page.getByText("Preview extras").click();
    },
  ],
]);

/** How many CSS px the page scrolls sideways; 0 when it reflows. */
export const sideways = (page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
