// The extension UiHost over a fake browser namespace: settings through the background, the small
// ui record written by the page itself, and change notifications for settings and Undo only.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHost } from "../../packages/ui/host.js";

function fakeApi({ reply = { ok: true, settings: { revision: 1 }, notices: [] }, records = {} } = {}) {
  const sent = [];
  const listeners = new Set();
  const data = structuredClone(records);
  return {
    sent,
    data,
    listeners,
    runtime: {
      sendMessage: async (message) => {
        sent.push(message);
        if (reply instanceof Error) throw reply;
        return typeof reply === "function" ? reply(message) : reply;
      },
    },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
        set: async (record) => Object.assign(data, structuredClone(record)),
      },
      onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    },
  };
}

test("read asks the background for settings and reads lastGood and the ui record directly", async () => {
  const api = fakeApi({ records: { "reskin.lastGood": { themeId: "nord", revision: 0 }, "reskin.ui": { group: "classics", junk: 1 } } });
  const host = createExtensionHost(api, { view: { matchMedia: () => ({ matches: true }) } });
  const result = await host.read();
  assert.deepEqual(result, { ok: true, settings: { revision: 1 }, notices: [], lastGood: { themeId: "nord", revision: 0 }, ui: { group: "classics" } });
  assert.equal(api.sent[0].type, "get");
  assert.match(api.sent[0].requestId, /^[A-Za-z0-9]{32}$/);
  assert.equal(host.reducedMotion(), true);
});

test("commit sends a typed request with the expected revision and never throws", async () => {
  const api = fakeApi({ reply: (message) => ({ ok: true, echo: message }) });
  const host = createExtensionHost(api);
  const reply = await host.commit({ type: "selectTheme", id: "nord" }, 7);
  assert.deepEqual({ type: reply.echo.type, expectedRevision: reply.echo.expectedRevision, action: reply.echo.action }, { type: "commit", expectedRevision: 7, action: { type: "selectTheme", id: "nord" } });
  const failing = createExtensionHost(fakeApi({ reply: new Error("Could not establish connection") }));
  assert.deepEqual(await failing.commit({ type: "setEnabled", enabled: false }, 1), { ok: false, code: "storage", issues: [{ message: "Could not establish connection" }] });
  assert.equal((await failing.read()).ok, false);
  const unreadable = createExtensionHost(fakeApi({ reply: { ok: false, code: "invalid", current: { revision: 0 }, issues: [{ message: "bad" }] } }));
  assert.deepEqual(await unreadable.read(), { ok: false, message: "bad", settings: { revision: 0 } });
});

test("writeUi merges known fields only", async () => {
  const api = fakeApi({ records: { "reskin.ui": { group: "anime" } } });
  const host = createExtensionHost(api);
  await host.writeUi({ undoneAt: 4 });
  assert.deepEqual(api.data["reskin.ui"], { group: "anime", undoneAt: 4 });
  await assert.rejects(host.writeUi({ theme: "x" }), /Unknown UI record field/);
});

test("subscribe reports settings and lastGood changes in local storage only, and unsubscribes", () => {
  const api = fakeApi();
  const host = createExtensionHost(api);
  let calls = 0;
  const stop = host.subscribe(() => calls++);
  const [handler] = api.listeners;
  handler({ "reskin.settings": {} }, "local");
  handler({ "reskin.lastGood": {} }, "local");
  handler({ "reskin.ui": {} }, "local");
  handler({ "reskin.settings": {} }, "sync");
  assert.equal(calls, 2);
  stop();
  assert.equal(api.listeners.size, 0);
});

test("openPage sends a typed open-page request", async () => {
  const api = fakeApi();
  await createExtensionHost(api).openPage("settings");
  assert.deepEqual(api.sent[0].action, { page: "settings" });
});
