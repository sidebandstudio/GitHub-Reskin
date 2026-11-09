// 1.1.0 storage to SettingsV2. Pure: reads only the known 1.x keys from the record it is given and
// writes nothing. repository.js persists the result once, from the background.
import { LEGACY_EDITED_COLORS_THEME_ID, LEGACY_STORAGE_KEYS, LEGACY_THEME_ALIASES, LOCAL_THEME_ID_PREFIX } from "../contracts/index.js";
import { validateTheme } from "../format/index.js";
import { basePolarityIssue } from "../engine/index.js";
import { NOTICES, STORAGE_LIMITS } from "./constants.js";
import { defaultSettings, isPlainObject } from "./model.js";

const LEGACY_COLOR_KEYS = ["bg", "text", "accent", "graph"];
const LEGACY_HEX = /^#[0-9a-f]{6}$/i;
const NAME_LIMIT = 64;
const EDITED = ", edited";

/** True when the record holds any 1.x key, so the person used 1.1.0 or earlier. */
export const hasLegacyKeys = (raw) => LEGACY_STORAGE_KEYS.some((key) => raw[key] !== undefined);

const validCustom = (custom) => isPlainObject(custom) && LEGACY_COLOR_KEYS.every((key) => typeof custom[key] === "string" && LEGACY_HEX.test(custom[key]));

/**
 * @param {Record<string, unknown>} raw storage values; only enabled, theme and custom are read
 * @param {{catalog, newId:()=>string, repair?:(theme)=>{theme, repairs:readonly unknown[]}}} context
 *   newId returns a fresh UUID. repair, when given, is the engine's source repair against the
 *   standard seed of the theme's base (C6 wires repairTheme with C3's standardSeed).
 * @returns {{settings, notices:string[], recovery?:object}}
 */
export function migrateLegacy(raw, { catalog, newId, repair } = {}) {
  const settings = defaultSettings(catalog);
  const notices = [];
  const recovery = {};
  const { enabled, theme, custom } = { enabled: raw.enabled, theme: raw.theme, custom: raw.custom };

  // Never interpret truthiness: only a real boolean is a choice.
  if (typeof enabled === "boolean") settings.enabled = enabled;
  else if (enabled !== undefined) {
    recovery.enabled = enabled;
    notices.push(NOTICES.invalidEnabled);
  }

  // The selected source. 1.0 saved edited colors without a theme; they belong to Editing Suite.
  let sourceId;
  if (theme === undefined || theme === null) sourceId = custom != null ? LEGACY_EDITED_COLORS_THEME_ID : settings.selectedThemeId;
  else if (typeof theme === "string" && Object.hasOwn(LEGACY_THEME_ALIASES, theme) && catalog.has(LEGACY_THEME_ALIASES[theme])) {
    sourceId = LEGACY_THEME_ALIASES[theme];
    notices.push(NOTICES.cyberpunkAlias, NOTICES.controlSwapsRemoved);
  } else if (typeof theme === "string" && !theme.startsWith(LOCAL_THEME_ID_PREFIX) && catalog.has(theme)) sourceId = theme;
  else {
    recovery.theme = theme;
    sourceId = LEGACY_EDITED_COLORS_THEME_ID;
    notices.push(NOTICES.unknownTheme);
  }
  settings.selectedThemeId = sourceId;

  if (custom != null) {
    const local = validCustom(custom) ? localTheme(catalog.document(sourceId), custom, repair) : null;
    if (local) {
      const id = `${LOCAL_THEME_ID_PREFIX}${newId()}`;
      settings.customThemes.push({ id, document: local.document, basedOn: sourceId });
      settings.selectedThemeId = id;
      notices.push(NOTICES.customColors);
      if (local.repairs.length) {
        notices.push(NOTICES.customRepaired);
        recovery.custom = custom;
      }
    } else {
      recovery.custom = custom;
      notices.push(NOTICES.customRecovered);
    }
  }

  const bounded = boundRecovery(recovery);
  if (bounded.truncated) notices.push(NOTICES.recoveryTruncated);
  settings.onboardingCompleted = true;
  settings.migration = { from: "1.1.0", notices: notices.slice(0, STORAGE_LIMITS.maxNotices) };
  return Object.keys(recovery).length ? { settings, notices: settings.migration.notices, recovery: { from: "1.1.0", ...bounded.value } } : { settings, notices: settings.migration.notices };
}

// Clones the source and applies the four 1.x colors. 1.1.0 dropped a theme's extra surface, border
// and muted colors once you edited it, so its overrides and graph levels go too; fonts, effects and
// flavor stay, as they did. A base the colors contradict is switched, as an import would offer.
function localTheme(source, custom, repair) {
  if (!source) return null;
  const { overrides, contributions, ...rest } = structuredClone(source);
  const name = source.name.length + EDITED.length > NAME_LIMIT ? source.name.slice(0, NAME_LIMIT - EDITED.length).trimEnd() : source.name;
  let document = {
    ...rest,
    name: `${name}${EDITED}`,
    colors: { background: custom.bg.toLowerCase(), text: custom.text.toLowerCase(), accent: custom.accent.toLowerCase(), contribution: custom.graph.toLowerCase() },
  };
  if (!validateTheme(document).ok) return null;
  if (basePolarityIssue(document)) {
    document = { ...document, base: document.base === "dark" ? "light" : "dark" };
    if (basePolarityIssue(document)) return null;
  }
  let repairs = [];
  if (repair) ({ theme: document, repairs } = repair(document));
  return validateTheme(document).ok ? { document, repairs } : null;
}

// Keeps the recovery copy within its bound. A field too large to keep is replaced by its size.
export function boundRecovery(recovery) {
  const value = {};
  let truncated = false;
  let bytes = 0;
  for (const [key, field] of Object.entries(recovery)) {
    let size;
    try {
      size = new TextEncoder().encode(JSON.stringify(field) ?? "null").length;
    } catch {
      size = Infinity;
    }
    if (bytes + size <= STORAGE_LIMITS.maxRecoveryBytes) {
      value[key] = field === undefined ? null : jsonCopy(field);
      bytes += size;
    } else {
      value[key] = { truncated: true, bytes: Number.isFinite(size) ? size : null };
      truncated = true;
    }
  }
  return { value, truncated };
}

function jsonCopy(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}
