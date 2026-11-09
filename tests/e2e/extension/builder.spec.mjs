// The theme builder on the built extension. Chromium runs the installed Chrome package; Firefox
// runs the built Firefox package's own settings page, pages.js and background.js in Gecko over a
// stand-in extension namespace (Playwright's Firefox cannot open add-on pages), then its built
// content.js on GitHub over the records the builder saved. Each scenario runs in both:
//   three colors to a saved, selected theme; the base fix; one-change Undo; Copy AI prompt with the
//   clipboard allowed and refused, then the chatbot's answer in prose imported and saved; a share
//   code, and a damaged one; Advanced CSS that imports off, saves without consent and applies on
//   GitHub's reviewed elements only after Enable advanced CSS; the draft kept after the page closes;
//   and the export round trip through the file, the share code and the preview link.
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firefox } from "@playwright/test";
import { STORAGE_KEYS } from "../../../packages/contracts/index.js";
import { admitCss, encodeShare, makeAiPrompt } from "../../../packages/format/index.js";
import { SHARE_PAGE } from "../../../packages/ui/importer.js";
import { CLIPBOARD_STAND_IN, expect, firefoxPages, PROFILE_URL, storage, test } from "./helpers.mjs";

const ROOT = new URL("../../../", import.meta.url);
const ANSWER = readFileSync(new URL("tests/ui/fixtures/ai-answer.txt", ROOT), "utf8");
const REGISTRY_HTML = readFileSync(new URL("tests/primer/fixtures/registry.html", ROOT), "utf8").replace('<div class="border-top" data-color-mode="light"><h2 id="h-bare"', '<div class="border-top"><h2 id="h-bare"');
const REGISTRY_URL = "https://github.com/octo-registry";

// CSS for the reviewed header and sidebar headings that no bundled theme carries, so GitHub can
// apply it only through the runtime sanitizer and a consent for its hash.
const CUSTOM_CSS = ".HeaderMktg, .AppHeader { box-shadow: 0 3px 18px -5px color-mix(in srgb, var(--reskin-accent) 45%, transparent); }\nh2.h4.mb-2 { text-shadow: 0 0 9px color-mix(in srgb, var(--reskin-accent) 40%, transparent); }";
// The appearance compiler includes a theme's own CSS only alongside its effects or flavor text, so
// this theme requests one effect, as chatbot themes usually do.
const CSS_THEME = { schemaVersion: 1, name: "Signal Glow", inspiredBy: "Late-night radio", base: "dark", colors: { background: "#0b1021", text: "#e8ecf8", accent: "#ffb000" }, effects: { glow: {} }, css: CUSTOM_CSS };
const CSS_HASH = admitCss(admitCss(CUSTOM_CSS, "/css").value.css, "/css").value.hash;
const SHARED = { schemaVersion: 1, name: "Moss and parchment", base: "light", colors: { background: "#f4efe2", text: "#26301f", accent: "#4f7a3a" }, shape: { corners: { style: "rounded", radius: 12 } } };

const hex = (page, name) => page.getByRole("textbox", { name, exact: true });
async function setHex(page, name, value) {
  const field = hex(page, name);
  await field.fill(value);
  await field.press("Tab");
}
const builder = (page) => page.locator('[data-rb="builder"]');
const status = (page) => page.locator('[data-rb="status"]');
const settingsOf = (records) => records[STORAGE_KEYS.settings];
const saved = (records, name) => settingsOf(records).customThemes.find((theme) => theme.document.name === name);

async function save(page) {
  const copy = page.getByRole("button", { name: "Save a copy" });
  if (await copy.isVisible()) await copy.click();
  else await page.getByRole("button", { name: "Save as theme" }).click();
}

/** Opens Make a theme; a draft left by an earlier scenario is set aside unless `keepDraft`. */
async function openBuilder(env, { viewport = { width: 1280, height: 900 }, keepDraft = false } = {}) {
  const page = await env.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("close", () => expect(errors, "uncaught page errors").toEqual([]));
  await page.setViewportSize(viewport);
  await page.goto(`${env.url("settings")}#make`);
  await expect(page.locator('[data-rb="based-on"]')).not.toBeEmpty();
  await expect(page.locator('[data-rb="preview"] iframe').first()).toBeAttached();
  if (!keepDraft) {
    await page.waitForTimeout(300);
    const fresh = page.getByRole("button", { name: "Start with your saved theme" });
    if (await fresh.isVisible()) await fresh.click();
  }
  return page;
}

