// Authentication routes on the installed extension, in Chromium and Firefox: sign-in and sign-up
// stay exactly as GitHub draws them, in Full and Calm, with no stylesheet, marker or owned node,
// down to the passkey button outside the sign-in form; and a Turbo navigation into sign-in is
// native in its first frame and themed again once it leaves.
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { chromium, firefox } from "@playwright/test";
import { STORAGE_KEYS } from "../../../packages/contracts/index.js";
import { createCatalogSource, defaultSettings } from "../../../packages/settings/index.js";
import { readCatalogEntries } from "../../../packages/ui/bundle.mjs";
import { build, ROOT as BUILD_ROOT } from "../../../scripts/build.mjs";
import { requireBrowser } from "../../helpers/browsers.mjs";
import { CHOOM_CANVAS, PROFILE_HTML, PROFILE_URL, commit, expect, firefoxExtension, openGitHub, openPage, test, waitFor } from "./helpers.mjs";

const primer = ["light", "dark"].map((id) => readFileSync(new URL(`../../../vendor/primer/source/${id}.css`, import.meta.url), "utf8")).join("\n");
const STYLE = `<style>${primer}</style>
<style>:root,[data-color-mode=light][data-light-theme*=light],[data-color-mode=dark][data-dark-theme*=light]{color-scheme:light}[data-color-mode=dark][data-dark-theme*=dark]{color-scheme:dark}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;color:var(--fgColor-default);background:var(--bgColor-default)}
a{color:var(--fgColor-accent)}.color-fg-muted{color:var(--fgColor-muted)}h1{font-weight:300;font-size:24px}
.auth-form{width:340px;margin:0 auto}.auth-form-body{padding:16px;border:1px solid var(--borderColor-muted);border-radius:6px;background:var(--bgColor-muted)}
.form-control{display:block;width:100%;padding:5px 12px;color:var(--fgColor-default);background:var(--bgColor-default);border:1px solid var(--borderColor-default);border-radius:6px}
.btn{padding:5px 16px;color:var(--button-default-fgColor-rest);background:var(--button-default-bgColor-rest);border:1px solid var(--button-default-borderColor-rest);border-radius:6px}
.btn-primary{color:var(--button-primary-fgColor-rest);background:var(--button-primary-bgColor-rest);border-color:var(--button-primary-borderColor-rest)}.btn-block{display:block;width:100%}
.Button--link{padding:0;color:var(--fgColor-accent);background:none;border:0;font:inherit}
.authentication-footer{width:340px;margin:16px auto;padding:16px;text-align:center;border:1px solid var(--borderColor-default);border-radius:6px}
.HeaderMktg{display:flex;justify-content:space-between;padding:16px;color:var(--fgColor-default);background:var(--bgColor-default)}
.Button--primary{padding:8px 16px;color:var(--button-primary-fgColor-rest);background:var(--button-primary-bgColor-rest);border:0;border-radius:6px}</style>`;

