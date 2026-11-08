import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { build } from "./scripts/userscript.mjs";

const script = await build();

test("the committed userscript matches the extension", async () => {
  const committed = await readFile(new URL("./userscript/github-reskin.user.js", import.meta.url), "utf8");
  assert.equal(committed.replace(/\r\n/g, "\n"), script, "Run node scripts/userscript.mjs");
});

test("the userscript paints from userscript storage and repaints when you come back to the tab", async () => {
  const values = { theme: "nord" };
  const events = {};
  const style = {};
  const document = {
    readyState: "complete",
    hidden: false,
    documentElement: { append() {} },
    createElement: () => style,
    addEventListener: (type, listener) => (events[type] = listener),
  };
  const GM = { getValue: async (key, fallback) => values[key] ?? fallback, setValue: async (key, value) => (values[key] = value) };
  const context = { GM, document, window: { addEventListener() {} }, location: { protocol: "https:", hash: "" }, setTimeout };
  vm.runInNewContext(script, context);
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  await settle();
  assert.match(style.textContent, /--bgColor-default:#2e3440 !important/);

  values.theme = "dracula";
  events.visibilitychange();
  await settle();
  assert.match(style.textContent, /--bgColor-default:#282a36 !important/);

  values.enabled = false;
  events.visibilitychange();
  await settle();
  assert.equal(style.textContent, "");
});

// Runs the userscript on a stand-in GitHub page, with `values` as the manager's saved values.
// Returns the page's stylesheet and events, and the GM keys read and written.
function runUserscript(values) {
  const events = {};
  const style = { textContent: "" };
  const reads = [];
  const writes = [];
  const document = {
    readyState: "complete",
    hidden: false,
    documentElement: { append() {} },
    createElement: () => style,
    addEventListener: (type, listener) => (events[type] = listener),
  };
  const GM = {
    getValue: async (key, fallback) => (reads.push(key), key in values ? structuredClone(values[key]) : fallback),
    // One key per call, so a save writes only the settings it changes.
    setValue: async (key, value) => (writes.push([key, value]), (values[key] = structuredClone(value))),
  };
  const context = { GM, document, window: { addEventListener() {} }, location: { protocol: "https:", hash: "" }, setTimeout };
  vm.runInNewContext(script, context);
  return { style, events, reads, writes, GitHubReskin: context.GitHubReskin };
}

// Just enough of the frame's document for the card. Returns its controls once settings have loaded.
async function openCard(GitHubReskin) {
  const all = [];
  const element = (tag) => {
    const listeners = {};
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      style: { setProperty() {} },
      classList: { toggle() {} },
      setAttribute() {},
      removeAttribute() {},
      append: (...kids) => el.children.push(...kids),
      addEventListener: (type, fn) => (listeners[type] = fn),
      fire: (type) => listeners[type]({ target: el }),
      querySelectorAll: () => all.filter((e) => e.tagName === "INPUT"),
    };
    all.push(el);
    return el;
  };
  const ids = Object.fromEntries(["themes", "colors", "enabled", "reset", "warning", "status"].map((id) => [id, element("div")]));
  const main = element("main");
  main.inert = true;
  const doc = {
    documentElement: element("html"),
    body: element("body"),
    activeElement: null,
    createElement: element,
    getElementById: (id) => ids[id],
    querySelector: () => main,
  };
  GitHubReskin.card(doc);
  while (main.inert) await settle();
  return {
    status: () => ids.status.textContent,
    pick: (id) => ids.themes.children.find((b) => b.dataset.id === id).fire("click"),
    toggle: (on) => {
      ids.enabled.checked = on;
      ids.enabled.fire("change");
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const SETTING_KEYS = ["enabled", "theme", "custom"];

test("a theme picked and turned off in the userscript card stays that way after a reload", async () => {
  const values = {};
  const page = runUserscript(values);
  const card = await openCard(page.GitHubReskin);
  card.pick("nord");
  card.toggle(false);
  await settle();
  assert.deepEqual(page.writes, [["theme", "nord"], ["custom", null], ["theme", "nord"], ["enabled", false]]);
  assert.equal(page.style.textContent, "");

  // A new page load reads Nord and off, not the default theme turned on.
  const reloaded = runUserscript(values);
  await settle();
  assert.equal(reloaded.style.textContent, "");
  assert.equal((await openCard(reloaded.GitHubReskin)).status(), "Off");
  assert.ok(reloaded.reads.every((key) => SETTING_KEYS.includes(key)), reloaded.reads.join());

  values.enabled = true;
  reloaded.events.visibilitychange();
  await settle();
  assert.match(reloaded.style.textContent, /--bgColor-default:#2e3440 !important/);
});

test("with no saved theme, the userscript paints the default theme and saves nothing", async () => {
  const page = runUserscript({});
  await settle();
  assert.match(page.style.textContent, /--bgColor-default:#0a0a17 !important/);
  assert.match(page.style.textContent, /reskin-effects:cyberpunk/);
  assert.equal((await openCard(page.GitHubReskin)).status(), "Cyberpunk");
  assert.ok(page.reads.every((key) => SETTING_KEYS.includes(key)), page.reads.join());
  assert.deepEqual(page.writes, []);
});

test("colors edited in the 1.0 userscript stay on Editing Suite after the upgrade", async () => {
  // 1.0 saved only the colors when you edited them, each setting under its own key.
  const custom = { bg: "#101010", text: "#f0f0f0", accent: "#ff2a6d", graph: "#39ff14" };
  const page = runUserscript({ custom });
  await settle();
  assert.match(page.style.textContent, /--bgColor-default:#101010 !important/);
  assert.doesNotMatch(page.style.textContent, /reskin-effects/);
  assert.equal((await openCard(page.GitHubReskin)).status(), "Editing Suite, edited");
  // Loading never writes, so the theme is saved only with the next change.
  assert.deepEqual(page.writes, []);
});
