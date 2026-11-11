// scripts/qa-live.mjs without the network: the pages it visits come from GitHub's answers at test
// time, a GitHub failure is told apart from a markup change and a steady product change, rendered
// contrast is judged against GitHub's own, the candidate is the packaged build, setup is bounded,
// and themes with the same identity colors are caught. The live run itself is npm run qa:live.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "../../scripts/build.mjs";
import { DEMO_PULL, REFERENCE_PROFILES, arrivalFailure, compareSnapshots, contrast, contrastRegressions, deadline, missingContent, provenance, qaLive, resolveTargets, sameIdentities, snapshotVerdict } from "../../scripts/qa-live.mjs";

const answers = (routes) => async (path) => {
  for (const [pattern, answer] of routes) if (pattern.test(path)) return answer;
  return { status: 404, body: null };
};

test("the Gist is the first public one GitHub answers with at test time, and the profiles keep owner order", async () => {
  const targets = await resolveTargets(
    answers([
      [/users\/whoisaldo\/gists/, { status: 200, body: [] }],
      [/users\/Alitleis123\/gists/, { status: 200, body: [{ public: false, html_url: "https://gist.github.com/secret" }, { public: true, html_url: "https://gist.github.com/Alitleis123/abc" }] }],
    ]),
  );
  assert.deepEqual(targets.filter((t) => t.route === "profile").map((t) => t.url), REFERENCE_PROFILES.map((user) => `https://github.com/${user}`));
  assert.equal(targets.find((t) => t.name === "diff").url, `https://github.com/sidebandstudio/GitHub-Reskin/pull/${DEMO_PULL}/files`);
  assert.equal(targets.find((t) => t.name === "gist").url, "https://gist.github.com/Alitleis123/abc");
  assert.equal(targets.find((t) => t.name === "404").status, 404);
  assert.ok(targets.every((t) => !t.error));
});

test("a Gist GitHub's API cannot supply is an error, not a guessed URL", async () => {
  const gist = async (answer) => (await resolveTargets(async () => answer)).find((t) => t.name === "gist");
  assert.match((await gist({ status: 403, body: null })).error, /answered 403/);
  assert.match((await gist({ status: 403, limited: true, body: null })).error, /rate limit is used up/);
  assert.match((await gist({ status: 200, body: [] })).error, /no reference profile/);
  const offline = await resolveTargets(async () => {
    throw new Error("fetch failed");
  });
  assert.equal(offline.find((t) => t.name === "gist").error, "fetch failed");
  assert.equal(offline.find((t) => t.name === "gist").url, undefined);
});

test("outages and rate limits are GitHub's, an unexpected status is markup", () => {
  assert.equal(arrivalFailure({ status: 200 }, {}), null);
  assert.equal(arrivalFailure({ status: 404 }, { status: 404 }), null);
  assert.equal(arrivalFailure({ status: 304 }, {}), null, "a reload answered from cache");
  assert.equal(arrivalFailure({ status: 304 }, { status: 404 }).kind, "markup");
  assert.deepEqual(arrivalFailure({ status: 429 }, {}), { kind: "github", detail: "rate limited" });
  assert.deepEqual(arrivalFailure({ status: 403, text: "You have exceeded a secondary rate limit." }, {}), { kind: "github", detail: "rate limited" });
  assert.deepEqual(arrivalFailure({ status: 503 }, {}), { kind: "github", detail: "HTTP 503" });
  assert.deepEqual(arrivalFailure({ status: null, error: "net::ERR_TIMED_OUT" }, {}), { kind: "github", detail: "net::ERR_TIMED_OUT" });
  assert.equal(arrivalFailure({ status: 404 }, {}).kind, "markup");
  assert.equal(arrivalFailure({ status: 200 }, { status: 404 }).kind, "markup");
});

