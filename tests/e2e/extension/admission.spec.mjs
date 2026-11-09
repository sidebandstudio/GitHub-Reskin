// Theme CSS on GitHub's own elements, on the installed extension in Chromium and in Firefox. Choom
// Circuit's CSS reaches the reviewed subjects C3b's admission marks on its registry fixture, a
// profile with every reviewed subject and protected lookalikes of each, and never a protected
// element: not one in a form, a dialog or a warning, not one inserted or moved there after load,
// not anything while a dialog is open, and nothing on a settings or security page. It applies in
// Full only, never under forced colors, and a saved theme's CSS only while its consent stands,
// which a revocation ends without a reload.
//
// Playwright's Firefox cannot open an add-on's own pages, so on the installed Firefox add-on no test
// can commit settings. There, Calm and consent run the built Firefox content script in Gecko over a
// stand-in for extension storage, with each action applied by the settings reducer the background
// commits with; Chromium commits the same actions through the installed background.
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firefox } from "@playwright/test";
import { SANITIZER_VERSION, STORAGE_KEYS } from "../../../packages/contracts/index.js";
import { admitCss } from "../../../packages/format/index.js";
import { createCatalogSource, createRepository, defaultSettings } from "../../../packages/settings/index.js";
import { readCatalogEntries } from "../../../packages/ui/bundle.mjs";
import { CSS_ADMISSION } from "../../../packages/ui/renderer.js";
import { build, ROOT as BUILD_ROOT } from "../../../scripts/build.mjs";
import { requireBrowser } from "../../helpers/browsers.mjs";
import { commit, expect, firefoxExtension, openFirefoxGitHub, openPage, test } from "./helpers.mjs";

const ROOT = new URL("../../../", import.meta.url);
// C3b's registry fixture without its bare island: an island without theme attributes is unsafe, so
// the Primer stylesheet suppresses the themed root around it and no audited variable reaches the
// subjects, which these tests need painted.
const BARE_ISLAND = '<div class="border-top" data-color-mode="light"><h2 id="h-bare"';
const REGISTRY_FIXTURE = readFileSync(new URL("tests/primer/fixtures/registry.html", ROOT), "utf8");
if (!REGISTRY_FIXTURE.includes(BARE_ISLAND)) throw new Error("the registry fixture changed; review this test's variant");
const REGISTRY_HTML = REGISTRY_FIXTURE.replace(BARE_ISLAND, '<div class="border-top"><h2 id="h-bare"');
// The same page as GitHub's security settings: an unreviewed route, where no theme CSS applies.
const SECURITY_HTML = REGISTRY_HTML.replace(/<title>[^<]*<\/title>/, "<title>Password and authentication · GitHub</title>")
  .replace('content="profiles"', 'content="settings/security"')
  .replace('<meta name="route-action" content="show">', '<meta name="route-action" content="index">');
const PAGES = new Map([["/octo-registry", REGISTRY_HTML], ["/settings/security", SECURITY_HTML]]);
const REGISTRY_URL = "https://github.com/octo-registry";
const SECURITY_URL = "https://github.com/settings/security";

// A saved copy of Choom: the same CSS, which applies only with consent for its sanitized hash.
const CHOOM_DOCUMENT = JSON.parse(readFileSync(new URL("themes/anime/choom-circuit.reskin.json", ROOT), "utf8"));
const SAVED = { ...CHOOM_DOCUMENT, name: "My Choom" };
const SAVED_HASH = admitCss(SAVED.css, "/css").value.hash;

// Protected lookalikes of the reviewed sidebar heading: in a sign-in, sign-out, token and billing
// form, a closed dialog and a security warning, and around a sign-up link.
const PROTECTED = ["h-login", "h-logout", "h-tokens", "h-billing", "h-dialog", "h-warning", "h-signup"];

const state = (page) =>
  page.evaluate((ids) => {
    const root = document.documentElement;
    const css = (id, property) => {
      const el = document.getElementById(id);
      return el ? getComputedStyle(el)[property] : null;
    };
    return {
      boot: root.getAttribute("data-reskin-boot"),
      scope: root.getAttribute("data-reskin-css"),
      gate: root.getAttribute("data-reskin-css-native"),
      kinds: [...document.querySelectorAll("[data-reskin-css-kind]")].map((el) => el.id || el.localName).sort(),
      heading: css("h-highlights", "textShadow"),
      header: css("mktg", "boxShadow"),
      tab: css("tab", "boxShadow"),
      protected: ids.map((id) => [id, css(id, "textShadow")]).filter(([, shadow]) => shadow !== "none"),
      owned: document.querySelectorAll("[data-reskin-owned]:not(style)").length,
    };
  }, PROTECTED);

