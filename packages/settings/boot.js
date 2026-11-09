// reskin.boot: the extension-owned first-paint snapshot, written with settings in one storage.set.
// The content script reuses it only when the whole record validates and every field of the frozen
// validity rule (packages/contracts BootRecord) matches the current page and settings. Anything
// else discards it and the selected source is resolved again.
import { EFFECT_IDS, ENGINE_VERSION, FLAVOR_SLOT_IDS, FONT_IDS, HEX_COLOR, PAIR_MATRIX_VERSION, RENDERER_VERSION, SYNTAX_ROLES } from "../contracts/index.js";
import { EFFECT_PARAMETERS, FLAVOR_SLOTS } from "../format/index.js";
import { ANSI_ROLES, auditPairs, graphProblems, PAIR_PATHS, rampDirection, SEMANTIC_FIELDS, SEMANTIC_ROLES, sourceHash, TOKEN_KEYS } from "../engine/index.js";
import { selectedSource } from "./catalog.js";
import { EXPANSION_VERSION, SANITIZER_VERSION } from "./constants.js";
import { effectivePreferences, isPlainObject, selectedConsent, SHA256_HEX } from "./model.js";

export const BOOT_KEYS = Object.freeze([
  "settingsRevision", "rendererVersion", "engineVersion", "pairMatrixVersion", "expansionVersion", "sanitizerVersion",
  "catalogHash", "selectedSourceHash", "assetHashes", "cssConsent", "validatedTokenSnapshot", "effectivePreferences",
]);
// The expanded resolver adds appearance, expansionVersion and sanitizerVersion to ResolvedTheme.
const EXPANDED_KEYS = ["expansionVersion", "sanitizerVersion", "appearance"];
const THEMED_KEYS = ["tokens", "semantics", "syntax", "ansi", "graph", "rendererVersion", "sourceHash", "seedId", "seedHash", "base", "policy", "font", "effects", "flavor", "motionAllowed", "repairs", "pairAudit", ...EXPANDED_KEYS];
const NATIVE_POLICIES = ["native-high-contrast", "native-unknown", "forced-colors"];
const PREFERENCE_KEYS = ["enabled", "appearance", "extras", "text", "motion", "fonts", "effects"];
const MAX_REPAIRS = 512;
const RESOURCE = /data:|url\(|@import|<|>/i;

const sameKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const isHex = (value) => typeof value === "string" && HEX_COLOR.test(value);
const isRamp = (value) => Array.isArray(value) && value.length === 5 && value.every(isHex);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The running versions a boot record must carry. TODO(C2b): import EXPANSION_VERSION and
 * SANITIZER_VERSION from contracts; PAIR_MATRIX_VERSION becomes 2 there.
 */
export const RUNNING_VERSIONS = Object.freeze({
  rendererVersion: RENDERER_VERSION,
  engineVersion: ENGINE_VERSION,
  pairMatrixVersion: PAIR_MATRIX_VERSION,
  expansionVersion: EXPANSION_VERSION,
  sanitizerVersion: SANITIZER_VERSION,
});

/**
 * The boot record for settings, or null when there is nothing to paint (disabled, or no usable
 * snapshot). `snapshot(theme)` is the renderer's resolution of the source for the standard seed of
 * its base, themed, without reduced motion or forced colors: the common page. It never runs here
 * without that callback, so this package creates no second color engine.
 */
export function buildBootRecord(settings, { catalog, snapshot }) {
  if (!settings.enabled || !snapshot) return null;
  const source = selectedSource(settings, catalog);
  if (!source) return null;
  let resolved;
  try {
    resolved = snapshot(source);
  } catch {
    return null;
  }
  const record = {
    settingsRevision: settings.revision,
    ...RUNNING_VERSIONS,
    catalogHash: catalog.hash,
    selectedSourceHash: sourceHash(source),
    // TODO(C2b): hashes of the selected theme's admitted image assets, never the bytes.
    assetHashes: [],
    cssConsent: selectedConsent(settings),
    validatedTokenSnapshot: resolved,
    effectivePreferences: effectivePreferences(settings),
  };
  // Never write a snapshot the content script would reject.
  return bootRecordProblems(record).length ? null : JSON.parse(JSON.stringify(record));
}

/** Structural problems with a boot record, including the complete snapshot. Empty means valid. */
export function bootRecordProblems(record) {
  if (!sameKeys(record, BOOT_KEYS)) return ["the boot record does not have exactly the current fields"];
  const problems = [];
  for (const [key, version] of Object.entries(RUNNING_VERSIONS)) if (record[key] !== version) problems.push(`${key} is not ${version}`);
  if (!Number.isSafeInteger(record.settingsRevision) || record.settingsRevision < 0) problems.push("settingsRevision is not a revision");
  for (const key of ["catalogHash", "selectedSourceHash"]) if (typeof record[key] !== "string" || !SHA256_HEX.test(record[key])) problems.push(`${key} is not a SHA-256`);
  if (!Array.isArray(record.assetHashes) || !record.assetHashes.every((h) => typeof h === "string" && SHA256_HEX.test(h))) problems.push("assetHashes are not SHA-256 hashes");
  if (record.cssConsent !== null && !(sameKeys(record.cssConsent, ["hash", "sanitizerVersion"]) && SHA256_HEX.test(record.cssConsent.hash) && Number.isSafeInteger(record.cssConsent.sanitizerVersion))) problems.push("cssConsent is malformed");
  const prefs = record.effectivePreferences;
  if (!sameKeys(prefs, PREFERENCE_KEYS) || !["full", "calm"].includes(prefs.appearance) || PREFERENCE_KEYS.some((k) => k !== "appearance" && typeof prefs[k] !== "boolean") || prefs.extras !== (prefs.appearance === "full")) {
    problems.push("effectivePreferences are malformed");
  }
  problems.push(...snapshotProblems(record.validatedTokenSnapshot).map((p) => `snapshot: ${p}`));
  if (!problems.length && record.validatedTokenSnapshot.sourceHash !== record.selectedSourceHash) problems.push("the snapshot's sourceHash is not selectedSourceHash");
  if (!problems.length && hasResourceText(record)) problems.push("the record holds a resource, markup or CSS string");
  return problems;
}

function hasResourceText(value, depth = 0) {
  if (depth > 8) return true;
  if (typeof value === "string") return RESOURCE.test(value);
  if (value && typeof value === "object") return Object.values(value).some((v) => hasResourceText(v, depth + 1));
  return false;
}

/** Problems with a ResolvedTheme as a snapshot: the full discriminated branch. */
export function snapshotProblems(resolved) {
  if (!isPlainObject(resolved)) return ["not an object"];
  if (NATIVE_POLICIES.includes(resolved.policy)) return nativeProblems(resolved);
  if (resolved.policy !== "themed") return ["unknown policy"];
  if (!sameKeys(resolved, THEMED_KEYS)) return ["themed keys are not exactly the renderer 1 keys"];
  const problems = [...expandedProblems(resolved)];
  if (!isPlainObject(resolved.appearance)) problems.push("appearance is not an object");
  const group = (name, value, keys, check) => {
    if (!sameKeys(value, keys)) problems.push(`${name} keys are not exact`);
    else for (const key of keys) if (!check(value[key])) problems.push(`${name}.${key} is invalid`);
  };
  group("tokens", resolved.tokens, TOKEN_KEYS, isHex);
  group("semantics", resolved.semantics, SEMANTIC_ROLES, (record) => sameKeys(record, SEMANTIC_FIELDS) && SEMANTIC_FIELDS.every((f) => isHex(record[f])));
  group("syntax", resolved.syntax, SYNTAX_ROLES, isHex);
  group("ansi", resolved.ansi, ANSI_ROLES, isHex);
  if (!isRamp(resolved.graph)) problems.push("graph is not five colors");
  if (resolved.rendererVersion !== RENDERER_VERSION) problems.push("rendererVersion");
  if (typeof resolved.sourceHash !== "string" || !SHA256_HEX.test(resolved.sourceHash)) problems.push("sourceHash");
  if (typeof resolved.seedId !== "string" || !resolved.seedId || resolved.seedId.length > 128) problems.push("seedId");
  if (typeof resolved.seedHash !== "string" || !SHA256_HEX.test(resolved.seedHash)) problems.push("seedHash");
  if (resolved.base !== "dark" && resolved.base !== "light") problems.push("base");
  if (!FONT_IDS.includes(resolved.font)) problems.push("font");
  if (typeof resolved.motionAllowed !== "boolean") problems.push("motionAllowed");
  problems.push(...effectProblems(resolved.effects), ...flavorProblems(resolved.flavor), ...repairProblems(resolved.repairs));
  if (problems.length) return problems;
  // Passing pair and graph constraints, recomputed rather than trusted.
  let audit;
  try {
    audit = auditPairs(resolved);
  } catch {
    return ["pairs cannot be audited"];
  }
  if (!audit.every((pair) => pair.passed)) problems.push("a pair fails its contrast minimum");
  if (!equal(audit, resolved.pairAudit)) problems.push("pairAudit differs from the recomputed audit");
  if (graphProblems(resolved.graph, resolved.tokens.canvas, rampDirection(resolved.base), { first: true }).length) problems.push("graph ramp fails its constraints");
  return problems;
}

function nativeProblems(resolved) {
  const problems = [];
  const keys = ["rendererVersion", "sourceHash", "seedId", "seedHash", "base", "policy", "tokens", "semantics", "syntax", "ansi", "graph", "font", "effects", "flavor", "motionAllowed", "repairs", "pairAudit", ...EXPANDED_KEYS];
  if (!sameKeys(resolved, keys)) return ["native keys are not exact"];
  problems.push(...expandedProblems(resolved));
  if (resolved.appearance !== null) problems.push("native appearance must be null");
  for (const key of ["tokens", "semantics", "syntax", "ansi", "graph"]) if (resolved[key] !== null) problems.push(`${key} must be null`);
  if (resolved.font !== "system" || !sameKeys(resolved.effects, []) || resolved.motionAllowed !== false) problems.push("native fields are not empty");
  if (!equal(resolved.flavor, { enabled: false, locale: "en", slots: {} })) problems.push("native flavor is not empty");
  if (!Array.isArray(resolved.repairs) || resolved.repairs.length || !Array.isArray(resolved.pairAudit) || resolved.pairAudit.length) problems.push("native repairs and audits must be empty");
  if (resolved.rendererVersion !== RENDERER_VERSION || typeof resolved.sourceHash !== "string" || !SHA256_HEX.test(resolved.sourceHash)) problems.push("native identity");
  if (!((resolved.seedId === null && resolved.seedHash === null) || (typeof resolved.seedId === "string" && typeof resolved.seedHash === "string" && SHA256_HEX.test(resolved.seedHash)))) problems.push("native seed identity");
  if (resolved.base !== "dark" && resolved.base !== "light") problems.push("base");
  return problems;
}

function expandedProblems(resolved) {
  const problems = [];
  if (resolved.expansionVersion !== EXPANSION_VERSION) problems.push("expansionVersion");
  if (resolved.sanitizerVersion !== SANITIZER_VERSION) problems.push("sanitizerVersion");
  return problems;
}

function effectProblems(effects) {
  if (!isPlainObject(effects)) return ["effects is not an object"];
  const problems = [];
  if (Object.keys(effects).length > 3) problems.push("more than three effects");
  for (const [id, params] of Object.entries(effects)) {
    const spec = EFFECT_PARAMETERS[id];
    if (!EFFECT_IDS.includes(id) || !spec) {
      problems.push(`unknown effect ${id}`);
      continue;
    }
    if (!sameKeys(params, Object.keys(spec))) {
      problems.push(`effect ${id} parameters are not exact`);
      continue;
    }
    for (const [name, rule] of Object.entries(spec)) {
      const value = params[name];
      const ok = rule.enum ? rule.enum.includes(value)
        : typeof value === "number" && Number.isFinite(value) && (rule.type !== "integer" || Number.isInteger(value)) && value >= rule.minimum && value <= rule.maximum;
      if (!ok) problems.push(`effect ${id}.${name} is out of bounds`);
    }
  }
  return problems;
}

function flavorProblems(flavor) {
  if (!sameKeys(flavor, ["enabled", "locale", "slots"]) || typeof flavor.enabled !== "boolean" || flavor.locale !== "en" || !isPlainObject(flavor.slots)) return ["flavor is malformed"];
  const problems = [];
  for (const [slot, text] of Object.entries(flavor.slots)) {
    if (!FLAVOR_SLOT_IDS.includes(slot)) problems.push(`unknown flavor slot ${slot}`);
    else if (typeof text !== "string" || [...text].length > FLAVOR_SLOTS[slot].maxLength || /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/.test(text)) problems.push(`flavor ${slot} text is invalid`);
  }
  return problems;
}

function repairProblems(repairs) {
  if (!Array.isArray(repairs) || repairs.length > MAX_REPAIRS) return ["repairs is not a bounded list"];
  const bad = repairs.filter((repair) => {
    if (!isPlainObject(repair) || typeof repair.reason !== "string" || repair.reason.length > 400) return true;
    if (repair.persistence === "render") return !sameKeys(repair, ["persistence", "path", "before", "after", "reason"]) || !PAIR_PATHS.includes(repair.path) || !isHex(repair.before) || !isHex(repair.after);
    if (repair.persistence === "source") {
      const ramp = repair.path === "/contributions/levels";
      return !sameKeys(repair, ["persistence", "path", "before", "after", "reason"]) || typeof repair.path !== "string" || !/^\/(colors|overrides|contributions)\//.test(repair.path)
        || !(ramp ? isRamp(repair.before) && isRamp(repair.after) : isHex(repair.before) && isHex(repair.after));
    }
    return true;
  });
  return bad.length ? [`${bad.length} malformed repairs`] : [];
}

/**
 * Every rule-3 field that does not match. `current` is what the content script knows now:
 * {settingsRevision, catalogHash, selectedSourceHash, effectivePreferences, cssConsent, policy,
 *  base, seedId, seedHash, motionAllowed}. Policy is decided from the page first; a native or
 * forced-color policy never matches a themed snapshot.
 */
export function bootMismatches(record, current) {
  const snap = record.validatedTokenSnapshot;
  const checks = {
    settingsRevision: record.settingsRevision === current.settingsRevision,
    catalogHash: record.catalogHash === current.catalogHash,
    selectedSourceHash: record.selectedSourceHash === current.selectedSourceHash && snap.sourceHash === current.selectedSourceHash,
    effectivePreferences: equal(record.effectivePreferences, current.effectivePreferences),
    cssConsent: equal(record.cssConsent, current.cssConsent ?? null),
    policy: snap.policy === current.policy,
    base: snap.base === current.base,
    seedId: snap.seedId === current.seedId,
    seedHash: snap.seedHash === current.seedHash,
    motionAllowed: snap.motionAllowed === current.motionAllowed,
  };
  return Object.keys(checks).filter((key) => !checks[key]);
}

/** The snapshot to compile, or null to resolve the source again. Never throws. */
export function usableSnapshot(record, current) {
  try {
    if (current.policy !== "themed") return null;
    if (bootRecordProblems(record).length) return null;
    return bootMismatches(record, current).length ? null : record.validatedTokenSnapshot;
  } catch {
    return null;
  }
}
