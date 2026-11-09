// SettingsV2: defaults, strict validation, salvage of a damaged record and effective preferences.
// Pure; storage and migration persistence live in repository.js.
import { ISSUE_CODES, LOCAL_THEME_ID_PREFIX, SETTINGS_VERSION } from "../contracts/index.js";
import { canonicalize, validateTheme } from "../format/index.js";
import { fallbackThemeId } from "./catalog.js";
import { APPEARANCE_MODES, BOOLEAN_PREFERENCE_KEYS, DEFAULT_PREFERENCES, STORAGE_LIMITS } from "./constants.js";

export const SETTINGS_KEYS = Object.freeze(["settingsVersion", "revision", "enabled", "selectedThemeId", "preferences", "cssConsent", "customThemes", "onboardingCompleted", "migration"]);
export const LOCAL_ID = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;
const NOTICE_CODE = /^[a-z0-9-]{1,40}$/;

export const issue = (code, path, message, severity = "error") => ({ code, path, message, severity });
const invalid = (path, message) => issue(ISSUE_CODES.invalid, path, message);

export const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const hasOnly = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
const utf8Length = (text) => new TextEncoder().encode(text).length;

/** A new install's settings. */
export function defaultSettings(catalog) {
  return {
    settingsVersion: SETTINGS_VERSION,
    revision: 0,
    enabled: true,
    selectedThemeId: fallbackThemeId(catalog),
    preferences: { ...DEFAULT_PREFERENCES },
    cssConsent: {},
    customThemes: [],
    onboardingCompleted: false,
    migration: { notices: [] },
  };
}

/** Full when both the primary switch and the extras alias say so; anything else is Calm. */
export const appearanceOf = (preferences) => (preferences.appearance === "calm" || preferences.extras === false ? "calm" : "full");

/**
 * What renderers receive. Calm has extras false, so a renderer that only knows the alias still
 * removes decoration. TODO(C2b): EffectivePreferences gains `appearance` in contracts.
 */
export function effectivePreferences(settings) {
  const appearance = appearanceOf(settings.preferences);
  const { text, motion, fonts, effects } = settings.preferences;
  return Object.freeze({ enabled: settings.enabled, appearance, extras: appearance === "full", text, motion, fonts, effects });
}

/** The approved CSS hash for the selected local theme, or null. */
export function selectedConsent(settings) {
  const consent = settings.cssConsent[settings.selectedThemeId];
  return consent ? { hash: consent.hash, sanitizerVersion: consent.sanitizerVersion } : null;
}

function preferenceIssues(value, path) {
  if (!isPlainObject(value)) return [invalid(path, "Preferences must be an object.")];
  const issues = [];
  if (!hasOnly(value, ["appearance", ...BOOLEAN_PREFERENCE_KEYS])) issues.push(invalid(path, "Preferences have an unknown key."));
  for (const key of BOOLEAN_PREFERENCE_KEYS) if (typeof value[key] !== "boolean") issues.push(invalid(`${path}/${key}`, `${key} must be true or false.`));
  if ("appearance" in value) {
    if (!APPEARANCE_MODES.includes(value.appearance)) issues.push(invalid(`${path}/appearance`, "Appearance must be full or calm."));
    else if (typeof value.extras === "boolean" && value.extras !== (value.appearance === "full")) issues.push(invalid(`${path}/appearance`, "Appearance and extras disagree."));
  }
  return issues;
}

/** Problems with one saved custom theme, given the catalog. */
export function customThemeIssues(entry, path, catalog) {
  if (!isPlainObject(entry) || !hasOnly(entry, ["id", "document", "basedOn"])) return [invalid(path, "A saved theme must have id, document and an optional basedOn.")];
  const issues = [];
  if (typeof entry.id !== "string" || !LOCAL_ID.test(entry.id)) issues.push(invalid(`${path}/id`, "A saved theme ID must be local:<uuid>."));
  if ("basedOn" in entry && !(typeof entry.basedOn === "string" && catalog.has(entry.basedOn))) issues.push(invalid(`${path}/basedOn`, "basedOn must name a bundled theme."));
  const result = validateTheme(entry.document);
  if (!result.ok) issues.push(...result.issues.map((i) => ({ ...i, path: `${path}/document${i.path}` })));
  return issues;
}

export const customSourceBytes = (customThemes) => customThemes.reduce((sum, theme) => sum + utf8Length(canonicalize(theme.document)), 0);

