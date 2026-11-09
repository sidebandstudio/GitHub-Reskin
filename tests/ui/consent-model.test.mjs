// A model-based test of the advanced CSS approval invariant. Seeded random sequences of every
// builder and repository action run against the real settings repository, with in-memory storage,
// several editor windows, failing writes, restarts and sanitizer updates. The simulated editors are
// careless on purpose: they replay any approval ticket they ever saw (their own stale ones and other
// windows'), save copies, re-add removed themes, undo past revocations, resume drafts in new
// windows, import, export and send the earlier build's direct grants. After every step the test
// checks the invariant against a reference model of what the person actually approved:
//
//   every stored approval names a saved theme, its current sanitizer version and exactly the
//   sanitized hash of that theme's CSS; and an approval that was not there, unchanged, before a
//   step was created by that step redeeming a ticket the same editor got from an explicit Enable
//   for that target and that exact CSS, unused and not withdrawn, removed, revoked or changed since.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "../../packages/contracts/index.js";
import * as settingsPackage from "../../packages/settings/index.js";
import { catalog, CLASSICS, context, counter, memoryStorage, snapshot, standInCss } from "../settings/helpers.mjs";

// A namespace import, so this file also loads, and fails, against a build without approval tickets.
const { createRepository, STORAGE_LIMITS } = settingsPackage;
const APPROVALS_KEY = settingsPackage.APPROVALS_KEY ?? "reskin.cssApprovals";
const SEQUENCES = Number(process.env.RESKIN_MODEL_SEQUENCES ?? 3000);
const STEPS = 18;
const SEED = 0x5eed2026;

const nord = CLASSICS.find((t) => t.id === "nord").document;
const CSS = [".AppHeader { box-shadow: none; }", ".AppHeader, .Header { box-shadow: 0 1px 0 var(--reskin-accent); }", "h1 { letter-spacing: 0.02em; }"];
const ACCENTS = ["#88c0d0", "#ff806c", "#a3be8c"];

// Resolving the boot snapshot is most of a commit's cost and decides nothing about approval, so
// most sequences run without one (the boot record is then null); every tenth resolves it for real
// and checks that the boot record carries exactly the selected theme's stored approval.
const BOOT_EVERY = 10;

// mulberry32: small, fast and the same on every run.
function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  return { next, int, pick: (list) => list[int(list.length)], chance: (p) => next() < p };
}

const documentWith = ({ name = "Mine", accent = ACCENTS[0], css = null }) => {
  const document = { ...structuredClone(nord), name, colors: { ...nord.colors, accent } };
  if (css !== null) document.css = css;
  return document;
};

