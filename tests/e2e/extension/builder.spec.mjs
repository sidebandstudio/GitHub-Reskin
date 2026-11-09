// The theme builder on the built extension. Chromium runs the installed Chrome package; Firefox
// runs the built Firefox package's own settings page, pages.js and background.js in Gecko over a
// stand-in extension namespace (Playwright's Firefox cannot open add-on pages), then its built
// content.js on GitHub over the records the builder saved. Each scenario runs in both:
//   three colors to a saved, selected theme with nothing else of the theme it started from, and
//   Remix for every detail; the base fix; one-change Undo; Copy AI prompt with the clipboard
//   allowed and refused, then the chatbot's answer in prose imported and saved; a missing color
//   chosen in the import itself; a share code, and a damaged one; Advanced CSS alone, which imports
//   off, saves without consent and applies on GitHub's reviewed elements only after Enable
//   advanced CSS; an older window that never grants that approval again after another revokes it;
//   a failed save that leaves nothing behind and a Retry that saves once; image upload, conversion
//   and removal; the draft kept after the page closes; the export round trip through the file, the
//   share code and the preview link; Backup & help's export, removal and Reset all; and the round 2
//   review's reproductions: removal and Save a copy, Undo after a revocation, a stale draft resumed
//   and an upload that needs Resize.
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
// Colors and CSS alone, with no effect or flavor text: the CSS still applies once approved.
const CSS_THEME = { schemaVersion: 1, name: "Signal Glow", inspiredBy: "Late-night radio", base: "dark", colors: { background: "#0b1021", text: "#e8ecf8", accent: "#ffb000" }, css: CUSTOM_CSS };
const CSS_HASH = admitCss(admitCss(CUSTOM_CSS, "/css").value.css, "/css").value.hash;
// A still, metadata-free image that fits as it is: the first one the valid schema fixture embeds.
const TILE = (() => {
  const theme = JSON.parse(readFileSync(new URL("tests/fixtures/schema/valid/embedded-images.reskin.json", ROOT), "utf8"));
  const data = Object.values(theme.backgrounds).flatMap((b) => b.layers ?? []).find((layer) => layer.image?.data.startsWith("data:image/png"))?.image.data;
  return Buffer.from(data.split(",")[1], "base64");
})();
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
  // The builder marks itself ready once it has read settings and any kept draft; a loaded machine
  // only makes that later, so only the test's timeout bounds the wait.
  await expect(builder(page)).toHaveAttribute("data-rb-ready", "", { timeout: 0 });
  await expect(page.locator('[data-rb="based-on"]')).not.toBeEmpty();
  await expect(page.locator('[data-rb="preview"] iframe').first()).toBeAttached();
  if (!keepDraft) {
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
  // Nothing of Choom Circuit outweighs the three colors: no page paint, links, graph, effects or label.
  expect(Object.keys(theme.document).sort()).toEqual(["base", "colors", "name", "schemaVersion"]);
  expect(theme.basedOn).toBe("anime.cyberpunk-edgerunners");
  expect(settingsOf(records).selectedThemeId).toBe(theme.id);
  expect(records[STORAGE_KEYS.draft] ?? null).toBeNull();
  // The saved theme is now what the builder edits.
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await page.close();
  return theme;
}

