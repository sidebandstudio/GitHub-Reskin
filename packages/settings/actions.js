// The closed set of settings commits and the pure reducer that applies one. The background calls
// reduceAction on the latest stored state inside its serialized queue; nothing else writes.
import { COMMIT_ACTION_TYPES, ISSUE_CODES, LOCAL_THEME_ID_PREFIX } from "../contracts/index.js";
import { documentAdmissionIssues, NO_CSS_SANITIZER } from "./admission.js";
import { fallbackThemeId } from "./catalog.js";
import { APPEARANCE_MODES, BOOLEAN_PREFERENCE_KEYS, DEFAULT_PREFERENCES, EXTRA_COMMIT_ACTION_TYPES, STORAGE_LIMITS } from "./constants.js";
import { customSourceBytes, customThemeIssues, defaultSettings, isPlainObject, issue, LOCAL_ID, SHA256_HEX } from "./model.js";

export const ACTION_TYPES = Object.freeze([...COMMIT_ACTION_TYPES, ...EXTRA_COMMIT_ACTION_TYPES]);

const SHAPES = {
  selectTheme: ["id"],
  setEnabled: ["enabled"],
  setPreference: ["key", "value"],
  saveCustom: ["id", "document", "basedOn", "select", "cssConsent"],
  deleteCustom: ["id"],
  resetPreferences: [],
  resetAll: [],
  setCssConsent: ["id", "granted", "hash", "sanitizerVersion"],
  completeOnboarding: [],
  dismissMigration: [],
};

/** A rejected action. `code` is the SettingsReply code: invalid, or storage for capacity. */
export class ActionError extends Error {
  constructor(code, issues) {
    super(issues.map((i) => i.message).join(" "));
    this.code = code;
    this.issues = issues;
  }
}
const reject = (message, path = "/action") => {
  throw new ActionError("invalid", [issue(ISSUE_CODES.invalid, path, message)]);
};

const validGrant = (grant) => typeof grant.hash === "string" && SHA256_HEX.test(grant.hash) && Number.isSafeInteger(grant.sanitizerVersion) && grant.sanitizerVersion > 0;

/** Shape problems with an action, before any state is consulted. */
export function actionIssues(action) {
  if (!isPlainObject(action) || !ACTION_TYPES.includes(action.type)) return [issue(ISSUE_CODES.invalid, "/action/type", "Unknown settings action.")];
  const allowed = ["type", ...SHAPES[action.type]];
  const extra = Object.keys(action).filter((key) => !allowed.includes(key));
  const problems = extra.length ? [`unknown fields ${extra.join(", ")}`] : [];
  const localId = (value) => typeof value === "string" && LOCAL_ID.test(value);
  switch (action.type) {
    case "selectTheme":
      if (typeof action.id !== "string" || !action.id || action.id.length > 128) problems.push("id must be a theme ID");
      break;
    case "setEnabled":
      if (typeof action.enabled !== "boolean") problems.push("enabled must be true or false");
      break;
    case "setPreference":
      if (action.key === "appearance") {
        if (!APPEARANCE_MODES.includes(action.value)) problems.push("appearance must be full or calm");
      } else if (!BOOLEAN_PREFERENCE_KEYS.includes(action.key) || typeof action.value !== "boolean") problems.push("a preference is one of extras, text, motion, fonts or effects with true or false, or appearance");
      break;
    case "saveCustom":
      if ("id" in action && !localId(action.id)) problems.push("id must be local:<uuid>");
      if ("basedOn" in action && (typeof action.basedOn !== "string" || action.basedOn.startsWith(LOCAL_THEME_ID_PREFIX))) problems.push("basedOn must be a bundled theme ID");
      if (typeof action.select !== "boolean") problems.push("select must be true or false");
      if (!isPlainObject(action.document)) problems.push("document must be a theme");
      if ("cssConsent" in action && action.cssConsent !== null && !(isPlainObject(action.cssConsent) && Object.keys(action.cssConsent).every((key) => key === "hash" || key === "sanitizerVersion") && validGrant(action.cssConsent))) problems.push("cssConsent must be null or the sanitized CSS hash and sanitizer version");
      break;
    case "deleteCustom":
      if (!localId(action.id)) problems.push("id must be local:<uuid>");
      break;
    case "setCssConsent":
      if (!localId(action.id)) problems.push("id must be local:<uuid>");
      if (typeof action.granted !== "boolean") problems.push("granted must be true or false");
      if (action.granted && !validGrant(action)) problems.push("a grant needs the sanitized CSS hash and sanitizer version");
      break;
  }
  return problems.map((message) => issue(ISSUE_CODES.invalid, "/action", `${action.type}: ${message}.`));
}

// A grant names the sanitized hash of exactly this theme's CSS under this sanitizer.
function approveCss(entry, grant, css, path) {
  const result = css.inspect(entry.document).css;
  if (css.sanitizerVersion === null || !result?.ok || result.hash !== grant.hash || result.sanitizerVersion !== grant.sanitizerVersion) {
    reject("This advanced CSS cannot be approved: it is missing, changed or not sanitized by this version of Reskin.", path);
  }
}

