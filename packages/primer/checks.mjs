// C3's checks behind check:primer and check:slot-contracts, routed by scripts/check-routes.mjs.
// run({command, args, root, outDir}) resolves to {exitCode, testCount}, counting every assertion
// made here plus every test in the files it runs. Node only.
//   node packages/primer/checks.mjs primer
//   node packages/primer/checks.mjs slot-contracts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "../..");

function assertions() {
  const problems = [];
  let count = 0;
  return {
    problems,
    get count() {
      return count;
    },
    expect(ok, problem) {
      count++;
      if (!ok) problems.push(problem);
    },
  };
}

// Runs node:test files and counts real tests; skips, todos and empty files fail.
async function runTestFiles(root, files) {
  const { run } = await import("node:test");
  const { spec } = await import("node:test/reporters");
  const totals = { pass: 0, fail: 0, skip: 0 };
  const counts = Object.fromEntries(files.map((f) => [f, 0]));
  const stream = run({ files: files.map((f) => join(root, f)), cwd: root });
  const record = (outcome) => (event) => {
    if (event.details?.type === "suite") {
      if (event.skip || event.todo) totals.skip++;
      else if (outcome === "fail" && event.details.error?.failureType !== "subtestsFailed") totals.fail++;
      return;
    }
    if (event.name === event.file) {
      if (outcome === "fail") totals.fail++;
      return;
    }
    counts[relative(root, event.file)] = (counts[relative(root, event.file)] ?? 0) + 1;
    totals[event.skip || event.todo ? "skip" : outcome]++;
  };
  stream.on("test:pass", record("pass"));
  stream.on("test:fail", record("fail"));
  await new Promise((done) => stream.compose(spec).on("end", done).pipe(process.stdout, { end: false }));
  const empty = Object.entries(counts).filter(([, n]) => !n).map(([f]) => f);
  for (const f of empty) console.error(`  FAIL ${f} ran no tests`);
  return { ...totals, tests: totals.pass + totals.fail + totals.skip, ok: !totals.fail && !totals.skip && !empty.length };
}

async function engineAvailable() {
  const { loadEngine } = await import("../../tests/primer/helpers.mjs");
  try {
    await loadEngine();
    return true;
  } catch (error) {
    if (error.code !== "RESKIN_NO_ENGINE") throw error;
    console.error(`NOT IMPLEMENTED: check:primer needs C2's engine for its all-mode integration. ${error.message}`);
    return false;
  }
}

