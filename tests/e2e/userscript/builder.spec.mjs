// The builder in the userscript's frame, on the generated script with a manager shim: the card's
// Make a theme opens the settings page's builder in a wider frame over the GM host, and Backup &
// help beside it. Each scenario runs in Chromium and Firefox:
//   three colors to a saved, selected theme painted on GitHub, then Save changes and Save a copy;
//   a chatbot's answer wrapped in prose imported, previewed and saved;
//   a theme that carries Advanced CSS imports and saves with its CSS kept and off, the note in
//   place of any Enable control, and nothing of its CSS on GitHub;
//   the draft kept after the panel closes and after a reload, resumed;
//   the export round trip through the downloaded file and the share code;
//   no builder at all where the script cannot show it runs apart from the page;
//   two tabs editing one saved theme: the later save offers Keep editing or Load saved theme;
//   the session preview's builder, labeled, saving for the tab only;
//   Backup & help's views, Escape in the import dialog and focus back where it was.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { STORAGE_KEYS } from "../../../packages/contracts/index.js";
import { admitCss, encodeShare } from "../../../packages/format/index.js";
import { COPY, CSS_NOTE, IMPORT_CSS_NOTE } from "../../../userscript/copy.js";
import { CHOOM, CHOOM_CANVAS, HOST, PANEL, PROFILE_HTML, PROFILE_URL, expect, firefoxContentManager, menuNames, openPanel, painted, panelFrame, settingsOf, test, waitSettled } from "./helpers.mjs";

const ROOT = new URL("../../../", import.meta.url);
const ANSWER = readFileSync(new URL("tests/ui/fixtures/ai-answer.txt", ROOT), "utf8");
const CUSTOM_CSS = ".HeaderMktg, .AppHeader { box-shadow: 0 3px 18px -5px color-mix(in srgb, var(--reskin-accent) 45%, transparent); }";
// What the importer keeps: the sanitizer's canonical text.
const CANONICAL_CSS = admitCss(CUSTOM_CSS, "/css").value.css;
const CSS_THEME = { schemaVersion: 1, name: "Signal Glow", inspiredBy: "Late-night radio", base: "dark", colors: { background: "#0b1021", text: "#e8ecf8", accent: "#ffb000" }, css: CUSTOM_CSS };
const SHARED = { schemaVersion: 1, name: "Moss and parchment", base: "light", colors: { background: "#f4efe2", text: "#26301f", accent: "#4f7a3a" }, shape: { corners: { style: "rounded", radius: 12 } } };

// An RGB PNG with a text chunk, so the builder converts it to a still, metadata-free copy.
function pngWithText(size) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push((x * 7) & 255, (y * 5) & 255, (x ^ y) & 255);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("tEXt", Buffer.from("Comment\0from a camera")), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const builderOf = (frame) => frame.locator('[data-rb="builder"]');
const statusOf = (frame) => frame.locator('[data-rb="status"]');
const hex = (frame, name) => frame.getByRole("textbox", { name, exact: true });
async function setHex(frame, name, value) {
  await hex(frame, name).fill(value);
  await hex(frame, name).press("Tab");
}
const customThemes = async (gm, page) => (await settingsOf(gm, page))?.customThemes ?? [];
const draftOf = async (gm, page) => (await gm.records(page))[STORAGE_KEYS.draft] ?? null;

/** The panel's frame once the builder has read settings and any kept draft. */
async function builderFrame(page) {
  await expect(page.locator(HOST)).toHaveAttribute("data-reskin-userscript-panel", /^(make|backup)$/);
  const frame = page.frameLocator(PANEL);
  await expect(builderOf(frame)).toHaveAttribute("data-rb-ready", "", { timeout: 0 });
  await expect(frame.locator('[data-rb="preview"] iframe').first()).toBeAttached();
  return frame;
}