test("a snapshot comparison names what the themed page lost and gained", () => {
  assert.deepEqual(compareSnapshots(["Code", "Issues"], ["Code", "Issues"]), { same: true, missing: [], added: [] });
  assert.deepEqual(compareSnapshots(["Code", "Issues", "Issues"], ["Code", "Issues", "Problems"]), { same: false, missing: ["Issues"], added: ["Problems"] });
  assert.equal(compareSnapshots(["a", "b"], ["b", "a"]).same, false, "order counts");
  assert.equal(compareSnapshots(Array(9).fill("x"), [], 3).missing.length, 3);
});

test("a page GitHub serves differently on each load is GitHub's, a steady difference is the product's", () => {
  const page = (text, names = ["button aria-label=Code"]) => ({ text, names, controls: [], accessibility: [] });
  const kinds = (verdict) => Object.fromEntries(Object.entries(verdict).map(([part, { kind }]) => [part, kind]));
  const [a, b] = [page(["13 comments"]), page(["6 comments"])];
  assert.deepEqual(kinds(snapshotVerdict([a], [a])), { text: null, names: null, controls: null, accessibility: null });
  assert.equal(snapshotVerdict([a, b], [page(["Problems"]), b]).text.kind, null, "any agreeing pair passes");
  assert.equal(snapshotVerdict([a, a], [page(["Problems"]), page(["Problems"])]).text.kind, "product");
  assert.equal(snapshotVerdict([a], [page(["Problems"])]).text.kind, "product", "no second load, no evidence GitHub changed");
  assert.equal(snapshotVerdict([a, b], [b, page(["7 comments"])]).text.kind, null, "the first themed load matched");
  assert.equal(snapshotVerdict([a, b], [page(["7 comments"]), page(["8 comments"])]).text.kind, "github", "every difference varied between loads");
  assert.equal(snapshotVerdict([a, b], [page(["7 comments"]), page(["7 comments"])]).text.kind, "product", "only the themed loads ever show it, so it is not excused");
  assert.equal(snapshotVerdict([a, a], [page(["13 comments", "x"]), page(["6 comments", "x"])]).text.kind, "product", "the steady extra item is the product's");
  // GitHub's activity changes between loads while the extension steadily renames a control.
  const noisy = snapshotVerdict([a, b], [page(["7 comments"], ["button aria-label=Problems"]), page(["8 comments"], ["button aria-label=Problems"])]);
  assert.deepEqual(kinds(noisy), { text: "github", names: "product", controls: null, accessibility: null });
  assert.deepEqual(noisy.names, { kind: "product", missing: ["button aria-label=Code"], added: ["button aria-label=Problems"] });
  const reordered = snapshotVerdict([page(["a", "b"])], [page(["b", "a"])]);
  assert.deepEqual(reordered.text, { kind: "product", missing: [], added: [] }, "order alone is the product's");
  // Star counts change between every load while the extension steadily swaps two tabs.
  const swapped = snapshotVerdict([page(["Code", "Issues", "13 stars"]), page(["Code", "Issues", "14 stars"])], [page(["Issues", "Code", "15 stars"]), page(["Issues", "Code", "16 stars"])]);
  assert.deepEqual(swapped.text, { kind: "product", missing: [], added: [] }, "noise elsewhere does not excuse a steady reorder");
});

test("rendered contrast fails only where the theme reads worse than GitHub's own page", () => {
  const entry = (key, ratio, extra = {}) => ({ key, ratio, large: false, overImage: false, ...extra });
  const native = [entry("a Code", 7), entry("span 3 open", 3.2), entry("h2 Title", 8)];
  const themed = [entry("a Code", 4.2), entry("span 3 open", 3.1), entry("h2 Title", 3.2, { large: true }), entry("p Over art", 1.5, { overImage: true }), entry("p New", 4.4)];
  assert.deepEqual(contrastRegressions(native, themed).map((e) => e.key), ["a Code", "p New"]);
});

