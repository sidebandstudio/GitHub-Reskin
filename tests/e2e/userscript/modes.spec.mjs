// Where the userscript runs decides what it offers, in Chromium and Firefox (userscript/isolation.js).
// Isolated from GitHub's JavaScript, in a Chromium isolated world on the manager's report or a
// Firefox content-script sandbox with none, the panel has its controls. A page script that ran
// first and faked that isolation gets none of it. In the page's
// own context it has none: the consent and isolation review's reproduction, where a page script
// patches Document.prototype.createElement and so holds the panel's frame, finds nothing that saves
// and changes no setting. The script there never touches the manager's storage, so a page script
// that patches built-ins can't capture it, and the manager's menu changes settings until the page
// reloads. Also the
// top layer: a page overlay drawn over the panel, with a false label, closes it, and a click
// through it to a real control is dropped.
import { CHOOM, CHOOM_CANVAS, FRIEREN_CANVAS, HOST, PANEL, PROFILE_HTML, PROFILE_URL, chooseMenu, expect, firefoxContentManager, menuNames, openPanel, painted, settingsOf, test, waitSettled } from "./helpers.mjs";

import { COPY } from "../../../userscript/copy.js";
const MENU_ONLY = COPY.menuOnly;

// The review's page-context manager: GM.* in a closure only the automation client can reach, the
// userscript run in the page's own world after load.
const pageWorld = (script) =>
  `(() => {const values = new Map(); const menu = []; const GM = {getValue: async (k, d) => (values.has(k) ? structuredClone(values.get(k)) : d), setValue: async (k, v) => void values.set(k, structuredClone(v)), deleteValue: async (k) => void values.delete(k), registerMenuCommand: (name, fn) => menu.push({ name, fn })};\n${script}\nreturn { menu, records: () => Object.fromEntries(values) };})()`;

test("in the page's own context a page script that holds the panel's frame finds no control and changes nothing; the manager's menu changes the page, never its storage", async ({ manager, userscript }) => {
  const gm = await manager({ inject: false });
  const page = await gm.context.newPage();
  await page.goto(PROFILE_URL);
  const handle = await page.evaluateHandle(pageWorld(userscript));
  const stored = () => handle.evaluate((m) => m.records());
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });
  expect(await stored()).toEqual({});
  // After the script captured attachShadow, as a later GitHub script could.
  await page.evaluate(() => {
    window.__caught = [];
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (...args) {
      const node = create.apply(this, args);
      if (String(args[0]).toLowerCase() === "iframe") window.__caught.push(node);
      return node;
    };
  });
  await expect.poll(() => handle.evaluate((m) => m.menu.map((entry) => entry.name).slice(0, 5))).toEqual(["Open GitHub Reskin", "Turn GitHub Reskin on or off", "Switch between Full and Calm", "Turn extra theme text on or off", "Turn motion on or off"]);
  await handle.evaluate((m) => m.menu[0].fn());
  await page.waitForFunction(() => window.__caught.some((frame) => frame.contentDocument?.querySelector("[data-us=storage-note]")?.textContent));
  const attack = await page.evaluate(() => {
    const doc = window.__caught.find((frame) => frame.contentDocument?.querySelector("[data-us=storage-note]")).contentDocument;
    const controls = [...doc.querySelectorAll("input, select, textarea, [data-theme], [data-rs], [data-us=export]")].map((node) => node.dataset.rs ?? node.dataset.theme ?? node.tagName);
    const note = doc.querySelector("[data-us=storage-note]").textContent;
    // Everything clickable, clicked; every input it could have, set.
    for (const node of doc.querySelectorAll("button, input, [role=switch], [data-theme]")) if (node.dataset.us !== "close") node.click();
    doc.querySelector("[data-theme='anime.frieren']")?.click();
    doc.querySelector("[data-rs=summary-show]").textContent = "Page-controlled replacement";
    return { controls, note, summary: doc.querySelector("[data-rs=summary-name]").textContent };
  });
  await page.waitForTimeout(500);
  expect(attack.controls.filter((name) => !["summary-show", "summary-name", "summary-note", "status"].includes(name))).toEqual([]);
  expect(attack.note).toBe(MENU_ONLY);
  expect(await stored()).toEqual({});
  expect(await painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });

  // A person's choice in the manager's menu changes the page, and still nothing is stored.
  const toggle = () => handle.evaluate((m) => m.menu.find((entry) => entry.name === "Turn GitHub Reskin on or off").fn());
  await toggle();
  await expect.poll(() => painted(page)).toMatchObject({ boot: "native", styled: false });
  await toggle();
  await handle.evaluate((m) => m.menu.find((entry) => entry.name.startsWith("Frieren")).fn());
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: FRIEREN_CANVAS });
  expect(await stored()).toEqual({});
});

