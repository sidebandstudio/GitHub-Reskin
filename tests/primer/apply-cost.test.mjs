// The cost of applying the Primer stylesheet to a large page in Chromium and Firefox: the fixed
// 10,000-line diff with 2,000 added and 2,000 deleted lines, a 53x7 contribution calendar with
// its five legend swatches and the activity overview, with GitHub's own box and button geometry
// and color scheme. Each sample inserts the stylesheet and flushes style and layout in one task.
//
// Any change to an inherited custom property on the root restyles every element, so a stylesheet
// that sets one variable is the control. The Primer stylesheet's own matching, beyond that
// restyle, must stay a small multiple of it and under 50 ms; the absolute times are printed for
// the record, with the machine's load.
import assert from "node:assert/strict";
import { loadavg } from "node:os";
import { after, before, describe, test } from "node:test";
import { chromium, firefox } from "playwright";
import { compileGitHub, MODE_INDEX } from "../../packages/primer/index.js";
import { PREFS, resolvedFromSeed } from "./helpers.mjs";

// GitHub's dark mode with the Primer geometry the diff view reads, and a profile's graph.
const PAGE = `<!doctype html><html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head><title>Large diff</title>
<style>:root{color-scheme:dark}.Box{border:1px solid #3d444d;border-radius:6px}.btn{border:1px solid #3d444d;border-radius:6px}</style></head>
<body><main>
<div class="js-yearly-contributions"><div class="js-calendar-graph"><table class="ContributionCalendar-grid"><tbody id="grid"></tbody></table><div class="ContributionCalendar-legend" id="legend"></div></div>
<div class="activity-overview-box"><svg class="js-activity-overview-graph" width="100" height="100"><path class="js-highlight-blob" d="M0 0h10v10z"/><ellipse class="activity-overview-point" rx="3" ry="3"/></svg></div></div>
<div class="Box"><div class="Box-header file-header"><strong>src/large.js</strong> <button class="btn">View file</button></div><table class="diff-table" aria-label="Large diff"><tbody id="diff"></tbody></table></div>
</main></body></html>`;

function grow() {
  const rows = [];
  for (let i = 0; i < 10000; i++) {
    const kind = i % 5 === 1 ? "addition" : i % 5 === 3 ? "deletion" : "context";
    rows.push(`<tr><td class="blob-num">${i}</td><td class="blob-num">${i}</td><td class="blob-code blob-code-${kind}"><span class="pl-k">const</span> <span class="pl-v">line${i}</span> = <span class="pl-s">"value ${i}"</span>;</td></tr>`);
  }
  document.getElementById("diff").innerHTML = rows.join("");
  const weeks = [];
  for (let d = 0; d < 7; d++) weeks.push(`<tr>${Array.from({ length: 53 }, (_, w) => `<td class="ContributionCalendar-day" data-level="${(w * 7 + d) % 5}"></td>`).join("")}</tr>`);
  document.getElementById("grid").innerHTML = weeks.join("");
  document.getElementById("legend").innerHTML = [0, 1, 2, 3, 4].map((l) => `<div class="ContributionCalendar-day" data-level="${l}"></div>`).join("");
  return {
    elements: document.getElementsByTagName("*").length,
    additions: document.querySelectorAll(".blob-code-addition").length,
    deletions: document.querySelectorAll(".blob-code-deletion").length,
    days: document.querySelectorAll("#grid .ContributionCalendar-day").length,
  };
}

// Every structured rule kind at once: bevelled corners, borders, a glow, buttons, cell glow,
// labels, topics, the scrollbar and selection.
const resolved = resolvedFromSeed(MODE_INDEX.modes.dark);
resolved.appearance = {
  ...resolved.appearance,
  shape: { corners: { style: "bevel", radius: 12 }, borders: { width: 1, style: "solid", color: "#2d2a52" }, shadows: { style: "glow", color: "#fcee0a", opacity: 0.6, blur: 14, offset: 0 }, buttons: { style: "bevel", radius: 8 }, avatar: null },
  graph: { cellStyle: "glow", cellRadius: 1, glow: { levels: [1, 2, 3, 4], radius: 9, opacity: 0.85, color: null } },
  details: { scrollbarWidth: "thin", labels: { style: "bevel" }, topics: { style: "bevel" } },
};
const SHEETS = {
  control: ":root{--reskin-control:1}",
  full: compileGitHub(resolved, { seedMode: "dark", policy: "themed" }, { ...PREFS, appearance: "full" }).css,
  calm: compileGitHub(resolved, { seedMode: "dark", policy: "themed" }, { ...PREFS, appearance: "calm" }).css,
};

async function measure(page, sheets) {
  return page.evaluate(async (sheets) => {
    const flush = () => {
      document.body.offsetHeight;
      getComputedStyle(document.body).color;
    };
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const out = Object.fromEntries(Object.keys(sheets).map((k) => [k, []]));
    // Interleaved, so machine load reaches every sheet alike; the first round warms up.
    for (let round = 0; round < 6; round++) {
      for (const [name, css] of Object.entries(sheets)) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        flush();
        await pause(20);
        const start = performance.now();
        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);
        flush();
        if (round) out[name].push(performance.now() - start);
        await pause(20);
        style.remove();
        flush();
      }
    }
    return out;
  }, sheets);
}
const median = (list) => [...list].sort((a, b) => a - b)[list.length >> 1];

for (const [name, engine] of [["Chromium", chromium], ["Firefox", firefox]]) {
  describe(`Primer apply cost in ${name}`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch();
    });
    after(async () => {
      await browser?.close();
    });

    test("applying the stylesheet to the large diff costs little beyond the restyle any root variable costs, in Full and Calm", async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
      await page.route("**/*", (r) => (r.request().url() === "https://github.com/octo/sample/pull/1/files" ? r.fulfill({ contentType: "text/html", body: PAGE }) : r.abort()));
      await page.goto("https://github.com/octo/sample/pull/1/files");
      const fixture = await page.evaluate(grow);
      assert.deepEqual([fixture.additions, fixture.deletions, fixture.days], [2000, 2000, 371]);
      const start = loadavg();
      const times = await measure(page, SHEETS);
      const m = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, median(v)]));
      console.log(`${name} ${browser.version()}: ${fixture.elements} elements; median control ${m.control.toFixed(1)} ms, Full ${m.full.toFixed(1)} ms, Calm ${m.calm.toFixed(1)} ms; samples ${JSON.stringify(Object.fromEntries(Object.entries(times).map(([k, v]) => [k, v.map((n) => Math.round(n))])))}; load ${start.map((n) => n.toFixed(1)).join("/")} to ${loadavg().map((n) => n.toFixed(1)).join("/")}`);
      for (const mode of ["full", "calm"]) {
        assert.ok(m[mode] - m.control < 50, `${mode}: ${m[mode].toFixed(1)} ms is more than 50 ms beyond the ${m.control.toFixed(1)} ms control`);
        assert.ok(m[mode] < 2.5 * m.control + 10, `${mode}: ${m[mode].toFixed(1)} ms is more than 2.5 times the ${m.control.toFixed(1)} ms control`);
      }
      await page.close();
    });
  });
}