// github.com/login, logged out, on 2026-11-09: the sign-in form, the passkey status, and the
// footer whose "Sign in with a passkey" button sits outside the form and every protected element.
const LOGIN = `<!doctype html><html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head><title>Sign in to GitHub · GitHub</title>
<meta name="route-controller" content="sessions"><meta name="route-action" content="new">${STYLE}</head>
<body class="logged-out env-production page-responsive session-authentication">
<div class="header header-logged-out width-full pt-5 pb-4" role="banner"><a id="logo" class="header-logo" href="https://github.com/" aria-label="Homepage"><svg height="48" width="48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="currentColor"/></svg></a></div>
<main><div class="auth-form px-3" id="login">
<div class="auth-form-header p-0"><h1 id="heading">Sign in to GitHub</h1></div>
<div class="auth-form-body mt-3" id="form-body">
<form data-turbo="false" action="/session" method="post"><label id="label" for="login_field">Username or email address</label><input type="text" name="login" id="login_field" class="form-control"><label for="password">Password</label><input type="password" name="password" id="password" class="form-control"><a id="forgot" class="label-link" href="/password_reset">Forgot password?</a><input id="submit" type="submit" name="commit" value="Sign in" class="btn btn-primary btn-block"></form>
<webauthn-status class="js-webauthn-login-emu-control"><p id="status" class="color-fg-muted">Passkeys are available on this device.</p></webauthn-status>
</div></div>
<div class="authentication-footer" id="footer"><p class="mt-1 mb-0 p-0" id="new">New to GitHub? <a id="create" href="/signup?source=login">Create an account</a></p>
<webauthn-subtle class="js-webauthn-subtle"><p class="mb-0 mt-0"><button id="passkey" data-action="click:webauthn-subtle#prompt" type="button" class="Button--link Button--medium Button"><span class="Button-content"><span class="Button-label" id="passkey-label">Sign in with a passkey</span></span></button></p></webauthn-subtle>
</div></main>
<div class="footer-session-authentication" role="contentinfo"><a id="terms" href="https://docs.github.com/site-policy/github-terms/github-terms-of-service">Terms</a> <a id="privacy" href="https://docs.github.com/site-policy/privacy-policies/github-privacy-statement">Privacy</a></div>
</body></html>`;
const LOGIN_IDS = ["logo", "heading", "form-body", "label", "login_field", "forgot", "submit", "status", "footer", "new", "create", "passkey", "passkey-label", "terms"];

// github.com/signup: the Brand marketing header with its sign-in link, in its own dark island,
// and the email step of the sign-up form.
const SIGNUP = `<!doctype html><html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head><title>Join GitHub · GitHub</title>
<meta name="route-controller" content="signups"><meta name="route-action" content="new">${STYLE}</head>
<body class="logged-out env-production page-responsive"><div id="page" data-color-mode="dark" data-light-theme="light" data-dark-theme="dark">
<header class="HeaderMktg" role="banner" data-marketing-header="true" id="header"><a id="home" href="https://github.com/">GitHub</a><span id="have">Already have an account? <a id="signin" href="/login">Sign in →</a></span></header>
<main class="font-mktg"><h1 id="heading">Create your free account</h1>
<form id="signup-form" action="/signup" method="post"><label id="label" for="email">Email*</label><input id="email" name="user[email]" class="form-control"><button id="continue" class="Button Button--primary" type="submit">Continue</button></form>
<p id="terms-copy" class="color-fg-muted">By creating an account, you agree to the <a id="tos" href="https://docs.github.com/site-policy/github-terms/github-terms-of-service">Terms of Service</a>.</p></main>
</div></body></html>`;
const SIGNUP_IDS = ["page", "header", "home", "have", "signin", "heading", "signup-form", "label", "email", "continue", "terms-copy", "tos"];

const ROUTES = [["/login", LOGIN, LOGIN_IDS], ["/signup", SIGNUP, SIGNUP_IDS]];
const PAGES = new Map(ROUTES.map(([path, html]) => [path, html]));

// What GitHub draws and whether Reskin touched it: colors, fonts and geometry of every element,
// the root and body, and any stylesheet, marker or owned node.
const look = (page, ids) =>
  page.evaluate((ids) => {
    const read = (node) => {
      const cs = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return [cs.color, cs.backgroundColor, cs.backgroundImage, cs.borderTopColor, cs.borderTopLeftRadius, cs.boxShadow, cs.textShadow, cs.fontFamily, cs.fontSize, cs.fontWeight, cs.colorScheme, cs.getPropertyValue("--reskin-on"), ...[box.x, box.y, box.width, box.height].map(Math.round)];
    };
    return {
      root: read(document.documentElement),
      body: read(document.body),
      ...Object.fromEntries(ids.map((id) => [id, read(document.getElementById(id))])),
    };
  }, ids);
