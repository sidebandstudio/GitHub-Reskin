// C5's routed checks (scripts/check-routes.mjs): check:fonts, check:effects and the fixture
// browser surface for test:e2e and check:a11y.
//   fonts                        bundled WOFF2 files, budget, OFL notices, provenance, weights, coverage, names
//   effects [--themes <dir>]     effect templates at every shape and bound, and every catalog theme plus
//                                the worst-case load themes (and staged theme files) under every preference
//   test:e2e, a11y               builds the fixture app into <outDir>/fixture/product, then runs the
//                                fixture-chromium/fixture-firefox projects (a11y: only @a11y tests)
import { relative } from "node:path";
import { runSurface } from "../../scripts/check-a11y.mjs";
import { optionValues, withoutOptions } from "../../scripts/check-routes.mjs";
import { buildFixtureApp } from "../../tests/fixture-app/product/build.mjs";
import { auditDocuments, fontAudit, templateAudit, themeAudit } from "./audit.mjs";

function report(name, { problems, count }) {
  for (const problem of problems) console.error(`  ${problem}`);
  console.log(`${name}: ${count} assertions, ${problems.length} failed`);
  return { exitCode: problems.length ? 1 : 0, testCount: count };
}

function unsupported(command, args) {
  if (!args.length) return null;
  console.error(`${command} takes no arguments: ${args.join(" ")}`);
  return { exitCode: 1, testCount: 0 };
}

export async function run({ command, args, root, outDir }) {
  if (command === "fonts") {
    const bad = unsupported("check:fonts", args);
    if (bad) return bad;
    const result = await fontAudit(root);
    console.log(`Bundled fonts: ${result.families} families in ${result.files} files, ${result.total} bytes`);
    return report("check:fonts", result);
  }
  if (command === "effects") {
    const extra = optionValues(args, "themes");
    const bad = unsupported("check:effects", withoutOptions(args, ["themes"]));
    if (bad) return bad;
    const templates = templateAudit();
    const documents = await auditDocuments(root, extra);
    const themes = await themeAudit(root, documents);
    console.log(`Themes audited: ${documents.length}${extra.length ? ` (with ${extra.map((dir) => relative(root, dir) || dir).join(", ")})` : ""}`);
    return report("check:effects", { problems: [...templates.problems, ...themes.problems], count: templates.count + themes.count });
  }
  if (command === "test:e2e" || command === "a11y") {
    // The specs read the app from here; a stale or missing build fails them rather than passing.
    process.env.RESKIN_FIXTURE_APP = await buildFixtureApp({ root, outDir });
    return runSurface("fixture", { args, root, a11y: command === "a11y" });
  }
  console.error(`packages/appearance/checks.mjs does not handle ${command}`);
  return { exitCode: 2, testCount: 0 };
}
