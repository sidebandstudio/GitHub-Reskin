// C8's check route, dispatched by scripts/check-routes.mjs to run({command, args, root, outDir}),
// which resolves to {exitCode, testCount}:
//   userscript  check:userscript: builds the script twice (same bytes), checks the generated
//               artifact (metadata, no remote code or icon, no network or page-storage API, every
//               font and notice embedded, the 3.5 MiB budget), that the committed copy 1.1.0
//               installs update from is fresh, then runs the userscript unit tests.
//   test:e2e    the userscript surface: userscript-chromium and userscript-firefox.
//   a11y        the same projects' @a11y tests.
// Direct use: node userscript/checks.mjs userscript
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSurface } from "../scripts/check-a11y.mjs";
import { build, COMMITTED, MAX_BYTES } from "./build.mjs";
import { scriptProblems } from "./verify.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const UNIT_TESTS = ["tests/userscript/build.test.mjs", "tests/userscript/host.test.mjs", "tests/userscript/migration.test.mjs", "tests/userscript/storage.test.mjs", "userscript.test.mjs"];

// Runs unit test files in a child node --test and counts its TAP totals. Any failure, skip, todo or
// file that runs nothing fails.
function unitTests(root, files) {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const total = (name) => Number(result.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN);
  const [tests, pass, fail, skipped, todo] = ["tests", "pass", "fail", "skipped", "todo"].map(total);
  for (const line of result.stdout.split("\n").filter((line) => /^\s*not ok /.test(line))) console.error(`  ${line.trim()}`);
  if (result.status !== 0) console.error(result.stderr.slice(-4000) || result.stdout.slice(-4000));
  console.log(`unit tests: ${tests} tests, ${pass} passed, ${fail} failed, ${skipped + todo} skipped`);
  const ok = result.status === 0 && tests > 0 && pass === tests && fail === 0 && skipped === 0 && todo === 0;
  return { exitCode: ok ? 0 : 1, testCount: Number.isFinite(tests) ? tests : 0 };
}

async function checkUserscript(root) {
  const config = JSON.parse(await readFile(join(root, "release.config.json"), "utf8"));
  const failures = [];
  let count = 0;
  const check = (ok, message) => {
    count++;
    if (!ok) failures.push(message);
  };
  const [first, second] = [await build({ root }), await build({ root })];
  check(first === second, "two builds from the same inputs differ");
  const problems = await scriptProblems(first, { config, root });
  check(problems.length === 0, problems.join("\n  "));
  const committed = (await readFile(join(root, COMMITTED), "utf8").catch(() => "")).replace(/\r\n/g, "\n");
  check(committed === first, `${COMMITTED} is out of date. Run node userscript/build.mjs`);
  const bytes = Buffer.byteLength(first);
  console.log(`github-reskin.user.js: ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB of the ${MAX_BYTES / 1024 / 1024} MiB budget)`);
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.log(`check:userscript artifact: ${count} checks, ${failures.length} failed`);
  const unit = unitTests(root, UNIT_TESTS);
  return { exitCode: failures.length || unit.exitCode ? 1 : 0, testCount: count + unit.testCount };
}

/** @type {import("../packages/contracts/index.js").CheckRunner} */
export async function run({ command, args = [], root = DEFAULT_ROOT }) {
  if (command === "userscript") return checkUserscript(root);
  if (command === "test:e2e") return runSurface("userscript", { args, root });
  if (command === "a11y") return runSurface("userscript", { args, root, a11y: true });
  console.error(`userscript/checks.mjs does not serve ${command}`);
  return { exitCode: 1, testCount: 0 };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = "userscript", ...args] = process.argv.slice(2);
  const result = await run({ command, args, root: DEFAULT_ROOT, outDir: join(DEFAULT_ROOT, "dist") });
  process.exit(result.exitCode);
}
