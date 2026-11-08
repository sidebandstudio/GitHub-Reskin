// The Playwright surface runner, used by every surface's test:e2e and a11y checks. scripts/check.mjs
// dispatches `test:e2e` and `a11y` (selected with --surface=<name> and/or --project=<name>) to each
// selected surface's module, whose run calls runSurface once its prerequisites are built:
//
//   import { runSurface } from "../../scripts/check-a11y.mjs";
//   export async function run({ command, args, root, outDir }) {
//     if (command === "test:e2e") return runSurface("fixture", { args, root });
//     if (command === "a11y") return runSurface("fixture", { args, root, a11y: true });
//     // ... the module's other commands ...
//   }
//
// It lists the surface's projects first, without launching a browser, and fails if any requested
// project discovers no tests. Then it runs them and fails on any failure, flaky result, skip,
// fixme or expected failure, so a required project cannot pass empty or partly skipped.
// Tests tagged @a11y are the surface's accessibility checks.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./build.mjs";
import { SURFACES, optionValues, withoutOptions } from "./check-routes.mjs";

export const A11Y_TAG = "@a11y";
const CLI = join(ROOT, "node_modules/@playwright/test/cli.js");

// Every test in a Playwright JSON report, with its project and outcome.
function reportTests(report) {
  const tests = [];
  const walk = (suite) => {
    for (const spec of suite.specs || []) for (const test of spec.tests) tests.push({ title: `${spec.file} › ${spec.title}`, ...test });
    for (const child of suite.suites || []) walk(child);
  };
  for (const suite of report.suites || []) walk(suite);
  return tests;
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Lists, then runs, Playwright projects. Arguments are passed to `playwright test` after the
 * selection, for example --headed or --workers=1.
 * @returns {Promise<import("../packages/contracts/index.js").CheckResult>}
 */
export async function runPlaywright({ projects, grep, args = [], root = ROOT, config = join(ROOT, "playwright.config.mjs") }) {
  if (!projects?.length) throw new Error("runPlaywright needs at least one project");
  const select = ["test", "--config", config, ...projects.map((name) => `--project=${name}`), ...(grep ? ["--grep", grep] : []), ...args];
  const matching = grep ? ` matching ${grep}` : "";

  // Playwright exits 1 with "No tests found" when nothing at all matches, and 0 when only some
  // projects are empty, so the counts decide.
  const listed = spawnSync(process.execPath, [CLI, ...select, "--list", "--reporter=json"], { cwd: root, encoding: "utf8" });
  const list = parse(listed.stdout);
  if (!list) {
    console.error(`Playwright could not list ${projects.join(", ")}:\n${`${listed.stdout}${listed.stderr}`.trim()}`);
    return { exitCode: 1, testCount: 0 };
  }
  const discovered = Object.fromEntries(projects.map((name) => [name, 0]));
  for (const test of reportTests(list)) discovered[test.projectName]++;
  console.log(`Discovered${matching}: ${projects.map((name) => `${name} ${discovered[name]}`).join(", ")}`);
  const empty = projects.filter((name) => !discovered[name]);
  for (const name of empty) console.error(`${name} discovered no tests${matching}. A required project that discovers nothing fails.`);
  const errors = (list.errors || []).map((error) => error.message).filter((message) => !(empty.length && /^Error: No tests found/.test(message)));
  if (errors.length) console.error(`Playwright could not list ${projects.join(", ")}:\n${errors.join("\n")}`);
  if (empty.length || errors.length || listed.status !== 0) return { exitCode: 1, testCount: 0 };

  const tmp = await mkdtemp(join(tmpdir(), "reskin-playwright-"));
  try {
    const file = join(tmp, "report.json");
    const status = await new Promise((done, fail) =>
      spawn(process.execPath, [CLI, ...select, "--reporter=list,json"], { cwd: root, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: file } })
        .on("error", fail)
        .on("close", done),
    );
    const report = parse(await readFile(file, "utf8").catch(() => ""));
    if (!report) {
      console.error(`Playwright wrote no report (exit ${status})`);
      return { exitCode: 1, testCount: 0 };
    }
    const tests = reportTests(report);
    const passed = Object.fromEntries(projects.map((name) => [name, 0]));
    const problems = report.errors?.map((error) => error.message) ?? [];
    for (const test of tests) {
      if (test.status === "expected" && test.expectedStatus === "passed") passed[test.projectName]++;
      else problems.push(`[${test.projectName}] ${test.title}: ${test.status === "skipped" ? "skipped" : test.expectedStatus !== "passed" ? `marked ${test.expectedStatus}` : test.status}`);
    }
    for (const name of projects) if (!passed[name]) problems.push(`${name} passed no tests${matching}`);
    const testCount = Object.values(passed).reduce((a, b) => a + b, 0);
    console.log(`Playwright: ${projects.map((name) => `${name} ${passed[name]} passed`).join(", ")}`);
    if (status !== 0 || problems.length) {
      console.error(`Playwright failed (exit ${status}):\n  ${problems.join("\n  ") || "see the output above"}\nSkipped, fixme and expected-failure tests fail a required project.`);
      return { exitCode: 1, testCount };
    }
    return { exitCode: 0, testCount };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Runs one surface's projects: those named by --project=<name> in args, or all of them. With
 * a11y, only its @a11y tests. --surface may only name this surface. Other arguments are passed
 * to Playwright.
 */
export async function runSurface(surface, { args = [], root = ROOT, a11y = false } = {}) {
  const own = SURFACES[surface].projects.map(([name]) => name);
  const requested = optionValues(args, "project");
  const unknown = [...requested.filter((name) => !own.includes(name)), ...optionValues(args, "surface").filter((name) => name !== surface).map((name) => `surface ${name}`)];
  if (unknown.length) {
    console.error(`${unknown.join(", ")} not in the ${surface} surface (${own.join(", ")})`);
    return { exitCode: 1, testCount: 0 };
  }
  const rest = withoutOptions(args, ["project", "surface"]);
  return runPlaywright({ projects: requested.length ? requested : own, grep: a11y ? A11Y_TAG : undefined, args: rest, root });
}