async function checkPrimer(root) {
  const a = assertions();
  const { generate, readPolicy, readVendor } = await import("./generate.mjs");
  const fresh = await generate(await readVendor(join(root, "vendor/primer/source")), await readPolicy(root));
  a.expect(readFileSync(join(root, "vendor/primer/modes.json"), "utf8") === fresh.modesJson, "vendor/primer/modes.json differs from an offline conversion of the frozen sources");
  a.expect(readFileSync(join(root, "vendor/primer/provenance.json"), "utf8") === fresh.provenanceJson, "vendor/primer/provenance.json differs from an offline conversion");
  // The build never fetches: no runtime or build module of this package calls the network.
  for (const file of readdirSync(join(root, "packages/primer")).filter((f) => /\.(m?js)$/.test(f) && f !== "checks.mjs")) {
    a.expect(!/\bfetch\(|https?:\/\/|XMLHttpRequest|import\(\s*["']http/.test(readFileSync(join(root, "packages/primer", file), "utf8")), `packages/primer/${file} must not reach the network`);
  }
  for (const p of a.problems) console.error(`  FAIL ${p}`);
  const available = await engineAvailable();
  const files = ["tests/primer/data.test.mjs", "tests/primer/modes.test.mjs", "tests/primer/compile.test.mjs", "tests/primer/islands.test.mjs", ...(available ? ["tests/primer/engine.integration.mjs"] : [])];
  const result = await runTestFiles(root, files);
  const testCount = a.count + result.tests;
  console.log(`check:primer: ${a.count} data assertions, ${result.tests} tests (${result.pass} passed, ${result.fail} failed, ${result.skip} skipped)`);
  if (!available) return { exitCode: 2, testCount };
  return { exitCode: a.problems.length || !result.ok ? 1 : 0, testCount };
}

async function checkSlotContracts(root) {
  const a = assertions();
  const { FLAVOR_SLOT_IDS } = await import("../contracts/index.js");
  const { SLOTS } = await import("../../extension/content/github/selectors.js");
  const evidence = JSON.parse(readFileSync(join(root, "tests/primer/slot-evidence.json"), "utf8"));
  a.expect(JSON.stringify(SLOTS.map((s) => s.slot).sort()) === JSON.stringify([...FLAVOR_SLOT_IDS].sort()), "the adapter defines exactly the eight frozen slot IDs");
  a.expect(JSON.stringify(Object.keys(evidence.slots).sort()) === JSON.stringify([...FLAVOR_SLOT_IDS].sort()), "slot-evidence.json covers exactly the eight slot IDs");
  for (const def of SLOTS) {
    const e = evidence.slots[def.slot];
    a.expect(e?.status === def.status, `${def.slot}: adapter status ${def.status}, evidence ${e?.status}`);
    a.expect(["append", "after", "before"].includes(def.insert), `${def.slot}: insert ${def.insert}`);
    a.expect(/^main\b/.test(def.scope), `${def.slot}: scope starts inside <main>`);
    a.expect(!/\*=|\^=|\$=|~=/.test(def.scope), `${def.slot}: no substring attribute matching`);
    if (def.status === "enabled") {
      a.expect(/^\d{4}-\d{2}-\d{2}$/.test(e?.date ?? ""), `${def.slot}: evidence date`);
      a.expect(/^https:\/\/github\.com\//.test(e?.url ?? ""), `${def.slot}: evidence route URL`);
      a.expect(e?.route === def.route, `${def.slot}: evidence route class`);
      a.expect(typeof e?.host === "string" && e.host.startsWith("main"), `${def.slot}: evidence DOM path`);
      a.expect(Boolean(e?.screenshot) && existsSync(join(root, e.screenshot)), `${def.slot}: evidence screenshot`);
    } else {
      a.expect(typeof e?.reason === "string" && e.reason.length > 20 && typeof def.dormant === "string", `${def.slot}: dormant reason`);
    }
  }
  for (const page of evidence.pages) for (const anchor of page.anchors) a.expect(!anchor.authored && !anchor.interactive, `${page.url}: ${anchor.slot} anchored in authored or interactive markup`);
  // The adapter only reads, except admission, which writes Reskin's own marker attributes through
  // its two helpers and nothing else. Drawing, text and their removal belong to C5's owned nodes.
  const dir = join(root, "extension/content/github");
  const WRITES = /\.(append|prepend|before|after|replaceWith|replaceChildren|insertBefore|appendChild|removeChild|insertAdjacent\w*|setAttribute|removeAttribute|toggleAttribute)\(|\.remove\(\)|textContent\s*=|innerText\s*=|innerHTML|outerHTML\s*=|\.data\s*=|nodeValue\s*=/;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    let text = readFileSync(join(dir, file), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    if (file === "admission.js") {
      const writes = [...text.matchAll(/\b(\w+)\.(setAttribute|removeAttribute)\(/g)];
      a.expect(writes.length === 2 && writes.every((m) => m[1] === "el"), "admission.js writes attributes only inside mark() and unmark()");
      a.expect(/function mark\(el, name, value\) \{\n\s*if \(!MARKERS\.has\(name\)\) throw/.test(text) && /function unmark\(el, name\) \{\n\s*if \(!MARKERS\.has\(name\)\) throw/.test(text), "admission.js refuses every attribute but Reskin's markers");
      text = text.replace(/el\.(setAttribute|removeAttribute)\(/g, "");
    }
    a.expect(!WRITES.test(text), `extension/content/github/${file} must not write to the page`);
    a.expect(!/font-size\s*:\s*0|content\s*:\s*["']|aria-label\s*=|localStorage|sessionStorage|\bfetch\(/.test(text), `extension/content/github/${file} must not hide labels, generate text, use page storage or the network`);
  }
  for (const p of a.problems) console.error(`  FAIL ${p}`);
  const result = await runTestFiles(root, ["tests/primer/slots.test.mjs"]);
  console.log(`check:slot-contracts: ${a.count} contract assertions, ${result.tests} tests (${result.pass} passed, ${result.fail} failed, ${result.skip} skipped)`);
  return { exitCode: a.problems.length || !result.ok ? 1 : 0, testCount: a.count + result.tests };
}

/** @param {{command:string, args?:string[], root?:string, outDir?:string}} options */
export async function run({ command, args = [], root = DEFAULT_ROOT }) {
  if (args.length) {
    console.error(`check:${command} takes no arguments; got ${args.join(" ")}`);
    return { exitCode: 1, testCount: 0 };
  }
  if (command === "primer") return checkPrimer(root);
  if (command === "slot-contracts") return checkSlotContracts(root);
  console.error(`packages/primer/checks.mjs has no ${command} check. Checks: primer, slot-contracts`);
  return { exitCode: 2, testCount: 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, ...args] = process.argv.slice(2);
  const { exitCode } = await run({ command, args, root: process.cwd() });
  process.exitCode = exitCode;
}