function consentIssues(value, customIds, path) {
  if (!isPlainObject(value)) return [invalid(path, "CSS consent must be an object.")];
  const issues = [];
  for (const [id, record] of Object.entries(value)) {
    const at = `${path}/${id}`;
    if (!customIds.has(id)) issues.push(invalid(at, "CSS consent names a theme that is not saved."));
    else if (!isPlainObject(record) || !hasOnly(record, ["hash", "sanitizerVersion"]) || typeof record.hash !== "string" || !SHA256_HEX.test(record.hash) || !Number.isSafeInteger(record.sanitizerVersion) || record.sanitizerVersion < 1) {
      issues.push(invalid(at, "CSS consent needs a sanitized CSS hash and sanitizer version."));
    }
  }
  return issues;
}

function migrationIssues(value, path) {
  if (!isPlainObject(value) || !hasOnly(value, ["from", "notices"])) return [invalid(path, "Migration must have notices and an optional from.")];
  const issues = [];
  if ("from" in value && value.from !== "1.1.0") issues.push(invalid(`${path}/from`, "Migration can only come from 1.1.0."));
  if (!Array.isArray(value.notices) || value.notices.length > STORAGE_LIMITS.maxNotices || !value.notices.every((n) => typeof n === "string" && NOTICE_CODE.test(n))) {
    issues.push(invalid(`${path}/notices`, "Migration notices must be a short list of notice codes."));
  }
  return issues;
}

/**
 * Validates a stored settings record without changing it.
 * Returns {ok:true, settings, upgraded} or {ok:false, newer, issues}. `newer` marks a record a later
 * Reskin wrote; it must not be overwritten. `upgraded` marks a Revision 3 record without
 * preferences.appearance or cssConsent, which `settings` fills in (extras false becomes Calm).
 */
export function validateSettings(value, catalog) {
  if (!isPlainObject(value)) return { ok: false, newer: false, issues: [invalid("", "Settings must be an object.")] };
  if (Number.isSafeInteger(value.settingsVersion) && value.settingsVersion > SETTINGS_VERSION) {
    return { ok: false, newer: true, issues: [issue(ISSUE_CODES.unsupportedVersion, "/settingsVersion", "These settings were saved by a newer Reskin.")] };
  }
  const issues = [];
  if (value.settingsVersion !== SETTINGS_VERSION) issues.push(invalid("/settingsVersion", "settingsVersion must be 2."));
  if (!hasOnly(value, SETTINGS_KEYS)) issues.push(invalid("", `Settings have unknown keys: ${Object.keys(value).filter((k) => !SETTINGS_KEYS.includes(k)).join(", ")}.`));
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) issues.push(invalid("/revision", "revision must be a nonnegative integer."));
  if (typeof value.enabled !== "boolean") issues.push(invalid("/enabled", "enabled must be true or false."));
  if (typeof value.onboardingCompleted !== "boolean") issues.push(invalid("/onboardingCompleted", "onboardingCompleted must be true or false."));
  issues.push(...preferenceIssues(value.preferences, "/preferences"));
  issues.push(...migrationIssues(value.migration, "/migration"));

  const customIds = new Set();
  if (!Array.isArray(value.customThemes)) issues.push(invalid("/customThemes", "customThemes must be a list."));
  else {
    if (value.customThemes.length > STORAGE_LIMITS.maxCustomThemes) issues.push(issue(ISSUE_CODES.capacity, "/customThemes", `At most ${STORAGE_LIMITS.maxCustomThemes} saved themes.`));
    value.customThemes.forEach((entry, index) => {
      const entryIssues = customThemeIssues(entry, `/customThemes/${index}`, catalog);
      issues.push(...entryIssues);
      if (customIds.has(entry?.id)) issues.push(invalid(`/customThemes/${index}/id`, "Saved theme IDs repeat."));
      if (typeof entry?.id === "string") customIds.add(entry.id);
    });
    if (!issues.length && customSourceBytes(value.customThemes) > STORAGE_LIMITS.maxCustomSourceBytes) issues.push(issue(ISSUE_CODES.capacity, "/customThemes", "Saved themes exceed 4 MiB."));
  }
  if ("cssConsent" in value) issues.push(...consentIssues(value.cssConsent, customIds, "/cssConsent"));
  const selected = value.selectedThemeId;
  if (typeof selected !== "string" || !(selected.startsWith(LOCAL_THEME_ID_PREFIX) ? customIds.has(selected) : catalog.has(selected))) {
    issues.push(invalid("/selectedThemeId", "The selected theme is not bundled or saved."));
  }
  if (issues.length) return { ok: false, newer: false, issues };

  const upgraded = !("cssConsent" in value) || !("appearance" in value.preferences);
  const settings = structuredClone(value);
  settings.preferences = { ...settings.preferences, appearance: appearanceOf(settings.preferences) };
  settings.cssConsent ??= {};
  return { ok: true, settings, upgraded };
}