/**
 * Applies one action to valid settings and returns new settings with the same revision; the
 * repository bumps it on write. Throws ActionError for anything it cannot apply.
 * @param {object} settings validated SettingsV2
 * @param {object} action
 * @param {{catalog, newId?:()=>string, css?, images?}} context
 */
export function reduceAction(settings, action, { catalog, newId, css = NO_CSS_SANITIZER, images } = {}) {
  const shape = actionIssues(action);
  if (shape.length) throw new ActionError("invalid", shape);
  const next = structuredClone(settings);
  const customIndex = (id) => next.customThemes.findIndex((theme) => theme.id === id);

  switch (action.type) {
    case "selectTheme": {
      const known = action.id.startsWith(LOCAL_THEME_ID_PREFIX) ? customIndex(action.id) >= 0 : catalog.has(action.id);
      if (!known) reject("That theme is not bundled or saved.", "/action/id");
      next.selectedThemeId = action.id;
      return next;
    }
    case "setEnabled":
      next.enabled = action.enabled;
      return next;
    case "setPreference":
      // The primary switch and its extras alias always move together; child switches never do.
      if (action.key === "appearance" || action.key === "extras") {
        const full = action.key === "appearance" ? action.value === "full" : action.value;
        next.preferences.appearance = full ? "full" : "calm";
        next.preferences.extras = full;
      } else next.preferences[action.key] = action.value;
      return next;
    case "saveCustom": {
      const entry = { id: action.id ?? `${LOCAL_THEME_ID_PREFIX}${newId()}`, document: structuredClone(action.document) };
      if (action.basedOn !== undefined) entry.basedOn = action.basedOn;
      const index = customIndex(entry.id);
      if (action.id !== undefined && index < 0) reject("That saved theme no longer exists.", "/action/id");
      const problems = [...customThemeIssues(entry, "/action", catalog), ...documentAdmissionIssues(entry.document, { css, images })];
      if (problems.length) throw new ActionError("invalid", problems);
      if (index < 0) next.customThemes.push(entry);
      else {
        // Changing CSS needs a fresh choice; changing anything else keeps the approval.
        const before = css.inspect(next.customThemes[index].document).css;
        const after = css.inspect(entry.document).css;
        if (before?.hash !== after?.hash) delete next.cssConsent[entry.id];
        next.customThemes[index] = entry;
      }
      // The builder's Enable advanced CSS choice travels with the document it approves, so the
      // theme and its consent are written together or not at all. null revokes it.
      if (action.cssConsent === null) delete next.cssConsent[entry.id];
      else if (action.cssConsent) {
        approveCss(entry, action.cssConsent, css, "/action/cssConsent/hash");
        next.cssConsent[entry.id] = { hash: action.cssConsent.hash, sanitizerVersion: action.cssConsent.sanitizerVersion };
      }
      if (next.customThemes.length > STORAGE_LIMITS.maxCustomThemes) throw new ActionError("storage", [issue(ISSUE_CODES.capacity, "/customThemes", "Your theme collection is full. Export or remove a saved theme, then try again.")]);
      if (customSourceBytes(next.customThemes) > STORAGE_LIMITS.maxCustomSourceBytes) throw new ActionError("storage", [issue(ISSUE_CODES.capacity, "/customThemes", "Saved themes would exceed 4 MiB. Export or remove a saved theme, then try again.")]);
      if (action.select) next.selectedThemeId = entry.id;
      return next;
    }
    case "deleteCustom": {
      const index = customIndex(action.id);
      if (index < 0) reject("That saved theme no longer exists.", "/action/id");
      const [removed] = next.customThemes.splice(index, 1);
      delete next.cssConsent[action.id];
      // Removing the selected theme first switches to a known built-in.
      if (next.selectedThemeId === action.id) next.selectedThemeId = removed.basedOn && catalog.has(removed.basedOn) ? removed.basedOn : fallbackThemeId(catalog);
      return next;
    }
    case "resetPreferences":
      next.preferences = { ...DEFAULT_PREFERENCES };
      return next;
    case "resetAll":
      return { ...defaultSettings(catalog), revision: settings.revision, onboardingCompleted: settings.onboardingCompleted };
    case "setCssConsent": {
      const index = customIndex(action.id);
      if (index < 0) reject("That saved theme no longer exists.", "/action/id");
      if (!action.granted) {
        delete next.cssConsent[action.id];
        return next;
      }
      approveCss(next.customThemes[index], action, css, "/action/hash");
      next.cssConsent[action.id] = { hash: action.hash, sanitizerVersion: action.sanitizerVersion };
      return next;
    }
    case "completeOnboarding":
      next.onboardingCompleted = true;
      return next;
    case "dismissMigration":
      next.migration = { ...next.migration, notices: [] };
      return next;
  }
  throw new ActionError("invalid", [issue(ISSUE_CODES.invalid, "/action/type", "Unknown settings action.")]);
}