const touched = (page) =>
  page.evaluate(() => ({
    styles: document.querySelectorAll("#reskin-style, style[data-reskin-owned]").length,
    owned: document.querySelectorAll("[data-reskin-owned], [data-reskin-slot]").length,
    markers: [...document.querySelectorAll("*")].flatMap((node) => node.getAttributeNames().filter((name) => name.startsWith("data-reskin") && name !== "data-reskin-boot")),
    boot: document.documentElement.getAttribute("data-reskin-boot"),
  }));
const UNTOUCHED = { styles: 0, owned: 0, markers: [], boot: "native" };

// The same pages in the same engine with no extension.
async function nativeLooks(engine) {
  const browser = await engine.launch(engine === chromium ? { channel: "chromium", headless: true } : { headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("https://github.com/**", (route) => (route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: PAGES.get(new URL(route.request().url()).pathname) }) : route.abort()));
    const page = await context.newPage();
    const looks = {};
    for (const [path, , ids] of ROUTES) {
      await page.goto(`https://github.com${path}`);
      looks[path] = await look(page, ids);
    }
    return looks;
  } finally {
    await browser.close();
  }
}

async function expectNative(context, act, native, label, appearances = ["full", "calm"]) {
  for (const appearance of appearances) {
    if (act) expect((await act({ type: "setPreference", key: "appearance", value: appearance })).ok, `${label} ${appearance}`).toBe(true);
    for (const [path, , ids] of ROUTES) {
      const page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`https://github.com${path}`);
      expect(await waitFor(page, touched, (now) => isDeepStrictEqual(now, UNTOUCHED)), `${label} ${appearance} ${path}`).toEqual(UNTOUCHED);
      // A stylesheet that arrived late would show here.
      await page.waitForTimeout(300);
      expect(await touched(page), `${label} ${appearance} ${path} stays untouched`).toEqual(UNTOUCHED);
      expect(await look(page, ids), `${label} ${appearance} ${path} looks exactly like GitHub`).toEqual(native[path]);
      await page.close();
    }
  }
}

// A Turbo navigation from a themed profile into sign-in, then back: Turbo pushes the URL, merges the
// head, swaps the body and fires turbo:render. Sign-in is native in the frame that first paints it.
async function expectNavigation(page, label) {
  const themed = async () => page.evaluate(() => ({ boot: document.documentElement.getAttribute("data-reskin-boot"), styled: Boolean(document.getElementById("reskin-style")?.isConnected), canvas: getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim() }));
  const isThemed = (now) => now.boot === "ready" && now.styled && now.canvas === CHOOM_CANVAS;
  expect(await waitFor(page, themed, isThemed), `${label} profile`).toEqual({ boot: "ready", styled: true, canvas: CHOOM_CANVAS });
  const first = await page.evaluate((html) => new Promise((resolve) => {
    const next = new DOMParser().parseFromString(html, "text/html");
    window.__profile = document.body;
    history.pushState({}, "", "/login");
    document.title = next.title;
    document.head.append(...[...next.head.querySelectorAll("style")].map((node) => document.adoptNode(node)));
    document.body.replaceWith(document.adoptNode(next.body));
    document.dispatchEvent(new Event("turbo:render"));
    document.dispatchEvent(new Event("turbo:load"));
    requestAnimationFrame(() => {
      const passkey = getComputedStyle(document.getElementById("passkey"));
      resolve({
        boot: document.documentElement.getAttribute("data-reskin-boot"),
        styles: document.querySelectorAll("#reskin-style").length,
        markers: [...document.querySelectorAll("*")].flatMap((node) => node.getAttributeNames().filter((name) => name.startsWith("data-reskin") && name !== "data-reskin-boot")),
        canvas: getComputedStyle(document.body).backgroundColor,
        passkey: [passkey.color, passkey.getPropertyValue("--reskin-on")],
      });
    });
  }), LOGIN);
  expect(first, `${label} sign-in in its first frame`).toEqual({ boot: "native", styles: 0, markers: [], canvas: "rgb(255, 255, 255)", passkey: ["rgb(9, 105, 218)", ""] });
  await page.evaluate(() => {
    history.pushState({}, "", "/octo-sample");
    document.body.replaceWith(window.__profile);
    document.dispatchEvent(new Event("turbo:render"));
    document.dispatchEvent(new Event("turbo:load"));
  });
  expect(await waitFor(page, themed, isThemed), `${label} back on the profile`).toEqual({ boot: "ready", styled: true, canvas: CHOOM_CANVAS });
}

