// Active-workload traces for the structured appearance, in Chromium and Firefox. Run after building
// the fixture app (npm run test:e2e -- --project=fixture-chromium builds it):
//   node tests/fixture-app/product/trace.mjs [--out report.json] [--theme choom.reskin.json]
// The adversarial GitHub-like page grows a 10,000-line diff with 2,000 added and 2,000 removed lines
// and a 53x7 full-year graph with its legend, then each measurement runs natively and with the
// theme's maximum structured background: four gradient layers on the page and four on the header.
// Raster wallpaper is not admitted in this increment, so it is not in the set.
//
// Measured per engine, native and themed: scroll frame intervals, diff expansion, year change and
// theme change flushes (style and layout forced synchronously), long tasks where the engine reports
// them, and owned nodes and style nodes left after repeated apply/remove cycles. Chromium also
// reports main-thread task time per scroll frame from the DevTools protocol, at normal speed and at
// a 4x CPU slowdown, and the JS heap. The preview runs 50 edits 100 ms apart, then a burst that
// cancels obsolete jobs, and reports completion latency and frames left behind.
import { readFile, writeFile } from "node:fs/promises";
import { loadavg, cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, firefox } from "@playwright/test";
import { serve } from "../../../scripts/serve.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const { values } = parseArgs({
  options: {
    out: { type: "string" },
    theme: { type: "string", default: join(ROOT, "tests/appearance/fixtures/choom-circuit.reskin.json") },
    app: { type: "string", default: join(ROOT, "dist/fixture/product") },
  },
});
const PREFS = { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true };
const choom = JSON.parse(await readFile(values.theme, "utf8"));
// The control: the same theme with solid paints, so the layers' own cost shows against it.
// The maximum structured set: the header gets four layers too, the rule plus the page's grid and scanlines.
const solid = { ...choom, name: `${choom.name} solid`, backgrounds: { page: { color: choom.backgrounds.page.color }, header: { color: choom.backgrounds.header.color } } };
const max = { ...choom, name: `${choom.name} max`, backgrounds: { ...choom.backgrounds, header: { ...choom.backgrounds.header, layers: [choom.backgrounds.header.layers[0], ...choom.backgrounds.page.layers.slice(1)] } } };

const stats = (list) => {
  const s = [...list].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.ceil(s.length * q) - 1)];
  const round = (n) => Math.round(n * 100) / 100;
  return { n: s.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(s.at(-1)) };
};

