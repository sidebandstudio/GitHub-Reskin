// Native CSS admission in Chromium and Firefox, against the registry fixture served at a
// github.com URL with no network: which subjects get a host-issued kind marker, and that every
// invalidation removes markers or the document's native gate before the next styled render.
// Each check reads the marker and the computed style inside the next animation frame callback,
// which runs before that frame's style and paint.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, firefox } from "playwright";
import { compileCss, sanitizeCss } from "../../packages/format/index.js";
import { CSS_TARGET_REGISTRY } from "../../packages/primer/registry.js";
import { adapterBundle, PREFS, readText } from "./helpers.mjs";

const FIXTURE = readText("tests/primer/fixtures/registry.html");
const bundle = await adapterBundle();
const sanitized = sanitizeCss(readText("tests/primer/fixtures/choom-native-proposed.css"), { path: "/css" });
const compiled = compileCss(sanitized.value, { registry: CSS_TARGET_REGISTRY, cssAllowed: true, preferences: { ...PREFS, appearance: "full" }, policy: "themed" });
assert.ok(compiled.ok && compiled.nativeRules === 8);
// The dark-base plan's modes in the frozen index.
const MODES = ["light", "dark", "dark_dimmed"];

// In-page helpers, installed once per page.
function install({ css, modes }) {
  const G = globalThis.ReskinGitHub;
  const style = document.createElement("style");
  // The audited variables the compiled rules read, as the Primer stylesheet sets them.
  style.textContent = `:root{--reskin-accent:#fcee0a;--reskin-graph-4:#00f0ff;--reskin-link:#fcee0a}\n${css}`;
  document.head.append(style);
  window.events = [];
  window.H = G.startAdmission(document, { modes, onEvent: (e) => window.events.push(e) });
  window.frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  window.settle = async () => {
    for (let i = 0; i < 30 && window.H.state().pending; i++) await window.frame();
    return window.H.state();
  };
  window.admitted = () => [...document.querySelectorAll("[data-reskin-css-kind]")].map((el) => el.id || el.localName).sort();
  // Runs `change`, then reports the gate, a subject's marker and its computed shadow from inside
  // the next animation frame callback, before that frame renders.
  window.nextFrame = (change, id = "primary") =>
    new Promise((resolve) => {
      const el = document.getElementById(id);
      const prior = getComputedStyle(el).boxShadow;
      change();
      requestAnimationFrame(() => {
        const cs = getComputedStyle(el);
        resolve({ prior, gate: document.documentElement.getAttribute("data-reskin-css-native") === "active", kind: el.getAttribute("data-reskin-css-kind"), shadow: cs.boxShadow, textShadow: cs.textShadow });
      });
    });
}