async function runSequence(seed, failures) {
  const rng = random(seed);
  let version = 1;
  let failNext = 0;
  const legacy = rng.chance(0.15);
  const withBoot = seed % BOOT_EVERY === 0;
  const storage = memoryStorage(legacy ? { theme: "vaporwave", enabled: true } : {}, {
    set: async () => {
      if (failNext > 0) {
        failNext--;
        throw new Error("QUOTA_BYTES quota exceeded");
      }
    },
  });
  const newId = counter(`${(seed >>> 0).toString(16).padStart(8, "0").slice(-8)}-0000-4000-8000-`);
  const open = () => createRepository(storage, context({ css: standInCss(version), newId, snapshot: withBoot ? snapshot : undefined }));
  let repository = open();
  await repository.initialize();

  const hashOf = (document) => {
    const result = standInCss(version).inspect({ css: document?.css }).css;
    return result?.ok ? result.hash : null;
  };
  const settings = () => storage.data.get(STORAGE_KEYS.settings);

  // The reference model: tickets the person's explicit Enable issued and that still stand.
  let legit = [];
  const issued = [];
  const editors = [];
  const openEditor = (draft = { savedId: null, document: documentWith({ css: rng.pick([null, ...CSS]) }) }) => {
    const editor = { id: `e${seed.toString(36)}x${editors.length}`.padEnd(20, "0"), tickets: [], draft, history: [] };
    editors.push(editor);
    return editor;
  };
  openEditor();
  const log = [];

  // One commit, then the invariant. `grant` describes a ticket the action carries.
  async function commit(action, { revision = settings().revision, grant = null } = {}) {
    // Storage replaces a record on every write and never mutates it, so this is the earlier state.
    const before = settings();
    const legitBefore = legit.slice();
    const reply = await repository.commit(action, revision);
    const after = settings();
    log.push([action.type, action.id ?? action.target ?? "", reply.ok ? "ok" : reply.code]);
    if (action.type === "approveCss" || action.type === "withdrawCss") {
      assert.deepEqual(after, before, "an approval request never changes settings");
    }
    // Structural: an approval names a saved theme, this sanitizer and exactly its CSS hash.
    for (const [id, consent] of Object.entries(after.cssConsent)) {
      const theme = after.customThemes.find((t) => t.id === id);
      assert.ok(theme, `approval for a theme that is not saved: ${id}`);
      assert.equal(consent.sanitizerVersion, version, "approval under another sanitizer version");
      assert.equal(consent.hash, hashOf(theme.document), "approval for other CSS than the theme has");
    }
    // A refused or failed commit changes nothing, so it revokes nothing either.
    const revokes = (id) =>
      reply.ok && (action.type === "resetAll" || (action.type === "deleteCustom" && action.id === id) || (action.type === "setCssConsent" && action.id === id && action.granted === false) || (action.type === "saveCustom" && action.id === id && action.approval === null));
    // Provenance: anything new or changed came from a ticket that stands in the model.
    const created = after.customThemes.filter((t) => !before.customThemes.some((b) => b.id === t.id)).map((t) => t.id);
    for (const [id, consent] of Object.entries(after.cssConsent)) {
      assert.equal(revokes(id), false, `a revocation left an approval behind: ${id}`);
      const earlier = before.cssConsent[id];
      const theme = before.customThemes.find((t) => t.id === id);
      const kept = earlier && theme && earlier.hash === consent.hash && earlier.sanitizerVersion === consent.sanitizerVersion && hashOf(theme.document) === consent.hash;
      if (kept) continue;
      const target = action.type === "saveCustom" ? (action.id ?? "new") : action.id;
      const forThis = action.type === "saveCustom" ? (action.id ? action.id === id : created.includes(id)) : action.type === "setCssConsent" && action.id === id;
      assert.ok(grant && forThis, `an approval appeared without a ticket: ${action.type} ${id}`);
      const stands = legitBefore.some((l) => l.editor === action.editor && l.ticket === grant.ticket && l.target === target && l.hash === consent.hash && l.version === version);
      assert.ok(stands, `an approval appeared from a ticket the person did not give for this theme and text: ${action.type} ${id}`);
    }
    // The model follows what invalidates a ticket.
    if (reply.ok && grant) legit = legit.filter((l) => l.ticket !== grant.ticket);
    if (action.type === "resetAll") legit = [];
    for (const theme of before.customThemes) {
      const now = after.customThemes.find((t) => t.id === theme.id);
      if (!now || hashOf(now.document) !== hashOf(theme.document) || revokes(theme.id) || (before.cssConsent[theme.id] && !after.cssConsent[theme.id])) legit = legit.filter((l) => l.target !== theme.id);
    }
    if (withBoot) {
      const boot = storage.data.get(STORAGE_KEYS.boot);
      if (boot) assert.deepEqual(boot.cssConsent, after.cssConsent[after.selectedThemeId] ?? null, "the boot record's approval is the stored one");
    }
    const approvals = storage.data.get(APPROVALS_KEY) ?? [];
    if (approvals.length) assert.ok(approvals.length <= STORAGE_LIMITS.maxApprovals, "pending approvals stay bounded");
    return reply;
  }

  const ids = () => settings().customThemes.map((t) => t.id);
  const anyId = () => (rng.chance(0.85) && ids().length ? rng.pick(ids()) : `local:${newId()}`);
  // What a careless editor sends as approval: nothing, a revocation, its newest ticket, any ticket
  // it or another window ever saw, a forged one, or the earlier build's direct grant.
  function approvalFor(editor, document) {
    const roll = rng.next();
    if (roll < 0.25) return {};
    if (roll < 0.35) return { approval: null };
    if (roll < 0.6 && editor.tickets.length) return { approval: editor.tickets.at(-1).ticket };
    if (roll < 0.75 && editor.tickets.length) return { approval: rng.pick(editor.tickets).ticket };
    if (roll < 0.85 && issued.length) return { approval: rng.pick(issued).ticket };
    if (roll < 0.9) return { approval: `forged-${rng.int(1e9)}`.padEnd(24, "x") };
    const hash = hashOf(document);
    return hash ? { cssConsent: { hash, sanitizerVersion: version } } : {};
  }
  async function save(editor, { asCopy = false, document = editor.draft.document, id = asCopy ? undefined : editor.draft.savedId } = {}) {
    const choice = approvalFor(editor, document);
    // The earlier build's grant went without an editor, exactly as its builder sent it.
    const action = { type: "saveCustom", document, select: rng.chance(0.8), ...(choice.cssConsent ? {} : { editor: editor.id }), ...choice };
    if (id) action.id = id;
    const grant = typeof choice.approval === "string" ? { ticket: choice.approval } : null;
    const before = new Set(ids());
    const reply = await commit(action, { grant });
    if (reply.ok) {
      editor.history.push(structuredClone(editor.draft));
      editor.draft = { savedId: id ?? ids().find((x) => !before.has(x)), document };
    }
    return { action, grant, reply };
  }

  const steps = {
    // The explicit Enable advanced CSS choice: a ticket for this editor's target and CSS.
    async enable(editor = rng.pick(editors)) {
      const css = rng.chance(0.9) ? (editor.draft.document.css ?? rng.pick(CSS)) : "INVALID {";
      const target = rng.chance(0.9) ? (editor.draft.savedId ?? "new") : anyId();
      const reply = await commit({ type: "approveCss", editor: editor.id, target, css });
      if (reply.ok) {
        const ticket = { ticket: reply.approval.ticket, target, hash: reply.approval.hash };
        editor.tickets.push(ticket);
        issued.push(ticket);
        legit.push({ ...ticket, editor: editor.id, version });
      }
    },
    // Turning Enable off, or changing the CSS: the builder withdraws this editor's tickets.
    async disable(editor = rng.pick(editors)) {
      await commit({ type: "withdrawCss", editor: editor.id });
      legit = legit.filter((l) => l.editor !== editor.id);
    },
    async editColor() {
      const editor = rng.pick(editors);
      editor.history.push(structuredClone(editor.draft));
      editor.draft = { ...editor.draft, document: { ...editor.draft.document, colors: { ...editor.draft.document.colors, accent: rng.pick(ACCENTS) } } };
    },
    async editCss() {
      const editor = rng.pick(editors);
      editor.history.push(structuredClone(editor.draft));
      const css = rng.pick([null, ...CSS]);
      const document = { ...editor.draft.document };
      if (css === null) delete document.css;
      else document.css = css;
      editor.draft = { ...editor.draft, document };
      // A careless editor sometimes forgets to withdraw; its stale ticket is then for other text.
      if (rng.chance(0.7)) await steps.disable(editor);
    },
    async rename() {
      const editor = rng.pick(editors);
      editor.draft = { ...editor.draft, document: { ...editor.draft.document, name: `Mine ${rng.int(100)}` } };
      if (editor.draft.savedId) await save(editor);
    },
    async save() {
      await save(rng.pick(editors));
    },
    async saveCopy() {
      const editor = rng.pick(editors);
      await save(editor, { asCopy: true, document: { ...editor.draft.document, name: `${editor.draft.document.name} copy` } });
    },
    async undo() {
      const editor = rng.pick(editors);
      if (editor.history.length) editor.draft = editor.history.pop();
      if (rng.chance(0.5)) await save(editor);
    },
    async reset() {
      const editor = rng.pick(editors);
      const saved = settings().customThemes.find((t) => t.id === editor.draft.savedId);
      if (saved) editor.draft = { savedId: saved.id, document: structuredClone(saved.document) };
      if (rng.chance(0.5)) await save(editor);
    },
    async importTheme() {
      const editor = rng.pick(editors);
      editor.history.push(structuredClone(editor.draft));
      // Paste, file, share code or preview link: a new theme, its CSS off until Enable.
      editor.draft = { savedId: null, document: documentWith({ name: "Imported", accent: rng.pick(ACCENTS), css: rng.pick([null, ...CSS]) }) };
      if (rng.chance(0.3)) await steps.enable(editor);
      if (rng.chance(0.5)) await save(editor);
    },
    async exportRoundTrip() {
      const theme = rng.pick(settings().customThemes);
      if (!theme) return;
      const editor = rng.pick(editors);
      editor.draft = { savedId: null, document: JSON.parse(JSON.stringify(theme.document)) };
      await save(editor);
    },
    async remove() {
      if (!ids().length) return;
      await commit({ type: "deleteCustom", id: anyId() });
    },
    async removeAndReadd() {
      const theme = rng.pick(settings().customThemes);
      if (!theme) return;
      await commit({ type: "deleteCustom", id: theme.id });
      const editor = rng.pick(editors);
      editor.draft = { savedId: rng.chance(0.5) ? theme.id : null, document: theme.document };
      const result = await save(editor);
      if (!result.reply.ok && editor.draft.savedId) await save(editor, { id: undefined });
    },
    async revoke() {
      if (!ids().length) return;
      if (rng.chance(0.5)) await commit({ type: "setCssConsent", id: anyId(), granted: false });
      else {
        const editor = rng.pick(editors);
        const saved = rng.pick(settings().customThemes);
        await save(editor, { id: saved.id, document: saved.document });
      }
    },
    async grantDirectly() {
      if (!ids().length) return;
      const editor = rng.pick(editors);
      const id = anyId();
      if (rng.chance(0.15)) {
        const theme = settings().customThemes.find((t) => t.id === id);
        const hash = hashOf(theme?.document);
        await commit({ type: "setCssConsent", id, granted: true, hash: hash ?? "0".repeat(64), sanitizerVersion: version });
        return;
      }
      const pool = rng.chance(0.7) ? editor.tickets : issued;
      if (!pool.length) return;
      const { ticket } = rng.pick(pool);
      await commit({ type: "setCssConsent", id, granted: true, editor: editor.id, approval: ticket }, { grant: { ticket } });
    },
    async secondWindow() {
      if (editors.length < 4) openEditor({ savedId: rng.chance(0.7) && ids().length ? rng.pick(ids()) : null, document: rng.pick(settings().customThemes)?.document ?? documentWith({ css: rng.pick(CSS) }) });
    },
    // A kept draft resumed in a new window: the draft, never the old window's identity.
    async resume() {
      const from = rng.pick(editors);
      const editor = openEditor(structuredClone(from.draft));
      if (rng.chance(0.4)) editor.tickets.push(...from.tickets);
      await save(editor);
    },
    async preferences() {
      const roll = rng.int(6);
      if (roll === 0) await commit({ type: "setPreference", key: "appearance", value: rng.pick(["full", "calm"]) });
      else if (roll === 1) await commit({ type: "setEnabled", enabled: rng.chance(0.5) });
      else if (roll === 2) await commit({ type: "selectTheme", id: rng.chance(0.5) && ids().length ? rng.pick(ids()) : "nord" });
      else if (roll === 3) await commit({ type: "resetPreferences" });
      else if (roll === 4) await commit({ type: "completeOnboarding" });
      else await commit({ type: "dismissMigration" });
    },
    async resetAll() {
      await commit({ type: "resetAll" });
      for (const editor of editors) editor.draft = { ...editor.draft, savedId: rng.chance(0.5) ? editor.draft.savedId : null };
    },
    // A write that fails and is retried: once only, with the same ticket.
    async failedWrite() {
      failNext = 1;
      const editor = rng.pick(editors);
      const first = await save(editor);
      if (!first.reply.ok) {
        const before = new Set(ids());
        const reply = await commit(first.action, { grant: first.grant });
        if (reply.ok) editor.draft = { savedId: first.action.id ?? ids().find((x) => !before.has(x)), document: first.action.document };
      }
    },
    async staleRevision() {
      const editor = rng.pick(editors);
      const choice = approvalFor(editor, editor.draft.document);
      const reply = await commit({ type: "saveCustom", document: editor.draft.document, select: true, editor: editor.id, ...choice }, { revision: rng.chance(0.5) && settings().revision > 0 ? rng.int(settings().revision) : settings().revision + 1 + rng.int(3), grant: typeof choice.approval === "string" ? { ticket: choice.approval } : null });
      assert.notEqual(reply.ok, true, "a stale revision never commits");
    },
    // The background restarting, or the other window's: storage is the only authority.
    async restart() {
      await reopen();
    },
    // An update with a new sanitizer: earlier approvals and tickets no longer match.
    async sanitizerUpdate() {
      version++;
      legit = legit.filter((l) => l.version === version);
      await reopen();
    },
  };
  // Initialization (a restart, an update's migration) keeps or drops approvals, never adds one.
  async function reopen() {
    const before = structuredClone(settings().cssConsent);
    repository = open();
    await repository.initialize();
    for (const [id, consent] of Object.entries(settings().cssConsent)) assert.deepEqual(consent, before[id], `initialization created an approval: ${id}`);
    await commit({ type: "completeOnboarding" });
  }
  const weights = { enable: 14, disable: 4, editColor: 5, editCss: 4, rename: 3, save: 14, saveCopy: 6, undo: 6, reset: 3, importTheme: 5, exportRoundTrip: 3, remove: 4, removeAndReadd: 4, revoke: 5, grantDirectly: 4, secondWindow: 3, resume: 3, preferences: 3, resetAll: 1, failedWrite: 3, staleRevision: 2, restart: 2, sanitizerUpdate: 1 };
  const table = Object.entries(weights).flatMap(([name, weight]) => Array(weight).fill(name));

  try {
    for (let i = 0; i < STEPS; i++) {
      const name = rng.pick(table);
      log.push([`#${i} ${name}`]);
      await steps[name]();
      failNext = 0;
    }
    // Storage never holds a secret that redeems an approval.
    const records = JSON.stringify(storage.snapshot());
    for (const { ticket } of issued) assert.equal(records.includes(ticket), false, "a ticket secret reached storage");
    if (legacy) assert.equal(LEGACY_STORAGE_KEYS.some((key) => storage.data.has(key)), false);
  } catch (error) {
    failures.push({ seed, error, log });
  }
  return log.filter((entry) => entry[0] === "saveCustom" || entry[0] === "setCssConsent").length;
}

