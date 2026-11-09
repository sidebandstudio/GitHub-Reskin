// Slot anchors and route guards against fixtures served at github.com URLs in Chromium and
// Firefox, with no network. Fixtures follow the live markup recorded in slot-evidence.json and
// add hostile authored copies of GitHub's words.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { chromium, firefox } from "playwright";
import { FLAVOR_SLOT_IDS } from "../../packages/contracts/index.js";
import { dormantSlots, enabledSlots, SLOTS } from "../../extension/content/github/index.js";
import { EMPTY_PROFILE, ISSUES, NOT_FOUND, REPOSITORY } from "./fixtures/pages.mjs";
import { adapterBundle, readJson, readText, ROOT } from "./helpers.mjs";

const PROFILE = readText("tests/primer/fixtures/profile.html");
const bundle = await adapterBundle();

test("the adapter knows exactly the eight frozen slot IDs, and its states match the dated evidence", () => {
  assert.deepEqual(SLOTS.map((s) => s.slot).sort(), [...FLAVOR_SLOT_IDS].sort());
  const evidence = readJson("tests/primer/slot-evidence.json");
  assert.deepEqual(Object.keys(evidence.slots).sort(), [...FLAVOR_SLOT_IDS].sort());
  for (const slot of enabledSlots()) {
    const e = evidence.slots[slot];
    assert.equal(e.status, "enabled", slot);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(e.url, /^https:\/\/github\.com\//);
    assert.equal(e.route, SLOTS.find((s) => s.slot === slot).route);
    assert.ok(e.screenshot && existsSync(join(ROOT, e.screenshot)), `${slot} screenshot`);
  }
  for (const slot of dormantSlots()) {
    assert.equal(evidence.slots[slot].status, "dormant", slot);
    assert.ok(evidence.slots[slot].reason, slot);
  }
  for (const page of evidence.pages) for (const a of page.anchors) assert.ok(!a.authored && !a.interactive, `${page.url} ${a.slot}`);
});

// Page clocks for locateSlots: one that never advances, and one that jumps 5 ms on every reading,
// past the 4 ms allowance, as on a runner too slow to finish discovery in time.
const frozenClock = () => {
  performance.now = () => 0;
};
const slowClock = () => {
  let t = 0;
  performance.now = () => (t += 5);
};

for (const [name, engine] of [["Chromium", chromium], ["Firefox", firefox]]) {
  describe(`slot anchors in ${name}`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch();
    });
    after(async () => {
      await browser?.close();
    });

    // Serves html at a github.com (or gist) URL and returns what the adapter reports there.
    // locateSlots reads the page's clock, which the helper controls so results never depend on
    // how fast the runner is: frozen unless a test passes its own. `init` runs before the page's
    // scripts, as the browser's own environment would.
    async function locate(html, { url = "https://github.com/octo-sample", route, mutate, clock = frozenClock, init } = {}) {
      const context = await browser.newContext();
      await context.route("**/*", (r) => (r.request().url() === url ? r.fulfill({ contentType: "text/html", body: html }) : r.abort()));
      if (init) await context.addInitScript(init);
      const page = await context.newPage();
      await page.goto(url);
      await page.addScriptTag({ content: bundle });
      if (mutate) await page.evaluate(mutate);
      await page.evaluate(clock);
      const result = await page.evaluate((route) => {
        const G = globalThis.ReskinGitHub;
        const before = document.documentElement.outerHTML;
        const detected = G.classifyRoute(document);
        const anchors = G.locateSlots(document, route ?? detected);
        const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className ? `.${String(el.className).trim().split(/\s+/)[0]}` : ""}`;
        return {
          route: detected,
          anchors: anchors.map((a) => ({ slot: a.slot, insert: a.insert, host: describe(a.host), text: a.host.textContent.replace(/\s+/g, " ").trim().slice(0, 60), authored: G.insideAuthored(a.host), signature: a.nativeSignature })),
          unchanged: document.documentElement.outerHTML === before,
        };
      }, route);
      await context.close();
      return result;
    }
    const slots = (r) => r.anchors.map((a) => a.slot).sort();

    test("a profile gets its five evidenced anchors and nothing in the README, name, bio or activity titles", async () => {
      const r = await locate(PROFILE);
      assert.equal(r.route, "profile");
      assert.deepEqual(slots(r), ["contributions.caption", "profile.activity.heading", "profile.organizations.heading", "profile.pinned.heading", "profile.tag"]);
      const by = Object.fromEntries(r.anchors.map((a) => [a.slot, a]));
      assert.deepEqual([by["profile.pinned.heading"].host, by["profile.pinned.heading"].insert], ["h2.f4", "append"]);
      assert.match(by["profile.pinned.heading"].text, /^Pinned Loading/);
      assert.deepEqual([by["profile.organizations.heading"].host, by["profile.organizations.heading"].text], ["h2.mb-2", "Organizations"]);
      assert.deepEqual([by["profile.tag"].host, by["profile.tag"].insert], ["div.vcard-names-container", "append"]);
      assert.deepEqual([by["contributions.caption"].host, by["contributions.caption"].insert], ["div.py-2", "after"]);
      assert.equal(by["profile.activity.heading"].text, "Contribution activity");
      for (const a of r.anchors) assert.equal(a.authored, false, a.slot);
      assert.equal(r.unchanged, true, "locating anchors never edits the page");
    });

    test("an empty profile, a confirmed 404 and the issue list give exactly their evidenced or dormant results", async () => {
      assert.deepEqual(slots(await locate(EMPTY_PROFILE, { url: "https://github.com/empty-sample" })), ["empty.pinned.caption", "profile.pinned.heading", "profile.tag"]);
      const nf = await locate(NOT_FOUND, { url: "https://github.com/octo-sample/missing" });
      assert.equal(nf.route, "not-found");
      assert.deepEqual(nf.anchors.map((a) => [a.slot, a.host, a.insert]), [["error.notFound.caption", "div.position-relative", "after"]]);
      // Dormant: the live blankslate sits in a focusable list and a live region, and even a safe
      // copy of it stays dormant until new evidence enables the slot.
      for (const focusable of [true, false]) {
        const r = await locate(ISSUES(focusable), { url: "https://github.com/sample/repo/issues" });
        assert.equal(r.route, "issues");
        assert.deepEqual(r.anchors, []);
      }
      const repo = await locate(REPOSITORY, { url: "https://github.com/sample/repo" });
      assert.equal(repo.route, "repository");
      assert.deepEqual(repo.anchors, []);
    });

    test("changed wording, duplicates, other languages and nested controls leave a slot alone", async () => {
      const cases = [
        ["changed wording", () => (document.querySelector(".js-pinned-items-reorder-container > h2").firstChild.data = " Pinned repos "), "profile.pinned.heading"],
        ["duplicate anchor", () => document.querySelector(".js-pinned-items-reorder-container").after(document.querySelector(".js-pinned-items-reorder-container").cloneNode(true)), "profile.pinned.heading"],
        ["heading turned into a link", () => { const h = document.querySelector("#js-contribution-activity > h2"); h.innerHTML = '<a href="/x">Contribution activity</a>'; }, "profile.activity.heading"],
        ["control inside the heading", () => document.querySelector(".js-pinned-items-reorder-container > h2").append(Object.assign(document.createElement("button"), { textContent: "Edit" })), "profile.pinned.heading"],
        ["heading inside a control", () => { const h = [...document.querySelectorAll(".border-top > h2")].find((e) => e.textContent === "Organizations"); const b = document.createElement("div"); b.setAttribute("role", "button"); h.before(b); b.append(h, h.nextElementSibling); }, "profile.organizations.heading"],
        ["organizations heading without organization links", () => document.querySelector("a.avatar-group-item").remove(), "profile.organizations.heading"],
        ["contribution count reworded", () => (document.querySelector("#js-contribution-activity-description").firstChild.data = " 1,234 Beiträge "), "contributions.caption"],
        ["graph moved", () => document.querySelector(".graph-before-activity-overview").remove(), "contributions.caption"],
        ["anchor inside a live region", () => document.querySelector("#js-contribution-activity").setAttribute("aria-live", "polite"), "profile.activity.heading"],
      ];
      for (const [label, mutate, slot] of cases) {
        const r = await locate(PROFILE, { mutate });
        assert.ok(!slots(r).includes(slot), `${label}: ${slot} must be skipped`);
        assert.equal(r.anchors.length, 4, `${label}: the other slots are unaffected`);
      }
      assert.deepEqual((await locate(PROFILE, { mutate: () => document.documentElement.setAttribute("lang", "de") })).anchors, []);
    });

    test("route guards: wrong route class, other hosts and Gist run no profile or 404 locators", async () => {
      assert.deepEqual((await locate(PROFILE, { route: "issues" })).anchors, []);
      assert.deepEqual((await locate(PROFILE, { mutate: () => document.querySelector("meta[name='route-controller']").setAttribute("content", "profiles_repositories") })).route, "other");
      const gist = await locate(PROFILE, { url: "https://gist.github.com/octo-sample/0123456789abcdef0123" });
      assert.equal(gist.route, "gist");
      assert.deepEqual(gist.anchors, []);
      const notFoundOnGist = await locate(NOT_FOUND, { url: "https://gist.github.com/octo-sample/missing" });
      assert.deepEqual(notFoundOnGist.anchors, []);
      assert.deepEqual((await locate(PROFILE, { url: "https://github.example.com/octo-sample" })).anchors, []);
    });

    test("route classification and slot discovery stay within the startup query budget", async () => {
      const context = await browser.newContext();
      const url = "https://github.com/octo-sample";
      await context.route("**/*", (r) => (r.request().url() === url ? r.fulfill({ contentType: "text/html", body: PROFILE }) : r.abort()));
      const page = await context.newPage();
      await page.goto(url);
      await page.addScriptTag({ content: bundle });
      await page.evaluate(frozenClock);
      const result = await page.evaluate(() => {
        const calls = { document: [], element: 0 };
        for (const [proto, kind] of [[Document.prototype, "document"], [Element.prototype, "element"]]) {
          for (const method of ["querySelector", "querySelectorAll"]) {
            const original = proto[method];
            proto[method] = function (selector) {
              if (kind === "document") calls.document.push(selector);
              else calls.element++;
              return original.call(this, selector);
            };
          }
        }
        const G = globalThis.ReskinGitHub;
        const route = G.classifyRoute(document);
        const anchors = G.locateSlots(document, route);
        return { route, anchors: anchors.length, calls };
      });
      await context.close();
      assert.equal(result.route, "profile");
      assert.equal(result.anchors, 5);
      // One document query to classify and one to verify the route and find every candidate,
      // within the architecture's six; each anchor's guard reads at most two small subtrees.
      assert.equal(result.calls.document.length, 2, result.calls.document.join("\n"));
      assert.ok(result.calls.element <= 2 * result.anchors, `${result.calls.element} element-scoped queries`);
    });

    test("too many candidates or too much time yields no anchors at all", async () => {
      const crowd = () => {
        const card = document.querySelector(".Layout-sidebar .h-card");
        for (let i = 0; i < 250; i++) card.append(Object.assign(document.createElement("h2"), { textContent: `Heading ${i}` }));
      };
      assert.deepEqual((await locate(PROFILE, { mutate: crowd })).anchors, []);
      assert.deepEqual((await locate(PROFILE, { clock: slowClock })).anchors, []);
      assert.equal((await locate(PROFILE)).anchors.length, 5);
    });

    test("r4-3 slot results do not depend on the runner's clock: a runner too slow for 4 ms still gets every semantic anchor", async () => {
      // The page's own clock runs out on every reading, as on a loaded CI runner; the helper's
      // controlled clock replaces it, so the semantic result is the same as on a fast machine.
      const r = await locate(PROFILE, { init: slowClock });
      assert.deepEqual(slots(r), ["contributions.caption", "profile.activity.heading", "profile.organizations.heading", "profile.pinned.heading", "profile.tag"]);
      assert.equal((await locate(PROFILE, { init: slowClock, mutate: () => document.querySelector("a.avatar-group-item").remove() })).anchors.length, 4);
      // The production allowance still applies to the clock the adapter reads.
      assert.deepEqual((await locate(PROFILE, { init: slowClock, clock: slowClock })).anchors, []);
    });

    test("authored copies of GitHub's structure never anchor, even with GitHub's classes", async () => {
      // GitHub strips classes from Markdown, but the guard does not rely on that.
      const forged = () => {
        const readme = document.querySelector(".markdown-body");
        readme.insertAdjacentHTML("beforeend", '<div class="js-pinned-items-reorder-container"><h2>Pinned</h2></div><div id="js-contribution-activity"><h2>Contribution activity</h2></div><img data-static-error-asset="404-illustration">');
        document.querySelector(".Layout-main > turbo-frame .mt-4 .js-pinned-items-reorder-container").remove();
        document.querySelector(".Layout-main #js-contribution-activity:not(.markdown-body *)").remove();
      };
      const r = await locate(PROFILE, { mutate: forged });
      assert.deepEqual(slots(r), ["contributions.caption", "profile.organizations.heading", "profile.tag"]);
      for (const a of r.anchors) assert.equal(a.authored, false);
    });
  });
}
