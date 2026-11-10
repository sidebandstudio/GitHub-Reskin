// Chromium timings of the installed extension, for check:budgets: settings to style (a theme
// commit from the popup until the GitHub tab's computed colors change), the longest task that runs
// extension code, from a DevTools trace of loading the tab and the popup and switching themes, and
// the tab's main-thread time over 30 idle seconds. The same switches and the preview's resolve are
// also reported at a 4x CPU slowdown, which no budget gates.
import { CHOOM, CHOOM_CANVAS, expect, openPage, PROFILE_URL, painted, test, waitPainted } from "../extension/helpers.mjs";
import { catalogThemes, record, resolvePage, summary, timeResolves } from "./helpers.mjs";

const OTHER = "dracula";
const SWITCHES = 40;

/** A GitHub profile tab, with a DevTools session on it, once the lifecycle has painted it. */
async function openTab(extension, { trace = false } = {}) {
  const page = await extension.context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const cdp = await extension.context.newCDPSession(page);
  if (trace) {
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: ["toplevel", "devtools.timeline"] },
    });
  }
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

/**
 * The tasks that ran extension code: every task on the main thread of a process showing an
 * extension page, and any other task during which a script of the extension ran on its thread.
 * Returns their count and the longest one in milliseconds.
 */
export function extensionTasks(events, id) {
  const origin = `chrome-extension://${id}/`;
  const thread = (event) => `${event.pid}:${event.tid}`;
  const main = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain").map(thread));
  // Chromium names the process that holds extension pages; frame records name it too when traced.
  const pages = new Set(events.filter((e) => e.ph === "M" && e.name === "process_name" && e.args?.name === "Extension Renderer").map((e) => e.pid));
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
  await record(info, "settings", { settingsToStyleP95Ms: result.p95, settingsToStyle: result, longestTaskMs: tasks.longest, extensionTasks: tasks.count }, await version(cdp));
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

test("a themed GitHub tab left idle for 30 s spends at most a sliver of one core, measured for the release budget", async ({ extension }, info) => {
  test.setTimeout(120000);
  const { page, cdp } = await openTab(extension);
  // Settle first: fonts, decorations and the boot attribute's last writes.
  await page.waitForTimeout(3000);
  await cdp.send("Performance.enable");
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const before = await metric();
  await page.waitForTimeout(30000);
  const after = await metric();
  const seconds = after.Timestamp - before.Timestamp;
  const busy = after.TaskDuration - before.TaskDuration;
  expect(seconds).toBeGreaterThan(29);
  expect((await painted(page)).boot).toBe("ready");
  await record(info, "idle", { idleCpuPercent: (busy / seconds) * 100, idle: { seconds, taskSeconds: busy, scriptSeconds: after.ScriptDuration - before.ScriptDuration, layouts: after.LayoutCount - before.LayoutCount, styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount } }, await version(cdp));
});
