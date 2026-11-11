// scripts/qa-live.mjs without the network: the pages it visits come from GitHub's answers at test
// time, a GitHub failure is told apart from a markup change, snapshots report what changed, and
// themes with the same identity colors are caught. The live run itself is npm run qa:live.
import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_PULL, REFERENCE_PROFILES, arrivalFailure, compareSnapshots, contrast, qaLive, resolveTargets, sameIdentities, snapshotVerdict } from "../../scripts/qa-live.mjs";

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
  const page = (text) => ({ text: [text], names: [], controls: [] });
  const [a, b, c] = [page("13 comments"), page("6 comments"), page("Problems")];
  assert.equal(snapshotVerdict([a], [a]).kind, null);
  assert.deepEqual(snapshotVerdict([a, b], [c, b]), { kind: null, native: b, themed: b }, "any matching pair passes");
  assert.equal(snapshotVerdict([a, a], [c, c]).kind, "product");
  assert.equal(snapshotVerdict([a], [c]).kind, "product", "no retry, no evidence GitHub changed");
  assert.equal(snapshotVerdict([a, b], [c, c]).kind, "github");
  assert.equal(snapshotVerdict([a, a], [c, b]).kind, "github");
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
