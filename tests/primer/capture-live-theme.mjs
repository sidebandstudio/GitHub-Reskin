// Maintenance only, networked: applies a theme to public github.com pages in a fresh logged-out
// Chromium the way the content script composes it (the Primer stylesheet, C5's appearance CSS and
// the theme's sanitized advanced CSS compiled against the registry, then admission and owned
// decorations) and saves full-page screenshots. Ordinary test runs never call this.
//   node tests/primer/capture-live-theme.mjs <theme.reskin.json> <outDir> [native.css] [--calm]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { compileAppearance } from "../../packages/appearance/index.js";
import { repairTheme, resolveTheme } from "../../packages/engine/index.js";
import { compileCss, sanitizeCss } from "../../packages/format/index.js";
import { compileGitHub, coveredModes, CSS_TARGET_REGISTRY, MODE_INDEX, selectMode } from "../../packages/primer/index.js";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const [themePath, outDir, nativePath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const calm = process.argv.includes("--calm");
if (!themePath || !outDir) throw new Error("usage: capture-live-theme.mjs <theme.reskin.json> <outDir> [native.css] [--calm]");
const theme = JSON.parse(await readFile(themePath, "utf8"));
const extraCss = nativePath ? await readFile(nativePath, "utf8") : "";

export const PAGES = [
  { url: "https://github.com/whoisaldo", name: "profile" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin", name: "repository" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin/blob/main/README.md", name: "file" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin/pull/5/files", name: "pull-diff" },
  { url: "https://github.com/", name: "home" },
  { url: "https://github.com/whoisaldo/this-page-does-not-exist-reskin-qa", name: "404" },
];

const prefs = { enabled: true, extras: !calm, text: true, motion: false, fonts: true, effects: true, appearance: calm ? "calm" : "full" };
// GitHub's logged-out pages follow the system scheme; the browser below is dark.
const native = { colorMode: "auto", lightTheme: "light", darkTheme: "dark", systemDark: true };
const plan = selectMode(native, theme.base, MODE_INDEX);
const seed = MODE_INDEX.modes[plan.seedMode];
const repaired = repairTheme(theme, seed);
const resolved = resolveTheme(repaired.theme, { seed, policy: plan.policy, reducedMotion: true, forcedColors: false });
const primer = compileGitHub(resolved, plan, prefs);
const appearance = compileAppearance(resolved, prefs, "github");
const source = [theme.css ?? "", extraCss].join("");
const sanitized = source ? sanitizeCss(source, { path: "/css" }) : null;
if (sanitized && !sanitized.ok) throw new Error(`Theme CSS is refused: ${JSON.stringify(sanitized.issues)}`);
const advanced = sanitized ? compileCss(sanitized.value, { registry: CSS_TARGET_REGISTRY, cssAllowed: true, preferences: prefs, policy: plan.policy }) : { ok: true, css: "", nativeRules: 0, ownedRules: 0 };
if (!advanced.ok) throw new Error(`Theme CSS does not compile: ${JSON.stringify(advanced.issues)}`);
const css = [primer.css, appearance, advanced.css].join("\n");

const entry = join(ROOT, "tests/primer/.capture-entry.mjs");
await writeFile(entry, 'export * from "../../extension/content/github/index.js";\nexport { mountAppearance } from "../../packages/appearance/index.js";\n');
const bundle = (await build({ entryPoints: [entry], bundle: true, format: "iife", globalName: "ReskinGitHub", write: false, platform: "browser", logLevel: "silent" })).outputFiles[0].text;
await (await import("node:fs/promises")).rm(entry);

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 900 }, colorScheme: "dark", bypassCSP: true, reducedMotion: "reduce" });
const report = { theme: theme.name, mode: prefs.appearance, bytes: { primer: primer.css.length, appearance: appearance.length, advanced: advanced.css.length }, nativeRules: advanced.nativeRules, ownedRules: advanced.ownedRules, pages: [] };
for (const { url, name } of PAGES) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.addScriptTag({ content: bundle });
  const state = await page.evaluate(async ({ css, modes, resolved, prefs }) => {
    const G = globalThis.ReskinGitHub;
    const style = document.createElement("style");
    style.textContent = css;
    document.documentElement.append(style);
    const handle = G.startAdmission(document, { modes });
    for (let i = 0; i < 20 && handle.state().pending; i++) await new Promise((r) => requestAnimationFrame(r));
    const route = G.classifyRoute(document);
    const anchors = G.locateSlots(document, route);
    let mounted = 0;
    try {
      G.mountAppearance(document.body, resolved, prefs, anchors);
      mounted = anchors.length;
    } catch (error) {
      mounted = String(error);
    }
    window.scrollTo(0, 0);
    // Computed colors of a fixed sample of GitHub's own elements, the first match of each.
    const SAMPLES = ["body", "header[role=banner]", ".btn-primary", "[data-component=Button][data-variant=primary]", ".pl-k", ".pl-s", ".pl-c1", ".pl-c", ".pl-en", "[class*=additionNum], .blob-num-addition", "[class*=deletionNum], .blob-num-deletion", "[class*=additionLine], .blob-code-addition", "[class*=deletionLine], .blob-code-deletion", "[class*=hunk], .blob-num-hunk", ".ContributionCalendar-day[data-level='4']", ".ContributionCalendar-day[data-level='0']", "#contribution-graph-legend-level-4", ".js-highlight-blob", ".js-year-link.selected", ".UnderlineNav-item[aria-current=page]", "a[data-testid=repo-name-link], strong[itemprop=name] a", ".Label, [data-component=Label]", ".topic-tag", ".Box", ".Counter", "footer"];
    const computed = {};
    for (const selector of SAMPLES) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const cs = getComputedStyle(el);
      computed[selector] = { color: cs.color, background: cs.backgroundColor, border: cs.borderTopColor, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow === "none" ? null : cs.boxShadow.slice(0, 80), textShadow: cs.textShadow === "none" ? null : cs.textShadow.slice(0, 60), fill: el instanceof SVGElement ? cs.fill : undefined, kind: el.getAttribute("data-reskin-css-kind") };
    }
    return { ...handle.state(), anchors: mounted, computed };
  }, { css, modes: coveredModes(MODE_INDEX, plan.seedMode), resolved, prefs });
  await page.waitForTimeout(500);
  const file = join(outDir, `${name}${calm ? "-calm" : ""}.png`);
  await page.screenshot({ path: file, fullPage: name !== "pull-diff" && name !== "home" });
  report.pages.push({ url, name, file, ...state });
  await page.close();
}
await browser.close();
await writeFile(join(outDir, `report${calm ? "-calm" : ""}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
