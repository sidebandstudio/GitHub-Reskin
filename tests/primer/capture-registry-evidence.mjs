// Maintenance only, networked: runs the shipped admission runtime (startAdmission with the
// registry) and the slot candidates in a fresh logged-out Chromium against public GitHub pages,
// and records what it admits and why it refuses the rest in tests/primer/registry-evidence.json,
// with a cropped screenshot of each proposed slot under tests/primer/evidence/. Ordinary test
// runs never call this; they read the recorded file.
//   node tests/primer/capture-registry-evidence.mjs
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const OUT = join(ROOT, "tests/primer/registry-evidence.json");
const SHOTS = join(ROOT, "tests/primer/evidence");
// The modes a dark-base theme covers in the frozen index: GitHub's standard light, dark and dimmed.
const MODES = ["light", "dark", "dark_dimmed"];

export const PAGES = [
  { url: "https://github.com/whoisaldo", kind: "profile" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin", kind: "repository overview" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin/blob/main/README.md", kind: "file view" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin/pull/5/files", kind: "pull request diff" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin/commit/46c0e6f", kind: "commit diff" },
  { url: "https://github.com/whoisaldo/this-page-does-not-exist-reskin-qa", kind: "404" },
  { url: "https://github.com/", kind: "home" },
  { url: "https://github.com/features", kind: "features" },
  { url: "https://github.com/pricing", kind: "pricing" },
  { url: "https://github.com/sponsors", kind: "sponsors" },
  { url: "https://gist.github.com/octocat/6cad326836d38bd3a7ae", kind: "gist" },
  { url: "https://github.com/login", kind: "sign-in (protected route)" },
  { url: "https://github.com/sidebandstudio/GitHub-Reskin/issues", kind: "issue list" },
];

const bundle = (await build({ entryPoints: [join(ROOT, "extension/content/github/index.js")], bundle: true, format: "iife", globalName: "ReskinGitHub", write: false, platform: "browser" })).outputFiles[0].text;

const date = new Date().toISOString().slice(0, 10);
const browser = await chromium.launch();
const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 }, colorScheme: "dark", bypassCSP: true });
const pages = [];
const candidates = {};
for (const { url, kind } of PAGES) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await page.addScriptTag({ content: bundle });
  const found = await page.evaluate(async (modes) => {
    const G = globalThis.ReskinGitHub;
    const events = [];
    const handle = G.startAdmission(document, { modes, onEvent: (e) => events.push(e) });
    for (let i = 0; i < 20 && handle.state().pending; i++) await new Promise((r) => requestAnimationFrame(r));
    const state = handle.state();
    // The structure of every admitted subject: element, classes and the registry predicates only.
    const shape = (el) => ({
      element: el.tagName.toLowerCase(),
      classes: [...el.classList].filter((c) => !/__|^prc-|^tmp-|\d{3,}/.test(c)).sort(),
      attributes: Object.fromEntries(["role", "aria-current", "data-testid", "data-component", "aria-label"].filter((a) => el.hasAttribute(a)).map((a) => [a, el.getAttribute(a)])),
      descendants: el.getElementsByTagName("*").length,
    });
    const admitted = {};
    for (const el of document.querySelectorAll("[data-reskin-css-kind]")) {
      const def = G.HOST_SUBJECTS.find((s) => el.matches(s.select));
      const entry = (admitted[def.id] ??= { kind: def.kind, count: 0, example: shape(el) });
      entry.count++;
    }
    const refused = {};
    for (const def of G.HOST_SUBJECTS) {
      const els = [...document.querySelectorAll(def.select)].filter((el) => !el.hasAttribute("data-reskin-css-kind"));
      if (els.length) refused[def.id] = { count: els.length, reasons: [...new Set(els.map((el) => handle.explain(el)))], example: shape(els[0]) };
    }
    const protectedCount = document.querySelectorAll("[data-reskin-protected]").length;
    const layers = [...document.querySelectorAll(G.BLOCKING)].filter((el) => !el.closest("[hidden],dialog:not([open]),details:not([open]) > :not(summary),[popover]:not(:popover-open)") && (el.localName !== "dialog" || el.open)).map((el) => el.outerHTML.replace(/\s+/g, " ").slice(0, 120));
    const slotCandidates = G.CANDIDATE_SLOTS.map((def) => {
      const els = [...document.querySelectorAll(def.scope)].filter((el) => def.text === null || def.text.some((t) => (typeof t === "string" ? G.ownText(el) === t : t.test(G.ownText(el)))));
      // The region the owned node would join: the insertion parent, for the screenshot.
      const parent = els[0] && (def.host === "parent" ? els[0].parentElement : els[0]).parentElement;
      const box = parent?.getBoundingClientRect();
      const clip = box && box.width && box.height ? { x: Math.max(0, box.x - 8), y: Math.max(0, box.y + window.scrollY - 8), width: box.width + 16, height: Math.min(box.height + 16, 400) } : null;
      return { slot: def.slot, status: def.status, matches: els.length, clip, reasons: els.map((el) => (def.route === state.route ? G.rejectReason(def, el) : `route is ${state.route}`)), outer: els[0] ? els[0].outerHTML.replace(/\s+/g, " ").replace(/href="[^"]*"/g, 'href="…"').slice(0, 240) : null };
    });
    handle.dispose();
    return { state, admitted, refused, protectedCount, layers, slotCandidates, events: events.map((e) => e.type) };
  }, MODES);
  pages.push({ url, kind, status: (await page.evaluate(() => document.title)).slice(0, 80), route: found.state.route, gate: found.state.gate, scope: found.state.scope, reason: found.state.reason, admitted: found.admitted, refused: found.refused, protected: found.protectedCount, layers: found.layers });
  for (const c of found.slotCandidates) {
    const record = (candidates[c.slot] ??= { status: c.status, seen: [] });
    if (c.matches) record.seen.push({ url, route: found.state.route, matches: c.matches, reasons: c.reasons, outer: c.outer });
    if (c.status === "proposed" && c.matches === 1 && c.reasons[0] === null && !record.screenshot) {
      const shot = `tests/primer/evidence/${c.slot}.png`;
      await page.screenshot({ path: join(SHOTS, `${c.slot}.png`), clip: c.clip, fullPage: true });
      Object.assign(record, { date, url, screenshot: shot });
    }
  }
  await page.close();
}
await browser.close();
const evidence = {
  version: 1,
  captured: date,
  method: "tests/primer/capture-registry-evidence.mjs: logged-out Chromium, en-US, 1280x900, dark system scheme, the shipped extension/content/github adapter injected after load (CSP bypassed, as for a content script), startAdmission with the dark-base plan's modes light, dark and dark_dimmed. Nothing was signed in, clicked, starred or followed.",
  pages,
  slotCandidates: candidates,
};
await writeFile(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Wrote ${OUT}`);
for (const p of pages) console.log(`${p.kind.padEnd(26)} ${p.route.padEnd(11)} gate=${p.gate} scope=${p.scope} ${p.reason} admitted=${Object.entries(p.admitted).map(([k, v]) => `${k}:${v.count}`).join(" ")} refused=${Object.entries(p.refused).map(([k, v]) => `${k}:${v.count}(${v.reasons.join("/")})`).join(" ")}`);