/** Opens the card from the menu, then Make a theme; a kept draft is set aside unless `keepDraft`. */
async function openBuilder(page, { keepDraft = false } = {}) {
  const card = await openPanel(page);
  await card.getByRole("button", { name: "Make a theme" }).click();
  const frame = await builderFrame(page);
  if (!keepDraft) {
    const fresh = frame.getByRole("button", { name: "Start with your saved theme" });
    if (await fresh.isVisible()) await fresh.click();
  }
  return frame;
}

async function openImport(frame, kind) {
  await frame.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = frame.getByRole("dialog", { name: "Import a theme" });
  await expect(dialog).toBeVisible();
  if (kind) await dialog.getByRole("button", { name: kind }).click();
  return dialog;
}

async function save(frame) {
  const copy = frame.getByRole("button", { name: "Save a copy" });
  if (await copy.isVisible()) await copy.click();
  else await frame.getByRole("button", { name: "Save as theme" }).click();
}

test("makes a theme from three colors, saves and applies it, then Save changes and Save a copy", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  const frame = await openBuilder(page);
  await expect(frame.locator('[data-us="storage-note"]')).toHaveText(COPY.durable);
  await expect(frame.locator('[data-us="session-label"]')).toBeHidden();
  await frame.getByRole("textbox", { name: "Theme name" }).fill("Night Market");
  await frame.getByRole("textbox", { name: "Theme name" }).press("Tab");
  await setHex(frame, "Background", "#1b1030");
  await setHex(frame, "Text", "#f3e9ff");
  await setHex(frame, "Accent", "#ff9f1c");
  await expect(frame.locator('[data-rb="dirty"]')).toBeVisible();
  await expect.poll(async () => (await draftOf(gm, page))?.document?.colors?.accent ?? null).toBe("#ff9f1c");
  await expect(frame.locator('[data-rb="error"]')).toBeHidden();
  // One-change Undo: the accent goes back, then Undo is spent.
  await setHex(frame, "Accent", "#33ccaa");
  await frame.getByRole("button", { name: "Undo last change" }).click();
  await expect(hex(frame, "Accent")).toHaveValue("#ff9f1c");
  await expect(frame.getByRole("button", { name: "Undo last change" })).toBeDisabled();
  await save(frame);
  await expect(statusOf(frame)).toHaveText("Saved Night Market and applied it to GitHub.");
  const [theme] = await customThemes(gm, page);
  expect(theme.document.colors).toMatchObject({ background: "#1b1030", text: "#f3e9ff", accent: "#ff9f1c" });
  expect(Object.keys(theme.document).sort()).toEqual(["base", "colors", "name", "schemaVersion"]);
  expect((await settingsOf(gm, page)).selectedThemeId).toBe(theme.id);
  expect(await draftOf(gm, page)).toBeNull();
  // GitHub behind the panel paints the saved theme from manager storage.
  await expect.poll(async () => (await painted(page)).canvas).toBe("#1b1030");

  await setHex(frame, "Accent", "#e05d5d");
  await frame.getByRole("button", { name: "Save changes" }).click();
  await expect(statusOf(frame)).toHaveText("Saved changes to Night Market.");
  await expect.poll(async () => (await customThemes(gm, page))[0].document.colors.accent).toBe("#e05d5d");
  await frame.getByRole("button", { name: "Save a copy" }).click();
  await expect.poll(async () => (await customThemes(gm, page)).length).toBe(2);

  // Themes goes back to the card, which lists both under Mine.
  await frame.getByRole("button", { name: "Themes" }).click();
  const card = await panelFrame(page);
  await expect(page.locator(HOST)).toHaveAttribute("data-reskin-userscript-panel", "picker");
  await expect(card.locator("[data-rs=summary-show]")).toHaveText(/Night Market/);
  await expect(card.getByRole("button", { name: /My themes/ })).toContainText("2");
});

