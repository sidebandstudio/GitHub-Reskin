// detectIsolation (userscript/isolation.js) and the manager menu (userscript/menu.js). A manager's
// report of page injection always means not isolated; the browser's own evidence (a Firefox Xray,
// a Chromium isolated world) means isolated with no report; a report of isolation counts only
// without that evidence, and never when it is a page global; anything else is not isolated. The
// menu offers every durable setting, the anime title first, follows the settings, and offers a
// failed change again.
import assert from "node:assert/strict";
import test from "node:test";
import { detectIsolation } from "../../userscript/isolation.js";
import { createMenu, MENU } from "../../userscript/menu.js";

const page = () => ({ customElements: {} });
// A content-script Xray: expandos set on the page's window are not seen through this one.
const xray = () => ({ customElements: {}, wrappedJSObject: {} });

test("isolation comes from the browser first, from the manager's report otherwise, and is never assumed", () => {
  assert.deepEqual(detectIsolation({ view: xray() }), { isolated: true, method: "xray" });
  assert.deepEqual(detectIsolation({ view: { customElements: null } }), { isolated: true, method: "isolated-world" });
  // A page that set a property named wrappedJSObject on its own window: the marker shows through.
  const faked = page();
  faked.wrappedJSObject = faked;
  assert.equal(detectIsolation({ view: faked }).isolated, false);
  for (const info of [{ sandboxMode: "raw" }, { injectInto: "page" }]) {
    assert.deepEqual(detectIsolation({ view: { customElements: null }, info }), { isolated: false, method: "manager-page" });
  }
  for (const info of [{ sandboxMode: "dom" }, { sandboxMode: "js" }, { injectInto: "content" }]) assert.deepEqual(detectIsolation({ view: page(), info }), { isolated: true, method: "manager" });
  assert.equal(detectIsolation({ view: page(), info: { scriptHandler: "Userscripts" }, gm: { getValue() {} } }).isolated, true);
  assert.equal(detectIsolation({ view: page(), info: { scriptHandler: "Userscripts" } }).isolated, false);
  // A report that is a global of the page is the page's, not the manager's.
  const planted = { injectInto: "content" };
  const view = Object.assign(page(), { GM_info: planted });
  assert.deepEqual(detectIsolation({ view, info: planted }), { isolated: false, method: "unverified" });
  assert.deepEqual(detectIsolation({ view: page() }), { isolated: false, method: "unverified" });
});

const settings = (overrides = {}) => ({ revision: 0, enabled: true, selectedThemeId: "anime.frieren", preferences: { appearance: "full", text: true, motion: true }, customThemes: [], ...overrides });
const CARDS = [
  { id: "anime.frieren", show: "Frieren: Beyond Journey's End", name: "Longroad Petals", group: "anime" },
  { id: "nord", name: "Nord", group: "classics" },
];
function fakeHost(initial) {
  let current = initial;
  let fail = false;
  const listeners = new Set();
  return {
    applied: [],
    set fail(value) {
      fail = value;
    },
    read: async () => ({ ok: true, settings: current }),
    async apply(change) {
      const action = typeof change === "function" ? change(current) : change;
      this.applied.push(action);
      if (fail) return { ok: false, code: "storage", issues: [] };
      if (action.type === "setEnabled") current = { ...current, enabled: action.enabled };
      if (action.type === "setPreference") current = { ...current, preferences: { ...current.preferences, [action.key]: action.value } };
      if (action.type === "selectTheme") current = { ...current, selectedThemeId: action.id };
      return { ok: true, settings: current };
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    remote(next) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}
function fakeManager(withRemove = true) {
  const entries = new Map();
  let id = 0;
  return {
    register: (name, run) => (entries.set(++id, { name, run }), id),
    unregister: withRemove ? (key) => entries.delete(key) : null,
    names: () => [...entries.values()].map((entry) => entry.name),
    choose: (name) => [...entries.values()].find((entry) => entry.name === name).run(),
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("the menu offers every durable setting, follows the settings and offers a failed change again", async () => {
  const host = fakeHost(settings());
  const manager = fakeManager();
  let opened = 0;
  const menu = createMenu({ register: manager.register, unregister: manager.unregister, host, cards: CARDS, customCard: () => null, open: () => opened++ });
  await menu.ready;
  assert.deepEqual(manager.names(), [MENU.open, "Turn GitHub Reskin off", "Use Calm appearance", "Turn extra theme text off", "Turn motion off", "✓ Frieren: Beyond Journey's End · Longroad Petals", "Nord · Classic"]);
  manager.choose(MENU.open);
  assert.equal(opened, 1);
  manager.choose("Nord · Classic");
  await settle();
  assert.deepEqual(host.applied.at(-1), { type: "selectTheme", id: "nord" });
  assert.ok(manager.names().includes("✓ Nord · Classic"));
  manager.choose("Use Calm appearance");
  await settle();
  assert.ok(manager.names().includes("Use Full appearance"));
  // Another tab's change relabels the entries.
  host.remote(settings({ enabled: false }));
  await settle();
  assert.ok(manager.names().includes("Turn GitHub Reskin on"));
  host.fail = true;
  manager.choose("Turn GitHub Reskin on");
  await settle();
  assert.deepEqual(manager.names().slice(0, 2), [MENU.open, MENU.retry]);
  host.fail = false;
  manager.choose(MENU.retry);
  await settle();
  assert.deepEqual(host.applied.at(-1), { type: "setEnabled", enabled: true });
  assert.equal(manager.names().includes(MENU.retry), false);
  menu.destroy();
});

test("a manager that cannot remove entries gets fixed labels whose switches act on the saved settings", async () => {
  const host = fakeHost(settings({ preferences: { appearance: "calm", text: false, motion: true } }));
  const manager = fakeManager(false);
  await createMenu({ register: manager.register, unregister: null, host, cards: CARDS, customCard: () => null, open: () => {} }).ready;
  assert.deepEqual(manager.names().slice(1, 5), Object.values(MENU.fixed));
  for (const name of Object.values(MENU.fixed)) manager.choose(name);
  await settle();
  assert.deepEqual(host.applied, [
    { type: "setEnabled", enabled: false },
    { type: "setPreference", key: "appearance", value: "full" },
    { type: "setPreference", key: "text", value: true },
    { type: "setPreference", key: "motion", value: false },
  ]);
  // Entries are added once.
  assert.equal(manager.names().length, 1 + 4 + CARDS.length);
});