async function openImport(page, kind) {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import a theme" });
  await expect(dialog).toBeVisible();
  if (kind) await dialog.getByRole("button", { name: kind }).click();
  return dialog;
}

// Three colors, then Save: a new local theme, selected, with exactly those colors.
async function threeColors(env) {
  const page = await openBuilder(env);
  await page.getByRole("textbox", { name: "Theme name" }).fill("Night Market");
  await page.getByRole("textbox", { name: "Theme name" }).press("Tab");
  await setHex(page, "Background", "#1b1030");
  await setHex(page, "Text", "#f3e9ff");
  await setHex(page, "Accent", "#ff9f1c");
  await expect(page.locator('[data-rb="dirty"]')).toBeVisible();
  // An invalid partial hex stays in its field with an inline error; nothing changes.
  await hex(page, "Accent").fill("#ff9");
  await hex(page, "Accent").press("Backspace");
  await expect(builder(page).getByText("Use a color like #18212b.")).toBeVisible();
  await expect(hex(page, "Accent")).toHaveValue("#ff");
  await setHex(page, "Accent", "#ff9f1c");
  await save(page);
  await expect(status(page)).toHaveText("Saved Night Market and applied it to GitHub.");
  const records = await env.records();
  const theme = saved(records, "Night Market");
  expect(theme.document.colors).toMatchObject({ background: "#1b1030", text: "#f3e9ff", accent: "#ff9f1c" });
  expect(theme.basedOn).toBe("anime.cyberpunk-edgerunners");
  expect(settingsOf(records).selectedThemeId).toBe(theme.id);
  expect(records[STORAGE_KEYS.draft] ?? null).toBeNull();
  // The saved theme is now what the builder edits.
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await page.close();
  return theme;
}

// A background that contradicts the base offers the other base in one tap; Undo is one change.
async function baseFixAndUndo(env) {
  const page = await openBuilder(env);
  await setHex(page, "Text", "#1a1a1a");
  await setHex(page, "Background", "#f7f3ea");
  const fix = page.getByRole("button", { name: "Switch to light" });
  await expect(fix).toBeVisible();
  await fix.click();
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect(fix).toBeHidden();
  await setHex(page, "Accent", "#0057b8");
  const undo = page.getByRole("button", { name: "Undo last change" });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(status(page)).toHaveText("Last change undone.");
  await expect(hex(page, "Accent")).not.toHaveValue("#0057b8");
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect(undo).toBeDisabled();
  await page.close();
}