test("imports a chatbot's answer wrapped in prose, previews it and saves it", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  const frame = await openBuilder(page);
  // Copy AI prompt: the three steps either way; a refused clipboard leaves the prompt to select.
  await frame.getByRole("button", { name: "Copy AI prompt" }).click();
  for (const step of ["Paste into your chatbot", "Describe your theme", "Paste its answer here"]) await expect(builderOf(frame).getByText(step)).toBeVisible();
  await frame.getByRole("button", { name: "Paste answer" }).click();
  const dialog = frame.getByRole("dialog", { name: "Import a theme" });
  await expect(dialog.getByRole("textbox", { name: "Chatbot answer" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(ANSWER);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await expect(dialog.getByText("We found your theme inside the answer.")).toBeVisible();
  await expect(dialog.getByText("We spaced the graph colors so activity levels stay visible.")).toBeVisible();
  await expect(dialog.locator('[data-rb="import-show"]')).toHaveText("Neon Drizzle");
  await dialog.getByText("See changes").click();
  await expect(dialog.getByRole("rowheader", { name: /Graph levels/ })).toBeVisible();
  await expect(dialog.locator('[data-rb="import-frame"] iframe').first()).toBeAttached();
  // Escape closes the dialog and leaves the panel open.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator(HOST)).toHaveCount(1);
  await frame.getByRole("button", { name: "Import", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(ANSWER);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(dialog).toBeHidden();
  await expect(statusOf(frame)).toHaveText("Imported Neon Drizzle. Save it to keep it.");
  await expect(frame.getByRole("textbox", { name: "Theme name" })).toHaveValue("Neon Drizzle");
  await save(frame);
  await expect(statusOf(frame)).toHaveText("Saved Neon Drizzle and applied it to GitHub.");
  const theme = (await customThemes(gm, page)).find((entry) => entry.document.name === "Neon Drizzle").document;
  expect(theme.fonts.heading).toBe("space-grotesk");
  expect(Object.keys(theme.effects).sort()).toEqual(["glow", "scanlines"]);
  expect(theme.flavor.slots["profile.tag"]).toBe("// after hours");
  expect(theme.backgrounds.page.layers).toHaveLength(2);
  await expect.poll(async () => (await painted(page)).canvas).toBe("#0e1320");
});

test("a theme that carries Advanced CSS imports and saves with its CSS kept and off, says so, and offers no Enable control", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  const frame = await openBuilder(page);
  const dialog = await openImport(frame);
  await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(`Here it is:\n\n\`\`\`json\n${JSON.stringify(CSS_THEME, null, 2)}\n\`\`\``);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await expect(dialog.locator('[data-rb="import-show"]')).toHaveText("Late-night radio");
  await expect(dialog.getByText(IMPORT_CSS_NOTE)).toBeVisible();
  await dialog.getByText("View CSS").click();
  await expect(dialog.locator('[data-rb="import-css-source"]')).toContainText(".AppHeader");
  // No Enable control anywhere in the frame, and no enabling wording.
  await expect(frame.getByRole("checkbox", { name: /advanced CSS/i })).toHaveCount(0);
  await expect(frame.getByText("Enable advanced CSS")).toHaveCount(0);
  await expect(dialog.locator('[data-rb="import-css-size"]')).toBeHidden();
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(statusOf(frame)).toHaveText("Imported Signal Glow. Save it to keep it.");
  await builderOf(frame).locator('[data-rb-section="css"] > summary').click();
  await expect(builderOf(frame).getByText(CSS_NOTE)).toBeVisible();
  const editor = frame.getByRole("textbox", { name: "CSS (read only)" });
  await expect(editor).toHaveValue(CANONICAL_CSS);
  await expect(editor).not.toBeEditable();
  await save(frame);
  await expect(statusOf(frame)).toHaveText("Saved Signal Glow and applied it to GitHub.");
  const settings = await settingsOf(gm, page);
  const saved = settings.customThemes.find((entry) => entry.document.name === "Signal Glow");
  expect(saved.document.css).toBe(CANONICAL_CSS);
  expect(settings.cssConsent ?? {}).toEqual({});
  // GitHub gets the theme's colors and none of its CSS.
  await expect.poll(async () => (await painted(page)).canvas).toBe("#0b1021");
  expect(await page.evaluate(() => ({ scope: document.documentElement.hasAttribute("data-reskin-css"), css: document.getElementById("reskin-style")?.textContent.includes("0 3px 18px -5px") }))).toEqual({ scope: false, css: false });
  // After a reload the saved theme, CSS and all, still validates and applies without it.
  await page.reload();
  await waitSettled(page);
  await expect.poll(async () => (await painted(page)).canvas).toBe("#0b1021");
  expect((await settingsOf(gm, page)).customThemes.find((entry) => entry.id === saved.id)?.document.css).toBe(CANONICAL_CSS);
});

test("keeps the draft when the panel closes and after a reload, and resumes it", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  let frame = await openBuilder(page);
  await setHex(frame, "Accent", "#12ab34");
  await expect.poll(async () => (await draftOf(gm, page))?.document?.colors?.accent ?? null).toBe("#12ab34");
  // The host answered the autosave as kept: no "couldn't keep a recoverable copy".
  await expect(frame.locator('[data-rb="error"]')).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator(HOST)).toHaveCount(0);
  frame = await openBuilder(page, { keepDraft: true });
  await expect(builderOf(frame).getByText(/^You have an unsaved draft:/)).toBeVisible();
  await frame.getByRole("button", { name: "Resume your draft" }).click();
  await expect(statusOf(frame)).toHaveText("Your draft is back.");
  await expect(hex(frame, "Accent")).toHaveValue("#12ab34");
  await expect(frame.locator('[data-rb="dirty"]')).toBeVisible();

  await page.reload();
  await waitSettled(page);
  frame = await openBuilder(page, { keepDraft: true });
  // Backup & help knows the kept draft too.
  await frame.getByRole("link", { name: "Backup & help" }).click();
  await expect(frame.locator('[data-rk="draft-text"]')).toHaveText(/^You have an unsaved draft: /);
  await frame.getByRole("button", { name: "Resume in Make a theme" }).click();
  await expect(frame.getByRole("heading", { name: "Make a theme" })).toBeVisible();
  await expect(hex(frame, "Accent")).toHaveValue("#12ab34");
  await frame.getByRole("button", { name: "Discard draft" }).click();
  await expect.poll(async () => await draftOf(gm, page)).toBeNull();
  await expect(hex(frame, "Accent")).not.toHaveValue("#12ab34");
});

test("closing the builder right after an edit, before the autosave delay, keeps that edit in the draft", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  const frame = await openBuilder(page);
  await setHex(frame, "Accent", "#12ab34");
  // Well inside the builder's 400 ms autosave delay.
  await page.keyboard.press("Escape");
  await expect(page.locator(HOST)).toHaveCount(0);
  await expect.poll(async () => (await draftOf(gm, page))?.document?.colors?.accent ?? null).toBe("#12ab34");
});

