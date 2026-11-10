// Chromium timings of the installed extension, for check:budgets: settings to style (a theme
// commit from the popup until the GitHub tab's computed colors change), the longest task that runs
// extension code, from a DevTools trace of loading the tab and the popup and switching themes, and
// over 30 idle seconds the CPU time of the tab's main thread and of the extension's own process,
// which must run no timer or animation. The same switches and the preview's resolve are also
// reported at a 4x CPU slowdown, which no budget gates. Each trace is saved with the timings.
import { CHOOM, CHOOM_CANVAS, expect, openPage, PROFILE_URL, painted, test, waitPainted } from "../extension/helpers.mjs";
import { catalogThemes, FIXTURE, record, resolvePage, saveTrace, summary, timeResolves } from "./helpers.mjs";

const OTHER = "dracula";
const SWITCHES = 40;

// Tracing covers the whole browser. The disabled-by-default timeline categories make every task
// several milliseconds longer, so they stay off.
const startTrace = (cdp) =>
  cdp.send("Tracing.start", {
    transferMode: "ReturnAsStream",
    traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: ["toplevel", "devtools.timeline"] },
  });

/** A GitHub profile tab, with a DevTools session on it, once the lifecycle has painted it. */
async function openTab(extension, { trace = false } = {}) {
  const page = await extension.context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const cdp = await extension.context.newCDPSession(page);
  if (trace) await startTrace(cdp);
  await page.goto(PROFILE_URL);
  await waitPainted(page, (now) => now.boot === "ready" && now.styled);
  return { page, cdp };
}

/** Commits selectTheme from an extension page and returns the time just before the commit was sent. */
const select = (popup, id) =>
  popup.evaluate(async (id) => {
    const got = await chrome.runtime.sendMessage({ type: "get", requestId: "release-get" });
    const sent = Date.now();
    const reply = await chrome.runtime.sendMessage({ type: "commit", requestId: `release-commit-${sent}`, expectedRevision: got.settings.revision, action: { type: "selectTheme", id } });
    if (!reply.ok) throw new Error(`selectTheme ${id} failed: ${JSON.stringify(reply)}`);
    return sent;
  }, id);

/** Resolves with the time the tab's computed canvas first equals `canvas` after a DOM change. */
const arm = (page, canvas) =>
  page.evaluate((canvas) => {
    window.__styled = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim() !== canvas) return;
        observer.disconnect();
        resolve(Date.now());
      });
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
  }, canvas);

/** Switches between Choom Circuit and Dracula `count` times and returns each settings-to-style time. */
async function switches(page, popup, count) {
  await select(popup, OTHER);
  const other = (await waitPainted(page, (now) => now.canvas && now.canvas !== CHOOM_CANVAS)).canvas;
  await select(popup, CHOOM);
  await waitPainted(page, (now) => now.canvas === CHOOM_CANVAS);
  const canvas = { [CHOOM]: CHOOM_CANVAS, [OTHER]: other };
  const times = [];
  for (let i = 0; i < count; i++) {
    const id = i % 2 ? CHOOM : OTHER;
    await arm(page, canvas[id]);
    const sent = await select(popup, id);
    times.push((await page.evaluate(() => window.__styled)) - sent);
    await page.waitForTimeout(100);
  }
  return times;
}

const version = async (cdp) => (await cdp.send("Browser.getVersion")).product;

/** Reads a finished DevTools trace from its stream. */
async function readTrace(cdp) {
  const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  const { stream } = await complete;
  const chunks = [];
  for (;;) {
    const { data, eof, base64Encoded } = await cdp.send("IO.read", { handle: stream, size: 1 << 22 });
    chunks.push(base64Encoded ? Buffer.from(data, "base64").toString("utf8") : data);
    if (eof) break;
  }
  await cdp.send("IO.close", { handle: stream });
  const trace = JSON.parse(chunks.join(""));
  return Array.isArray(trace) ? trace : trace.traceEvents;
}

// Chromium records each task as ThreadControllerImpl::RunTask, older builds as RunTask, and some
// builds as both, nested; the longest is the same either way.
const TASKS = new Set(["RunTask", "ThreadControllerImpl::RunTask"]);
const thread = (event) => `${event.pid}:${event.tid}`;
// Chromium names the process that holds the extension's pages and service worker.
const extensionProcesses = (events) => new Set(events.filter((e) => e.ph === "M" && e.name === "process_name" && e.args?.name === "Extension Renderer").map((e) => e.pid));

/**
 * The tasks that ran extension code: every task on the main thread of a process showing an
 * extension page, and any other task during which a script of the extension ran on its thread.
 * Returns their count and the longest one in milliseconds.
 */
export function extensionTasks(events, id) {
  const origin = `chrome-extension://${id}/`;
  const main = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain").map(thread));
  // Frame records name the extension's process too when traced.
  const pages = extensionProcesses(events);
  for (const event of events) {
    const data = event.args?.data;
    for (const frame of [data, ...(data?.frames ?? [])]) if (typeof frame?.url === "string" && frame.url.startsWith(origin) && frame.processId) pages.add(frame.processId);
  }
  const marks = new Map();
  for (const event of events) {
    const url = event.args?.data?.url ?? event.args?.data?.stackTrace?.[0]?.url;
    if (typeof url === "string" && url.startsWith(origin)) (marks.get(thread(event)) ?? marks.set(thread(event), []).get(thread(event))).push(event.ts);
  }
  let count = 0;
  let longest = 0;
  for (const task of events) {
    if (!TASKS.has(task.name) || task.ph !== "X" || !task.dur) continue;
    const own = (pages.has(task.pid) && main.has(thread(task))) || (marks.get(thread(task)) ?? []).some((ts) => ts >= task.ts && ts <= task.ts + task.dur);
    if (!own) continue;
    count++;
    longest = Math.max(longest, task.dur / 1000);
  }
  return { count, longest, extensionPageProcesses: pages.size, threadsWithExtensionScript: marks.size };
}