test("text a theme hides is missing content, and times that tick are left out", () => {
  const entry = (key, extra = {}) => ({ key, ratio: 7, large: false, overImage: false, tick: false, ...extra });
  const before = [entry("a Code"), entry("p Readme"), entry("span 3 hours ago", { tick: true }), entry("h1 Title", { overImage: true, ratio: null })];
  assert.deepEqual(missingContent(before, [entry("a Code"), entry("h1 Title", { overImage: true, ratio: null }), entry("span 4 hours ago", { tick: true })]), ["p Readme"]);
  assert.deepEqual(missingContent(before, [...before, entry("p New")]), []);
});

test("the candidate is what a checksummed build-info.json names, for exactly the packages tested", async () => {
  const root = mkdtempSync(join(tmpdir(), "reskin-qa-provenance-"));
  const commit = "a".repeat(40);
  const write = async (info, sums = {}) => {
    const bytes = JSON.stringify(info);
    await writeFile(join(root, "artifacts/build-info.json"), bytes);
    const lines = { "build-info.json": sha256(Buffer.from(bytes)), "github-reskin-9.9.9-chrome.zip": "aaa", ...sums };
    await writeFile(join(root, "artifacts/SHA256SUMS"), Object.entries(lines).map(([name, hash]) => `${hash}  ${name}\r\n`).join(""));
  };
  const chrome = { dir: "x", file: "artifacts/github-reskin-9.9.9-chrome.zip", sha256: "aaa", tree: "t1" };
  const info = { version: "9.9.9", commit, sourceDirty: false, targets: { chrome: { files: 1, tree: "t1" } } };
  try {
    await mkdir(join(root, "artifacts"));
    await write(info);
    assert.deepEqual(await provenance(root, { chrome }, "9.9.9"), { version: "9.9.9", commit, sourceDirty: false, packages: { chrome: { file: chrome.file, sha256: "aaa" } } });
    await assert.rejects(provenance(root, { chrome: { ...chrome, sha256: "old" } }, "9.9.9"), /chrome\.zip does not match artifacts\/SHA256SUMS/);
    await assert.rejects(provenance(root, { chrome: { ...chrome, tree: "other" } }, "9.9.9"), /not the chrome build/);
    await assert.rejects(provenance(root, { chrome }, "9.9.8"), /does not name version 9\.9\.8/);
    await write({});
    await assert.rejects(provenance(root, { chrome }, "9.9.9"), /does not name version/);
    await write(info, { "build-info.json": "stale" });
    await assert.rejects(provenance(root, { chrome }, "9.9.9"), /build-info\.json does not match/);
    await rm(join(root, "artifacts/build-info.json"));
    await assert.rejects(provenance(root, { chrome }, "9.9.9"), /build-info\.json is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a setup step that never answers fails at its deadline", async () => {
  await assert.rejects(deadline(new Promise(() => {}), 20, "Installing"), /Installing took longer than 0.02 s/);
  assert.equal(await deadline(Promise.resolve(5), 20, "x"), 5);
});

test("contrast follows WCAG, and themes sharing canvas, text and accent are caught", () => {
  assert.equal(Math.round(contrast([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
  assert.equal(Math.round(contrast([118, 118, 118], [255, 255, 255]) * 100) / 100, 4.54);
  const palette = (canvas, accent) => ({ "--bgColor-default": canvas, "--fgColor-default": [230, 230, 230], "--fgColor-accent": accent });
  const palettes = new Map([
    ["a", palette([10, 10, 10], [0, 240, 255])],
    ["b", palette([10, 10, 10], [255, 0, 0])],
    ["c", palette([10, 10, 10], [0, 240, 255])],
  ]);
  assert.deepEqual(sameIdentities(palettes), [["a", "c"]]);
});

test("qa:live refuses to run without --read-only", async () => {
  const errors = [];
  const error = console.error;
  console.error = (line) => errors.push(line);
  try {
    assert.deepEqual(await qaLive({ args: [] }), { exitCode: 2, testCount: 0 });
  } finally {
    console.error = error;
  }
  assert.match(errors.join("\n"), /--read-only/);
});
