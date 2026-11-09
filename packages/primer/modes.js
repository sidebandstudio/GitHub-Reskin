// Mode selection: which frozen seed, if any, a theme of a given base uses for a GitHub mode.
// Pure. The caller supplies the ModeIndex; nothing here looks one up on its own.
import POLICY from "./mode-policy.json" with { type: "json" };

export const MODE_POLICY = POLICY;

export const NOTICES = Object.freeze({
  accessibility: "GitHub accessibility colors are active",
  highContrast: "GitHub high-contrast colors are active, so Reskin keeps GitHub's colors and pauses theme colors, fonts and effects.",
  unknown: "Reskin does not recognize this GitHub color mode, so it keeps GitHub's colors here.",
});

const BASES = ["dark", "light"];
const COLOR_MODES = ["light", "dark", "auto"];

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function assertIndex(index) {
  if (!index || index.contractVersion !== 1 || typeof index.modes !== "object" || !Array.isArray(index.counterparts)) {
    throw new TypeError("selectMode needs a renderer 1 ModeIndex");
  }
}

/**
 * The GitHub mode ID in effect for a NativeMode: the light or dark theme for an explicit color
 * mode, and for auto the one matching the system preference. Null when the record is malformed.
 */
export function nativeModeId(native) {
  if (!native || !COLOR_MODES.includes(native.colorMode)) return null;
  const dark = native.colorMode === "dark" || (native.colorMode === "auto" && native.systemDark === true);
  const id = dark ? native.darkTheme : native.lightTheme;
  return typeof id === "string" && /^[a-z][a-z0-9_]*$/.test(id) ? id : null;
}

/** The unique counterpart record for a native mode and base, or null. */
export function counterpartFor(index, nativeMode, base) {
  const found = index.counterparts.filter((c) => c.nativeMode === nativeMode && c.base === base);
  return found.length === 1 ? found[0] : null;
}

/**
 * Maps a GitHub mode to a ModePlan for a theme of `base`.
 * Standard modes (including dimmed) use the standard seed of the theme's base; colorblind and
 * tritanopia use their own family's seed of that base; high-contrast modes and anything not in
 * the index stay native. A counterpart must match the family and never drop high contrast.
 * @returns {Readonly<{seedMode:string|null, policy:'themed'|'native-high-contrast'|'native-unknown', notice?:string}>}
 */
export function selectMode(native, base, index) {
  if (!BASES.includes(base)) throw new TypeError(`selectMode base must be dark or light, not ${base}`);
  assertIndex(index);
  const id = nativeModeId(native);
  const mode = id && Object.hasOwn(index.modes, id) ? index.modes[id] : null;
  if (!mode) return freeze({ seedMode: null, policy: "native-unknown", notice: NOTICES.unknown });
  if (mode.highContrast) return freeze({ seedMode: null, policy: "native-high-contrast", notice: NOTICES.highContrast });
  const counterpart = counterpartFor(index, id, base);
  const seed = counterpart && Object.hasOwn(index.modes, counterpart.seedMode) ? index.modes[counterpart.seedMode] : null;
  if (!seed || seed.base !== base || seed.family !== mode.family || seed.highContrast) {
    return freeze({ seedMode: null, policy: "native-unknown", notice: NOTICES.unknown });
  }
  return freeze(seed.family === "standard" ? { seedMode: seed.id, policy: "themed" } : { seedMode: seed.id, policy: "themed", notice: NOTICES.accessibility });
}

/** Every native mode whose counterpart for the seed's base is that seed, in index order. */
export function coveredModes(index, seedMode) {
  assertIndex(index);
  const seed = index.modes[seedMode];
  if (!seed) return [];
  return index.counterparts.filter((c) => c.base === seed.base && c.seedMode === seedMode).map((c) => c.nativeMode);
}

/** The plan's seed record, which the caller passes to resolveTheme as ResolveContext.seed. */
export function seedFor(index, plan) {
  assertIndex(index);
  return plan?.policy === "themed" && plan.seedMode && Object.hasOwn(index.modes, plan.seedMode) ? index.modes[plan.seedMode] : null;
}

/** The standard seed of a base, which repairTheme requires for portable source repair. */
export function standardSeed(index, base) {
  assertIndex(index);
  if (!BASES.includes(base)) throw new TypeError(`standardSeed base must be dark or light, not ${base}`);
  const seed = index.modes[POLICY.familySeeds.standard[base]];
  if (!seed || seed.family !== "standard" || seed.highContrast || seed.base !== base) throw new Error(`The index has no standard ${base} seed`);
  return seed;
}