test("closing the builder while Reset all is still writing leaves no draft behind", async ({ manager }) => {
  const gm = await manager({ kind: "async" });
  const page = await gm.open();
  const frame = await openBuilder(page);
  await setHex(frame, "Accent", "#12ab34");
  // Reset all starts inside the autosave delay, and its write waits until resume().
  await frame.getByRole("link", { name: "Backup & help" }).click();
  await page.evaluate(() => (window.__gmLog.pause = "reskin.state"));
  page.once("dialog", (dialog) => dialog.accept());
  await frame.getByRole("button", { name: "Reset all", exact: true }).click();
  await page.waitForFunction(() => window.__gmLog.paused);
  await page.keyboard.press("Escape");
  await expect(page.locator(HOST)).toHaveCount(0);
  await page.evaluate(() => window.__gmLog.resume());
  await expect.poll(async () => (await settingsOf(gm, page))?.revision).toBe(1);
  await page.waitForTimeout(500);
  expect(await draftOf(gm, page)).toBeNull();
});

test("a second Reset all while the first is still writing does nothing, so closing then leaves no draft", async ({ manager }) => {
  const gm = await manager({ kind: "async" });
  const page = await gm.open();
  const frame = await openBuilder(page);
  await setHex(frame, "Accent", "#12ab34");
  await frame.getByRole("link", { name: "Backup & help" }).click();
  await page.evaluate(() => (window.__gmLog.pause = "reskin.state"));
  page.once("dialog", (dialog) => dialog.accept());
  await frame.getByRole("button", { name: "Reset all", exact: true }).click();
  await page.waitForFunction(() => window.__gmLog.paused);
  let asked = false;
  page.once("dialog", (dialog) => ((asked = true), dialog.accept()));
  await frame.getByRole("button", { name: "Reset all", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(HOST)).toHaveCount(0);
  expect(asked).toBe(false);
  await page.evaluate(() => window.__gmLog.resume());
  await expect.poll(async () => (await settingsOf(gm, page))?.revision).toBe(1);
  await page.waitForTimeout(650);
  expect(await draftOf(gm, page)).toBeNull();
});

test("an edit made just before a Reset all that fails is kept, even when the builder closed while it ran", async ({ manager }) => {
  const gm = await manager({ kind: "async" });
  const page = await gm.open();
  await openBuilder(page);
  await page.evaluate(() => {
    window.__gmLog.pause = "reskin.state";
    window.__gmLog.refuse = (name, value) => name === "reskin.state" && value?.records?.["reskin.settings"]?.revision === 1;
  });
  // The edit and Reset all in one task, well inside the autosave delay.
  const doc = await (await page.locator(PANEL).elementHandle()).contentFrame();
  await doc.evaluate(() => {
    window.confirm = () => true;
    const input = document.querySelector("#rb-colors-accent");
    input.value = "#12ab34";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector('[data-rk="reset-all"]').click();
  });
  await page.waitForFunction(() => window.__gmLog.paused);
  expect(await draftOf(gm, page)).toBeNull();
  await page.keyboard.press("Escape");
  await expect(page.locator(HOST)).toHaveCount(0);
  await page.evaluate(() => window.__gmLog.resume());
  await expect.poll(async () => (await draftOf(gm, page))?.document?.colors?.accent ?? null).toBe("#12ab34");
  expect((await settingsOf(gm, page))?.revision ?? 0).toBe(0);
});

test("exports a theme as a file and a share code and imports both back unchanged", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  const frame = await openBuilder(page);
  // Every link GitHub's document ever holds, even one added and removed at once.
  await page.evaluate(() => {
    window.__links = [];
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          for (const link of [node, ...node.querySelectorAll("a")]) if (link.localName === "a") window.__links.push(link.getAttribute("download") ?? "", link.getAttribute("href") ?? "");
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await frame.getByRole("textbox", { name: "Theme name" }).fill("Round Trip");
  await frame.getByRole("textbox", { name: "Theme name" }).press("Tab");
  await setHex(frame, "Accent", "#e05d9c");
  await frame.getByText("Export and share").click();
  const [download] = await Promise.all([page.waitForEvent("download"), frame.getByRole("button", { name: "Download .reskin.json" }).click()]);
  expect(download.suggestedFilename()).toBe("round-trip.reskin.json");
  const bytes = await readFile(await download.path());
  const exported = JSON.parse(bytes.toString("utf8"));
  expect(exported).toMatchObject({ name: "Round Trip", colors: { accent: "#e05d9c" } });
  // Whether or not the clipboard takes it, the code stays selectable beside the buttons.
  await frame.getByRole("button", { name: "Copy share code" }).click();
  await expect(frame.locator('[data-rb="export-note"]')).toContainText("Share codes can be longer than a TikTok comment.");
  const code = await frame.locator('[data-rb="export-text"]').inputValue();
  expect(code).toBe(encodeShare(exported));

  await setHex(frame, "Accent", "#000000");
  let dialog = await openImport(frame, "Share code");
  await dialog.getByRole("textbox", { name: "Share code or link" }).fill(code);
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(hex(frame, "Accent")).toHaveValue("#e05d9c");

  await setHex(frame, "Accent", "#000000");
  dialog = await openImport(frame, "Choose file");
  await dialog.getByLabel("Theme file (.json or .reskin.json)").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: bytes });
  await dialog.getByRole("button", { name: "Preview theme" }).click();
  await dialog.getByRole("button", { name: "Use theme" }).click();
  await expect(hex(frame, "Accent")).toHaveValue("#e05d9c");
  const [again] = await Promise.all([page.waitForEvent("download"), frame.getByRole("button", { name: "Download .reskin.json" }).click()]);
  expect(JSON.parse((await readFile(await again.path())).toString("utf8"))).toEqual(exported);
  // The files went through the panel's frame, never a link in GitHub's document.
  expect(await page.evaluate(() => window.__links.filter((link) => /\.reskin\.json$|^blob:/.test(link)))).toEqual([]);
});

