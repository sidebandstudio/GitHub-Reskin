// Native CSS admission in Chromium and Firefox, against the registry fixture served at a
// github.com URL with no network: which subjects get a host-issued kind marker, and that every
// invalidation removes markers or the document's native gate before the next styled render.
// Each check reads the marker and the computed style inside the next animation frame callback,
// which runs before that frame's style and paint.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, firefox } from "playwright";
import { compileCss, sanitizeCss } from "../../packages/format/index.js";
import { compileGitHub, MODE_INDEX } from "../../packages/primer/index.js";
import { CSS_TARGET_REGISTRY } from "../../packages/primer/registry.js";
import { adapterBundle, PREFS, readText, resolvedFromSeed, stripStyleQueries } from "./helpers.mjs";

const FIXTURE = readText("tests/primer/fixtures/registry.html");
const bundle = await adapterBundle();
const sanitized = sanitizeCss(readText("tests/primer/fixtures/choom-native-proposed.css"), { path: "/css" });
const compiled = compileCss(sanitized.value, { registry: CSS_TARGET_REGISTRY, cssAllowed: true, preferences: { ...PREFS, appearance: "full" }, policy: "themed" });
assert.ok(compiled.ok && compiled.nativeRules === 8);
// The dark-base plan's modes in the frozen index.
const MODES = ["light", "dark", "dark_dimmed"];
// The protected flows the fixture holds on its reviewed profile route, each with a sidebar heading
// at a reviewed signature and a primary button.
const FLOWS = ["login", "signup", "logout", "tokens", "billing", "invite", "transfer", "warning", "verified"];
const BUTTONS = ["login", "signup", "logout", "tokens", "billing", "invite", "transfer", "advisory", "section"];

// A repository overview with the selected repository tab, at its registry signature.
const REPOSITORY = `<!doctype html><html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head>
<title>octo/sample · GitHub</title><meta name="route-controller" content="files"><meta name="route-action" content="disambiguate"></head>
<body><header class="GlobalNav"><nav aria-label="Repository"><ul><li><a id="rtab" aria-current="page" data-tab-item="code" href="/octo/sample"><span>Code</span></a></li></ul></nav></header>
<main><div itemscope itemtype="http://schema.org/SoftwareSourceCode"><p id="readme">README</p></div></main></body></html>`;

// A page whose only island is its themed root, with GitHub's own button and box geometry as
// primer.css gives them, protected UI and the same components outside it.
const STRUCTURED = `<!doctype html><html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head><title>Structured</title>
<style>.btn{border:1px solid #d1d9e0;border-radius:6px}.Box{border:1px solid #d1d9e0;border-radius:6px}</style></head>
<body><main>
<form action="/session"><button id="p-login" class="btn btn-primary" type="submit">Sign in</button></form>
<div class="flash flash-warn"><div class="Box" id="warn-box">Warning</div></div>
<dialog id="confirm"><button class="btn" id="confirm-btn">Delete</button></dialog>
<div id="menu-pop" popover="auto"><button class="btn" id="pop-btn">Leave</button></div>
<div class="Box" id="free-box">Box</div><button class="btn" id="free-btn">Edit</button><a class="btn btn-primary" id="free-primary" href="/octo/sample">Open</a>
</main></body></html>`;