// Remix keeps every detail of the theme it starts from; Undo goes back to the three colors.
async function remix(env) {
  const page = await openBuilder(env);
  await page.getByRole("radio", { name: "Three colors" }).check();
  await setHex(page, "Accent", "#33ccaa");
  await page.getByRole("radio", { name: /^(Remix|Edit) / }).check();
  await expect(status(page)).toHaveText(/^Started from every detail of /);
  await expect(hex(page, "Accent")).not.toHaveValue("#33ccaa");
  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(page.getByRole("radio", { name: "Three colors" })).toBeChecked();
  await expect(hex(page, "Accent")).toHaveValue("#33ccaa");
  await page.close();
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
  await expect(builder(page).getByText(/^You have an unsaved draft:/)).toBeVisible();
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
  // The show leads when the theme names one; a three-color theme has none, so its name leads.
  await expect(dialog.locator('[data-rb="import-show"], [data-rb="import-name"]').filter({ hasText: /^Round Trip$/ })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(hex(page, "Accent")).toHaveValue("#e05d9c");
  await page.getByRole("button", { name: "Download .reskin.json" }).isVisible();
  const [again] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .reskin.json" }).click()]);
  expect(JSON.parse((await readFile(await again.path())).toString("utf8"))).toEqual(exported);
  await page.close();
}

// An answer without Background: the picker in the import itself fixes it, Copy fix request remains.
async function missingColor(env) {
  const page = await openBuilder(env);
  const dialog = await openImport(page);
  const theme = { schemaVersion: 1, name: "Harbor Fog", base: "dark", colors: { text: "#e6edf3", accent: "#ff806c" } };
  await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(`Sure! Here it is:\n\`\`\`json\n${JSON.stringify(theme, null, 2)}\n\`\`\`\nEnjoy.`);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Add a background color like #18212b.");
  await expect(dialog.getByRole("button", { name: "Copy fix request" })).toBeVisible();
  const field = dialog.getByRole("textbox", { name: "Background", exact: true });
  await expect(dialog.getByLabel("Background color picker")).toHaveAttribute("type", "color");
  await field.fill("#10");
  await dialog.getByRole("button", { name: "Preview with this background" }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.fill("#101820");
  await dialog.getByRole("button", { name: "Preview with this background" }).click();
  await expect(dialog.locator('[data-rb="import-show"]')).toHaveText("Harbor Fog");
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(hex(page, "Background")).toHaveValue("#101820");
  await expect(hex(page, "Text")).toHaveValue("#e6edf3");
  await page.close();
}

// Fails the next settings commit that carries a CSS approval, as a full or denied write would.
const failNextConsent = (page) =>
  page.evaluate(() => {
    let failed = false;
    for (const ns of [globalThis.browser, globalThis.chrome]) {
      if (!ns?.runtime?.sendMessage) continue;
      const send = ns.runtime.sendMessage.bind(ns.runtime);
      Object.defineProperty(ns.runtime, "sendMessage", {
        configurable: true,
        value: (message) => {
          const consent = message.type === "commit" && (message.action.type === "setCssConsent" || typeof message.action.approval === "string");
          if (consent && !failed) return (failed = true), Promise.resolve({ ok: false, code: "storage", issues: [{ message: "Storage failed" }] });
          return send(message);
        },
      });
    }
  });

// A save whose consent cannot be written saves nothing; Retry saves the theme once, with consent.
async function failedConsentSave(env) {
  const page = await openBuilder(env);
  const dialog = await openImport(page);
  await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(JSON.stringify({ ...CSS_THEME, name: "Thunder sea" }));
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await dialog.getByRole("checkbox", { name: "Enable advanced CSS" }).check();
  await dialog.getByRole("button", { name: "Use theme" }).click();
  const before = settingsOf(await env.records());
  await failNextConsent(page);
  await page.getByRole("button", { name: "Save as theme" }).click();
  await expect(builder(page).getByRole("alert")).toContainText("We couldn't save your theme. Your draft is still here.");
  let now = settingsOf(await env.records());
  expect(now.customThemes.length).toBe(before.customThemes.length);
  expect(now.selectedThemeId).toBe(before.selectedThemeId);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(status(page)).toHaveText("Saved Thunder sea and applied it to GitHub.");
  now = settingsOf(await env.records());
  expect(now.customThemes.length).toBe(before.customThemes.length + 1);
  const thunder = now.customThemes.filter((theme) => theme.document.name === "Thunder sea");
  expect(thunder).toHaveLength(1);
  expect(now.cssConsent[thunder[0].id]).toEqual({ hash: CSS_HASH, sanitizerVersion: 1 });
  await page.close();
}

// Two windows edit the selected CSS theme. The newer turns Enable advanced CSS off and saves; the
// older, saving a color change, never writes that approval again.
async function revokedElsewhere(env) {
  const older = await openBuilder(env);
  const enable = (page) => page.locator('[data-rb="css-enable"]');
  await expect(enable(older)).toBeChecked();
  const id = settingsOf(await env.records()).selectedThemeId;
  expect(settingsOf(await env.records()).cssConsent[id]).toBeTruthy();
  const newer = await openBuilder(env);
  await newer.getByText("Advanced CSS", { exact: true }).first().click();
  await enable(newer).uncheck();
  await newer.getByRole("button", { name: "Save changes" }).click();
  await expect(status(newer)).toHaveText(/^Saved changes to /);
  expect(settingsOf(await env.records()).cssConsent[id]).toBeUndefined();
  await newer.close();

  await setHex(older, "Accent", "#ffaa00");
  await older.getByRole("button", { name: "Save changes" }).click();
  // Either this window already followed the revocation, or Save stops and asks.
  const conflict = older.locator('[data-rb="conflict"]');
  await expect.poll(async () => (await conflict.isVisible()) || /^Saved changes to /.test(await status(older).textContent())).toBe(true);
  if (await conflict.isVisible()) {
    expect(settingsOf(await env.records()).cssConsent[id]).toBeUndefined();
    await older.getByRole("button", { name: "Keep editing this draft" }).click();
    await expect(enable(older)).not.toBeChecked();
    await older.getByRole("button", { name: "Save changes" }).click();
    await expect(status(older)).toHaveText(/^Saved changes to /);
  }
  await expect(enable(older)).not.toBeChecked();
  const records = settingsOf(await env.records());
  expect(records.cssConsent[id]).toBeUndefined();
  expect(records.customThemes.find((theme) => theme.id === id).document.colors.accent).toBe("#ffaa00");
  await older.close();
}

// A noisy PNG over the 128 KiB image cap, drawn by the page itself. `random` fills every channel,
// transparency included, with random bytes, which no compression brings under the cap at full size.
const noisyPng = (page, size, random = false) =>
  page.evaluate(async ([side, incompressible]) => {
    const canvas = new OffscreenCanvas(side, side);
    const context = canvas.getContext("2d");
    const pixels = context.createImageData(side, side);
    let seed = 7;
    if (incompressible) for (let i = 0; i < pixels.data.length; i += 65536) crypto.getRandomValues(pixels.data.subarray(i, i + 65536));
    else for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = i % 4 === 3 ? 255 : (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 23;
    context.putImageData(pixels, 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  }, [size, random]);

// A small image is added as it is; a large or animated one only after accepting its converted copy.
async function imageUpload(env) {
  const page = await openBuilder(env);
  await page.getByText("Backgrounds", { exact: true }).click();
  await expect(page.locator('[data-rb="image-limits"]')).toContainText("Each image is at most 128 KiB");
  await expect(page.locator('[data-rb="image-limits"]')).toContainText("6,291,456 pixels");
  const file = page.getByLabel("Add an image");
  await file.setInputFiles({ name: "tile.png", mimeType: "image/png", buffer: TILE });
  await expect(status(page)).toHaveText(/^Added tile\.png, \d+ × \d+ px, /);
  const layers = page.locator('[data-rb="bg-layers"] > li');
  await expect(layers).toHaveCount(1);
  // A JPEG carrying metadata is converted, not added as it is.
  await file.setInputFiles({ name: "plain.jpg", mimeType: "image/jpeg", buffer: readFileSync(new URL("tests/fixtures/images/plain.jpg", ROOT)) });
  await expect(page.locator('[data-rb="image-note"]')).toContainText("removed metadata");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(layers).toHaveCount(1);
  const big = Buffer.from(await noisyPng(page, 400), "base64");
  expect(big.length).toBeGreaterThan(131072);
  await file.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: big });
  const offer = page.getByRole("group", { name: "photo.png doesn't fit as it is. Use this converted copy?" });
  await expect(offer).toBeVisible();
  await expect(offer.locator('[data-rb="image-before"]')).toHaveText(/ KiB PNG, 400 × 400 px$/);
  await expect(offer.locator('[data-rb="image-after"]')).toHaveText(/ KiB (WebP|PNG), \d+ × \d+ px$/);
  // Nothing is added before the person accepts.
  await expect(layers).toHaveCount(1);
  await offer.getByRole("button", { name: "Use converted image" }).click();
  await expect(status(page)).toHaveText("Added the converted image.");
  await expect(layers).toHaveCount(2);
  await file.setInputFiles({ name: "anim.gif", mimeType: "image/gif", buffer: readFileSync(new URL("tests/fixtures/images/anim.gif", ROOT)) });
  await expect(page.locator('[data-rb="image-note"]')).toContainText("kept the first frame of the animation");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(layers).toHaveCount(2);
  await page.getByRole("button", { name: "Compress layer 2, image" }).click();
  await expect(page.locator('[data-rb="image-offer"]')).toBeVisible();
  await page.getByRole("button", { name: "Use converted image" }).click();
  await expect(status(page)).toHaveText("Replaced the image with the smaller copy.");
  await page.getByRole("button", { name: "Remove layer 1, image" }).click();
  await expect(status(page)).toHaveText("Removed the image.");
  await expect(layers).toHaveCount(1);
  await expect(page.locator('[data-rb="image-usage"]')).toContainText("Images in this theme:");
  await page.getByText("Export and share").click();
  await expect(page.locator('[data-rb="export-images"]')).toHaveText(/^This theme carries 1 embedded image\./);
  // Too long for a preview link: the file is offered instead, and nothing is copied.
  const copied = await page.evaluate(() => globalThis.__copied.length);
  await page.getByRole("button", { name: "Copy preview link" }).click();
  await expect(page.locator('[data-rb="export-note"]')).toHaveText("This theme is too big for a preview link (over 8,192 characters). Share the .reskin.json file instead.");
  expect(await page.evaluate(() => globalThis.__copied.length)).toBe(copied);
  await page.getByRole("textbox", { name: "Theme name" }).fill("Photo wall");
  await page.getByRole("textbox", { name: "Theme name" }).press("Tab");
  await save(page);
  await expect(status(page)).toHaveText("Saved Photo wall and applied it to GitHub.");
  const layer = saved(await env.records(), "Photo wall").document.backgrounds.page.layers[0].image;
  expect(layer.data).toMatch(/^data:image\/(webp|png);base64,/);
  await page.close();
}

// ----- Regressions for the round 2 review's four reproductions -----

// Imports CSS_THEME as `name` with Enable advanced CSS ticked in the import, and saves it: the
// explicit choice, so the new theme is approved. Returns its ID.
async function approvedCssTheme(env, name) {
  const page = await openBuilder(env);
  const dialog = await openImport(page);
  await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(JSON.stringify({ ...CSS_THEME, name }));
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await dialog.getByRole("checkbox", { name: "Enable advanced CSS" }).check();
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await page.getByRole("button", { name: "Save as theme" }).click();
  await expect(status(page)).toHaveText(`Saved ${name} and applied it to GitHub.`);
  const theme = saved(await env.records(), name);
  expect(settingsOf(await env.records()).cssConsent[theme.id]).toEqual({ hash: CSS_HASH, sanitizerVersion: 1 });
  await page.close();
  return theme.id;
}
// Every stored approval, by theme name.
const approvedNames = (records) => Object.keys(settingsOf(records).cssConsent).map((id) => settingsOf(records).customThemes.find((t) => t.id === id)?.document.name);
// Saves, and when Save stops at the conflict, keeps editing and saves again.
async function saveThrough(page, name) {
  await page.getByRole("button", { name }).click();
  const conflict = page.locator('[data-rb="conflict"]');
  await expect.poll(async () => (await conflict.isVisible()) || /^Saved /.test(await status(page).textContent())).toBe(true);
  if (await conflict.isVisible()) {
    await page.getByRole("button", { name: "Keep editing this draft" }).click();
    await page.locator('[data-rb="save"]').click();
  }
  await expect(status(page)).toHaveText(/^Saved /);
}

// Review finding 1: removing an approved theme from Backup & help in a newer window, then saving
// the older editor's color change, creates a theme with no approval; Save a copy of an approved
// theme starts the copy without one.
async function removedThenCopied(env) {
  const id = await approvedCssTheme(env, "Removed glow");
  const older = await openBuilder(env);
  await expect(older.locator('[data-rb="css-enable"]')).toBeChecked();
  const backup = await env.newPage();
  await backup.goto(`${env.url("settings")}#backup`);
  backup.once("dialog", (dialog) => dialog.accept());
  await backup.locator('[data-rk="backup"]').getByRole("button", { name: "Remove Removed glow" }).click();
  await expect(backup.locator('[data-rk="status"]')).toHaveText("Removed Removed glow.");
  await backup.close();
  expect(settingsOf(await env.records()).cssConsent[id]).toBeUndefined();
  await expect(older.locator('[data-rb="css-enable"]')).not.toBeChecked();
  await setHex(older, "Accent", "#ffaa00");
  await saveThrough(older, "Save as theme");
  let records = await env.records();
  expect(saved(records, "Removed glow").id).not.toBe(id);
  expect(approvedNames(records)).not.toContain("Removed glow");
  await older.close();

  await approvedCssTheme(env, "Copied glow");
  const page = await openBuilder(env);
  await expect(page.locator('[data-rb="css-enable"]')).toBeChecked();
  await page.getByRole("textbox", { name: "Theme name" }).fill("Copied glow 2");
  await page.getByRole("textbox", { name: "Theme name" }).press("Tab");
  await page.getByRole("button", { name: "Save a copy" }).click();
  await expect(status(page)).toHaveText("Saved Copied glow 2 as a copy and applied it to GitHub. Its advanced CSS stays off until you turn on Enable advanced CSS for the copy.");
  await expect(page.locator('[data-rb="css-enable"]')).not.toBeChecked();
  records = await env.records();
  expect(approvedNames(records)).toContain("Copied glow");
  expect(approvedNames(records)).not.toContain("Copied glow 2");
  await page.close();
}

// Review finding 2: Undo after an import, once another window revoked the approval, does not
// bring it back, and saving afterwards leaves it revoked.
async function undoAfterRevocation(env) {
  const id = await approvedCssTheme(env, "Undo glow");
  const first = await openBuilder(env);
  await expect(first.locator('[data-rb="css-enable"]')).toBeChecked();
  const dialog = await openImport(first, "Share code");
  await dialog.getByRole("textbox", { name: "Share code or link" }).fill(encodeShare(SHARED));
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(hex(first, "Background")).toHaveValue("#f4efe2");

  const other = await openBuilder(env);
  await other.getByText("Advanced CSS", { exact: true }).first().click();
  await other.locator('[data-rb="css-enable"]').uncheck();
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(status(other)).toHaveText("Saved changes to Undo glow.");
  await other.close();
  expect(settingsOf(await env.records()).cssConsent[id]).toBeUndefined();

  await first.getByRole("button", { name: "Undo last change" }).click();
  await expect(first.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(first.locator('[data-rb="css-enable"]')).not.toBeChecked();
  await saveThrough(first, "Save changes");
  expect(settingsOf(await env.records()).cssConsent[id]).toBeUndefined();
  await first.close();
}

// Review finding 3: a draft kept from an older window, resumed after a newer window saved the same
// theme, shows Keep editing / Load saved theme and never silently puts the older colors back.
async function staleResume(env) {
  await approvedCssTheme(env, "Resume base");
  const older = await openBuilder(env);
  const newer = await openBuilder(env);
  await setHex(newer, "Background", "#0d1a22");
  await newer.getByRole("button", { name: "Save changes" }).click();
  await expect(status(newer)).toHaveText("Saved changes to Resume base.");
  await newer.close();
  await setHex(older, "Accent", "#77ddbb");
  await expect.poll(async () => (await env.records())[STORAGE_KEYS.draft]?.document?.colors?.accent ?? null).toBe("#77ddbb");
  await older.close();

  const page = await openBuilder(env, { keepDraft: true });
  await page.getByRole("button", { name: "Resume your draft" }).click();
  const conflict = page.getByRole("group", { name: "Resume base was saved again after this draft was kept. Keep editing to replace the saved version when you save, or load the saved theme." });
  await expect(conflict).toBeVisible();
  await expect(conflict.getByRole("button", { name: "Keep editing this draft" })).toBeFocused();
  // Save still stops and asks.
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator('[data-rb="conflict"]')).toBeVisible();
  expect(saved(await env.records(), "Resume base").document.colors.background).toBe("#0d1a22");
  await page.getByRole("button", { name: "Load saved theme" }).click();
  await expect(hex(page, "Background")).toHaveValue("#0d1a22");
  expect(saved(await env.records(), "Resume base").document.colors.background).toBe("#0d1a22");
  await page.close();
}

// Review finding 4: a new image still over the cap after compression offers a working Resize,
// which converts a smaller copy that is added only once accepted.
async function oversizedUpload(env) {
  const page = await openBuilder(env);
  await page.getByText("Backgrounds", { exact: true }).click();
  const layers = page.locator('[data-rb="bg-layers"] > li');
  await expect(layers).toHaveCount(0);
  const noise = Buffer.from(await noisyPng(page, 400, true), "base64");
  expect(noise.length).toBeGreaterThan(131072);
  await page.getByLabel("Add an image").setInputFiles({ name: "noise.png", mimeType: "image/png", buffer: noise });
  await expect(builder(page).locator('[data-rb-error-for="backgrounds"]')).toHaveText(/more than this theme has room for\. Resize it to make it smaller\.$/);
  const resize = page.getByRole("button", { name: "Resize to 200 × 200 px" });
  await expect(resize).toBeVisible();
  await expect(layers).toHaveCount(0);
  await resize.click();
  const offer = page.getByRole("group", { name: "noise.png doesn't fit as it is. Use this converted copy?" });
  await expect(offer).toBeVisible({ timeout: 15000 });
  await expect(offer.locator('[data-rb="image-before"]')).toHaveText(/ PNG, 400 × 400 px$/);
  await expect(offer.locator('[data-rb="image-after"]')).toHaveText(/, 200 × 200 px$/);
  await expect(page.locator('[data-rb="image-retry"]')).toBeHidden();
  await expect(layers).toHaveCount(0);
  await offer.getByRole("button", { name: "Use converted image" }).click();
  await expect(status(page)).toHaveText("Added the converted image.");
  await expect(layers).toHaveCount(1);
  await page.close();
}

// Backup & help: the kept draft resumes; each saved theme exports and, after a native
// confirmation that suggests Export first, is removed; Reset all clears everything.
async function backupAndHelp(env) {
  let page = await openBuilder(env);
  await setHex(page, "Accent", "#5577ee");
  await expect.poll(async () => (await env.records())[STORAGE_KEYS.draft]?.document?.colors?.accent ?? null).toBe("#5577ee");
  await page.close();
  page = await env.newPage();
  await page.goto(`${env.url("settings")}#backup`);
  const backup = page.locator('[data-rk="backup"]');
  await expect(backup.getByRole("heading", { name: "Backup & help" })).toBeVisible();
  await expect(backup.locator('[data-rk="draft-text"]')).toHaveText(/^You have an unsaved draft: /);
  await backup.getByRole("button", { name: "Resume in Make a theme" }).click();
  await expect(page).toHaveURL(/#make$/);
  await expect(status(page)).toHaveText("Your draft is back.");
  await expect(hex(page, "Accent")).toHaveValue("#5577ee");
  await page.getByRole("link", { name: "Backup & help" }).click();
  await expect(backup.locator('[data-rk="draft-text"]')).toHaveText(/^Make a theme has unsaved changes to /);

  const themes = settingsOf(await env.records()).customThemes;
  expect(themes.length).toBeGreaterThan(1);
  await expect(backup.locator('[data-rk="capacity"]')).toHaveText(new RegExp(`^${themes.length} of 50 saved themes, `));
  const first = themes[0].document.name;
  const [file] = await Promise.all([page.waitForEvent("download"), backup.getByRole("button", { name: `Export ${first}` }).click()]);
  expect(file.suggestedFilename()).toMatch(/\.reskin\.json$/);
  expect(JSON.parse((await readFile(await file.path())).toString("utf8")).name).toBe(first);

  // Cancel keeps the theme and focus; OK removes it and focus moves to the next Remove.
  const messages = [];
  page.once("dialog", (dialog) => (messages.push([dialog.type(), dialog.message()]), dialog.dismiss()));
  await backup.getByRole("button", { name: `Remove ${first}` }).click();
  expect(messages[0][0]).toBe("confirm");
  expect(messages[0][1]).toContain(`Remove "${first}" from Reskin`);
  expect(messages[0][1]).toContain("choose Cancel, then Export");
  await expect(backup.getByRole("button", { name: `Remove ${first}` })).toBeFocused();
  expect(settingsOf(await env.records()).customThemes).toHaveLength(themes.length);
  page.once("dialog", (dialog) => dialog.accept());
  await backup.getByRole("button", { name: `Remove ${first}` }).click();
  await expect(backup.locator('[data-rk="status"]')).toHaveText(`Removed ${first}.`);
  await expect(backup.getByRole("button", { name: `Remove ${themes[1].document.name}` })).toBeFocused();
  expect(settingsOf(await env.records()).customThemes.map((t) => t.id)).not.toContain(themes[0].id);

  page.once("dialog", (dialog) => (messages.push([dialog.type(), dialog.message()]), dialog.accept()));
  await backup.getByRole("button", { name: "Reset all" }).click();
  expect(messages.at(-1)[1]).toContain(themes.length === 2 ? "your saved theme," : `your ${themes.length - 1} saved themes`);
  await expect(backup.locator('[data-rk="status"]')).toHaveText("Reskin is reset. Choom Circuit is selected.");
  await expect(backup.getByRole("button", { name: "Reset all" })).toBeFocused();
  await expect(backup.getByText("Your saved themes will appear here.")).toBeVisible();
  const records = await env.records();
  expect(settingsOf(records).customThemes).toEqual([]);
  expect(records[STORAGE_KEYS.draft] ?? null).toBeNull();
  await expect(backup.locator('[data-rk="draft-text"]')).toHaveText("There is no unsaved draft.");
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
  test("Remix starts from every detail of the theme, and Undo returns to three colors", async ({ extension }) => remix(await chromiumEnv(extension)));
  test("a contradicted base is one tap to fix, and Undo restores only the last change", async ({ extension }) => baseFixAndUndo(await chromiumEnv(extension)));
  test("a missing color is chosen in the import itself", async ({ extension }) => missingColor(await chromiumEnv(extension)));
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
    await revokedElsewhere(env);
  });
  test("a save whose CSS approval fails saves nothing, and Retry saves once", async ({ extension }) => failedConsentSave(await chromiumEnv(extension)));
  test("images upload as they are, or after accepting a converted copy, and Compress and Remove", async ({ extension }) => imageUpload(await chromiumEnv(extension)));
  test("the draft survives closing the page", async ({ extension }) => draftRecovery(await chromiumEnv(extension)));
  test("export round-trips through the file, share code and preview link", async ({ extension }) => exportRoundTrip(await chromiumEnv(extension)));
  test("removing an approved theme or saving a copy never carries its CSS approval over (review 2, finding 1)", async ({ extension }) => removedThenCopied(await chromiumEnv(extension)));
  test("Undo after an import never restores an approval revoked in another window (review 2, finding 2)", async ({ extension }) => undoAfterRevocation(await chromiumEnv(extension)));
  test("resuming a draft whose saved theme changed asks before overwriting it (review 2, finding 3)", async ({ extension }) => staleResume(await chromiumEnv(extension)));
  test("an upload still too big after compression offers a working Resize (review 2, finding 4)", async ({ extension }) => oversizedUpload(await chromiumEnv(extension)));
  test("Backup & help resumes the draft, exports and removes themes, and resets all", async ({ extension }) => {
    const env = await chromiumEnv(extension);
    await threeColors(env);
    await failedConsentSave(env);
    await backupAndHelp(env);
  });
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
    await remix(env);
    await baseFixAndUndo(env);
    await aiPromptAndAnswer(env);
    await missingColor(env);
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
    await revokedElsewhere(env);
    await failedConsentSave(env);
    await draftRecovery(env);
    await exportRoundTrip(env);
    await imageUpload(env);
    await removedThenCopied(env);
    await undoAfterRevocation(env);
    await staleResume(env);
    await oversizedUpload(env);
    await backupAndHelp(env);
  } finally {
    await harness.close();
  }
});