for (const [name, engine] of [["Chromium", chromium], ["Firefox", firefox]]) {
  describe(`native CSS admission in ${name}`, () => {
    let browser;
    before(async () => {
      browser = await engine.launch();
    });
    after(async () => {
      await browser?.close();
    });

    async function open(html = FIXTURE, url = "https://github.com/octo-sample") {
      const context = await browser.newContext({ colorScheme: "light" });
      await context.route("**/*", (r) => (r.request().url() === url ? r.fulfill({ contentType: "text/html", body: html }) : r.abort()));
      const page = await context.newPage();
      await page.goto(url);
      await page.addScriptTag({ content: bundle });
      await page.evaluate(install, { css: compiled.css, modes: MODES });
      const state = await page.evaluate(() => window.settle());
      return { page, context, state };
    }

    test("only reviewed subjects outside protected, authored, dialog and other islands are admitted", async () => {
      const { page, context, state } = await open();
      assert.equal(state.route, "profile");
      assert.equal(state.gate, true);
      const admitted = await page.evaluate(() => window.admitted());
      assert.deepEqual(admitted, ["blob", "body", "contribution-graph-legend-level-0", "contribution-graph-legend-level-4", "day-0", "day-1", "day-2", "day-3", "day-4", "h-achievements", "h-highlights", "mktg", "point", "primary", "tab"]);
      const reasons = await page.evaluate(() => Object.fromEntries(["h-button", "h-island", "h-bare", "h-authored", "h-dialog", "primary-form", "day-authored", "day-loose", "tab-other"].map((id) => [id, window.H.explain(document.getElementById(id))])));
      assert.deepEqual(reasons, {
        "h-button": "unreviewed descendant",
        "h-island": "island",
        "h-bare": "island",
        "h-authored": "inside authored content",
        "h-dialog": "inside protected UI",
        "primary-form": "inside protected UI",
        "day-authored": "not a candidate",
        "day-loose": "not a candidate",
        "tab-other": "not a candidate",
      });
      // Admitted subjects take the theme's rules; refused lookalikes keep GitHub's.
      const styles = await page.evaluate(() => Object.fromEntries(["primary", "primary-form", "h-highlights", "h-button"].map((id) => [id, getComputedStyle(document.getElementById(id))]).map(([id, cs]) => [id, id.startsWith("primary") ? cs.boxShadow : cs.textShadow])));
      assert.match(styles.primary, /14px/);
      assert.equal(styles["primary-form"], "none");
      assert.match(styles["h-highlights"], /12px/);
      assert.equal(styles["h-button"], "none");
      await context.close();
    });

    test("an inserted warning, reused nodes and future dialog markup revoke before the next styled render", async () => {
      const { page, context } = await open();
      const cases = {
        warning: () => document.querySelector("main").prepend(Object.assign(document.createElement("div"), { className: "flash flash-warn", textContent: "Warning" })),
        "reused class": () => (document.getElementById("h-highlights").className = "flash flash-error"),
        "reused role": () => document.getElementById("tab").setAttribute("role", "alertdialog"),
        "future dialog": () => document.body.append(Object.assign(document.createElement("x-review-panel"), { innerHTML: '<div role="dialog" aria-modal="true">Confirm</div>' })),
        "alert in a README": () => document.getElementById("readme").append(Object.assign(document.createElement("span"), { role: "alert", textContent: "Verify" })),
      };
      for (const [label, change] of Object.entries(cases)) {
        await page.evaluate(() => window.H.update({}));
        assert.equal((await page.evaluate(() => window.settle())).gate, true, `${label}: admitted before`);
        const r = await page.evaluate((source) => window.nextFrame(new Function(`return (${source})()`)), change.toString());
        assert.match(r.prior, /14px/, `${label}: the primary button had its theme shadow`);
        assert.equal(r.gate, false, `${label}: the native gate is off before the next frame`);
        assert.equal(r.shadow, "none", `${label}: the primary button lost its theme shadow before the next frame`);
        // While the warning or dialog is shown, classification keeps the gate off.
        assert.equal((await page.evaluate(() => window.settle())).gate, false, `${label}: stays off`);
        await page.goto("https://github.com/octo-sample");
        await page.addScriptTag({ content: bundle });
        await page.evaluate(install, { css: compiled.css, modes: MODES });
      }
      await context.close();
    });

    test("opening an existing dialog or popover with no insertion or route event revokes at once, and closing it restores admission", async () => {
      const { page, context } = await open();
      const modal = await page.evaluate(() => window.nextFrame(() => document.getElementById("existing").showModal()));
      assert.match(modal.prior, /14px/);
      assert.deepEqual([modal.gate, modal.shadow], [false, "none"]);
      await page.evaluate(() => document.getElementById("existing").close());
      assert.equal((await page.evaluate(() => window.settle())).gate, true, "closing the dialog restores the gate");
      const popover = await page.evaluate(() => window.nextFrame(() => document.getElementById("pop").showPopover()));
      assert.match(popover.prior, /14px/);
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
      assert.match(r.prior, /14px/);
      assert.deepEqual([r.gate, r.shadow], [false, "none"]);
      const state = await page.evaluate(() => window.settle());
      assert.equal(state.gate, true);
      assert.ok(await page.evaluate(() => window.events.some((e) => e.type === "revoked")));
      await context.close();
    });
  });
}