// Protected fragments on a themed dark root with GitHub's own mode stylesheets: a plain warning,
// warnings holding or being a standard island, an ordinary sign-in form with a query and a
// membership form, warnings inside a light and a dimmed island, past the sixth nested island and
// inside a light island in a warning, a wrapper that becomes a warning, and a standard island
// outside protected UI. Islands take their color scheme as primer.css gives it, and boxes and
// buttons paint from Primer variables.
const ISLAND = 'data-color-mode="dark" data-light-theme="light" data-dark-theme="dark"';
const parts = (id) => `<div class="Box" id="${id}-box">Security warning</div><button class="btn btn-primary" id="${id}-btn">Confirm</button>`;
const FRAGMENTS = `<!doctype html><html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head><title>Protected</title>
<style>${["light", "dark", "dark_dimmed"].map((id) => readText(`vendor/primer/source/${id}.css`)).join("\n")}</style>
<style>:root,[data-color-mode=light][data-light-theme*=light],[data-color-mode=dark][data-dark-theme*=light]{color-scheme:light}
[data-color-mode=light][data-light-theme*=dark],[data-color-mode=dark][data-dark-theme*=dark]{color-scheme:dark}
@media (prefers-color-scheme:dark){[data-color-mode=auto][data-dark-theme*=light]{color-scheme:light}[data-color-mode=auto][data-dark-theme*=dark]{color-scheme:dark}}
body{color:var(--fgColor-default);background:var(--bgColor-default)}.btn{color:var(--button-primary-fgColor-rest);background:var(--button-primary-bgColor-rest);border:1px solid var(--button-primary-borderColor-rest);border-radius:6px;box-shadow:none}.Box{border:1px solid var(--borderColor-default);border-radius:6px;background:var(--bgColor-default);color:var(--fgColor-default)}</style></head>
<body><main>
<div class="flash flash-warn">${parts("plain")}</div>
<div class="flash flash-warn"><div ${ISLAND}>${parts("nested")}</div></div>
<div class="flash flash-warn" ${ISLAND}>${parts("self")}</div>
<form action="/session?return_to=%2F">${parts("query")}</form>
<form action="/orgs/octo/teams/admin/memberships">${parts("permission")}</form>
<div data-color-mode="light" data-light-theme="light" data-dark-theme="dark"><div class="flash">${parts("light")}</div></div>
<div data-color-mode="dark" data-light-theme="light" data-dark-theme="dark_dimmed"><div class="flash">${parts("dimmed")}</div></div>
${`<div ${ISLAND}>`.repeat(7)}<div class="flash">${parts("deep")}</div>${"</div>".repeat(7)}
<div class="flash"><div data-color-mode="light" data-light-theme="light" data-dark-theme="dark"><div class="flash">${parts("within")}</div></div></div>
<div id="later"><div ${ISLAND}>${parts("later")}</div></div>
<div ${ISLAND}>${parts("free")}</div>
</main></body></html>`;
const FRAGMENT_IDS = ["plain", "nested", "self", "query", "permission", "light", "dimmed", "deep", "within"];

// In-page helpers, installed once per page.
function install({ css, modes, pace }) {
  const G = globalThis.ReskinGitHub;
  // Shared CI runners are a few times slower than a user's machine, so there the classification
  // budget is read from a clock running at `pace`; these tests are about which subjects are
  // admitted, not about the budget, which keeps its real value everywhere else.
  const clock = { now: () => performance.now() * pace };
  const style = document.createElement("style");
  // The audited variables the compiled rules read, as the Primer stylesheet sets them.
  style.textContent = `:root{--reskin-accent:#fcee0a;--reskin-graph-4:#00f0ff;--reskin-link:#fcee0a}\n${css}`;
  document.head.append(style);
  window.events = [];
  window.H = G.startAdmission(document, { modes, clock, onEvent: (e) => window.events.push({ ...e, at: performance.now() }) });
  window.frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  window.settle = async () => {
    for (let i = 0; i < 30 && window.H.state().pending; i++) await window.frame();
    return window.H.state();
  };
  window.admitted = () => [...document.querySelectorAll("[data-reskin-css-kind]")].map((el) => el.id || el.localName).sort();
  const read = (el) => {
    const cs = getComputedStyle(el);
    return { kind: el.getAttribute("data-reskin-css-kind"), shadow: cs.boxShadow, textShadow: cs.textShadow, letterSpacing: cs.letterSpacing };
  };
  window.read = (id) => read(document.getElementById(id));
  // Runs `change`, then reports the gate, a subject's marker and its computed shadows from inside
  // the next animation frame callback, before that frame renders. The subject is found by `id`
  // after the change, so the change may insert it.
  window.nextFrame = (change, id = "tab") =>
    new Promise((resolve) => {
      const el = document.getElementById(id);
      const prior = el && getComputedStyle(el).boxShadow;
      const priorText = el && getComputedStyle(el).textShadow;
      change();
      requestAnimationFrame(() => {
        resolve({ prior, priorText, gate: document.documentElement.getAttribute("data-reskin-css-native") === "active", ...read(document.getElementById(id)) });
      });
    });
}
const PACE = process.env.CI ? 1 / 3 : 1;
const run = (page, change, id) => page.evaluate(([source, id]) => window.nextFrame(new Function(`return (${source})()`), id), [change.toString(), id]);