test("Chromium: sign-in and sign-up look exactly like GitHub in Full and Calm, with no stylesheet, marker or owned node", async ({ extension }) => {
  for (const [path, html] of ROUTES) extension.serve(path, html);
  const native = await nativeLooks(chromium);
  const popup = await openPage(extension, "popup");
  await expectNative(extension.context, (action) => commit(popup, action), native, "chromium");
});

test("Chromium: a Turbo navigation into sign-in is native in its first frame, and leaving it themes the page again", async ({ extension }) => {
  const page = await openGitHub(extension);
  await expectNavigation(page, "chromium");
});

// Playwright's Firefox cannot open the add-on's own pages, so the installed add-on runs with its
// first-run settings, Full, and the built content script runs Calm over a stand-in for extension
// storage, as admission.spec does.
test("Firefox: the installed add-on leaves sign-in and sign-up exactly as GitHub draws them in Full, and follows Turbo navigation into and out of sign-in", async () => {
  test.setTimeout(150000);
  requireBrowser("firefox");
  const native = await nativeLooks(firefox);
  const installed = await firefoxExtension(new Map([...PAGES, ["/octo-sample", PROFILE_HTML]]));
  try {
    const page = await installed.context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(async () => {
      await page.goto(PROFILE_URL);
      await page.waitForTimeout(500);
      return page.evaluate(() => document.documentElement.getAttribute("data-reskin-boot"));
    }, { timeout: 20000 }).toBe("ready");
    await expectNative(installed.context, null, native, "firefox", ["full"]);
    await expectNavigation(page, "firefox");
  } finally {
    await installed.close();
  }
});

test("Firefox: the built content script leaves sign-in and sign-up exactly as GitHub draws them in Calm", async () => {
  test.setTimeout(120000);
  requireBrowser("firefox");
  const native = await nativeLooks(firefox);
  const out = await mkdtemp(join(tmpdir(), "reskin-e2e-firefox-content-"));
  const browser = await firefox.launch({ headless: true });
  try {
    const built = await build({ target: "firefox", outDir: out });
    const content = await readFile(join(built.dir, "content.js"), "utf8");
    const catalog = createCatalogSource(await readCatalogEntries(BUILD_ROOT));
    const defaults = defaultSettings(catalog);
    const settings = { ...defaults, onboardingCompleted: true, preferences: { ...defaults.preferences, appearance: "calm", extras: false } };
    const storage = `globalThis.browser = { runtime: { id: "e2e", getURL: (path) => "moz-extension://e2e/" + path }, storage: { local: { get: async () => (${JSON.stringify({ [STORAGE_KEYS.settings]: settings })}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {}, removeListener() {} } } };`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("https://github.com/**", (route) => (route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: PAGES.get(new URL(route.request().url()).pathname) ?? PROFILE_HTML }) : route.abort()));
    await context.addInitScript({ content: `${storage}\n${content}` });
    // The stand-in settings are Calm and themed: the profile takes them.
    const page = await context.newPage();
    await page.goto(PROFILE_URL);
    await expect.poll(() => page.evaluate(() => [document.documentElement.getAttribute("data-reskin-boot"), getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim()])).toEqual(["ready", CHOOM_CANVAS]);
    await expectNative(context, null, native, "firefox content", ["calm"]);
  } finally {
    await browser.close();
    await rm(out, { recursive: true, force: true });
  }
});