// In the page: the workload, then the measurements.
function grow() {
  const main = document.querySelector("main");
  const box = document.createElement("div");
  box.className = "Box";
  box.innerHTML = '<div class="Box-header file-header"><strong>src/large.js</strong></div><table class="diff-table" aria-label="Large diff"><tbody></tbody></table>';
  const body = box.querySelector("tbody");
  const rows = (start, count) => {
    const frag = document.createDocumentFragment();
    for (let i = start; i < start + count; i++) {
      const kind = i % 5 === 1 ? "addition" : i % 5 === 3 ? "deletion" : "context";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="blob-num">${i}</td><td class="blob-num">${i}</td><td class="blob-code blob-code-${kind}"><span class="pl-k">const</span> <span class="pl-v">line${i}</span> = <span class="pl-s">"value ${i}"</span>;</td>`;
      frag.append(tr);
    }
    return frag;
  };
  body.append(rows(0, 10000));
  main.append(box);
  window.traceRows = rows;
  window.traceBody = body;
  // 53 weeks of 7 days, the legend's five swatches and the activity overview.
  const grid = document.querySelector(".ContributionCalendar-grid");
  grid.replaceChildren(...Array.from({ length: 371 }, (_, i) => {
    const day = document.createElement("span");
    day.className = "ContributionCalendar-day";
    day.dataset.level = String((i * 7) % 5);
    return day;
  }));
  const legend = document.querySelector(".ContributionCalendar-legend");
  legend.replaceChildren(...[0, 1, 2, 3, 4].map((level) => {
    const swatch = document.createElement("span");
    swatch.className = "ContributionCalendar-day";
    swatch.dataset.level = String(level);
    return swatch;
  }));
  return { rows: document.querySelectorAll(".diff-table tr").length, days: grid.children.length, legend: legend.children.length, height: document.documentElement.scrollHeight };
}

async function measure(theme) {
  const flush = () => {
    document.body.offsetHeight;
    getComputedStyle(document.body).backgroundImage;
  };
  const longTasks = [];
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((e) => e.duration)));
    observer.observe({ type: "longtask", buffered: false });
  } catch {
    observer = null;
  }
  const out = {};
  const t0 = performance.now();
  if (theme) window.reskinNative.apply(theme, window.tracePrefs, { cssAllowed: true });
  flush();
  out.apply = performance.now() - t0;
  // Scroll: 180 frames, 600px a frame, through the whole document and back to the top.
  const frames = [];
  await new Promise((resolve) => {
    let last = performance.now();
    let n = 0;
    const step = (now) => {
      frames.push(now - last);
      last = now;
      window.scrollBy(0, 600);
      if (window.scrollY + innerHeight >= document.documentElement.scrollHeight - 1) window.scrollTo(0, 0);
      if (++n < 180) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(step);
    });
  });
  out.scroll = frames.slice(1);
  // Diff expansion: 500 more lines; year change: every day gets another level.
  out.expand = [];
  out.year = [];
  for (let i = 0; i < 10; i++) {
    let t = performance.now();
    window.traceBody.append(window.traceRows(10000 + i * 500, 500));
    flush();
    out.expand.push(performance.now() - t);
    t = performance.now();
    for (const day of document.querySelectorAll(".ContributionCalendar-grid .ContributionCalendar-day")) day.dataset.level = String((Number(day.dataset.level) + 1 + i) % 5);
    flush();
    out.year.push(performance.now() - t);
    await new Promise((r) => requestAnimationFrame(r));
  }
  // Back to the fixed 10,000 lines for the next run.
  while (window.traceBody.children.length > 10000) window.traceBody.lastElementChild.remove();
  observer?.disconnect();
  out.longTasks = longTasks;
  out.longTaskSupported = observer !== null;
  return out;
}

async function themeChanges(themes) {
  const flush = () => document.body.offsetHeight;
  const times = [];
  for (let i = 0; i < 20; i++) {
    for (const theme of themes) {
      const t = performance.now();
      window.reskinNative.apply(theme, window.tracePrefs, { cssAllowed: true });
      flush();
      times.push(performance.now() - t);
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.reskinNative.remove();
    flush();
  }
  return {
    times,
    retained: {
      styles: document.querySelectorAll("style[data-reskin-style]").length,
      owned: document.querySelectorAll("[data-reskin-owned]").length,
      scope: document.documentElement.hasAttribute("data-reskin-css"),
    },
  };
}

async function engine(type, launcher, url) {
  const browser = await launcher.launch();
  const version = browser.version();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(new URL("adversarial.html", url).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.evaluate((p) => (window.tracePrefs = p), PREFS);
  const fixture = await page.evaluate(grow);
  const cdp = type === "chromium" ? await page.context().newCDPSession(page) : null;
  if (cdp) await cdp.send("Performance.enable");
  const metrics = async () => (cdp ? Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value])) : null);

  const run = async (theme) => {
    const before = await metrics();
    const raw = await page.evaluate(measure, theme);
    const after = await metrics();
    const result = {
      apply: Math.round(raw.apply * 100) / 100,
      scroll: stats(raw.scroll),
      expand: stats(raw.expand),
      year: stats(raw.year),
      longTasks: raw.longTaskSupported ? { count: raw.longTasks.length, max: Math.max(0, ...raw.longTasks) } : "not reported by this engine",
    };
    if (before && after) {
      const frames = raw.scroll.length + 1;
      result.mainThreadPerFrameMs = Math.round(((after.TaskDuration - before.TaskDuration) * 1000 / frames) * 100) / 100;
      result.styleRecalcMs = Math.round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000 * 100) / 100;
      result.layoutMs = Math.round((after.LayoutDuration - before.LayoutDuration) * 1000 * 100) / 100;
      result.jsHeapMiB = Math.round((after.JSHeapUsedSize / 1048576) * 10) / 10;
    }
    if (theme) await page.evaluate(() => window.reskinNative.remove());
    return result;
  };

  const report = { version, fixture };
  for (const rate of cdp ? [1, 4] : [1]) {
    if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const key = rate === 1 ? "normal" : "cpu4x";
    report[key] = { native: await run(null), solid: await run(solid), themed: await run(max) };
    if (cdp) {
      const n = report[key].native.mainThreadPerFrameMs;
      const t = report[key].themed.mainThreadPerFrameMs;
      report[key].attributablePerFrameMs = Math.round((t - n) * 100) / 100;
      report[key].layersPerFrameMs = Math.round((t - report[key].solid.mainThreadPerFrameMs) * 100) / 100;
    }
    report[key].layersScrollDelta = { p95: Math.round((report[key].themed.scroll.p95 - report[key].solid.scroll.p95) * 100) / 100, p99: Math.round((report[key].themed.scroll.p99 - report[key].solid.scroll.p99) * 100) / 100 };
    report[key].scrollIntervalDelta = { p95: Math.round((report[key].themed.scroll.p95 - report[key].native.scroll.p95) * 100) / 100, p99: Math.round((report[key].themed.scroll.p99 - report[key].native.scroll.p99) * 100) / 100 };
  }
  if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const changes = await page.evaluate(themeChanges, [choom, max]);
  report.themeChanges = { ...stats(changes.times), retainedAfter20Cycles: changes.retained };

  // The preview: 50 edits 100 ms apart, then a burst of 20 that cancels all but the last.
  const preview = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await preview.goto(new URL("preview.html", url).href);
  const result = await preview.evaluate(
    async ({ theme, prefs }) => {
      window.reskinPreview.mount({ view: "profile", theme, preferences: prefs, cssAllowed: true });
      const element = document.querySelector("[data-reskin-preview]");
      const settle = () => new Promise((resolve) => element.addEventListener("reskin-preview-complete", (event) => resolve(event.detail.ms), { once: true }));
      await settle();
      const times = [];
      for (let i = 0; i < 50; i++) {
        const done = settle();
        const accent = `#${(0x40 + ((i * 37) % 0xa0)).toString(16)}${(0x60 + ((i * 53) % 0x90)).toString(16)}0a`;
        window.reskinPreview.update({ theme: { ...theme, colors: { ...theme.colors, accent } }, preferences: prefs, cssAllowed: true });
        times.push(await done);
        await new Promise((r) => setTimeout(r, 100));
      }
      const done = settle();
      for (let i = 0; i < 20; i++) window.reskinPreview.update({ theme, preferences: { ...prefs, extras: i % 2 === 0 }, cssAllowed: true });
      const burst = await done;
      await new Promise((r) => setTimeout(r, 300));
      return { times, burst, frames: document.querySelectorAll("#preview iframe").length };
    },
    { theme: choom, prefs: PREFS },
  );
  report.preview = { edits: stats(result.times), burstCompletionMs: result.burst, framesAfter: result.frames };
  await browser.close();
  return report;
}

const server = await serve({ root: values.app, host: "127.0.0.1" });
const report = {
  machine: { cpu: cpus()[0].model, cores: cpus().length, loadBefore: loadavg().map((n) => Math.round(n * 100) / 100) },
  theme: max.name,
  layers: { page: max.backgrounds.page.layers.length, header: max.backgrounds.header.layers.length },
};
try {
  report.chromium = await engine("chromium", chromium, server.url);
  report.firefox = await engine("firefox", firefox, server.url);
} finally {
  await server.close();
}
report.machine.loadAfter = loadavg().map((n) => Math.round(n * 100) / 100);
const text = JSON.stringify(report, null, 2);
if (values.out) await writeFile(values.out, `${text}\n`);
console.log(text);