test("in the page's own context a page script that patched Function.prototype.bind first never receives the manager's grants", async ({ manager, userscript }) => {
  const gm = await manager({ inject: false });
  const page = await gm.context.newPage();
  await page.goto(PROFILE_URL);
  await page.evaluate(() => {
    window.__bound = [];
    const bind = Function.prototype.bind;
    Function.prototype.bind = function (target, ...args) {
      window.__bound.push(target);
      return bind.call(this, target, ...args);
    };
  });
  const handle = await page.evaluateHandle(pageWorld(userscript));
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });
  await expect.poll(() => handle.evaluate((m) => m.menu.length)).toBeGreaterThan(0);
  // Nothing bound to an object that carries the manager's storage functions.
  expect(await page.evaluate(() => window.__bound.filter((target) => target && typeof target.getValue === "function").length)).toBe(0);
});

// What a page script that ran first could plant so the page looks isolated: Firefox's Xray and
// helper, a Chromium isolated world's null registry, a manager's report on a prototype.
const FORGERIES = {
  "window.wrappedJSObject": () => (window.wrappedJSObject = {}),
  "a null window.customElements": () => Object.defineProperty(window, "customElements", { value: null }),
  "window.exportFunction": () => (window.exportFunction = (fn) => fn),
  "GM_info on EventTarget.prototype": () => Object.defineProperty(EventTarget.prototype, "GM_info", { value: { scriptHandler: "Violentmonkey", injectInto: "content" } }),
};
for (const [name, forge] of Object.entries(FORGERIES)) {
  test(`in the page's own context a page script that planted ${name} first gets no grant, and nothing is stored`, async ({ manager, userscript }) => {
    const gm = await manager({ inject: false });
    const page = await gm.context.newPage();
    await page.goto(PROFILE_URL);
    await page.evaluate(forge);
    await page.evaluate(() => {
      window.__called = [];
      const call = Function.prototype.call;
      Function.prototype.call = function (target, ...args) {
        if (target && typeof target.getValue === "function") window.__called.push(target);
        return Reflect.apply(call, this, [target, ...args]);
      };
    });
    const handle = await page.evaluateHandle(pageWorld(userscript));
    await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });
    // The page-context menu: the script took none of it as isolation.
    await expect.poll(() => handle.evaluate((m) => m.menu.map((entry) => entry.name).slice(0, 2))).toEqual(["Open GitHub Reskin", "Turn GitHub Reskin on or off"]);
    await handle.evaluate((m) => m.menu[1].fn());
    await expect.poll(() => painted(page)).toMatchObject({ boot: "native", styled: false });
    expect(await handle.evaluate((m) => m.records())).toEqual({});
    expect(await page.evaluate(() => window.__called.length)).toBe(0);
  });
}

test("a manager that injects into the page: every setting from its menu until a reload, labels that follow the settings, nothing stored and a panel without controls", async ({ manager }) => {
  const gm = await manager({ kind: "sync", report: "page" });
  const page = await gm.open();
  await expect.poll(() => menuNames(page)).toContain("Turn GitHub Reskin off");
  const names = await menuNames(page);
  expect(names.slice(0, 5)).toEqual(["Open GitHub Reskin", "Turn GitHub Reskin off", "Use Calm appearance", "Turn extra theme text off", "Turn motion off"]);
  // One entry per theme, the anime title first, the current one marked.
  expect(names.filter((name) => name.startsWith("✓ "))).toEqual(["✓ Cyberpunk: Edgerunners · Choom Circuit"]);
  expect(names.some((name) => /^Frieren: Beyond Journey's End · /.test(name))).toBe(true);

  await chooseMenu(page, "Turn GitHub Reskin off");
  await expect.poll(() => painted(page)).toMatchObject({ boot: "native", styled: false });
  await expect.poll(() => menuNames(page)).toContain("Turn GitHub Reskin on");
  await chooseMenu(page, "Turn GitHub Reskin on");
  await chooseMenu(page, /^Frieren: /);
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: FRIEREN_CANVAS });
  await expect.poll(async () => (await menuNames(page)).filter((name) => name.startsWith("✓ "))).toEqual([expect.stringMatching(/^✓ Frieren: /)]);
  for (const [name, next] of [
    ["Use Calm appearance", "Use Full appearance"],
    ["Turn extra theme text off", "Turn extra theme text on"],
    ["Turn motion off", "Turn motion on"],
  ]) {
    await chooseMenu(page, name);
    await expect.poll(() => menuNames(page), { message: name }).toContain(next);
  }
  // None of it reached the manager's storage.
  expect(await gm.records(page)).toEqual({});

  // The panel names the theme and says why it has no controls, from the menu and from #reskin.
  const frame = page.frameLocator(PANEL);
  await chooseMenu(page, "Open GitHub Reskin");
  await expect(frame.locator("[data-us=storage-note]")).toHaveText(MENU_ONLY);
  await expect(frame.locator("[data-rs=summary-show]")).toHaveText(/^Frieren: /);
  await expect(frame.locator("input, [data-theme], [data-us=export]")).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "Close GitHub Reskin" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(HOST)).toHaveCount(0);
  await page.goto("about:blank");
  await page.goto(`${PROFILE_URL}#reskin`);
  await waitSettled(page);
  await expect(frame.locator("[data-us=storage-note]")).toHaveText(MENU_ONLY);
  // Nothing was saved, so the new page starts from the default theme.
  await expect(frame.locator("[data-rs=summary-show]")).toHaveText(/^Cyberpunk: Edgerunners/);
  expect(await gm.records(page)).toEqual({});
});

