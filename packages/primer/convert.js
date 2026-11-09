// Converts frozen GitHub mode stylesheets into the renderer 1 ModeIndex: one ModeSeed per mode,
// the unique counterpart for each themable mode and requested base, and the native baseline
// declarations each family seed needs. Pure: the caller supplies file text and SHA-256 hashes.
import { parseStylesheet } from "./css.js";
import { githubModeSelectors } from "./selectors.js";

export const GENERATOR_VERSION = 1;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VAR = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/s;


/** Normalizes #rgb, #rgba, #rrggbb and #rrggbbaa to lowercase six or eight digits. */
export function normalizeHex(value) {
  const v = value.toLowerCase();
  return v.length === 4 || v.length === 5 ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : v;
}

/** sRGB source-over compositing with floor(v + 0.5), as the engine's mix uses. */
export function flatten(hex8, under) {
  const a = parseInt(hex8.slice(7, 9), 16) / 255;
  const ch = (h, i) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.floor(ch(hex8, i) * a + ch(under, i) * (1 - a) + 0.5).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Reads one mode stylesheet: exactly GitHub's two rules for mode `id`, with identical
 * declarations, and returns its declarations as an ordered Map of name to raw value.
 */
export function readModeFile(text, id, base) {
  const rules = parseStylesheet(text);
  const expected = githubModeSelectors(id, base);
  const [outer, media, ...rest] = rules;
  const fail = (why) => {
    throw new Error(`${id}: ${why}`);
  };
  if (rest.length) fail(`expected two top-level rules, found ${rules.length}`);
  if (outer?.type !== "rule") fail("the first rule is not a style rule");
  if (JSON.stringify(outer.selectors) !== JSON.stringify(expected.always)) fail(`unexpected selectors ${outer.selectors.join(",")}`);
  if (media?.type !== "at" || media.name !== "media" || media.prelude.replace(/\s+/g, "") !== "(prefers-color-scheme:dark)") fail("the second rule is not @media (prefers-color-scheme:dark)");
  const inner = media.rules;
  if (inner?.length !== 1 || inner[0].type !== "rule" || JSON.stringify(inner[0].selectors) !== JSON.stringify(expected.prefersDark)) fail("unexpected rule inside the prefers-color-scheme:dark query");
  const declarations = new Map();
  for (const d of outer.declarations) {
    if (!d.name.startsWith("--")) fail(`non-variable declaration ${d.name}`);
    if (d.important) fail(`${d.name} is !important`);
    if (declarations.has(d.name)) fail(`${d.name} is declared twice`);
    declarations.set(d.name, d.value);
  }
  const darkCopy = inner[0].declarations.map((d) => `${d.name}:${d.value}`).join(";");
  if (darkCopy !== outer.declarations.map((d) => `${d.name}:${d.value}`).join(";")) fail("the two rules declare different values");
  return declarations;
}

// Resolves a variable to a normalized hex color through var() references in the same file.
function resolveColor(declarations, name, seen = []) {
  if (seen.includes(name)) throw new Error(`cyclic reference ${[...seen, name].join(" -> ")}`);
  if (!declarations.has(name)) throw new Error(`missing variable ${name}${seen.length ? ` (via ${seen.join(" -> ")})` : ""}`);
  const value = declarations.get(name).trim();
  if (HEX.test(value)) return normalizeHex(value);
  const ref = VAR.exec(value);
  if (ref) {
    if (!declarations.has(ref[1]) && ref[2] && HEX.test(ref[2].trim())) return normalizeHex(ref[2].trim());
    return resolveColor(declarations, ref[1], [...seen, name]);
  }
  throw new Error(`${name} is not a color: ${value}`);
}

/** Builds one ModeSeed from a mode's declarations, the mapping's seed table and its file identity. */
export function buildSeed({ id, entry, declarations, file, sha256, seedMap, colorPaths }) {
  const flat = new Map();
  const origins = {};
  const resolving = [];
  const opaque = (path) => {
    if (flat.has(path)) return flat.get(path);
    if (resolving.includes(path)) throw new Error(`${id}: cyclic compositeOver ${[...resolving, path].join(" -> ")}`);
    const map = seedMap[path];
    if (!map) throw new Error(`${id}: the mapping has no seed source for ${path}`);
    resolving.push(path);
    let color;
    try {
      color = resolveColor(declarations, map.variable);
    } catch (error) {
      throw new Error(`${id} ${path}: ${error.message}`);
    }
    let compositeOver = null;
    if (color.length === 9) {
      if (color.endsWith("ff")) color = color.slice(0, 7);
      else {
        if (!map.compositeOver) throw new Error(`${id} ${path}: ${map.variable} is translucent and the mapping names no compositeOver role`);
        compositeOver = map.compositeOver;
        color = flatten(color, opaque(compositeOver));
      }
    }
    resolving.pop();
    flat.set(path, color);
    origins[path] = { file, sha256, variable: map.variable, fallback: false, compositeOver };
    return color;
  };
  for (const path of colorPaths) opaque(path);
  const at = (path) => flat.get(path);
  const group = (prefix, keys) => Object.fromEntries(keys.map((k) => [k, at(`${prefix}/${k}`)]));
  const keysOf = (prefix) => colorPaths.filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1));
  const semantics = {};
  for (const role of [...new Set(keysOf("/semantics").map((k) => k.split("/")[0]))]) semantics[role] = group(`/semantics/${role}`, keysOf(`/semantics/${role}`));
  return {
    contractVersion: 1,
    id,
    base: entry.base,
    family: entry.family,
    highContrast: entry.highContrast,
    sourceHash: null, // filled by the caller, which owns the hash function
    colors: {
      tokens: group("/tokens", keysOf("/tokens")),
      semantics,
      syntax: group("/syntax", keysOf("/syntax")),
      ansi: group("/ansi", keysOf("/ansi")),
      graph: [0, 1, 2, 3, 4].map((n) => at(`/graph/${n}`)),
    },
    origins: Object.fromEntries(colorPaths.map((p) => [p, origins[p]])),
  };
}

