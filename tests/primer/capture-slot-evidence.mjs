// Maintenance only, networked: runs the shipped GitHub adapter (classifyRoute, locateSlots and
// the slot guards) in a fresh logged-out Chromium against the public reference pages and records
// what it finds in tests/primer/slot-evidence.json, with a cropped screenshot of each anchor under
// tests/primer/evidence/. Ordinary test runs never call this; they read the recorded file.
//   node tests/primer/capture-slot-evidence.mjs
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = join(ROOT, "tests/primer/slot-evidence.json");
const SHOTS = join(ROOT, "tests/primer/evidence");

export const PAGES = [
  { url: "https://github.com/whoisaldo", kind: "reference profile 1" },
  { url: "https://github.com/Alitleis123", kind: "reference profile 2" },
  { url: "https://github.com/torvalds", kind: "reference profile 3" },
  { url: "https://github.com/ghost", kind: "profile without public repositories" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin", kind: "repository" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin/blob/main/README.md", kind: "file view" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin/commit/46c0e6f", kind: "diff" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin/issues", kind: "issue list" },
  { url: "https://gist.github.com/octocat/6cad326836d38bd3a7ae", kind: "gist" },
  { url: "https://github.com/whoisaldo/this-page-does-not-exist-reskin-qa", kind: "404" },
];

const bundle = (await build({ entryPoints: [join(ROOT, "extension/content/github/index.js")], bundle: true, format: "iife", globalName: "ReskinGitHub", write: false, platform: "browser" })).outputFiles[0].text;

const date = new Date().toISOString().slice(0, 10);
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch();
// Extension content scripts run outside the page CSP; bypassCSP lets the injected adapter do the same.
const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 }, colorScheme: "light", bypassCSP: true });
const pages = [];
const slots = {};
for (const { url, kind } of PAGES) {
  const page = await context.newPage();
  const response = await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.addScriptTag({ content: bundle });
  const found = await page.evaluate(() => {
    const G = globalThis.ReskinGitHub;
    const route = G.classifyRoute(document);
    const anchors = G.locateSlots(document, route);
    const describe = (el) => {
      const parts = [];
      for (let n = el; n && n.tagName !== "MAIN" && parts.length < 6; n = n.parentElement) {
        const id = n.id && !/\d{3,}|[A-Z0-9]{6,}_/.test(n.id) ? `#${n.id}` : "";
        const testid = n.getAttribute("data-testid") ? `[data-testid=${n.getAttribute("data-testid")}]` : "";
        const component = n.getAttribute("data-component") ? `[data-component=${n.getAttribute("data-component")}]` : "";
        parts.unshift(`${n.tagName.toLowerCase()}${id}${testid}${component}`);
      }
      return `main > … > ${parts.join(" > ")}`;
    };
    // Every candidate a slot's scope matches on this page, with the guard's verdict.
    const candidates = G.SLOTS.flatMap((def) => [...document.querySelectorAll(def.scope)].map((el) => ({ slot: def.slot, status: def.status, path: describe(el), reason: def.route === route ? G.rejectReason(def, el) : `route is ${route}, not ${def.route}` })));
    for (const [i, a] of anchors.entries()) a.host.setAttribute("data-reskin-evidence", String(i));
    return {
      route,
      lang: document.documentElement.lang,
      title: document.title.replace(/^.*? · /, "… · "),
      islands: [...document.querySelectorAll("[data-color-mode]")].map((e) => `${e.tagName.toLowerCase()}[data-color-mode=${e.getAttribute("data-color-mode")}]${e.hasAttribute("data-light-theme") ? `[data-light-theme=${e.getAttribute("data-light-theme")}]` : ""}${e.hasAttribute("data-dark-theme") ? `[data-dark-theme=${e.getAttribute("data-dark-theme")}]` : ""}`),
      anchors: anchors.map((a, i) => ({ index: i, slot: a.slot, insert: a.insert, nativeSignature: a.nativeSignature, host: describe(a.host), authored: G.insideAuthored(a.host), interactive: G.insideInteractive(a.insert === "append" ? a.host : a.host.parentElement) })),
      candidates,
    };
  });
  for (const a of found.anchors) {
    const file = `${a.slot}.png`;
    if (!slots[a.slot]) {
      const host = page.locator(`[data-reskin-evidence="${a.index}"]`);
      await host.scrollIntoViewIfNeeded();
      const box = await host.boundingBox();
      if (box) await page.screenshot({ path: join(SHOTS, file), clip: { x: Math.max(box.x, 0), y: Math.max(box.y, 0), width: Math.min(box.width, 640), height: Math.min(box.height, 240) } });
      slots[a.slot] = { status: "enabled", date, route: found.route, url, insert: a.insert, host: a.host, nativeSignature: a.nativeSignature, screenshot: box ? `tests/primer/evidence/${file}` : null, alsoSeenOn: [] };
    } else slots[a.slot].alsoSeenOn.push(url);
  }
  pages.push({ url, kind, status: response.status(), date, ...found, anchors: found.anchors.map(({ index, ...a }) => a) });
  await page.close();
}
await browser.close();

// Dormant slots: the reason, and every live candidate the guards refused.
const { SLOTS } = await import("../../extension/content/github/selectors.js");
for (const def of SLOTS) {
  if (def.status === "enabled" && !slots[def.slot]) throw new Error(`${def.slot} is enabled but no reference page gave it an anchor`);
  if (def.status === "enabled") continue;
  const refused = pages.flatMap((p) => p.candidates.filter((c) => c.slot === def.slot).map((c) => ({ url: p.url, host: c.path, reason: c.reason ?? "dormant in the adapter" })));
  slots[def.slot] = { status: "dormant", date, reason: def.dormant, refused };
}

const evidence = {
  version: 1,
  captured: date,
  method: "tests/primer/capture-slot-evidence.mjs: logged-out Chromium, en-US, 1280x900, the shipped extension/content/github adapter injected after load (CSP bypassed, as for a content script). Nothing was signed in, clicked, starred or followed.",
  slots,
  pages,
};
await writeFile(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
const enabled = Object.keys(slots).filter((k) => slots[k].status === "enabled");
console.log(`${enabled.length} slots with live anchors: ${enabled.join(", ")}; dormant: ${Object.keys(slots).filter((k) => slots[k].status !== "enabled").join(", ") || "none"}`);
for (const p of pages) console.log(`${p.status} ${p.route.padEnd(10)} ${p.anchors.length} anchors  ${p.url}`);