test("isolated, in Chromium on the manager's report and in Firefox's content-script sandbox with none: the panel has its controls, and a person changes a setting with them", async ({ manager, userscript, browserName }) => {
  let gm;
  let close = async () => {};
  if (browserName === "chromium") {
    gm = await manager({ kind: "sync", hooks: false, report: "content", world: "isolated", pages: { "/octo-sample": PROFILE_HTML } });
  } else {
    gm = await firefoxContentManager(userscript, { kind: "sync" });
    close = gm.close;
  }
  try {
    const page = await gm.open(`${PROFILE_URL}#reskin`);
    await expect(page.locator(HOST)).toHaveCount(1);
    await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });
    // The picker takes focus on its Reskin switch; the note card would focus Close instead.
    await page.keyboard.press("Space");
    await expect.poll(() => painted(page)).toMatchObject({ boot: "native", styled: false });
    await expect.poll(async () => (await gm.records(page))["reskin.settings"]?.enabled).toBe(false);
    // The page sees no grant and no manager value.
    expect(await page.evaluate(() => ["GM", "GM_info", "GM_getValue", "GM_registerMenuCommand"].filter((name) => name in window))).toEqual([]);
    // Saves take the origin's lock from the isolated world too (in Firefox through the content
    // script's bridge, userscript/storage.js), and the tab announces its write for as long as it is open.
    const held = () => page.evaluate(async () => (await navigator.locks.query()).held.map((lock) => lock.name.split("|")[0]));
    expect(await held()).toContain("github-reskin-userscript-state");
    await page.evaluate(() => {
      window.__release = null;
      navigator.locks.request("github-reskin-userscript-state", () => new Promise((resolve) => (window.__release = resolve)));
    });
    await page.waitForFunction(() => window.__release);
    await page.keyboard.press("Space");
    await page.waitForTimeout(600);
    expect((await gm.records(page))["reskin.settings"].enabled).toBe(false);
    await page.evaluate(() => window.__release());
    await expect.poll(async () => (await gm.records(page))["reskin.settings"].enabled).toBe(true);
  } finally {
    await close();
  }
});

// The review's false-label overlay: a pointer-transparent top-layer element over the real switch.
function overlay(box) {
  const fake = document.createElement("div");
  fake.setAttribute("popover", "manual");
  fake.style.cssText = `position:fixed;inset:auto;margin:0;left:${box.x - 200}px;top:${box.y - 8}px;width:${box.width + 220}px;height:${box.height + 16}px;background:#262d36;color:#eee;display:flex;align-items:center;justify-content:center;pointer-events:none`;
  fake.textContent = "Turn off animation preview";
  document.documentElement.append(fake);
  fake.showPopover();
}

test("the panel draws in the top layer; a page overlay over it closes it, and a click through one is dropped", async ({ manager }) => {
  const gm = await manager({ kind: "sync" });
  const page = await gm.open();
  let frame = await openPanel(page);
  expect(await page.evaluate((selector) => document.querySelector(selector).matches(":popover-open"), HOST)).toBe(true);
  const box = await frame.getByRole("switch", { name: "Reskin" }).boundingBox();

  // An overlay that enters the top layer over the panel closes it.
  await page.evaluate(overlay, box);
  await expect(page.locator(HOST)).toHaveCount(0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect((await settingsOf(gm, page)).enabled).toBe(true);
  await page.evaluate(() => document.querySelectorAll("[popover]").forEach((node) => node.remove()));

  // A page that hides the overlay's arrival from the panel: the person's click is still dropped.
  frame = await openPanel(page);
  await page.evaluate(() => window.addEventListener("toggle", (event) => event.stopImmediatePropagation(), true));
  await page.evaluate(overlay, box);
  await page.waitForTimeout(200);
  await expect(page.locator(HOST)).toHaveCount(1);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(HOST)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect((await settingsOf(gm, page)).enabled).toBe(true);
  expect(await painted(page)).toMatchObject({ boot: "ready", canvas: CHOOM_CANVAS });
  expect((await settingsOf(gm, page)).selectedThemeId).toBe(CHOOM);
});