test("where the script cannot show it runs apart from the page, there is no builder, and the note says so", async ({ manager }) => {
  const gm = await manager({ kind: "sync", report: "page" });
  const page = await gm.open(`${PROFILE_URL}#reskin`);
  const frame = await panelFrame(page);
  await expect(frame.locator("[data-us=storage-note]")).toHaveText(COPY.menuOnly);
  await expect(frame.getByRole("button", { name: "Make a theme" })).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "Backup & help" })).toHaveCount(0);
  await expect(frame.locator("[data-rb], [data-rk]")).toHaveCount(0);
  expect(await menuNames(page)).not.toContainEqual(expect.stringMatching(/make a theme|import|backup/i));
  // Nothing in this tab can bring the builder's document up.
  const panelModes = await page.evaluate(() => [...document.querySelectorAll("[data-reskin-userscript-panel]")].map((host) => host.getAttribute("data-reskin-userscript-panel")));
  expect(panelModes).toEqual(["picker"]);

  const bare = await manager({ kind: "none", report: "page" });
  const tab = await bare.open(`${PROFILE_URL}#reskin`);
  const card = await panelFrame(tab);
  await expect(card.locator("[data-us=storage-note]")).toHaveText(COPY.noControls);
  await expect(card.getByRole("button", { name: "Make a theme" })).toHaveCount(0);
});