// Copy AI prompt, refused and allowed, then the chatbot's answer with its prose, fence and comments.
async function aiPromptAndAnswer(env) {
  const page = await openBuilder(env);
  await page.evaluate(() => (globalThis.__clipboardRefuse = true));
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(builder(page).getByText("Your browser didn't allow copying. Select the prompt below and copy it.")).toBeVisible();
  await expect(builder(page).getByText("AI prompt copied.")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "AI prompt" })).toHaveValue(makeAiPrompt());
  await page.getByRole("button", { name: "Select prompt" }).click();
  await page.evaluate(() => (globalThis.__clipboardRefuse = false));
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(status(page)).toHaveText("AI prompt copied.");
  await expect(page.locator('[data-rb="prompt-result"]')).toBeHidden();
  expect(await page.evaluate(() => globalThis.__copied.at(-1))).toBe(makeAiPrompt());
  for (const step of ["Paste into your chatbot", "Describe your theme", "Paste its answer here"]) await expect(builder(page).getByText(step)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "AI prompt" })).toBeHidden();

  await page.getByRole("button", { name: "Paste answer" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a theme" });
  await expect(dialog.getByRole("textbox", { name: "Chatbot answer" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(ANSWER);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await expect(dialog.getByText("We found your theme inside the answer.")).toBeVisible();
  await expect(dialog.getByText("We spaced the graph colors so activity levels stay visible.")).toBeVisible();
  await expect(dialog.locator('[data-rb="import-show"]')).toHaveText("Neon Drizzle");
  await dialog.getByText("See changes").click();
  await expect(dialog.getByRole("rowheader", { name: /Graph levels/ })).toBeVisible();
  await expect(dialog.locator('[data-rb="import-frame"] iframe').first()).toBeAttached();
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page)).toHaveText("Imported Neon Drizzle. Save it to keep it.");
  await expect(page.getByRole("textbox", { name: "Theme name" })).toHaveValue("Neon Drizzle");
  await save(page);
  await expect(status(page)).toHaveText("Saved Neon Drizzle and applied it to GitHub.");
  const theme = saved(await env.records(), "Neon Drizzle").document;
  expect(theme.fonts.heading).toBe("space-grotesk");
  expect(Object.keys(theme.effects).sort()).toEqual(["glow", "scanlines"]);
  expect(theme.flavor.slots["profile.tag"]).toBe("// after hours");
  expect(theme.backgrounds.page.layers).toHaveLength(2);
  expect(theme.contributions.cellStyle).toBe("round");
  await page.close();
}

// A share code previews and is used; a damaged one says so and keeps the draft.
async function shareCode(env) {
  const page = await openBuilder(env);
  const before = await page.getByRole("textbox", { name: "Theme name" }).inputValue();
  let dialog = await openImport(page, "Share code");
  const code = encodeShare(SHARED);
  await dialog.getByRole("textbox", { name: "Share code or link" }).fill(`${code.slice(0, -4)}0000`);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await expect(dialog.getByRole("alert")).toContainText("This share code is incomplete or damaged. Ask for the full code or theme file.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("textbox", { name: "Theme name" })).toHaveValue(before);
  dialog = await openImport(page, "Share code");
  await dialog.getByRole("textbox", { name: "Share code or link" }).fill(`${SHARE_PAGE}#${code}`);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await expect(dialog.locator('[data-rb="import-show"]')).toHaveText("Moss and parchment");
  await expect(dialog.locator('[data-rb="import-messages"] li').first()).toBeVisible();
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect(hex(page, "Background")).toHaveValue("#f4efe2");
  await page.close();
}

// Advanced CSS: imported off, saved without consent, then enabled and saved with it.
async function advancedCss(env, { onSavedOff, onConsented }) {
  const page = await openBuilder(env);
  const dialog = await openImport(page);
  await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(`Here's your theme:\n\`\`\`json\n${JSON.stringify(CSS_THEME, null, 2)}\n\`\`\``);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await expect(dialog.getByText("Advanced CSS", { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-rb="import-css-warning"]')).toHaveText(
    "Advanced CSS changes GitHub's appearance and can break layout or reduce readability. Reskin blocks outside resources and unsupported rules, but cannot guarantee every GitHub page. Review the preview and CSS before enabling it. Calm turns it off.",
  );
  const enable = dialog.getByRole("checkbox", { name: "Enable advanced CSS" });
  await expect(enable).not.toBeChecked();
  await expect(dialog.getByText(/of CSS\. It is off in this preview until you enable it\./)).toBeVisible();
  await dialog.getByText("View CSS").click();
  await expect(dialog.locator('[data-rb="import-css-source"]')).toContainText("text-shadow");
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await save(page);
  await expect(status(page)).toHaveText("Saved Signal Glow and applied it to GitHub.");
  let records = await env.records();
  const theme = saved(records, "Signal Glow");
  expect(typeof theme.document.css).toBe("string");
  expect(settingsOf(records).cssConsent[theme.id]).toBeUndefined();
  await onSavedOff(records);

  // The builder's own disclosure: the warning, the size, located errors for a bad rule, then consent.
  await page.getByText("Advanced CSS", { exact: true }).first().click();
  await expect(page.locator('[data-rb="css-warning"]')).toHaveText(/^Advanced CSS changes GitHub's appearance/);
  await expect(page.locator('[data-rb="css-meter"]')).toHaveText(/KiB of 32 KiB\./);
  const area = page.getByRole("textbox", { name: "CSS", exact: true });
  const good = await area.inputValue();
  await area.fill(`${good}\n.x { background: url(https://example.com/a.png); }`);
  await expect(page.getByRole("list", { name: "CSS problems" })).toContainText(/line \d+, column \d+/);
  await area.fill(good);
  await expect(page.getByRole("list", { name: "CSS problems" })).toBeHidden();
  const builderEnable = page.getByRole("checkbox", { name: "Enable advanced CSS" });
  await expect(builderEnable).not.toBeChecked();
  await builderEnable.check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(status(page)).toHaveText("Saved changes to Signal Glow.");
  records = await env.records();
  expect(settingsOf(records).cssConsent[theme.id]).toEqual({ hash: CSS_HASH, sanitizerVersion: 1 });
  await onConsented(records);
  await page.close();
}

// The draft survives closing the page; Start with your saved theme discards it.
async function draftRecovery(env) {
  let page = await openBuilder(env);
  await setHex(page, "Accent", "#12ab34");
  await expect.poll(async () => (await env.records())[STORAGE_KEYS.draft]?.document?.colors?.accent ?? null).toBe("#12ab34");
  await page.close();
  page = await openBuilder(env, { keepDraft: true });
  await expect(page.getByText(/^You have an unsaved draft:/)).toBeVisible();
  await page.getByRole("button", { name: "Resume your draft" }).click();
  await expect(status(page)).toHaveText("Your draft is back.");
  await expect(hex(page, "Accent")).toHaveValue("#12ab34");
  await expect(page.locator('[data-rb="dirty"]')).toBeVisible();
  await page.close();
  page = await openBuilder(env, { keepDraft: true });
  await page.getByRole("button", { name: "Start with your saved theme" }).click();
  await expect.poll(async () => (await env.records())[STORAGE_KEYS.draft] ?? null).toBeNull();
  await expect(hex(page, "Accent")).not.toHaveValue("#12ab34");
  await page.close();
}

// Download, then import that file: the same theme. Share code and preview link copy the code.
async function exportRoundTrip(env) {
  const page = await openBuilder(env);
  await page.getByRole("textbox", { name: "Theme name" }).fill("Round Trip");
  await page.getByRole("textbox", { name: "Theme name" }).press("Tab");
  await setHex(page, "Accent", "#e05d9c");
  await page.getByText("Export and share").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .reskin.json" }).click()]);
  expect(download.suggestedFilename()).toBe("round-trip.reskin.json");
  const bytes = await readFile(await download.path());
  const exported = JSON.parse(bytes.toString("utf8"));
  expect(exported).toMatchObject({ name: "Round Trip", colors: { accent: "#e05d9c" } });
  await page.getByRole("button", { name: "Copy share code" }).click();
  await expect(page.locator('[data-rb="export-note"]')).toHaveText("Copied the share code. Share codes can be longer than a TikTok comment. Share the file or preview link instead.");
  const code = await page.evaluate(() => globalThis.__copied.at(-1));
  expect(code).toMatch(/^RS1\./);
  await expect(page.getByRole("textbox", { name: "Share code" })).toHaveValue(code);
  await page.getByRole("button", { name: "Copy preview link" }).click();
  expect(await page.evaluate(() => globalThis.__copied.at(-1))).toBe(`${SHARE_PAGE}#${code}`);

  await setHex(page, "Accent", "#000000");
  const dialog = await openImport(page, "Choose file");
  await dialog.getByLabel("Theme file (.json or .reskin.json)").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: bytes });
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  // The show the draft was based on leads, as everywhere; the theme's own name follows.
  await expect(dialog.locator('[data-rb="import-name"]')).toHaveText("Round Trip");
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(hex(page, "Accent")).toHaveValue("#e05d9c");
  await page.getByRole("button", { name: "Download .reskin.json" }).isVisible();
  const [again] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .reskin.json" }).click()]);
  expect(JSON.parse((await readFile(await again.path())).toString("utf8"))).toEqual(exported);
  await page.close();
}

// What a GitHub page shows of the theme's own CSS on the registry fixture.
const cssState = (page) =>
  page.evaluate(() => {
    const css = (id, property) => getComputedStyle(document.getElementById(id))[property];
    return {
      boot: document.documentElement.getAttribute("data-reskin-boot"),
      scope: document.documentElement.getAttribute("data-reskin-css"),
      heading: css("h-highlights", "textShadow"),
      header: css("mktg", "boxShadow"),
      // Protected lookalikes never take it.
      protected: ["h-login", "h-logout", "h-tokens", "h-billing", "h-dialog", "h-warning", "h-signup"].map((id) => css(id, "textShadow")).filter((shadow) => shadow !== "none"),
    };
  });
async function expectCss(page, applied, label) {
  if (!applied) {
    await expect.poll(() => cssState(page), { timeout: 8000, message: label }).toMatchObject({ boot: "ready", heading: "none", header: "none", protected: [] });
    return;
  }
  // Admission classifies within 10 ms or leaves native rules off for the document; a resume
  // event classifies again, as in admission.spec.mjs.
  await expect
    .poll(
      async () => {
        const now = await cssState(page);
        if (now.heading === "none") await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
        return now.heading !== "none" && now.header !== "none" && now.scope === "active" && now.protected.length === 0;
      },
      { timeout: 15000, intervals: [500, 1000], message: label },
    )
    .toBe(true);
}

const chromiumEnv = async (extension) => {
  await extension.context.addInitScript({ content: CLIPBOARD_STAND_IN });
  return { newPage: () => extension.context.newPage(), url: extension.url, records: () => storage(extension.worker) };
};

test.describe("Chromium builder", () => {
  test("three colors become a saved, selected theme that GitHub shows", async ({ extension }) => {
    const env = await chromiumEnv(extension);
    await threeColors(env);
    const github = await extension.context.newPage();
    await github.goto(PROFILE_URL);
    await expect.poll(() => github.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim())).toBe("#1b1030");
  });
  test("a contradicted base is one tap to fix, and Undo restores only the last change", async ({ extension }) => baseFixAndUndo(await chromiumEnv(extension)));
  test("Copy AI prompt shows three steps, never Copied on refusal, and the chatbot's answer imports from prose", async ({ extension }) => aiPromptAndAnswer(await chromiumEnv(extension)));
  test("a share code imports; a damaged one says so and leaves the draft", async ({ extension }) => shareCode(await chromiumEnv(extension)));
  test("imported Advanced CSS stays off until consent, then reaches only reviewed GitHub elements", async ({ extension }) => {
    test.setTimeout(90000);
    const env = await chromiumEnv(extension);
    extension.serve("/octo-registry", REGISTRY_HTML);
    let github = null;
    await advancedCss(env, {
      async onSavedOff() {
        github = await extension.context.newPage();
        await github.setViewportSize({ width: 1280, height: 900 });
        await github.goto(REGISTRY_URL);
        await expectCss(github, false, "saved without consent");
      },
      async onConsented() {
        // The open tab follows the consent without a reload.
        await expectCss(github, true, "after consent");
      },
    });
  });
  test("the draft survives closing the page", async ({ extension }) => draftRecovery(await chromiumEnv(extension)));
  test("export round-trips through the file, share code and preview link", async ({ extension }) => exportRoundTrip(await chromiumEnv(extension)));
});

// The built Firefox content script on GitHub over the builder's saved records.
async function firefoxGitHub(contentScript, records) {
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("https://github.com/**", (route) => (route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: REGISTRY_HTML }) : route.abort()));
  const stand = `(() => {
    const records = ${JSON.stringify(records)};
    globalThis.browser = {
      runtime: { id: "e2e", getURL: (path) => "moz-extension://e2e/" + path },
      storage: { local: { get: async () => structuredClone(records), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {}, removeListener() {} } },
    };
  })();`;
  await context.addInitScript({ content: `${stand}\n${contentScript}` });
  const page = await context.newPage();
  await page.goto(REGISTRY_URL);
  return { page, close: () => browser.close() };
}

test("Firefox builder: every scenario on the built add-on's pages, and its content script applies saved CSS only after consent", async () => {
  test.setTimeout(300000);
  const harness = await firefoxPages();
  try {
    await harness.context.addInitScript({ content: CLIPBOARD_STAND_IN });
    const env = { newPage: () => harness.context.newPage(), url: harness.url, records: harness.records };
    await threeColors(env);
    await baseFixAndUndo(env);
    await aiPromptAndAnswer(env);
    await shareCode(env);
    await advancedCss(env, {
      async onSavedOff(records) {
        const github = await firefoxGitHub(harness.contentScript, records);
        try {
          await expectCss(github.page, false, "firefox: saved without consent");
        } finally {
          await github.close();
        }
      },
      async onConsented(records) {
        const github = await firefoxGitHub(harness.contentScript, records);
        try {
          await expectCss(github.page, true, "firefox: after consent");
        } finally {
          await github.close();
        }
      },
    });
    await draftRecovery(env);
    await exportRoundTrip(env);
  } finally {
    await harness.close();
  }
});