// What a page with no theme CSS applied looks like: no marker, no glow, no admitted subject.
const OFF = { scope: null, gate: null, kinds: [], heading: "none", header: "none", tab: "none", protected: [] };

const ADMITTED = { boot: "ready", scope: "active", gate: "active" };

async function expectAdmitted(page, label) {
  // Admission classifies within 10 ms or leaves the native gate off for the document, which is
  // what a pass does on this shared machine at load averages in the hundreds. A resume event is
  // the documented way it tries again; the test sends one only once a strict wait has failed, and
  // records that it did.
  const strict = await expect.poll(() => state(page), { timeout: 8000 }).toMatchObject(ADMITTED).then(() => true, () => false);
  if (!strict) {
    test.info().annotations.push({ type: "classification budget", description: `${label}: the native gate stayed off, so the test sent pageshow to classify again` });
    await expect.poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
      return state(page);
    }, { timeout: 15000, intervals: [1000], message: `${label}: reviewed subjects admitted` }).toMatchObject(ADMITTED);
  }
  const now = await state(page);
  // Choom's sidebar heading glow, header glow and selected-tab rule reach the reviewed subjects.
  expect(now.kinds, label).toEqual(expect.arrayContaining(["h-achievements", "h-highlights", "mktg", "tab"]));
  expect(now.heading, label).not.toBe("none");
  expect(now.header, label).not.toBe("none");
  expect(now.tab, label).not.toBe("none");
  // Never a protected element, and never a subject in a high-contrast or bare island.
  for (const id of [...PROTECTED, "h-island", "h-authored", "h-button", "h-verified"]) expect(now.kinds, `${label}: ${id}`).not.toContain(id);
  expect(now.protected, label).toEqual([]);
}

// Full: reviewed subjects take Choom's CSS; protected UI never does, including UI inserted or
// moved after load, and an open dialog suspends every native rule before the next frame renders.
async function fullScenario(page, label) {
  await expectAdmitted(page, label);

  // A protected form inserted after load, and a reviewed heading beside it.
  await page.evaluate(() => {
    const sidebar = document.querySelector(".Layout-sidebar");
    sidebar.insertAdjacentHTML("beforeend", '<form action="/session"><h2 id="h-late-form" class="h4 mb-2">Sign in again</h2></form><div class="border-top"><h2 id="h-late" class="h4 mb-2">Late heading</h2></div>');
  });
  await expect.poll(() => page.evaluate(() => document.getElementById("h-late").getAttribute("data-reskin-css-kind")), { message: `${label}: a reviewed heading inserted later is admitted` }).toBe("heading-chrome");
  const late = await page.evaluate(() => ({
    form: [document.getElementById("h-late-form").getAttribute("data-reskin-css-kind"), getComputedStyle(document.getElementById("h-late-form")).textShadow],
    marked: document.querySelector("form:has(#h-late-form)").hasAttribute("data-reskin-protected"),
  }));
  expect(late, label).toEqual({ form: [null, "none"], marked: true });

  // An admitted heading moved into a form loses its CSS before the next frame renders.
  const moved = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const heading = document.getElementById("h-late");
        const form = document.createElement("form");
        form.action = "/settings/tokens";
        document.querySelector(".Layout-sidebar").append(form);
        form.append(heading.parentElement);
        requestAnimationFrame(() => resolve([heading.getAttribute("data-reskin-css-kind"), getComputedStyle(heading).textShadow]));
      }),
  );
  expect(moved, `${label}: moved into a form`).toEqual([null, "none"]);

  // A dialog opened after load: no native rule renders a frame while it is open, inside or out.
  const opened = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const dialog = document.createElement("dialog");
        dialog.id = "late-dialog";
        dialog.innerHTML = '<h2 id="h-late-dialog" class="h4 mb-2">Delete this repository</h2>';
        document.body.append(dialog);
        dialog.show();
        requestAnimationFrame(() =>
          resolve({
            gate: document.documentElement.getAttribute("data-reskin-css-native"),
            heading: getComputedStyle(document.getElementById("h-highlights")).textShadow,
            header: getComputedStyle(document.getElementById("mktg")).boxShadow,
            inside: getComputedStyle(document.getElementById("h-late-dialog")).textShadow,
          }),
        );
      }),
  );
  expect(opened, `${label}: dialog open`).toEqual({ gate: null, heading: "none", header: "none", inside: "none" });
  await page.waitForTimeout(300);
  expect(await state(page), `${label}: still open`).toMatchObject({ gate: null, heading: "none" });
  // Closed and gone, the reviewed subjects take the theme again.
  await page.evaluate(() => document.getElementById("late-dialog").remove());
  await expectAdmitted(page, `${label}: dialog closed`);
}