test("two tabs editing one saved theme: the later save is held for Keep editing or Load saved theme", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const a = await gm.open();
  const frameA = await openBuilder(a);
  await frameA.getByRole("textbox", { name: "Theme name" }).fill("Shared Desk");
  await frameA.getByRole("textbox", { name: "Theme name" }).press("Tab");
  await save(frameA);
  await expect(statusOf(frameA)).toHaveText("Saved Shared Desk and applied it to GitHub.");
  const b = await gm.open();
  const frameB = await openBuilder(b);
  await expect(frameB.locator('[data-rb="based-on"]')).toHaveText("Editing Shared Desk");

  await setHex(frameA, "Accent", "#2299ff");
  await frameA.getByRole("button", { name: "Save changes" }).click();
  await expect(statusOf(frameA)).toHaveText("Saved changes to Shared Desk.");
  await setHex(frameB, "Background", "#202830");
  await frameB.getByRole("button", { name: "Save changes" }).click();
  const conflict = frameB.getByRole("group", { name: "Your settings changed in another window, so this draft was not saved." });
  await expect(conflict).toBeVisible();
  // Nothing of B's was written over A's save.
  const stored = async () => (await customThemes(gm, a)).find((entry) => entry.document.name === "Shared Desk").document.colors;
  expect(await stored()).toMatchObject({ accent: "#2299ff" });
  expect((await stored()).background).not.toBe("#202830");
  await conflict.getByRole("button", { name: "Load saved theme" }).click();
  await expect(hex(frameB, "Accent")).toHaveValue("#2299ff");
  await setHex(frameB, "Background", "#202830");
  await frameB.getByRole("button", { name: "Save changes" }).click();
  await expect(statusOf(frameB)).toHaveText("Saved changes to Shared Desk.");
  await expect.poll(stored).toMatchObject({ accent: "#2299ff", background: "#202830" });
  expect(await customThemes(gm, a)).toHaveLength(1);
});

