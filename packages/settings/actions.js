// The closed set of settings commits and the pure reducer that applies one. The background calls
// reduceState on the latest stored state inside its serialized queue; nothing else writes. CSS
// approval is never decided here: every action's result goes through consent.js.
import { COMMIT_ACTION_TYPES, ISSUE_CODES, LOCAL_THEME_ID_PREFIX } from "../contracts/index.js";
import { documentAdmissionIssues, NO_CSS_SANITIZER } from "./admission.js";
import { fallbackThemeId } from "./catalog.js";
import { EDITOR_ID, NEW_TARGET, settleConsent, TICKET } from "./consent.js";
import { APPEARANCE_MODES, BOOLEAN_PREFERENCE_KEYS, DEFAULT_PREFERENCES, EXTRA_COMMIT_ACTION_TYPES, STORAGE_LIMITS } from "./constants.js";
import { ActionError, customSourceBytes, customThemeIssues, defaultSettings, isPlainObject, issue, LOCAL_ID } from "./model.js";

export { ActionError };

export const ACTION_TYPES = Object.freeze([...COMMIT_ACTION_TYPES, ...EXTRA_COMMIT_ACTION_TYPES]);

const SHAPES = {
  selectTheme: ["id"],
  setEnabled: ["enabled"],
  setPreference: ["key", "value"],
  saveCustom: ["id", "document", "basedOn", "select", "editor", "approval"],
  deleteCustom: ["id"],
  resetPreferences: [],
  resetAll: [],
  setCssConsent: ["id", "granted", "editor", "approval"],
  approveCss: ["editor", "target", "css"],
  withdrawCss: ["editor"],
  completeOnboarding: [],
  dismissMigration: [],
};

const reject = (message, path = "/action") => {
  throw new ActionError("invalid", [issue(ISSUE_CODES.invalid, path, message)]);
};

/** Shape problems with an action, before any state is consulted. */
export function actionIssues(action) {
  if (!isPlainObject(action) || !ACTION_TYPES.includes(action.type)) return [issue(ISSUE_CODES.invalid, "/action/type", "Unknown settings action.")];
  const allowed = ["type", ...SHAPES[action.type]];
  const extra = Object.keys(action).filter((key) => !allowed.includes(key));
  const problems = extra.length ? [`unknown fields ${extra.join(", ")}`] : [];
  const localId = (value) => typeof value === "string" && LOCAL_ID.test(value);
  const editor = () => {
    if ("editor" in action && !(typeof action.editor === "string" && EDITOR_ID.test(action.editor))) problems.push("editor must be the editor's token");
  };
  // A ticket to redeem needs the editor it was issued to.
  const ticket = () => typeof action.approval === "string" && TICKET.test(action.approval) && "editor" in action;
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
      editor();
      if ("approval" in action && action.approval !== null && !ticket()) problems.push("approval must be null or an approval ticket with its editor");
      break;
    case "deleteCustom":
      if (!localId(action.id)) problems.push("id must be local:<uuid>");
      break;
    case "setCssConsent":
      if (!localId(action.id)) problems.push("id must be local:<uuid>");
      if (typeof action.granted !== "boolean") problems.push("granted must be true or false");
      editor();
      if (action.granted && !ticket()) problems.push("a grant needs an approval ticket and its editor");
      if (!action.granted && "approval" in action) problems.push("a revocation takes no approval");
      break;
    case "approveCss":
      if (!(typeof action.editor === "string" && EDITOR_ID.test(action.editor))) problems.push("editor must be the editor's token");
      if (action.target !== NEW_TARGET && !localId(action.target)) problems.push("target must be new or local:<uuid>");
      if (typeof action.css !== "string" || !action.css.trim()) problems.push("css must be the CSS to approve");
      break;
    case "withdrawCss":
      if (!(typeof action.editor === "string" && EDITOR_ID.test(action.editor))) problems.push("editor must be the editor's token");
      break;
  }
  return problems.map((message) => issue(ISSUE_CODES.invalid, "/action", `${action.type}: ${message}.`));
}

/**
 * Applies one action to valid settings and returns new settings with the same revision; the
 * repository bumps it on write. Throws ActionError for anything it cannot apply.
 * @param {object} settings validated SettingsV2
 * @param {object} action
 * @param {{catalog, newId?:()=>string, css?, images?, approvals?, redeem?, editor?}} context
 */
export const reduceAction = (settings, action, context = {}) => reduceState(settings, context.approvals ?? [], action, context).settings;

/**
 * reduceAction with the pending approvals: {settings, approvals}. `redeem` holds the digests of the
 * action's approval ticket and editor, and `editor` the digest of the editor saving (consent.js).
 */
