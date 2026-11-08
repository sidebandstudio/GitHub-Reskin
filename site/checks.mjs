// C7's check module (CheckRunner in packages/contracts), routed by scripts/check-routes.mjs:
//   site                  builds dist/site, then runs tests/site/*.test.mjs against it.
//                         --production also rejects the site/dev adapter and development catalog.
//                         --require-live-stores also requires real store listings in release.config.json.
//   budgets --surface=site  builds, then measures the home page at 390x844 in Chromium against the
//                         ARCHITECTURE.md site budgets and writes artifacts/reports/site-budgets.json.
//   test:e2e, a11y        builds, then runs the site-chromium and site-firefox Playwright projects.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { optionValues, withoutOptions } from "../scripts/check-routes.mjs";

const SITE_FLAGS = ["--production", "--require-live-stores"];

/** Builds the site into <outDir>/site and returns that directory. */
export async function buildSite({ root, outDir }) {
  const { buildSiteFrom, loadReleaseConfig } = await import("../scripts/build.mjs");
  const { dir } = await buildSiteFrom(root, { outDir, releaseConfig: await loadReleaseConfig() });
  return dir;
}

// Runs node:test files and counts real results. Skips, todos, file-level failures and files with
// no tests fail, as in C1's runner.
export async function runNodeTests(files) {
  if (!files.length) {
    console.error("No site test files found. A test command that discovers nothing fails.");
    return { exitCode: 1, testCount: 0 };
  }
  const { run } = await import("node:test");
  const { spec } = await import("node:test/reporters");
  const counts = Object.fromEntries(files.map((file) => [file, 0]));
  const totals = { pass: 0, fail: 0, skip: 0 };
  const broken = [];
  const stream = run({ files });
  const record = (outcome) => (event) => {
    if (event.details?.type === "suite") {
      if (event.skip || event.todo) totals.skip++;
      else if (outcome === "fail" && event.details.error?.failureType !== "subtestsFailed") {
        totals.fail++;
        broken.push(`suite "${event.name}" failed`);
      }
      return;
    }
    if (event.name === event.file) {
      if (outcome === "fail") broken.push(`${event.file} failed outside any test`);
      return;
    }
    counts[event.file] = (counts[event.file] || 0) + 1;
    totals[event.skip || event.todo ? "skip" : outcome]++;
  };
  stream.on("test:pass", record("pass"));
  stream.on("test:fail", record("fail"));
  await new Promise((done) => stream.compose(spec).on("end", done).pipe(process.stdout, { end: false }));
  for (const file of files) if (!counts[file]) broken.push(`${file} ran no tests`);
  const problems = [...broken, ...(totals.skip ? [`${totals.skip} skipped or todo`] : [])];
  if (totals.fail || problems.length) {
    console.error(`Site tests failed: ${totals.fail} failed${problems.length ? `; ${problems.join("; ")}` : ""}`);
    return { exitCode: 1, testCount: totals.pass };
  }
  return { exitCode: 0, testCount: totals.pass };
}

async function siteTests(root) {
  const dir = join(root, "tests/site");
  const names = await readdir(dir).catch(() => []);
  return names.filter((name) => name.endsWith(".test.mjs")).sort().map((name) => join(dir, name));
}

async function checkSite({ args, root, outDir }) {
  const unknown = args.filter((arg) => !SITE_FLAGS.includes(arg));
  if (unknown.length) {
    console.error(`check:site does not support ${unknown.join(" ")}. Supported: ${SITE_FLAGS.join(", ")}`);
    return { exitCode: 1, testCount: 0 };
  }
  process.env.RESKIN_SITE_DIR = await buildSite({ root, outDir });
  if (args.includes("--production")) process.env.RESKIN_SITE_PRODUCTION = "1";
  if (args.includes("--require-live-stores")) process.env.RESKIN_REQUIRE_LIVE_STORES = "1";
  return runNodeTests(await siteTests(root));
}

async function checkBudgets({ args, root, outDir }) {
  const surfaces = optionValues(args, "surface");
  if (surfaces.length !== 1 || surfaces[0] !== "site" || withoutOptions(args, ["surface"]).length) {
    console.error("site/checks.mjs measures budgets only for --surface=site, with no other arguments");
    return { exitCode: 1, testCount: 0 };
  }
  const { measureSiteBudgets } = await import("./budgets.mjs");
  return measureSiteBudgets({ root, siteDir: await buildSite({ root, outDir }) });
}

export async function run({ command, args = [], root, outDir }) {
  if (command === "site") return checkSite({ args, root, outDir });
  if (command === "budgets") return checkBudgets({ args, root, outDir });
  if (command === "test:e2e" || command === "a11y") {
    process.env.RESKIN_SITE_DIR = await buildSite({ root, outDir });
    const { runSurface } = await import("../scripts/check-a11y.mjs");
    return runSurface("site", { args, root, a11y: command === "a11y" });
  }
  console.error(`site/checks.mjs does not implement ${command}`);
  return { exitCode: 1, testCount: 0 };
}