test("without durable storage the builder is a labeled session preview: it saves for this tab only", async ({ manager }) => {
  const gm = await manager({ kind: "none" });
  const page = await gm.open(`${PROFILE_URL}#reskin`);
  const card = await panelFrame(page);
  await card.getByRole("button", { name: "Make a theme" }).click();
  const frame = await builderFrame(page);
  await expect(frame.locator("[data-us=session-label]")).toHaveText("Session preview");
  await expect(frame.locator("[data-us=storage-note]")).toHaveText(COPY.builderSession);
  await frame.getByRole("textbox", { name: "Theme name" }).fill("Tab Only");
  await frame.getByRole("textbox", { name: "Theme name" }).press("Tab");
  await setHex(frame, "Background", "#102030");
  await save(frame);
  await expect(statusOf(frame)).toHaveText("Saved Tab Only and applied it to GitHub.");
  await expect.poll(async () => (await painted(page)).canvas).toBe("#102030");
  await page.reload();
  await waitSettled(page);
  await expect.poll(async () => (await painted(page)).canvas).toBe(CHOOM_CANVAS);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
});

test("Backup & help exports and removes a saved theme; Close and Escape return focus; no request is made", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  const requests = [];
  page.on("request", (request) => !request.url().startsWith("data:") && request.resourceType() !== "document" && requests.push(request.url()));
  let frame = await openBuilder(page);
  await frame.getByRole("textbox", { name: "Theme name" }).fill("Keep Me");
  await frame.getByRole("textbox", { name: "Theme name" }).press("Tab");
  await save(frame);
  await frame.getByRole("link", { name: "Backup & help" }).click();
  const backup = frame.locator('[data-rk="backup"]');
  await expect(backup.getByRole("heading", { name: "Backup & help" })).toBeVisible();
  await expect(frame.locator('[data-rb="builder"]')).toBeHidden();
  await expect(backup.getByText("check that GitHub Reskin is turned on for github.com in your userscript manager")).toBeVisible();
  await expect(backup.locator('[data-rk="capacity"]')).toHaveText(/^1 of /);
  const [file] = await Promise.all([page.waitForEvent("download"), backup.getByRole("button", { name: "Export Keep Me" }).click()]);
  expect(file.suggestedFilename()).toBe("keep-me.reskin.json");
  // Remove asks through the browser's own confirmation, from the frame.
  const asked = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.type());
    void dialog.accept();
  });
  await backup.getByRole("button", { name: "Remove Keep Me" }).click();
  await expect.poll(() => asked).toEqual(["confirm"]);
  await expect(backup.locator('[data-rk="status"]')).toHaveText("Removed Keep Me.");
  await expect.poll(async () => (await customThemes(gm, page)).length).toBe(0);
  await expect.poll(async () => (await painted(page)).canvas).toBe(CHOOM_CANVAS);
  await frame.getByRole("button", { name: "Close GitHub Reskin" }).click();
  await expect(page.locator(HOST)).toHaveCount(0);

  // Opened from a focused page control, through the card, Escape in the builder returns focus there.
  await page.evaluate(() => {
    const button = Object.assign(document.createElement("button"), { id: "page-control", textContent: "Page control" });
    document.body.prepend(button);
    button.focus();
  });
  frame = await openBuilder(page);
  await frame.getByRole("textbox", { name: "Theme name" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(HOST)).toHaveCount(0);
  await expect(page.locator("#page-control")).toBeFocused();
  expect(await page.evaluate(() => window.__resizeObservers.size)).toBe(0);
  expect(requests).toEqual([]);
});

