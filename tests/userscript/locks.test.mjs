// Cross-tab saves under the Web Lock (userscript/storage.js), with the origin's real
// navigator.locks. Two reproductions from the consent and isolation review, which no confirmation
// delay can close: a tab whose manager write is paused after its revision check while another tab
// saves and is acknowledged, and a manager that delivers one tab's write to the other only after
// both have saved. Neither may end with two acknowledged saves and one of them gone. A busy lock or
// an undelivered write ends in a retryable failure, never a wait without end, and a lock stolen
// mid-commit fails that commit before it writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { STORAGE_KEYS } from "../../packages/contracts/index.js";
import { createRepository, defaultSettings } from "../../packages/settings/index.js";
import { createGmHost } from "../../userscript/host.js";
import { createGmStorage, LOCK_BUSY, STATE_KEY } from "../../userscript/storage.js";
import { catalog, context, deferred } from "../settings/helpers.mjs";

const VIEW = { navigator: {}, matchMedia: () => ({ matches: false }) };
const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const seed = () => ({ format: 1, stamp: "seed:1", lineage: [], records: { [STORAGE_KEYS.settings]: defaultSettings(catalog), [STORAGE_KEYS.boot]: null } });
const settingsIn = (value) => value.records[STORAGE_KEYS.settings];
const off = { type: "setEnabled", enabled: false };
const noText = { type: "setPreference", key: "text", value: false };

// A tab: its own storage adapter and repository over the scope `grants(i)` gives it, sharing one
// lock name (one origin) with the other tabs of the test.
function tab(scope, lockName, lockWaitMs = 400) {
  const { storage, capabilities } = createGmStorage(scope, { confirmMs: 20, locks: navigator.locks, lockName, lockWaitMs });
  const host = createGmHost({ storage, repository: createRepository(storage, context({ snapshot: undefined })), capabilities, view: VIEW });
  return { host, storage };
}
const grants = (kind, get, set) => (kind === "sync" ? { GM_getValue: get, GM_setValue: set } : { GM: { getValue: async (...args) => get(...args), setValue: async (...args) => set(...args) } });

for (const kind of ["sync", "async"]) {
  test(`${kind}: a write paused after its check holds the lock, so another tab's save waits, then fails to retry or meets a conflict, and nothing acknowledged is lost`, async () => {
    for (const release of ["after the other tab gave up", "while the other tab waits"]) {
      const lockName = `test-${randomUUID()}`;
      let value = seed();
      const reached = deferred();
      const resume = deferred();
      let pause = false;
      const make = (i) =>
        tab(
          grants(kind, (key, fallback) => (key === STATE_KEY ? clone(value) : fallback), async (key, next) => {
            if (i === 1 && pause && key === STATE_KEY) {
              pause = false;
              reached.resolve();
              await resume.promise;
            }
            value = clone(next);
          }),
          lockName,
        );
      const a = make(0);
      const b = make(1);
      await a.host.read();
      await b.host.read();
      pause = true;
      const bReply = b.host.commit(noText, 0);
      await reached.promise;
      let aReply;
      if (release === "after the other tab gave up") {
        // The review's exact order: A's whole save runs while B is paused, then B is released.
        aReply = await a.host.commit(off, 0);
        resume.resolve();
        assert.deepEqual([aReply.ok, aReply.code, aReply.issues?.[0]?.message], [false, "storage", LOCK_BUSY], release);
      } else {
        const pending = a.host.commit(off, 0);
        await new Promise((resolve) => setTimeout(resolve, 60));
        resume.resolve();
        aReply = await pending;
        // A read B's write inside the lock: its revision moved, so A is told, with the current settings.
        assert.deepEqual([aReply.ok, aReply.code, aReply.current?.preferences.text], [false, "conflict", false], release);
      }
      const replyB = await bReply;
      assert.equal(replyB.ok, true, release);
      assert.deepEqual([settingsIn(value).enabled, settingsIn(value).preferences.text, settingsIn(value).revision], [true, false, 1], release);
      // A's change is applied again on the current settings, as the picker does: both stand.
      const again = await a.host.commit(off, settingsIn(value).revision);
      assert.equal(again.ok, true, release);
      assert.deepEqual([settingsIn(value).enabled, settingsIn(value).preferences.text, settingsIn(value).revision], [false, false, 2], release);
      a.storage.release();
      b.storage.release();
    }
  });

  test(`${kind}: a write the manager has not yet delivered to the other tab is waited for inside the lock, never replaced`, async () => {
    for (const delivery of ["never, while both save", "while the second tab waits"]) {
      const lockName = `test-${randomUUID()}`;
      let canonical = seed();
      const caches = [seed(), seed()];
      // Each tab reads its own cache; a write reaches the other tab's only through deliver().
      const make = (i) =>
        tab(
          grants(kind, (key, fallback) => (key === STATE_KEY ? clone(caches[i]) : fallback), (key, next) => {
            if (key !== STATE_KEY) return;
            canonical = clone(next);
            caches[i] = clone(next);
          }),
          lockName,
        );
      const deliver = () => caches.splice(0, 2, clone(canonical), clone(canonical));
      const a = make(0);
      const b = make(1);
      await a.host.read();
      await b.host.read();
      const timer = delivery === "while the second tab waits" ? setTimeout(deliver, 150) : null;
      const replies = await Promise.all([a.host.commit(off, 0), b.host.commit(noText, 0)]);
      clearTimeout(timer);
      const persisted = settingsIn(canonical);
      const acknowledged = replies.filter((reply) => reply.ok);
      assert.equal(acknowledged.length, 1, `${delivery}: ${JSON.stringify(replies.map((reply) => [reply.ok, reply.code]))}`);
      // Whatever was acknowledged is what is stored.
      assert.deepEqual(persisted, acknowledged[0].settings, delivery);
      const told = replies.find((reply) => !reply.ok);
      assert.equal(told.code, delivery === "while the second tab waits" ? "conflict" : "storage", delivery);
      if (told.code === "storage") assert.equal(told.issues[0].message, LOCK_BUSY, delivery);
      deliver();
      a.storage.release();
      b.storage.release();
    }
  });
}

test("a lock stolen mid-commit fails that commit before it writes, and the menu's apply acts on the settings inside the lock", async () => {
  const lockName = `test-${randomUUID()}`;
  let value = seed();
  const gate = deferred();
  let hold = false;
  const { host, storage } = tab(
    {
      GM_getValue: (key, fallback) => (key === STATE_KEY ? clone(value) : fallback),
      GM_setValue: (key, next) => void (value = clone(next)),
    },
    lockName,
  );
  await host.read();
  const repository = createRepository(storage, context({ snapshot: undefined }));
  // A commit that waits after its read until the lock has been stolen from it.
  const stolen = storage.transaction(async () => {
    hold = true;
    await gate.promise;
    return repository.commit(off, 0);
  });
  while (!hold) await new Promise((resolve) => setTimeout(resolve, 5));
  await navigator.locks.request(lockName, { steal: true }, async () => gate.resolve());
  const reply = await stolen;
  assert.deepEqual([reply.ok, reply.code, reply.issues[0].message.includes(LOCK_BUSY)], [false, "storage", true]);
  assert.equal(settingsIn(value).enabled, true);

  // apply() needs no revision: it is the action on the latest settings.
  value.records[STORAGE_KEYS.settings] = { ...settingsIn(value), revision: 4 };
  const applied = await host.apply(noText);
  assert.deepEqual([applied.ok, settingsIn(value).preferences.text, settingsIn(value).revision], [true, false, 5]);
  storage.release();
});