// A settings or security page is an unreviewed route: no scope, no admission, no decoration.
async function securityScenario(page, label) {
  await page.goto(SECURITY_URL);
  await page.waitForFunction(() => document.documentElement.getAttribute("data-reskin-boot") === "ready");
  await page.waitForTimeout(400);
  expect(await state(page), label).toMatchObject({ ...OFF, owned: 0 });
}

// Calm never applies theme CSS; Full brings it back on the open page.
// `act(action)` commits a settings action and returns {ok, settings}.
async function calmScenario(page, act, label) {
  expect((await act({ type: "setPreference", key: "appearance", value: "calm" })).ok, label).toBe(true);
  await expect.poll(() => state(page), { message: `${label}: Calm` }).toMatchObject(OFF);
  await page.waitForTimeout(300);
  expect(await state(page), `${label}: Calm stays off`).toMatchObject(OFF);
  expect((await act({ type: "setPreference", key: "appearance", value: "full" })).ok, label).toBe(true);
  await expectAdmitted(page, `${label}: Full again`);
}

// Forced colors remove every marker and rule, and admission returns once they are off.
async function forcedScenario(page, label) {
  await page.emulateMedia({ forcedColors: "active" });
  await expect.poll(() => state(page), { message: `${label}: forced colors` }).toMatchObject({ ...OFF, owned: 0 });
  await page.emulateMedia({ forcedColors: "none" });
  await expectAdmitted(page, `${label}: forced colors off`);
}

// A saved theme's CSS needs consent for its hash; revoking it turns the CSS off without a reload.
async function consentScenario(page, act, label) {
  const saved = await act({ type: "saveCustom", document: SAVED, select: true });
  expect(saved.ok, `${label}: ${JSON.stringify(saved.issues ?? saved.error ?? null)}`).toBe(true);
  const id = saved.settings.customThemes.find((entry) => entry.document.name === "My Choom").id;
  await expect.poll(() => state(page), { message: `${label}: saved without consent` }).toMatchObject({ boot: "ready", ...OFF });

  // Approval is the explicit Enable choice: a ticket for exactly this CSS, then redeemed for it.
  const editor = "admission-editor-0000000001";
  const ticket = await act({ type: "approveCss", editor, target: id, css: SAVED.css });
  expect(ticket.approval?.hash, `${label}: ticket ${JSON.stringify(ticket.issues ?? null)}`).toBe(SAVED_HASH);
  expect(ticket.approval?.sanitizerVersion, label).toBe(SANITIZER_VERSION);
  const granted = await act({ type: "setCssConsent", id, granted: true, editor, approval: ticket.approval.ticket });
  expect(granted.ok, `${label}: consent ${JSON.stringify(granted.issues ?? null)}`).toBe(true);
  await expectAdmitted(page, `${label}: consent granted`);

  const before = await page.evaluate(() => performance.getEntriesByType("navigation").length + ":" + performance.timeOrigin);
  expect((await act({ type: "setCssConsent", id, granted: false })).ok, label).toBe(true);
  await expect.poll(() => state(page), { message: `${label}: consent revoked` }).toMatchObject(OFF);
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length + ":" + performance.timeOrigin), `${label}: no reload`).toBe(before);
}

async function openRegistry(extension) {
  for (const [path, html] of PAGES) extension.serve(path, html);
  const page = await extension.context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(REGISTRY_URL);
  await page.waitForFunction(() => document.documentElement.getAttribute("data-reskin-boot") === "ready");
  return page;
}

test("Chromium: Choom's CSS reaches reviewed GitHub subjects in Full and never protected UI, inserted, moved, behind a dialog or on a security page", async ({ extension }) => {
  const page = await openRegistry(extension);
  await fullScenario(page, "chromium");
  await securityScenario(page, "chromium security page");
});

test("Chromium: Calm never applies theme CSS, and Full brings it back without a reload", async ({ extension }) => {
  const page = await openRegistry(extension);
  await expectAdmitted(page, "chromium");
  const popup = await openPage(extension, "popup");
  await calmScenario(page, (action) => commit(popup, action), "chromium");
});