test(`the CSS approval invariant holds after every step of ${SEQUENCES} random action sequences`, async () => {
  const failures = [];
  const rng = random(SEED);
  let commits = 0;
  for (let n = 0; n < SEQUENCES; n++) commits += await runSequence(rng.int(2 ** 31), failures);
  if (failures.length) {
    const kinds = [...new Set(failures.map((f) => f.error.message.split(":")[0]))];
    const { seed, error, log } = failures[0];
    assert.fail(`${failures.length} of ${SEQUENCES} sequences broke the invariant (${kinds.join(" | ")}). First, seed ${seed}: ${error.message}\n${log.slice(-12).map((e) => e.join(" ")).join("\n")}`);
  }
  assert.ok(commits > SEQUENCES * 4, `the sequences exercised saves (${commits})`);
});

test("the model's sequences grant approvals through tickets, not only refuse them", async () => {
  // A guard on the generator: a model that never creates an approval proves nothing.
  const rng = random(SEED);
  let granted = 0;
  for (let n = 0; n < 200; n++) {
    const storage = memoryStorage();
    const repository = createRepository(storage, context({ css: standInCss(1), newId: counter() }));
    await repository.initialize();
    const editor = "model-editor-0000000000";
    const css = rng.pick(CSS);
    const ticket = (await repository.commit({ type: "approveCss", editor, target: "new", css }, 0)).approval.ticket;
    const reply = await repository.commit({ type: "saveCustom", document: documentWith({ css }), select: true, editor, approval: ticket }, 0);
    if (reply.ok && Object.keys(reply.settings.cssConsent).length === 1) granted++;
  }
  assert.equal(granted, 200);
});