// What runs a timer or an animation frame callback.
const TIMERS = new Set(["TimerFire", "FireAnimationFrame", "FireIdleCallback"]);
// The extension process's threads that run its code: its pages' main thread and its workers.
const SCRIPT_THREADS = new Set(["CrRendererMain", "ServiceWorker thread", "DedicatedWorker thread"]);

/**
 * Extension work in an idle trace: every timer or animation frame callback for the tab's frame or
 * in the extension's process, and the CPU seconds of the top-level tasks on that process's main and
 * worker threads. Thread time, so a busy machine descheduling a task does not count as work; a task
 * Chromium recorded without thread time counts at its wall time.
 */
export function idleWork(events, frameId) {
  const processes = extensionProcesses(events);
  const threads = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && processes.has(e.pid) && SCRIPT_THREADS.has(e.args?.name)).map(thread));
  const timers = events.filter((e) => TIMERS.has(e.name) && (e.args?.data?.frame === frameId || processes.has(e.pid))).map((e) => `${e.name} on ${processes.has(e.pid) ? "the extension's process" : "the tab"}`);
  const tasks = events.filter((e) => TASKS.has(e.name) && e.ph === "X" && threads.has(thread(e))).sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const ends = new Map();
  let micros = 0;
  for (const task of tasks) {
    // A task inside the one before it on its thread is nested and already counted.
    if (task.ts < (ends.get(thread(task)) ?? -Infinity)) continue;
    ends.set(thread(task), task.ts + (task.dur ?? 0));
    micros += task.tdur ?? task.dur ?? 0;
  }
  return { timers, extensionProcesses: processes.size, extensionSeconds: micros / 1e6 };
}

test("settings reach a GitHub tab's style, and no task that runs extension code takes 50 ms, timed for the release budget", async ({ extension }, info) => {
  test.setTimeout(180000);
  const { page, cdp } = await openTab(extension, { trace: true });
  const popup = await openPage(extension, "popup");
  const times = await switches(page, popup, SWITCHES);
  const events = await readTrace(cdp);
  const tasks = extensionTasks(events, extension.id);
  expect(times).toHaveLength(SWITCHES);
  // The trace saw the extension: its pages' process and its content script on the tab.
  expect(tasks.extensionPageProcesses).toBeGreaterThan(0);
  expect(tasks.threadsWithExtensionScript).toBeGreaterThan(0);
  expect(tasks.count).toBeGreaterThan(SWITCHES);
  const result = summary(times);
  const trace = await saveTrace(info, "settings", events);
  await record(info, "settings", { settingsToStyleP95Ms: result.p95, settingsToStyle: result, longestTaskMs: tasks.longest, extensionTasks: tasks.count, trace, fixture: FIXTURE }, await version(cdp));
});

test("at a 4x CPU slowdown, settings to style and the preview's resolve are reported", async ({ extension, serveDir }, info) => {
  test.setTimeout(180000);
  const { page, cdp } = await openTab(extension);
  const popup = await openPage(extension, "popup");
  const popupCdp = await extension.context.newCDPSession(popup);
  for (const session of [cdp, popupCdp]) await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const times = await switches(page, popup, 20);
  const resolver = await resolvePage(serveDir);
  try {
    const blank = await extension.context.newPage();
    await blank.goto(resolver.url);
    await (await extension.context.newCDPSession(blank)).send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const resolves = await timeResolves(blank, await catalogThemes());
    await record(info, "slowdown", { slowdown4x: { settingsToStyle: summary(times), previewResolve: summary(resolves) } }, await version(cdp));
  } finally {
    await resolver.cleanup();
  }
});

test("a themed GitHub tab left idle for 30 s runs no extension timer or animation and spends at most a sliver of one core on the extension, measured for the release budget", async ({ extension }, info) => {
  test.setTimeout(120000);
  const { page, cdp } = await openTab(extension);
  // Settle first: fonts, decorations and the boot attribute's last writes.
  await page.waitForTimeout(3000);
  const frameId = (await cdp.send("Page.getFrameTree")).frameTree.frame.id;
  // The tab's main thread in thread time, which counts the content script and the page alike.
  await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  await startTrace(cdp);
  const before = await metric();
  await page.waitForTimeout(30000);
  const after = await metric();
  const events = await readTrace(cdp);
  const work = idleWork(events, frameId);
  const seconds = after.Timestamp - before.Timestamp;
  const tab = after.TaskDuration - before.TaskDuration;
  expect(seconds).toBeGreaterThan(29);
  expect((await painted(page)).boot).toBe("ready");
  expect(work.extensionProcesses).toBeGreaterThan(0);
  expect(work.timers, "timers or animation frames while idle").toEqual([]);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length), "running animations").toBe(0);
  const trace = await saveTrace(info, "idle", events);
  const idle = { seconds, tabSeconds: tab, extensionSeconds: work.extensionSeconds, scriptSeconds: after.ScriptDuration - before.ScriptDuration, layouts: after.LayoutCount - before.LayoutCount, styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount };
  await record(info, "idle", { idleCpuPercent: ((tab + work.extensionSeconds) / seconds) * 100, idle, trace, fixture: FIXTURE }, await version(cdp));
});