/** Every ColorPath in ColorSet order, from the mapping's seed table (which must list them all). */
export const colorPathsOf = (seedMap) => Object.keys(seedMap);

/**
 * Converts reviewed mode files into a ModeIndex.
 * @param {{files:Record<string,{text:string,sha256:string}>, policy:object, mappings:object,
 *   hash:(text:string)=>string, allowUnreviewed?:boolean}} input
 */
export function convertModes({ files, policy, mappings, hash, allowUnreviewed = false }) {
  const discovered = {};
  for (const name of Object.keys(files).filter((n) => n.endsWith(".css")).sort()) discovered[name.slice(0, -4)] = name;
  const unreviewed = Object.keys(discovered).filter((id) => !policy.modes[id]);
  if (unreviewed.length && !allowUnreviewed) throw new Error(`Unreviewed modes: ${unreviewed.join(", ")}. Add each to packages/primer/mode-policy.json.`);
  const missing = Object.keys(policy.modes).filter((id) => !discovered[id]);
  if (missing.length) throw new Error(`Reviewed modes without a frozen stylesheet: ${missing.join(", ")}`);

  const colorPaths = colorPathsOf(mappings.seed);
  const declared = {};
  const modes = {};
  for (const [id, entry] of Object.entries(policy.modes)) {
    const name = discovered[id];
    const { text, sha256 } = files[name];
    const declarations = readModeFile(text, id, entry.base);
    declared[id] = declarations;
    const file = `source/${name}`;
    const seed = buildSeed({ id, entry, declarations, file, sha256, seedMap: mappings.seed, colorPaths });
    seed.sourceHash = hash(JSON.stringify([[file, sha256]]));
    modes[id] = seed;
  }

  // Counterparts: each themable mode and requested base maps to its family's seed of that base.
  const counterparts = [];
  for (const [id, entry] of Object.entries(policy.modes)) {
    if (entry.highContrast || entry.policy !== "themed") continue;
    for (const base of ["dark", "light"]) {
      const seedMode = policy.familySeeds[entry.family]?.[base];
      const seed = modes[seedMode];
      if (!seed || seed.base !== base || seed.family !== entry.family || seed.highContrast) throw new Error(`${id}: no ${entry.family} ${base} counterpart`);
      counterparts.push({ nativeMode: id, base, seedMode });
    }
  }

  // Native baselines: for each family seed, every variable whose value differs between themable
  // modes and that the compiler does not write itself, with the seed mode's own value.
  const emitted = new Set([...mappings.emit, ...mappings.brandFooter].map((m) => m.variable));
  const themable = Object.keys(policy.modes).filter((id) => policy.modes[id].policy === "themed");
  const names = [...declared[themable[0]].keys()];
  for (const id of Object.keys(declared)) {
    const own = [...declared[id].keys()];
    if (own.length !== names.length || own.some((n) => !declared[themable[0]].has(n))) throw new Error(`${id} declares a different variable set from ${themable[0]}`);
  }
  const varying = names.filter((n) => !emitted.has(n) && themable.some((id) => declared[id].get(n) !== declared[themable[0]].get(n)));
  const nativeCss = {};
  for (const seedMode of [...new Set(counterparts.map((c) => c.seedMode))].sort()) {
    nativeCss[seedMode] = varying.map((n) => `${n}:${declared[seedMode].get(n)}`).join(";");
  }

  // Variables that follow an emitted one through var() in every themable mode need no baseline.
  const follows = (n) => themable.every((id) => {
    let value = declared[id].get(n);
    for (let hops = 0; hops < 8; hops++) {
      const ref = VAR.exec(value?.trim() ?? "");
      if (!ref) return false;
      if (emitted.has(ref[1])) return true;
      value = declared[id].get(ref[1]);
    }
    return false;
  });
  const inventory = {
    declared: [...names].sort(),
    emitted: [...emitted].filter((n) => names.includes(n)).sort(),
    emittedOutsideModes: [...emitted].filter((n) => !names.includes(n)).sort(),
    baseline: [...varying].sort(),
    follows: names.filter((n) => !emitted.has(n) && !varying.includes(n) && follows(n)).sort(),
    constant: names.filter((n) => !emitted.has(n) && !varying.includes(n) && !follows(n)).sort(),
  };
  return { index: { contractVersion: 1, modes, counterparts, nativeCss }, discovered, inventory };
}
