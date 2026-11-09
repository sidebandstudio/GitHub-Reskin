// Runtime checks for the immutable inputs: ModeSeed records, ResolveContext and the pair matrix.
// A template type cannot prove a string is a color, so every leaf is checked once per object.
import { MODE_FAMILIES, MODE_POLICIES, PAIR_MATRIX_VERSION, SYNTAX_ROLES } from "../contracts/index.js";
import { isHex } from "./color.js";
import { ANSI_ROLES, COLOR_PATHS, PAIR_PATHS, SEMANTIC_FIELDS, SEMANTIC_ROLES, TOKEN_KEYS } from "./vocabulary.js";

const checked = new WeakSet();
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function exactKeys(value, keys, where, problems) {
  if (!isObject(value)) return problems.push(`${where} must be an object`), false;
  const actual = Object.keys(value);
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  const extra = actual.filter((key) => !keys.includes(key));
  if (missing.length) problems.push(`${where} is missing ${missing.join(", ")}`);
  if (extra.length) problems.push(`${where} has unknown keys ${extra.join(", ")}`);
  return !missing.length;
}

function colorLeaves(value, keys, where, problems) {
  if (!exactKeys(value, keys, where, problems)) return;
  for (const key of keys) if (!isHex(value[key]) || value[key] !== value[key].toLowerCase()) problems.push(`${where}.${key} must be a lowercase #rrggbb color`);
}

/** Problems with a ModeSeed, as readable strings. Empty means valid. */
export function seedProblems(seed) {
  const problems = [];
  if (!isObject(seed)) return ["seed must be an object"];
  exactKeys(seed, ["contractVersion", "id", "base", "family", "highContrast", "sourceHash", "colors", "origins"], "seed", problems);
  if (seed.contractVersion !== 1) problems.push("seed.contractVersion must be 1");
  if (typeof seed.id !== "string" || !seed.id) problems.push("seed.id must be a mode ID");
  if (seed.base !== "dark" && seed.base !== "light") problems.push("seed.base must be dark or light");
  if (!MODE_FAMILIES.includes(seed.family)) problems.push(`seed.family must be one of ${MODE_FAMILIES.join(", ")}`);
  if (typeof seed.highContrast !== "boolean") problems.push("seed.highContrast must be a boolean");
  if (typeof seed.sourceHash !== "string" || !/^[0-9a-f]{64}$/.test(seed.sourceHash)) problems.push("seed.sourceHash must be a SHA-256 hex digest");
  const colors = seed.colors;
  if (exactKeys(colors, ["tokens", "semantics", "syntax", "ansi", "graph"], "seed.colors", problems)) {
    colorLeaves(colors.tokens, TOKEN_KEYS, "seed.colors.tokens", problems);
    if (exactKeys(colors.semantics, SEMANTIC_ROLES, "seed.colors.semantics", problems)) {
      for (const role of SEMANTIC_ROLES) colorLeaves(colors.semantics[role], SEMANTIC_FIELDS, `seed.colors.semantics.${role}`, problems);
    }
    colorLeaves(colors.syntax, SYNTAX_ROLES, "seed.colors.syntax", problems);
    colorLeaves(colors.ansi, ANSI_ROLES, "seed.colors.ansi", problems);
    if (!Array.isArray(colors.graph) || colors.graph.length !== 5 || !colors.graph.every(isHex)) problems.push("seed.colors.graph must be five colors");
  }
  if (exactKeys(seed.origins, COLOR_PATHS, "seed.origins", problems)) {
    for (const path of COLOR_PATHS) {
      const origin = seed.origins[path];
      if (!isObject(origin) || typeof origin.file !== "string" || !/^[0-9a-f]{64}$/.test(origin.sha256 ?? "") || !/^--/.test(origin.variable ?? "") || typeof origin.fallback !== "boolean") {
        problems.push(`seed.origins[${path}] is not a valid SeedOrigin`);
      }
    }
  }
  return problems;
}

export function assertSeed(seed) {
  if (checked.has(seed)) return;
  const problems = seedProblems(seed);
  if (problems.length) throw new TypeError(`Invalid ModeSeed: ${problems.slice(0, 5).join("; ")}`);
  checked.add(seed);
}

export function assertContext(context) {
  if (!isObject(context)) throw new TypeError("ResolveContext must be an object");
  if (!MODE_POLICIES.includes(context.policy)) throw new TypeError(`ResolveContext.policy must be one of ${MODE_POLICIES.join(", ")}`);
  if (typeof context.reducedMotion !== "boolean" || typeof context.forcedColors !== "boolean") throw new TypeError("ResolveContext.reducedMotion and forcedColors must be booleans");
  if (context.seed !== null) assertSeed(context.seed);
}

/** Problems with a pair matrix: version, IDs, paths and background sets. Empty means valid. */
export function pairMatrixProblems(matrix) {
  const problems = [];
  if (!isObject(matrix) || matrix.version !== PAIR_MATRIX_VERSION || !Array.isArray(matrix.records)) return [`pair matrix must be {version:${PAIR_MATRIX_VERSION}, records:[...]}`];
  const ids = new Set();
  for (const [index, record] of matrix.records.entries()) {
    const at = `record ${record?.id ?? index}`;
    if (!isObject(record) || typeof record.id !== "string" || !record.id) {
      problems.push(`record ${index} needs an id`);
      continue;
    }
    if (ids.has(record.id)) problems.push(`${at} is a duplicate id`);
    ids.add(record.id);
    if (!PAIR_PATHS.includes(record.foreground)) problems.push(`${at} foreground ${record.foreground} is not a ColorPath or appearance color`);
    if (!Array.isArray(record.backgrounds) || !record.backgrounds.length) problems.push(`${at} needs at least one background`);
    else for (const bg of record.backgrounds) if (!PAIR_PATHS.includes(bg)) problems.push(`${at} background ${bg} is not a ColorPath or appearance color`);
    if (record.minimum !== 3 && record.minimum !== 4.5) problems.push(`${at} minimum must be 3 or 4.5`);
    if (!["text", "boundary", "focus"].includes(record.purpose)) problems.push(`${at} purpose must be text, boundary or focus`);
  }
  return problems;
}