test("Chromium: forced colors take theme CSS off GitHub's own elements", async ({ extension }) => {
  const page = await openRegistry(extension);
  await expectAdmitted(page, "chromium");
  await forcedScenario(page, "chromium");
  // A page that loads under forced colors never admits anything.
  const forced = await extension.context.newPage();
  await forced.emulateMedia({ forcedColors: "active" });
  await forced.goto(REGISTRY_URL);
  await forced.waitForFunction(() => document.documentElement.getAttribute("data-reskin-boot") === "native");
  await forced.waitForTimeout(300);
  expect(await state(forced)).toMatchObject({ ...OFF, owned: 0 });
});

test("Chromium: a saved theme's CSS applies only with consent, and revoking it turns the CSS off without a reload", async ({ extension }) => {
  const page = await openRegistry(extension);
  await expectAdmitted(page, "chromium built-in");
  const popup = await openPage(extension, "popup");
  await consentScenario(page, (action) => commit(popup, action), "chromium");
});

test("Firefox: the installed add-on admits the same subjects, refuses protected UI, inserted or moved, and follows forced colors", async () => {
  test.setTimeout(150000);
  const installed = await firefoxExtension(PAGES);
  try {
    const page = await openFirefoxGitHub(installed.context, REGISTRY_URL);
    await fullScenario(page, "firefox");
    await forcedScenario(page, "firefox");
    await securityScenario(page, "firefox security page");
  } finally {
    await installed.close();
  }
});

// The built Firefox content script on a plain Gecko page, over a stand-in for extension storage
// that delivers changes as storage.onChanged does.
const STAND_IN = `(() => {
  const records = {};
  const listeners = new Set();
  globalThis.browser = {
    runtime: { id: "e2e", getURL: (path) => "moz-extension://e2e/" + path },
    storage: {
      local: { get: async () => structuredClone(records), set: async () => {}, remove: async () => {} },
      onChanged: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) },
    },
  };
  globalThis.__reskinWrite = (key, value) => {
    const oldValue = records[key];
    records[key] = value;
    for (const listener of listeners) listener({ [key]: { oldValue, newValue: value } }, "local");
  };
  globalThis.__reskinWrite(${JSON.stringify(STORAGE_KEYS.settings)}, __SETTINGS__);
})();`;

test("Firefox: the built content script never applies theme CSS in Calm, and a saved theme's only while consent stands, off without a reload once revoked", async () => {
  test.setTimeout(120000);
  requireBrowser("firefox");
  const out = await mkdtemp(join(tmpdir(), "reskin-e2e-firefox-content-"));
  const browser = await firefox.launch({ headless: true });
  try {
    const built = await build({ target: "firefox", outDir: out });
    const content = await readFile(join(built.dir, "content.js"), "utf8");
    const catalog = createCatalogSource(await readCatalogEntries(BUILD_ROOT));
    let settings = { ...defaultSettings(catalog), onboardingCompleted: true };
    let ids = 0;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("https://github.com/**", (route) =>
      route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: PAGES.get(new URL(route.request().url()).pathname) }) : route.abort(),
    );
    await context.addInitScript({ content: `${STAND_IN.replace("__SETTINGS__", JSON.stringify(settings))}\n${content}` });
    const page = await context.newPage();
    // The background's commit: the settings repository over in-memory storage, then the write the
    // content script sees.
    const data = new Map([[STORAGE_KEYS.settings, settings]]);
    const memory = {
      get: async (keys) => Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))])),
      set: async (record) => Object.entries(record).forEach(([key, value]) => data.set(key, structuredClone(value))),
      remove: async (keys) => keys.forEach((key) => data.delete(key)),
      subscribe: () => () => {},
    };
    const repository = createRepository(memory, { catalog, css: CSS_ADMISSION, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}` });
    const act = async (action) => {
      const reply = await repository.commit(action, data.get(STORAGE_KEYS.settings).revision);
      if (reply.ok && !reply.approval) {
        settings = reply.settings;
        await page.evaluate(([key, value]) => globalThis.__reskinWrite(key, value), [STORAGE_KEYS.settings, settings]);
      }
      return reply;
    };
    await page.goto(REGISTRY_URL);
    await expectAdmitted(page, "firefox content");
    await calmScenario(page, act, "firefox content");
    await consentScenario(page, act, "firefox content");
  } finally {
    await browser.close();
    await rm(out, { recursive: true, force: true });
  }
});
