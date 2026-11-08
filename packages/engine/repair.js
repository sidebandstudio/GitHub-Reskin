// repairTheme: portable source repair against a same-base standard seed. Only fields the source
// already has can change, following the source-role mapping in ARCHITECTURE.md, plus an invalid
// supplied contribution ramp. Repair repeats until a fixed point, so repairing again is a no-op.
import { SYNTAX_ROLES } from "../contracts/index.js";
import { validateTheme } from "../format/index.js";
import { assertBasePolarity, assertTheme, deepFreeze, deriveColors } from "./resolve.js";
import { assertSeed } from "./seed.js";

// Portable field -> resolved ColorPath it persists from.
const SOURCE_MAP = [
  ["/colors/text", "/tokens/text"],
  ...["surface", "inset", "raised", "hover", "mutedText", "link", "border", "controlBorder", "accentMuted", "primaryBackground", "primaryText", "selectionBackground", "selectionText"].map((k) => [
    `/overrides/${k}`,
    `/tokens/${k}`,
  ]),
  ["/overrides/focus", "/tokens/focusOuter"],
  ...["success", "danger", "warning", "done"].map((k) => [`/overrides/${k}`, `/semantics/${k}/text`]),
  ...SYNTAX_ROLES.map((k) => [`/overrides/syntax/${k}`, `/syntax/${k}`]),
];
const MAX_ROUNDS = 12;

const clone = (value) => JSON.parse(JSON.stringify(value));

function read(theme, path) {
  let value = theme;
  for (const key of path.split("/").slice(1)) value = value?.[key];
  return value;
}
function write(theme, path, value) {
  const keys = path.split("/").slice(1);
  let holder = theme;
  for (const key of keys.slice(0, -1)) holder = holder[key];
  holder[keys.at(-1)] = value;
}

function reasonFor(repairs, path) {
  return repairs.find((r) => r.path === path)?.reason ?? "Adjusted for readable contrast.";
}

// One round: the source changes resolution asks for.
function round(theme, seed) {
  const { colors, graph } = deriveColors(theme, seed);
  const renderRepairs = colors.repairs();
  const changes = [];
  for (const [source, resolved] of SOURCE_MAP) {
    const before = read(theme, source);
    if (before === undefined) continue;
    const after = colors.get(resolved);
    if (before.toLowerCase() !== after) changes.push({ path: source, before, after, reason: reasonFor(renderRepairs, resolved) });
  }
  const levels = theme.contributions?.levels;
  if (levels && graph.method !== "supplied") {
    changes.push({ path: "/contributions/levels", before: levels, after: graph.levels, reason: "The contribution levels were not all visible and in order, so they were regenerated." });
  }
  return changes;
}

/**
 * @param {import("../contracts/index.js").ThemeV1} theme
 * @param {import("../contracts/index.js").ModeSeed} standardSeed a same-base, standard-family, non-high-contrast seed
 * @returns {{theme: import("../contracts/index.js").ThemeV1, repairs: readonly import("../contracts/index.js").Repair[]}}
 */
export function repairTheme(theme, standardSeed) {
  assertTheme(theme, "repairTheme");
  assertSeed(standardSeed);
  if (standardSeed.family !== "standard" || standardSeed.highContrast) throw new TypeError("repairTheme needs a standard, non-high-contrast seed");
  if (standardSeed.base !== theme.base) throw new TypeError(`repairTheme needs a ${theme.base} seed; ${standardSeed.id} is ${standardSeed.base}`);
  assertBasePolarity(theme);

  let current = clone(theme);
  const first = new Map();
  const last = new Map();
  for (let i = 0; ; i++) {
    const changes = round(current, standardSeed);
    if (!changes.length) break;
    if (i === MAX_ROUNDS) throw new Error(`repairTheme did not reach a fixed point for ${theme.name}`);
    for (const change of changes) {
      if (!first.has(change.path)) first.set(change.path, change);
      last.set(change.path, change);
      write(current, change.path, clone(change.after));
    }
  }
  const result = validateTheme(current);
  if (!result.ok) throw new Error(`repairTheme produced an invalid theme: ${result.issues.map((i) => i.path).join(", ")}`);

  const repairs = [...first.values()]
    .map(({ path, before, reason }) => ({ persistence: "source", path, before, after: last.get(path).after, reason }))
    .filter((r) => JSON.stringify(r.before).toLowerCase() !== JSON.stringify(r.after).toLowerCase());
  return Object.freeze({ theme: deepFreeze(current), repairs: deepFreeze(repairs) });
}