for (const [name, engine] of [["Chromium", chromium], ["Firefox", firefox]]) {
  describe(`native CSS admission in ${name}`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch();
    });
    after(async () => {
      await browser?.close();
    });

    async function open(html = FIXTURE, url = "https://github.com/octo-sample", options = {}) {
      const context = await browser.newContext({ colorScheme: "light", ...options });
      await context.route("**/*", (r) => (r.request().url() === url ? r.fulfill({ contentType: "text/html", body: html }) : r.abort()));
      const page = await context.newPage();
      await page.goto(url);
      await page.addScriptTag({ content: bundle });
      await page.evaluate(install, { css: compiled.css, modes: MODES, pace: PACE });
      const state = await page.evaluate(() => window.settle());
      return { page, context, state };
    }

    test("only reviewed subjects outside protected, authored, dialog and other islands are admitted", async () => {
      const { page, context, state } = await open();
      assert.equal(state.route, "profile");
      assert.equal(state.gate, true);
      const admitted = await page.evaluate(() => window.admitted());
      assert.deepEqual(admitted, ["blob", "body", "contribution-graph-legend-level-0", "contribution-graph-legend-level-4", "day-0", "day-1", "day-2", "day-3", "day-4", "h-achievements", "h-highlights", "mktg", "point", "tab"]);
      const reasons = await page.evaluate(() => Object.fromEntries(["h-button", "h-island", "h-bare", "h-authored", "h-dialog", "primary", "primary-form", "day-authored", "day-loose", "tab-other"].map((id) => [id, window.H.explain(document.getElementById(id))])));
      assert.deepEqual(reasons, {
        "h-button": "unreviewed descendant",
        "h-island": "island",
        "h-bare": "island",
        "h-authored": "inside authored content",
        "h-dialog": "inside protected UI",
        // The primary-button subject is dormant: no primary button is a candidate.
        primary: "not a candidate",
        "primary-form": "not a candidate",
        "day-authored": "not a candidate",
        "day-loose": "not a candidate",
        "tab-other": "not a candidate",
      });
      // Admitted subjects take the theme's rules; refused lookalikes keep GitHub's.
      const styles = await page.evaluate(() => Object.fromEntries(["primary", "primary-form", "tab", "h-highlights", "h-button"].map((id) => [id, window.read(id)])));
      assert.equal(styles.primary.shadow, "none");
      assert.equal(styles["primary-form"].shadow, "none");
      assert.match(styles.tab.shadow, /10px/);
      assert.match(styles["h-highlights"].textShadow, /12px/);
      assert.equal(styles["h-button"].textShadow, "none");
      await context.close();
    });

    test("no subject and no primary button in a sign-in, sign-up, sign-out, token, billing, invitation, transfer, warning or verification flow is admitted, initially, inserted or reused", async () => {
      const { page, context } = await open();
      const initial = await page.evaluate(([flows, buttons]) => ({
        headings: Object.fromEntries(flows.map((f) => [f, { why: window.H.explain(document.getElementById(`h-${f}`)), ...window.read(`h-${f}`) }])),
        buttons: Object.fromEntries(buttons.map((b) => [b, window.read(`p-${b}`)])),
      }), [FLOWS, BUTTONS]);
      for (const f of FLOWS) {
        assert.notEqual(initial.headings[f].why, "admitted", f);
        assert.deepEqual([initial.headings[f].kind, initial.headings[f].textShadow, initial.headings[f].letterSpacing], [null, "none", "normal"], f);
      }
      for (const b of BUTTONS) assert.deepEqual([initial.buttons[b].kind, initial.buttons[b].shadow], [null, "none"], b);
      // A sign-out form inserted after classification: native in the next frame and afterwards.
      const inserted = await run(page, () => document.querySelector(".Layout-sidebar").append(Object.assign(document.createElement("form"), { action: "/logout", method: "post", innerHTML: '<h2 id="h-late" class="h4 mb-2">Sign out</h2><button id="p-late" class="btn btn-primary">Sign out</button>' })), "h-late");
      assert.deepEqual([inserted.kind, inserted.textShadow], [null, "none"]);
      await page.evaluate(() => window.settle());
      assert.deepEqual(await page.evaluate(() => [window.read("h-late").kind, window.read("p-late").kind, window.read("h-late").textShadow]), [null, null, "none"]);
      // An admitted heading reused inside a token form loses its marker before the next frame and
      // is not admitted again.
      const reused = await run(
        page,
        () => {
          const form = Object.assign(document.createElement("form"), { action: "/settings/tokens" });
          document.querySelector(".Layout-sidebar").append(form);
          form.append(document.getElementById("h-highlights"));
        },
        "h-highlights",
      );
      assert.match(reused.priorText, /12px/, "the heading had its theme glow");
      assert.deepEqual([reused.kind, reused.textShadow], [null, "none"]);
      await page.evaluate(() => window.settle());
      assert.equal(await page.evaluate(() => window.H.explain(document.getElementById("h-highlights"))), "inside protected UI");
      assert.equal(await page.evaluate(() => window.read("h-highlights").textShadow), "none");
      await context.close();
    });

    test("an inserted warning, reused nodes and future dialog markup revoke before the next styled render", async () => {
      const { page, context } = await open();
      const cases = {
        warning: () => document.querySelector("main").prepend(Object.assign(document.createElement("div"), { className: "flash flash-warn", textContent: "Warning" })),
        "reused class": () => (document.getElementById("h-highlights").className = "flash flash-error"),
        "reused role": () => document.getElementById("h-achievements").setAttribute("role", "alertdialog"),
        "future dialog": () => document.body.append(Object.assign(document.createElement("x-review-panel"), { innerHTML: '<div role="dialog" aria-modal="true">Confirm</div>' })),
        "alert in a README": () => document.getElementById("readme").append(Object.assign(document.createElement("span"), { role: "alert", textContent: "Verify" })),
      };
      for (const [label, change] of Object.entries(cases)) {
        await page.evaluate(() => window.H.update({}));
        assert.equal((await page.evaluate(() => window.settle())).gate, true, `${label}: admitted before`);
        const r = await run(page, change, "tab");
        assert.match(r.prior, /10px/, `${label}: the selected tab had its theme shadow`);
        assert.equal(r.gate, false, `${label}: the native gate is off before the next frame`);
        assert.equal(r.shadow, "none", `${label}: the selected tab lost its theme shadow before the next frame`);
        // While the warning or dialog is shown, classification keeps the gate off.
        assert.equal((await page.evaluate(() => window.settle())).gate, false, `${label}: stays off`);
        await page.goto("https://github.com/octo-sample");
        await page.addScriptTag({ content: bundle });
        await page.evaluate(install, { css: compiled.css, modes: MODES, pace: PACE });
      }
      await context.close();
    });

    test("opening an existing dialog or popover with no insertion or route event revokes at once, and closing it restores admission", async () => {
      const { page, context } = await open();
      const modal = await page.evaluate(() => window.nextFrame(() => document.getElementById("existing").showModal()));
      assert.match(modal.prior, /10px/);
      assert.deepEqual([modal.gate, modal.shadow], [false, "none"]);
      await page.evaluate(() => document.getElementById("existing").close());
      assert.equal((await page.evaluate(() => window.settle())).gate, true, "closing the dialog restores the gate");
      const popover = await page.evaluate(() => window.nextFrame(() => document.getElementById("pop").showPopover()));
      assert.match(popover.prior, /10px/);
      assert.deepEqual([popover.gate, popover.shadow], [false, "none"]);
      await page.evaluate(() => document.getElementById("pop").hidePopover());
      assert.equal((await page.evaluate(() => window.settle())).gate, true, "hiding the popover restores the gate");
      // A tooltip popover is not a layer that blocks.
      await page.evaluate(() => document.getElementById("tip").showPopover());
      assert.equal((await page.evaluate(() => window.settle())).gate, true);
      // Activating a control that can open a layer revokes before the activation lands.
      const summary = await page.evaluate(() => window.nextFrame(() => document.getElementById("menu").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))));
      assert.equal(summary.gate, false);
      await context.close();
    });

    test("a protected child inserted into an admitted subject, or a verification badge in authored text, is seen at once", async () => {
      const { page, context } = await open();
      const r = await page.evaluate(() => window.nextFrame(() => document.getElementById("tab").append(Object.assign(document.createElement("a"), { href: "/login", textContent: "Sign in" })), "tab"));
      assert.match(r.prior, /10px/, "the selected tab had its theme glow");
      assert.equal(r.kind, null, "the tab lost its marker before the next frame");
      assert.equal(r.shadow, "none");
      await page.evaluate(() => window.settle());
      assert.equal(await page.evaluate(() => window.H.explain(document.getElementById("tab"))), "unreviewed descendant");
      assert.equal(await page.evaluate(() => document.querySelector("#tab a[href='/login']").hasAttribute("data-reskin-protected")), true);
      // Authored subtrees are observed for invalidation, never styled.
      const badge = await page.evaluate(() =>
        window.nextFrame(() => document.getElementById("readme").append(Object.assign(document.createElement("span"), { className: "signed-commit-badge", textContent: "Verified" })), "readme"),
      );
      assert.equal(badge.kind, null);
      assert.equal(await page.evaluate(() => document.querySelector("#readme .signed-commit-badge").hasAttribute("data-reskin-protected")), true);
      await context.close();
    });

    test("an editor, live region or structural change on a subject or in it withdraws admission before the next frame and is never readmitted", async () => {
      const cases = [
        ["editable heading", () => document.getElementById("h-highlights").setAttribute("contenteditable", "true"), "h-highlights", "inside authored content"],
        ["live heading", () => document.getElementById("h-highlights").setAttribute("aria-live", "polite"), "h-highlights", "inside authored content"],
        ["status link inside a heading", () => document.querySelector("#h-achievements a").setAttribute("role", "status"), "h-achievements", "unreviewed descendant"],
        ["editable link inside a heading", () => document.querySelector("#h-achievements a").setAttribute("contenteditable", ""), "h-achievements", "unreviewed descendant"],
        ["renamed profile navigation", () => document.querySelector('nav[aria-label="User profile"]').setAttribute("aria-label", "Sponsor tiers"), "tab", "not a candidate"],
      ];
      for (const [label, change, id, why] of cases) {
        const { page, context } = await open();
        const r = await run(page, change, id);
        assert.ok(/10px|12px/.test(r.prior) || /12px/.test(r.priorText), `${label}: themed before`);
        assert.deepEqual([r.kind, r.shadow, r.textShadow, r.letterSpacing], [null, "none", "none", "normal"], `${label}: native before the next frame`);
        await page.evaluate(() => window.settle());
        assert.equal(await page.evaluate((id) => window.H.explain(document.getElementById(id)), id), why, label);
        assert.deepEqual(await page.evaluate((id) => [window.read(id).kind, window.read(id).textShadow], id), [null, "none"], `${label}: stays native`);
        await context.close();
      }
      // A repository tab that loses the attribute its signature names.
      const { page, context, state } = await open(REPOSITORY, "https://github.com/octo/sample");
      assert.deepEqual([state.route, state.gate], ["repository", true]);
      const r = await run(page, () => document.getElementById("rtab").removeAttribute("data-tab-item"), "rtab");
      assert.match(r.prior, /10px/);
      assert.deepEqual([r.kind, r.shadow], [null, "none"]);
      await page.evaluate(() => window.settle());
      assert.equal(await page.evaluate(() => window.H.explain(document.getElementById("rtab"))), "not a candidate");
      await context.close();
    });

    test("forced colors keep advanced CSS off through mutations, events and updates, and it returns only once they clear", async () => {
      const none = () => page.evaluate(() => ({ ...window.H.state(), kinds: document.querySelectorAll("[data-reskin-css-kind]").length }));
      let page;
      // Active from the start.
      const started = await open(FIXTURE, "https://github.com/octo-sample", { forcedColors: "active" });
      page = started.page;
      assert.equal(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
      for (const poke of [
        () => document.getElementById("readme").append(document.createElement("i")),
        () => document.getElementById("h-highlights").setAttribute("class", "h4 mb-2"),
        () => window.dispatchEvent(new Event("turbo:render")),
        () => document.getElementById("menu").dispatchEvent(new MouseEvent("click", { bubbles: true })),
        () => window.H.update({}),
      ]) {
        await page.evaluate((source) => new Function(`return (${source})()`)(), poke.toString());
        await page.evaluate(() => window.settle());
        const s = await none();
        assert.deepEqual([s.gate, s.scope, s.admitted, s.kinds], [false, false, 0, 0], poke.toString());
        assert.equal(await page.evaluate(() => window.read("h-highlights").letterSpacing), "normal");
      }
      await started.context.close();
      // Active mid-session, then cleared.
      const later = await open();
      page = later.page;
      assert.equal(later.state.gate, true);
      assert.notEqual(await page.evaluate(() => window.read("h-highlights").letterSpacing), "normal");
      await page.emulateMedia({ forcedColors: "active" });
      await page.evaluate(() => window.frame());
      await page.evaluate(() => (window.cleared = performance.now()));
      await page.evaluate(() => document.getElementById("readme").append(document.createElement("i")));
      await page.evaluate(() => window.settle());
      const s = await none();
      assert.deepEqual([s.gate, s.scope, s.kinds], [false, false, 0]);
      assert.equal(await page.evaluate(() => window.read("h-highlights").letterSpacing), "normal");
      await page.emulateMedia({ forcedColors: "none" });
      // The change event reaches the runtime in a later rendering update than the media state.
      await page.waitForFunction(() => window.events.some((e) => e.type === "admitted" && e.at > window.cleared), null, { polling: "raf", timeout: 10000 });
      assert.equal((await page.evaluate(() => window.settle())).gate, true, "admission returns once forced colors clear");
      await later.context.close();
    });

    test("route, cache and history events strip every marker synchronously; Calm and unreviewed routes admit nothing", async () => {
      const { page, context } = await open();
      const stripped = await page.evaluate(() => {
        window.dispatchEvent(new Event("turbo:before-render"));
        return { kinds: document.querySelectorAll("[data-reskin-css-kind]").length, gate: document.documentElement.hasAttribute("data-reskin-css-native") };
      });
      assert.deepEqual(stripped, { kinds: 0, gate: false });
      await page.evaluate(() => window.dispatchEvent(new Event("turbo:render")));
      assert.equal((await page.evaluate(() => window.settle())).gate, true);
      // Calm, Off, native policy or missing consent: cssAllowed false removes every marker.
      await page.evaluate(() => window.H.update({ cssAllowed: false }));
      const calm = await page.evaluate(async () => ({ ...(await window.settle()), kinds: document.querySelectorAll("[data-reskin-css-kind]").length }));
      assert.deepEqual([calm.gate, calm.scope, calm.kinds], [false, false, 0]);
      // Disposing removes every marker it wrote.
      await page.evaluate(() => window.H.dispose());
      assert.equal(await page.evaluate(() => document.querySelectorAll("[data-reskin-css],[data-reskin-css-native],[data-reskin-css-kind],[data-reskin-protected]").length), 0);
      await context.close();
      // The same markup on a route outside the registry earns nothing.
      const unknown = await open(FIXTURE.replace('content="profiles"', 'content="settings"'), "https://github.com/settings/profile");
      assert.deepEqual([unknown.state.route, unknown.state.gate, unknown.state.scope], ["other", false, false]);
      assert.equal(await unknown.page.evaluate(() => document.querySelectorAll("[data-reskin-css-kind]").length), 0);
      await unknown.context.close();
    });

    test("more mutation records than one pass allows revoke the gate, and classification resumes inside its budget", async () => {
      const { page, context } = await open();
      const r = await page.evaluate(() =>
        window.nextFrame(() => {
          const host = document.getElementById("readme");
          for (let i = 0; i < 260; i++) host.append(document.createElement("i"));
        }),
      );
      assert.match(r.prior, /10px/);
      assert.deepEqual([r.gate, r.shadow], [false, "none"]);
      const state = await page.evaluate(() => window.settle());
      assert.equal(state.gate, true);
      assert.ok(await page.evaluate(() => window.events.some((e) => e.type === "revoked")));
      await context.close();
    });

    // The composed stylesheet: structured Primer rules with bevelled corners, heavy borders and a
    // glow, then the theme's advanced CSS. Protected UI keeps exactly GitHub's own computed
    // styling, also when a warning arrives late or a dialog opens.
    for (const appearance of ["full", "calm"]) {
      test(`structured rules leave protected UI GitHub's own in ${appearance === "full" ? "Full" : "Calm"}`, async () => {
        const resolved = resolvedFromSeed(MODE_INDEX.modes.dark);
        resolved.appearance = { ...resolved.appearance, shape: { corners: { style: "bevel", radius: 12 }, borders: { width: 4, style: "solid", color: "#123456" }, shadows: { style: "glow", color: "#fcee0a", opacity: 0.6, blur: 24, offset: 0 }, buttons: { style: "bevel", radius: 8 }, avatar: null } };
        const prefs = { ...PREFS, appearance };
        const primer = compileGitHub(resolved, { seedMode: "dark", policy: "themed" }, prefs).css;
        const { page, context } = await open(STRUCTURED, "https://github.com/octo-sample/structured");
        const ids = ["p-login", "warn-box", "confirm-btn", "pop-btn", "free-box", "free-btn", "free-primary"];
        const snapshot = () =>
          page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
            const cs = getComputedStyle(document.getElementById(id));
            return [id, [cs.borderTopLeftRadius, cs.borderTopWidth, cs.borderTopColor, cs.boxShadow]];
          })), ids);
        await page.evaluate(() => window.H.dispose());
        const native = await snapshot();
        await page.evaluate((css) => document.head.append(Object.assign(document.createElement("style"), { textContent: css })), primer);
        const themed = await snapshot();
        // The same rules do reach GitHub's own elements outside protected UI.
        for (const id of ["free-box", "free-btn"]) assert.notDeepEqual(themed[id], native[id], `${appearance} ${id} is themed`);
        for (const id of ["p-login", "warn-box", "confirm-btn", "pop-btn"]) assert.deepEqual(themed[id], native[id], `${appearance} ${id} keeps GitHub's styling`);
        // A late warning and an opened dialog or popover are GitHub's own in their first frame.
        const late = await page.evaluate(() => new Promise((resolve) => {
          document.querySelector("main").append(Object.assign(document.createElement("div"), { className: "flash flash-error", innerHTML: '<div class="Box" id="late-box">Late</div>' }));
          document.getElementById("confirm").showModal();
          document.getElementById("menu-pop").showPopover();
          requestAnimationFrame(() => resolve(["late-box", "confirm-btn", "pop-btn"].map((id) => {
            const cs = getComputedStyle(document.getElementById(id));
            return [cs.borderTopLeftRadius, cs.borderTopWidth, cs.borderTopColor, cs.boxShadow];
          })));
        }));
        assert.deepEqual(late, [native["warn-box"], native["confirm-btn"], native["pop-btn"]]);
        // Full keeps the primary glow outside protected UI; Calm drops it.
        assert.equal(themed["free-primary"][3] === "none", appearance === "calm", `${appearance} primary glow`);
        // Protected UI clears every Reskin switch for itself and its descendants.
        assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("confirm-btn")).getPropertyValue("--reskin-on")), "");
        await context.close();
      });

      // Every protected fragment and everything in it keeps GitHub's own computed colors for its
      // nearest island's mode, and no island inside or on it reopens structured styling, also in
      // the first frame after an ordinary wrapper becomes a warning. Firefox also runs the
      // selector fallback Gecko uses before Firefox 151, which gives a warning inside the plan's
      // light or dimmed island GitHub's own colors of the seed's mode, dark, as the root has.
      for (const fallback of name === "Firefox" ? [false, true] : [false]) {
        test(`protected fragments and forms keep their nearest island's native colors and components in ${appearance === "full" ? "Full" : "Calm"}${fallback ? " through the selector fallback" : ""}`, async () => {
          const resolved = resolvedFromSeed(MODE_INDEX.modes.dark, { "/tokens/canvas": "#101a2b", "/tokens/text": "#fafbe0", "/tokens/border": "#ff00aa" });
          resolved.appearance = { ...resolved.appearance, shape: { corners: { style: "sharp", radius: 0 }, borders: { width: 4, style: "solid", color: "#123456" }, shadows: { style: "neon", color: "#fcee0a", opacity: 0.7, blur: 24, offset: 0 }, buttons: { style: "bevel", radius: 8 }, avatar: null } };
          const primer = compileGitHub(resolved, { seedMode: "dark", policy: "themed" }, { ...PREFS, appearance });
          const css = fallback ? stripStyleQueries(primer.css) : primer.css;
          const { page, context } = await open(FRAGMENTS, "https://github.com/octo-sample/protected", { colorScheme: "dark" });
          const ids = [...FRAGMENT_IDS, "later", "free"].flatMap((id) => [`${id}-box`, `${id}-btn`]);
          const snapshot = () =>
            page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
              const cs = getComputedStyle(document.getElementById(id));
              return [id, [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderTopWidth, cs.borderTopLeftRadius, cs.boxShadow, cs.colorScheme, cs.getPropertyValue("--bgColor-default"), cs.getPropertyValue("--fgColor-default"), cs.getPropertyValue("--reskin-on")]];
            })), ids);
          const native = await snapshot();
          await page.evaluate((css) => document.head.append(Object.assign(document.createElement("style"), { textContent: css })), css);
          const themed = await snapshot();
          // The island outside protected UI is themed, and the theme's colors differ from GitHub's.
          assert.equal(themed["free-box"][1], "rgb(16, 26, 43)");
          assert.notDeepEqual(themed["free-box"], native["free-box"]);
          assert.notDeepEqual(themed["later-btn"], native["later-btn"]);
          for (const id of FRAGMENT_IDS) {
            const own = fallback && (id === "light" || id === "dimmed") ? "plain" : id;
            for (const part of ["box", "btn"]) assert.deepEqual(themed[`${id}-${part}`], native[`${own}-${part}`], `${appearance} ${id}-${part} keeps GitHub's own colors and components`);
          }
          // The light and dimmed warnings take their own island's values, not the dark root's.
          assert.notEqual(native["light-box"][1], native["plain-box"][1]);
          assert.notEqual(native["dimmed-box"][1], native["plain-box"][1]);
          // A wrapper that becomes a warning is native, island and all, in the next frame.
          const late = await page.evaluate(() => new Promise((resolve) => {
            document.getElementById("later").className = "flash flash-warn";
            requestAnimationFrame(() => resolve(["later-box", "later-btn"].map((id) => {
              const cs = getComputedStyle(document.getElementById(id));
              return [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderTopWidth, cs.borderTopLeftRadius, cs.boxShadow, cs.colorScheme, cs.getPropertyValue("--bgColor-default"), cs.getPropertyValue("--fgColor-default"), cs.getPropertyValue("--reskin-on")];
            })));
          }));
          assert.deepEqual(late, [native["later-box"], native["later-btn"]]);
          await context.close();
        });
      }
    }
  });
}