export function reduceState(settings, approvals, action, { catalog, newId, css = NO_CSS_SANITIZER, images, redeem = null, editor = null } = {}) {
  const shape = actionIssues(action);
  if (shape.length) throw new ActionError("invalid", shape);
  const { next, grant } = reduceSettings(settings, action, { catalog, newId, css, images });
  const ticket = grant && redeem ? { ...grant, ticket: redeem.ticket, editor: redeem.editor } : null;
  if (grant && !ticket) reject("An approval ticket needs its editor.", "/action/approval");
  const saves = action.type === "saveCustom" || action.type === "setCssConsent";
  const settled = settleConsent(settings, next, approvals, { css, action, grant: ticket, editor: saves ? editor : null });
  next.cssConsent = settled.cssConsent;
  return { settings: next, approvals: settled.approvals };
}

// The action's effect on everything but cssConsent, and the approval it asks to redeem, if any.
function reduceSettings(settings, action, { catalog, newId, css, images }) {
  const next = structuredClone(settings);
  const done = (grant = null) => ({ next, grant });
  const customIndex = (id) => next.customThemes.findIndex((theme) => theme.id === id);

  switch (action.type) {
    case "selectTheme": {
      const known = action.id.startsWith(LOCAL_THEME_ID_PREFIX) ? customIndex(action.id) >= 0 : catalog.has(action.id);
      if (!known) reject("That theme is not bundled or saved.", "/action/id");
      next.selectedThemeId = action.id;
      return done();
    }
    case "setEnabled":
      next.enabled = action.enabled;
      return done();
    case "setPreference":
      // The primary switch and its extras alias always move together; child switches never do.
      if (action.key === "appearance" || action.key === "extras") {
        const full = action.key === "appearance" ? action.value === "full" : action.value;
        next.preferences.appearance = full ? "full" : "calm";
        next.preferences.extras = full;
      } else next.preferences[action.key] = action.value;
      return done();
    case "saveCustom": {
      const entry = { id: action.id ?? `${LOCAL_THEME_ID_PREFIX}${newId()}`, document: structuredClone(action.document) };
      if (action.basedOn !== undefined) entry.basedOn = action.basedOn;
      const index = customIndex(entry.id);
      if (action.id !== undefined && index < 0) reject("That saved theme no longer exists.", "/action/id");
      const problems = [...customThemeIssues(entry, "/action", catalog), ...documentAdmissionIssues(entry.document, { css, images })];
      if (problems.length) throw new ActionError("invalid", problems);
      if (index < 0) next.customThemes.push(entry);
      else next.customThemes[index] = entry;
      if (next.customThemes.length > STORAGE_LIMITS.maxCustomThemes) throw new ActionError("storage", [issue(ISSUE_CODES.capacity, "/customThemes", "Your theme collection is full. Export or remove a saved theme, then try again.")]);
      if (customSourceBytes(next.customThemes) > STORAGE_LIMITS.maxCustomSourceBytes) throw new ActionError("storage", [issue(ISSUE_CODES.capacity, "/customThemes", "Saved themes would exceed 4 MiB. Export or remove a saved theme, then try again.")]);
      if (action.select) next.selectedThemeId = entry.id;
      // The theme and the approval it redeems are written together or not at all. An edit keeps
      // the approval only while the CSS stays exactly the same; a new theme starts without one.
      return done(typeof action.approval === "string" ? { id: entry.id, target: action.id ?? NEW_TARGET } : null);
    }
    case "deleteCustom": {
      const index = customIndex(action.id);
      if (index < 0) reject("That saved theme no longer exists.", "/action/id");
      const [removed] = next.customThemes.splice(index, 1);
      // Removing the selected theme first switches to a known built-in.
      if (next.selectedThemeId === action.id) next.selectedThemeId = removed.basedOn && catalog.has(removed.basedOn) ? removed.basedOn : fallbackThemeId(catalog);
      return done();
    }
    case "resetPreferences":
      next.preferences = { ...DEFAULT_PREFERENCES };
      return done();
    case "resetAll":
      return { next: { ...defaultSettings(catalog), revision: settings.revision, onboardingCompleted: settings.onboardingCompleted }, grant: null };
    case "setCssConsent":
      if (customIndex(action.id) < 0) reject("That saved theme no longer exists.", "/action/id");
      return done(action.granted ? { id: action.id, target: action.id } : null);
    case "completeOnboarding":
      next.onboardingCompleted = true;
      return done();
    case "dismissMigration":
      next.migration = { ...next.migration, notices: [] };
      return done();
  }
  throw new ActionError("invalid", [issue(ISSUE_CODES.invalid, "/action/type", "Unknown settings action.")]);
}
