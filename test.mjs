import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { mix, render } from "./index.mjs";

const day = (date, weekday, contributionLevel) => ({ date, weekday, contributionLevel });
const LEVELS = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"];

// A made-up year: 53 weeks from a Sunday, quieter weekends, every level used.
function year() {
  const weeks = [];
  let totalContributions = 0;
  for (let i = 0; i < 365; i++) {
    const date = new Date(Date.UTC(2025, 10, 2) + i * 864e5).toISOString().slice(0, 10);
    const weekday = i % 7;
    const level = ((i * 37 + (i >> 4) * 5) % (weekday % 6 ? 6 : 11)) % 5;
    totalContributions += level * 3;
    if (weekday === 0) weeks.push({ contributionDays: [] });
    weeks.at(-1).contributionDays.push(day(date, weekday, LEVELS[level]));
  }
  return { totalContributions, weeks };
}

// The fixtures were drawn from year() by index.mjs before it had styles.
const fixture = (name) => readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");

// Runs index.mjs against a local stand-in for the GraphQL API that serves year().
async function cli(args, env = {}) {
  const calendar = year();
  const server = createServer((req, res) =>
    res.end(JSON.stringify({ data: { user: { contributionsCollection: { contributionCalendar: calendar } } } })),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = await mkdtemp(join(tmpdir(), "reskin-"));
  const output = join(dir, "contributions.svg");
  try {
    await promisify(execFile)(process.execPath, ["index.mjs", "--username", "you", "--token", "x", "--output", output, ...args], {
      cwd: import.meta.dirname,
      env: { ...process.env, GITHUB_GRAPHQL_URL: `http://127.0.0.1:${server.address().port}`, ...env },
    });
    return await readFile(output, "utf8");
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

// Checks that every tag closes in order. The SVG has no comments, CDATA or entities to trip this up.
function assertWellFormed(svg) {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" [^>]*>\n[\s\S]*<\/svg>\n$/);
  const open = [];
  for (const [, close, name, self] of svg.matchAll(/<(\/?)([\w:-]+)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (close) assert.equal(open.pop(), name);
    else if (!self) open.push(name);
  }
  assert.deepEqual(open, []);
  assert.doesNotMatch(svg.replace(/<[^<>]*>/g, ""), /[<>]/);
}

// GitHub shows README images through its image proxy, which allows nothing outside the file.
function assertSelfContained(svg) {
  assert.equal(svg.match(/https?:/g).length, 1, "only the xmlns may name a URL");
  assert.doesNotMatch(svg, /href|@import|<script|<image|<foreignObject|\son\w+=/i);
  for (const [ref] of svg.matchAll(/url\([^)]*\)/g)) assert.match(ref, /^url\(#[\w-]+\)$/);
}

test("draws one cell per day in its level's shade", () => {
  const calendar = {
    totalContributions: 1234,
    weeks: [
      { contributionDays: [day("2026-01-03", 6, "NONE")] },
      { contributionDays: [day("2026-01-04", 0, "FOURTH_QUARTILE"), day("2026-01-05", 1, "FIRST_QUARTILE")] },
    ],
  };
  const svg = render(calendar, { color: "#ff0000", background: "#000000", text: "#ffffff" });
  assert.match(svg, /1,234 contributions in the last year/);
  // 3 days plus 5 legend cells.
  assert.equal(svg.match(/class="day"/g).length, 8);
  assert.match(svg, /y="72" width="12" height="12" rx="2.5" fill="#ff0000"/);
  assert.match(svg, /y="87" width="12" height="12" rx="2.5" fill="#590000"/);
});

test("says contribution for a single one", () => {
  const svg = render({ totalContributions: 1, weeks: [{ contributionDays: [day("2026-01-04", 0, "FIRST_QUARTILE")] }] });
  assert.match(svg, />1 contribution in the last year</);
});

test("accepts colors without a hash and writes them with one", () => {
  const svg = render({ totalContributions: 0, weeks: [] }, { color: "FF0000", background: "000000", text: "FFFFFF" });
  assert.match(svg, /rx="12" fill="#000000"/);
  assert.match(svg, /fill="#ffffff" font-family/);
  assert.doesNotMatch(svg, /fill="[0-9a-f]{6}"/i);
});

test("mix blends hex colors", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#0a0a0b", "#f2a93b", 1), "#f2a93b");
  assert.throws(() => mix("red", "#ffffff", 0.5), /6-digit hex/);
});

test("flat matches the graph drawn before styles existed", async () => {
  assert.equal(render(year()), await fixture("flat.svg"));
  assert.equal(render(year(), { style: "flat" }), await fixture("flat.svg"));
  const colors = { color: "7c5cff", background: "#ffffff", text: "#1f2328" };
  assert.equal(render(year(), colors), await fixture("flat-colors.svg"));
});

test("the action's empty inputs still draw the old flat graph", async () => {
  const unset = { INPUT_STYLE: "", INPUT_COLOR: "", INPUT_BACKGROUND: "", INPUT_TEXT: "" };
  assert.equal(await cli([], unset), await fixture("flat.svg"));
  assert.equal(await cli(["--style", "cyberpunk"], unset), render(year(), { style: "cyberpunk" }));
  assert.equal(await cli([], { ...unset, INPUT_STYLE: "cyberpunk" }), render(year(), { style: "cyberpunk" }));
});

test("cyberpunk draws a glowing graph with the same text", () => {
  const svg = render(year(), { style: "cyberpunk" });
  assertWellFormed(svg);
  assert.match(svg, /<title id="title">1,878 contributions in the last year<\/title>/);
  assert.match(svg, />1,878 contributions in the last year<\/text>/);
  for (const label of ["Nov", "Jan", "Oct", "Mon", "Wed", "Fri", "Less", "More"]) assert.match(svg, new RegExp(`>${label}<`));
  assert.equal(svg.match(/class="day"/g).length, 365 + 5);
  assert.match(svg, /<filter id="glow-4"[^>]*>\n<feGaussianBlur stdDeviation="3.4"\/>/);
  assert.match(svg, /<g filter="url\(#glow-4\)">\n<rect class="day"[^>]*fill="#fcee0a"/);
  assert.match(svg, /<polygon points="16.5,0.5 871.5,0.5 871.5,205.5 855.5,221.5 /);
  assert.match(svg, /font-family="'JetBrains Mono'[^"]*monospace"/);
  assert.doesNotMatch(svg, /Geist/);
  // Motion only for viewers who haven't asked for less.
  assert.equal(svg.match(/animation:/g).length, 1);
  assert.match(svg, /@media \(prefers-reduced-motion: no-preference\) \{ \.sweep \{ animation:/);
});

test("cyberpunk keeps colors the user set", () => {
  const svg = render(year(), { style: "cyberpunk", color: "39ff14", background: "#04140a", text: "#d7ffd0" });
  assertWellFormed(svg);
  assert.match(svg, /<polygon points="[^"]*" fill="#04140a"\/>/);
  assert.match(svg, /<text [^>]*fill="#d7ffd0"[^>]*>1,878 contributions/);
  assert.match(svg, /<g filter="url\(#glow-4\)">\n<rect class="day"[^>]*fill="#39ff14"/);
  assert.doesNotMatch(svg, /#0b0a17|#00f0ff|#fcee0a|#ff2a6d/);

  // Only the color set: the panel and text keep the cyberpunk defaults.
  const colorOnly = render(year(), { style: "cyberpunk", color: "#7c5cff" });
  assert.match(colorOnly, /fill="#0b0a17"/);
  assert.match(colorOnly, /<g filter="url\(#glow-4\)">\n<rect class="day"[^>]*fill="#7c5cff"/);
});

test("both styles stay inside the file", () => {
  assertSelfContained(render(year()));
  assertSelfContained(render(year(), { style: "cyberpunk" }));
  assertSelfContained(render(year(), { style: "cyberpunk", color: "#39ff14", background: "#04140a", text: "#d7ffd0" }));
});

test("rejects a style it doesn't know", async () => {
  assert.throws(() => render(year(), { style: "neon" }), /Style must be flat or cyberpunk\. Got: neon/);
  assert.throws(() => render(year(), { style: "toString" }), /Style must be flat or cyberpunk/);
  // Before it asks GitHub for anything.
  const unreachable = { GITHUB_GRAPHQL_URL: "http://127.0.0.1:9" };
  await assert.rejects(cli(["--style", "Cyberpunk"], unreachable), /Style must be flat or cyberpunk\. Got: Cyberpunk/);
});
