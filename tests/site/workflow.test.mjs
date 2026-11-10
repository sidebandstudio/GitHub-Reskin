// .github/workflows/pages.yml deploys only from main, through the protected environment, after the
// production site gate, with every action pinned to a commit. .github/workflows/ci.yml runs the
// same site gate on every push and pull request, so a site failure blocks before the merge.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "./helpers.mjs";

const workflow = await readFile(join(ROOT, ".github/workflows/pages.yml"), "utf8");
const ci = await readFile(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const SITE_STEPS = ["check:site -- --production", "check:budgets -- --surface=site", "test:e2e -- --surface=site", "check:a11y -- --surface=site"];
// The site e2e runs Chromium and Firefox projects, and its recovery cases launch WebKit directly.
const BROWSERS = /npx --no-install playwright install --with-deps chromium firefox webkit\n/;

test("Pages deploys only from main through the github-pages environment", () => {
  assert.match(workflow, /on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.equal(workflow.match(/if: github\.ref == 'refs\/heads\/main'/g)?.length, 2);
  assert.match(workflow, /environment:\n      name: github-pages/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
});

test("the build runs the production gate and site checks before uploading dist/site", () => {
  const gate = workflow.indexOf("npm run check:site -- --production");
  const upload = workflow.indexOf("actions/upload-pages-artifact");
  assert.ok(gate > 0 && gate < upload);
  for (const step of ["check:budgets -- --surface=site", "test:e2e -- --surface=site", "check:a11y -- --surface=site"]) assert.ok(workflow.indexOf(step) < upload, step);
  assert.match(workflow, /path: dist\/site/);
  assert.match(workflow, BROWSERS);
});

test("the Build workflow runs the site gate with all three browsers on every push and pull request", () => {
  assert.match(ci, /^on:\n  push:\n  pull_request:\n/m);
  const job = ci.slice(ci.indexOf("\n  site:\n"));
  assert.ok(job.length < ci.length, "ci.yml has a site job");
  assert.doesNotMatch(job, /^    if:/m);
  assert.match(job, BROWSERS);
  const install = job.search(BROWSERS);
  for (const step of SITE_STEPS) assert.ok(job.indexOf(`- run: npm run ${step}\n`) > install, step);
});

test("every action is pinned to a full commit SHA", () => {
  const uses = [...`${workflow}\n${ci}`.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 5);
  for (const use of uses) assert.match(use, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, use);
});