/**
 * Builds the safest usable settings from a damaged record: every field that validates on its own
 * is kept, the rest take defaults, and every value replaced goes to `dropped` for the recovery copy.
 */
export function salvageSettings(value, catalog) {
  const settings = defaultSettings(catalog);
  const dropped = {};
  if (!isPlainObject(value)) return { settings, dropped: { record: value } };
  const extraKeys = Object.fromEntries(Object.entries(value).filter(([key]) => !SETTINGS_KEYS.includes(key)));
  if (Object.keys(extraKeys).length) dropped.extraKeys = extraKeys;
  if (value.settingsVersion !== SETTINGS_VERSION) dropped.settingsVersion = value.settingsVersion;
  if (Number.isSafeInteger(value.revision) && value.revision >= 0) settings.revision = value.revision;
  else if ("revision" in value) dropped.revision = value.revision;
  for (const key of ["enabled", "onboardingCompleted"]) {
    if (typeof value[key] === "boolean") settings[key] = value[key];
    else if (key in value) dropped[key] = value[key];
  }
  if (isPlainObject(value.preferences)) {
    const preferences = Object.entries(value.preferences).filter(([key, field]) => (key === "appearance" ? !APPEARANCE_MODES.includes(field) : !BOOLEAN_PREFERENCE_KEYS.includes(key) || typeof field !== "boolean"));
    if (preferences.length) dropped.preferences = Object.fromEntries(preferences);
    for (const key of BOOLEAN_PREFERENCE_KEYS) if (typeof value.preferences[key] === "boolean") settings.preferences[key] = value.preferences[key];
    // Either value asking for Calm wins: less decoration is the safe reading.
    const calm = value.preferences.appearance === "calm" || value.preferences.extras === false;
    settings.preferences.appearance = calm ? "calm" : "full";
    settings.preferences.extras = !calm;
  } else if ("preferences" in value) dropped.preferences = value.preferences;

  const kept = [];
  const droppedThemes = [];
  for (const [index, entry] of (Array.isArray(value.customThemes) ? value.customThemes : []).entries()) {
    // A source that left the catalog drops only the association.
    const fixed = isPlainObject(entry) && "basedOn" in entry && !catalog.has(entry.basedOn) ? { id: entry.id, document: entry.document } : entry;
    const ok = kept.length < STORAGE_LIMITS.maxCustomThemes && !customThemeIssues(fixed, `/customThemes/${index}`, catalog).length && !kept.some((t) => t.id === fixed.id)
      && customSourceBytes([...kept, fixed]) <= STORAGE_LIMITS.maxCustomSourceBytes;
    if (ok) kept.push(structuredClone(fixed));
    else droppedThemes.push(entry);
  }
  if (!Array.isArray(value.customThemes) && "customThemes" in value) dropped.customThemes = value.customThemes;
  else if (droppedThemes.length) dropped.customThemes = droppedThemes;
  settings.customThemes = kept;

  const ids = new Set(kept.map((t) => t.id));
  if (isPlainObject(value.cssConsent)) {
    const consent = {};
    for (const [id, record] of Object.entries(value.cssConsent)) {
      if (!consentIssues({ [id]: record }, ids, "").length) settings.cssConsent[id] = { hash: record.hash, sanitizerVersion: record.sanitizerVersion };
      else consent[id] = record;
    }
    if (Object.keys(consent).length) dropped.cssConsent = consent;
  } else if ("cssConsent" in value) dropped.cssConsent = value.cssConsent;
  const selected = value.selectedThemeId;
  if (typeof selected === "string" && (selected.startsWith(LOCAL_THEME_ID_PREFIX) ? ids.has(selected) : catalog.has(selected))) settings.selectedThemeId = selected;
  else if ("selectedThemeId" in value) dropped.selectedThemeId = selected;
  if (!migrationIssues(value.migration, "").length) settings.migration = structuredClone(value.migration);
  else if ("migration" in value) dropped.migration = value.migration;
  return { settings, dropped };
}