test("in a real isolated world (Chromium's, Firefox's content-script Xrays) a theme is made, imported from a file and saved", async ({ manager, userscript, browserName }) => {
  let gm;
  let close = async () => {};
  if (browserName === "chromium") {
    gm = await manager({ kind: "sync", hooks: true, report: "content", world: "isolated", pages: { "/octo-sample": PROFILE_HTML } });
  } else {
    gm = await firefoxContentManager(userscript, { kind: "sync", hooks: true });
    close = gm.close;
  }
  try {
    const page = await gm.open(`${PROFILE_URL}#reskin`);
    const card = page.frameLocator(PANEL);
    await expect(card.locator("[data-rs=summary-show]")).not.toBeEmpty();
    await card.getByRole("button", { name: "Make a theme" }).click();
    const frame = await builderFrame(page);
    const fresh = frame.getByRole("button", { name: "Start with your saved theme" });
    if (await fresh.isVisible()) await fresh.click();
    await frame.getByRole("textbox", { name: "Theme name" }).fill("Isolated Ink");
    await frame.getByRole("textbox", { name: "Theme name" }).press("Tab");
    await setHex(frame, "Background", "#141820");
    await setHex(frame, "Accent", "#7fd1b9");
    // An image with metadata is converted on this device, offered, and placed once accepted.
    await frame.getByText("Backgrounds", { exact: true }).click();
    await frame.locator('[data-rb="image-file"]').setInputFiles({ name: "camera.png", mimeType: "image/png", buffer: pngWithText(240) });
    await expect(frame.locator('[data-rb="image-offer"]')).toBeVisible();
    await frame.getByRole("button", { name: "Use converted image" }).click();
    await expect(statusOf(frame)).toHaveText("Added the converted image.");
    await save(frame);
    await expect(statusOf(frame)).toHaveText("Saved Isolated Ink and applied it to GitHub.");
    const ink = (await gm.records(page))["reskin.settings"].customThemes.find((entry) => entry.document.name === "Isolated Ink").document;
    expect(ink.backgrounds.page.layers[0].image.data).toMatch(/^data:image\/(webp|png);base64,/);
    await expect.poll(async () => (await painted(page)).canvas).toBe("#141820");

    // Two themes in one answer: each is offered by name, and the chosen one previews.
    const dialog = await openImport(frame);
    await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(`First:\n${JSON.stringify(SHARED)}\nOr:\n${JSON.stringify(CSS_THEME)}`);
    await dialog.getByRole("button", { name: "Preview theme" }).click();
    await expect(dialog.getByText("There are two themes here. Choose one to preview.")).toBeVisible();
    await dialog.getByRole("button", { name: "Preview Moss and parchment" }).click();
    await expect(dialog.locator('[data-rb="import-show"]')).toHaveText("Moss and parchment");
    // A theme file, read from the frame's file input.
    await dialog.getByRole("button", { name: "Choose file" }).click();
    await dialog.getByLabel("Theme file (.json or .reskin.json)").setInputFiles({ name: "signal-glow.reskin.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(CSS_THEME)) });
    await dialog.getByRole("button", { name: "Preview theme" }).click();
    await expect(dialog.getByText(IMPORT_CSS_NOTE)).toBeVisible();
    await dialog.getByRole("button", { name: "Use theme" }).click();
    await save(frame);
    await expect(statusOf(frame)).toHaveText("Saved Signal Glow and applied it to GitHub.");
    const settings = (await gm.records(page))["reskin.settings"];
    expect(settings.customThemes.map((entry) => entry.document.name).sort()).toEqual(["Isolated Ink", "Signal Glow"]);
    expect(settings.cssConsent ?? {}).toEqual({});
    await expect.poll(async () => (await painted(page)).canvas).toBe("#0b1021");
  } finally {
    await close();
  }
});
