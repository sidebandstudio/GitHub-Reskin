// Parity with the extension: the site shows exactly the bundled theme documents, its captures
// record the hashes the extension's own resolver and Primer compiler produce for them, and the
// shared preview it configures uses C3's current slot evidence. Choom Circuit is the owner's
// Cyberpunk port, not the old green/lime stand-in.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, test } from "node:test";
import { ROOT, siteDir } from "./helpers.mjs";
import { repairTheme, resolveTheme } from "../../packages/engine/index.js";
import { CSS_POLICY_HASH, validateTheme } from "../../packages/format/index.js";
import * as primer from "../../packages/primer/index.js";
import { DEFAULT_DORMANT_SLOTS, PREVIEW_VARIABLES } from "../../packages/preview/index.js";
import { dormantSlots } from "../../extension/content/github/slots.js";
import { CATALOG, CSS_PROOFS } from "../../site/src/catalog.mjs";
import { themesModuleSource } from "../../site/modules.mjs";

const index = primer.MODE_INDEX;
// The preferences every site preview starts from: the extension's defaults, Full.
const FULL = { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true };
let manifest;
before(async () => {
  const { dir } = await siteDir();
  manifest = JSON.parse(await readFile(join(ROOT, "site/.cache/previews/manifest.json"), "utf8"));
  assert.ok(dir);
});

// The extension's resolution of one theme in GitHub's standard mode of its base, as the content
// script and mountPreview both do it, compiled for the preview frame as mountPreview does.
function extensionResolve(theme) {
  const native = { colorMode: theme.base, lightTheme: "light", darkTheme: "dark", systemDark: theme.base === "dark" };
  const plan = primer.selectMode(native, theme.base, index);
  const repaired = repairTheme(theme, index.modes[theme.base]);
  const resolved = resolveTheme(repaired.theme, { seed: plan.seedMode ? index.modes[plan.seedMode] : null, policy: plan.policy, reducedMotion: false, forcedColors: false });
  return { resolved, compiled: primer.compilePreview(resolved, plan, FULL, { variables: Object.keys(PREVIEW_VARIABLES), index }) };
}

test("the site's theme documents are the catalog's files, byte for byte, in catalog order", async () => {
  const catalog = JSON.parse(await readFile(join(ROOT, "themes/catalog.json"), "utf8"));
  assert.deepEqual(CATALOG.map((t) => t.id).sort(), catalog.map((t) => t.id).sort());
  for (const theme of CATALOG) assert.deepEqual(theme.doc, JSON.parse(await readFile(join(ROOT, theme.file), "utf8")), theme.file);
  const source = await themesModuleSource();
  const docs = JSON.parse(source.match(/^export const DOCS = (.*);$/m)[1]);
  for (const theme of CATALOG) assert.deepEqual(docs[theme.slug], theme.doc, `reskin:themes ${theme.slug}`);
});

test("every capture records the extension's source, seed and compiler hashes", () => {
  assert.equal(Object.keys(manifest.themes).length, CATALOG.length);
  for (const theme of CATALOG) {
    const entry = manifest.themes[theme.slug];
    const { resolved, compiled } = extensionResolve(theme.doc);
    assert.equal(entry.policy, "themed", theme.slug);
    assert.equal(entry.sourceHash, resolved.sourceHash, `${theme.slug} source hash`);
    assert.equal(entry.seedHash, resolved.seedHash, `${theme.slug} seed hash`);
    assert.equal(entry.fingerprint, compiled.fingerprint, `${theme.slug} compiler fingerprint`);
  }
});

test("bundled CSS reaches the viewer only as sanitizer proofs under the current policy", () => {
  const withCss = CATALOG.filter((t) => typeof t.doc.css === "string");
  assert.ok(withCss.some((t) => t.slug === "choom-circuit"));
  for (const proof of CSS_PROOFS) assert.equal(proof.kind === "css" ? proof.value.policyHash : proof.policyHash, CSS_POLICY_HASH, proof.kind);
  for (const theme of withCss) assert.ok(CSS_PROOFS.some((p) => p.kind === "css" && p.source === theme.doc.css), theme.slug);
  for (const theme of CATALOG) assert.ok(validateTheme(theme.doc).ok, theme.slug);
});

test("the site preview uses C3's current slot evidence", () => {
  assert.deepEqual(dormantSlots(), [...DEFAULT_DORMANT_SLOTS]);
});

test("Choom Circuit is the owner's Cyberpunk port and leads the catalog", () => {
  const choom = CATALOG[0];
  assert.equal(choom.slug, "choom-circuit");
  assert.equal(choom.id, "anime.cyberpunk-edgerunners");
  assert.equal(choom.doc.inspiredBy, "Cyberpunk: Edgerunners");
  assert.deepEqual(choom.doc.colors, { accent: "#fcee0a", background: "#0a0a17", contribution: "#00f0ff", text: "#e4f3ff" });
  assert.equal(choom.doc.contributions.levels.at(-1), "#00f0ff");
  assert.equal(choom.doc.flavor.slots["profile.tag"], "// choom");
  assert.equal(choom.doc.flavor.slots["error.notFound.caption"], "Flatlined");
  assert.ok(!/#(a3e635|84cc16|39ff14|00ff41)/i.test(JSON.stringify(choom.doc)), "Choom has no green/lime stand-in values");
});
