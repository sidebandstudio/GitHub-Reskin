// The audits behind check:fonts and check:effects, shared with the unit tests. Each returns
// { problems: string[], count } where count is the number of assertions made. Node only.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { FLAVOR_SLOT_IDS, FONT_IDS } from "../contracts/index.js";
import { repairTheme, resolveTheme } from "../engine/index.js";
import { BOX_EFFECTS, EFFECTS, FONTS, LIMITS, compileAppearance, effectCss, fontFaceCss, planAppearance, registryProblems } from "./index.js";
import { EFFECT_PARAMETERS } from "./registry.js";
import { codePoints, hasLowercaseForms, names, readWoff2, weightClass } from "./woff2.mjs";
import { SLOTS } from "../../extension/content/github/selectors.js";

// The slots one GitHub page can hold. The adapter places each slot on one route class, so the
// worst case for a document is every slot of one route at once, never all of them.
export const PAGE_SLOTS = Object.values(Object.groupBy(SLOTS, (def) => def.route)).map((defs) => defs.map((def) => def.slot));

function tally() {
  const problems = [];
  let count = 0;
  const check = (ok, message) => {
    count++;
    if (!ok) problems.push(message);
    return ok;
  };
  return { problems, check, result: () => ({ problems, count }) };
}

// Printable ASCII must be complete, except a sign upstream never drew: Orbitron has no circumflex
// accent. Some upstream families also lack a few Latin-1 signs (Rajdhani has no currency sign,
// Cormorant no micro sign); the unicode-range and font stack fall back natively, per character.
const REQUIRED_RANGE = [[0x20, 0x7e]];
const UPSTREAM_GAPS = { orbitron: [0x5e] };
const FONT_FILES = new Set(["acquire.py", "provenance.json", "README.md"]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (list) => [...(list ?? [])].sort();

/**
 * The bundled fonts: every family the schema registers, one file per reviewed weight, the file,
 * family and total budgets, licenses, Reserved Font Names, provenance hashes, weights, coverage
 * and names.
 */
export async function fontAudit(root) {
  const { check, result } = tally();
  const dir = join(root, "assets/fonts");
  const schema = JSON.parse(await readFile(join(root, "packages/format/theme-v1.schema.json"), "utf8"))["x-reskin"];
  const budget = schema.fontBudget;
  const provenance = JSON.parse(await readFile(join(dir, "provenance.json"), "utf8"));
  const recorded = Object.fromEntries(provenance.fonts.map((font) => [font.id, font]));
  check(provenance.subset.replace(/\s/g, "") === budget.subset.replace(/^Latin\s*/, "").replace(/\s/g, ""), "provenance subset differs from the schema's");
  const bundled = FONT_IDS.filter((id) => id !== "system");
  check(same(FONTS.map((font) => font.id), bundled), `the registry's ${FONTS.length} families differ from the bundled set of ${bundled.length}`);
  check(same(schema.fonts.map((font) => font.id), bundled), "the schema registers a family that is not bundled");
  check(FONTS.length === budget.families, `${FONTS.length} families, the schema budgets ${budget.families}`);
  check(same(provenance.fonts.map((font) => font.id), bundled), "provenance.json does not record exactly the bundled families");
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    check(entry.isDirectory() ? FONTS.some((font) => font.id === entry.name) : FONT_FILES.has(entry.name), `unexpected assets/fonts/${entry.name}`);
  }
  let total = 0;
  for (const font of FONTS) {
    const spec = schema.fonts.find((f) => f.id === font.id);
    check(spec && spec.family === font.family && spec.weight === font.weight && spec.minimumAccentPx === font.minimumAccentPx && same(spec.weights ?? [spec.weight], font.weights), `${font.id} differs from the schema registry`);
    const record = recorded[font.id];
    check(same(sorted(record?.weights), sorted(font.weights)) && same(sorted(record?.files?.map((f) => `assets/fonts/${f.file}`)), sorted(font.files.map((f) => f.path))), `${font.id} files differ from provenance.json`);
    const held = existsSync(join(dir, font.id)) ? (await readdir(join(dir, font.id))).sort() : [];
    check(same(held, [...font.files.map((f) => f.path.split("/").pop()), "OFL.txt"].sort()), `assets/fonts/${font.id} holds ${held.join(", ")}`);
    const license = await readFile(join(root, font.license), "utf8").catch(() => "");
    check(/SIL OPEN FONT LICENSE Version 1\.1/.test(license) && /^Copyright/m.test(license), `${font.license} is not the family's OFL 1.1 notice`);
    check(record?.licenseSha256 === createHash("sha256").update(license).digest("hex"), `${font.license} does not match provenance.json`);
    // The notice's header declares any Reserved Font Name; the subset must not carry it.
    const reserved = /Reserved Font Name:?\s*["'\u2018\u201c]([^"'\u2019\u201d]+)/.exec(license.split("SIL OPEN FONT LICENSE")[0])?.[1] ?? null;
    check(Boolean(reserved) === Boolean(record?.reservedFontName) && (!reserved || reserved.includes(record.reservedFontName)), `${font.id} records Reserved Font Name ${record?.reservedFontName}, its notice declares ${reserved}`);
    let bytesInFamily = 0;
    for (const file of font.files) {
      const label = `${font.id} ${file.weight}`;
      const path = join(root, file.path);
      if (!check(existsSync(path), `${file.path} is missing`)) continue;
      const bytes = await readFile(path);
      bytesInFamily += bytes.length;
      check(bytes.length <= budget.maxPerFileBytes, `${file.path} is ${bytes.length} bytes, over ${budget.maxPerFileBytes}`);
      const entry = record?.files?.find((f) => `assets/fonts/${f.file}` === file.path);
      check(entry?.weight === file.weight && entry.sha256 === createHash("sha256").update(bytes).digest("hex") && entry.bytes === bytes.length, `${file.path} does not match provenance.json`);
      check(/^[0-9a-f]{40}$/.test(record?.commit ?? "") && entry?.source?.url === `https://raw.githubusercontent.com/google/fonts/${record.commit}/${entry.source.path}` && entry.source.path.startsWith("ofl/") && /^[0-9a-f]{64}$/.test(entry.source.sha256 ?? ""), `${file.path} provenance lacks a pinned google/fonts source and hash`);
      let tables;
      try {
        tables = readWoff2(bytes);
      } catch (error) {
        check(false, `${label}: ${error.message}`);
        continue;
      }
      check(weightClass(tables) === file.weight, `${label} has weight class ${weightClass(tables)}`);
      // The registry's capsOnly flag is what the glyphs draw, so authored text never meets a face
      // that reads it in capitals.
      let lowercase = null;
      try {
        lowercase = hasLowercaseForms(tables);
      } catch (error) {
        check(false, `${label}: ${error.message}`);
      }
      if (lowercase !== null) check(lowercase === !font.capsOnly, `${label} ${lowercase ? "draws lowercase forms" : "has no lowercase forms"}, but the registry's capsOnly is ${font.capsOnly}`);
      const points = codePoints(tables);
      const missing = REQUIRED_RANGE.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)).filter((c) => !points.has(c) && !UPSTREAM_GAPS[font.id]?.includes(c));
      check(!missing.length, `${label} lacks ${missing.length} Latin code points, first U+${missing[0]?.toString(16)}`);
      check([...points].every((c) => c < 0x2100 || c === 0x20ac), `${label} carries glyphs outside the Latin subset`);
      const familyNames = names(tables).filter((n) => [1, 3, 4, 6, 16, 17, 21, 22].includes(n.nameID)).map((n) => n.value);
      if (record?.reservedFontName) check(!familyNames.some((n) => n.toLowerCase().includes(record.reservedFontName.toLowerCase())), `${label} still carries its Reserved Font Name`);
      check(names(tables).some((n) => n.nameID === 0 && /Copyright|\u00a9/.test(n.value)), `${label} lost its copyright record`);
      check(fontFaceCss(font.id, `/${file.path}`, file.weight).includes(`font-weight:${file.weight}`), `${label} @font-face weight`);
    }
    check(bytesInFamily <= Math.min(budget.maxPerFamilyBytes, spec?.maxBytes ?? 0), `${font.id} is ${bytesInFamily} bytes, over ${Math.min(budget.maxPerFamilyBytes, spec?.maxBytes ?? 0)}`);
    check(record?.bytes === bytesInFamily, `${font.id} family bytes in provenance.json are stale`);
    total += bytesInFamily;
  }
  check(total <= budget.totalWoff2Bytes, `fonts total ${total} bytes, over ${budget.totalWoff2Bytes}`);
  check(provenance.totalBytes === total, "provenance totalBytes is stale");
  return { ...result(), total, families: FONTS.length, files: FONTS.reduce((n, font) => n + font.files.length, 0) };
}

// Distinct colors per role, so every color in effect CSS can be traced to the role it came from.
const ROLE_COLORS = { accent: "#a10001", mutedText: "#a20002", primaryBackground: "#a30003", border: "#a40004", canvas: "#a50005" };
const triplet = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
const FORBIDDEN_CSS = [/url\(/i, /@import/i, /filter\s*:/i, /infinite/i, /blur\(/i, /expression\(/i, /javascript:/i, /position\s*:\s*fixed/i, /#[0-9a-f]{3,8}\b/i, /var\(--(?!rs-lift)/];

function parameterCases(id) {
  const spec = EFFECT_PARAMETERS[id];
  const cases = [];
  const enums = Object.entries(spec).filter(([, rule]) => rule.enum);
  const numbers = Object.entries(spec).filter(([, rule]) => !rule.enum);
  const choices = enums.length ? enums[0][1].enum : [null];
  for (const choice of choices) {
    for (const pick of ["minimum", "default", "maximum"]) {
      const params = Object.fromEntries(numbers.map(([name, rule]) => [name, rule[pick]]));
      if (enums.length) params[enums[0][0]] = choice;
      cases.push(params);
    }
  }
  return cases;
}

/** Every effect template at every shape and at its parameter bounds. */
export function templateAudit() {
  const { check, result } = tally();
  for (const problem of registryProblems()) check(false, problem);
  for (const id of Object.keys(EFFECTS)) {
    const allowed = new Set(EFFECTS[id].colors.map((role) => triplet(ROLE_COLORS[role])));
    for (const params of parameterCases(id)) {
      const css = effectCss(id, params, ROLE_COLORS).join("\n");
      const label = `${id} ${JSON.stringify(params)}`;
      for (const pattern of FORBIDDEN_CSS) check(!pattern.test(css), `${label} contains ${pattern}`);
      for (const [, color] of css.matchAll(/rgb\((\d+ \d+ \d+) \//g)) check(allowed.has(color), `${label} uses a color outside ${EFFECTS[id].colors.join(", ")}`);
      check(/rgb\(/.test(css), `${label} draws nothing`);
      for (const [, body] of css.matchAll(/@keyframes [\w-]+\{((?:[^{}]*\{[^{}]*\})*)\}/g)) {
        for (const [, property] of body.matchAll(/([a-z-]+)\s*:/g)) check(property === "opacity" || property === "transform", `${label} animates ${property}`);
      }
      for (const [, ms] of css.matchAll(/animation:[\w-]+ (\d+)ms/g)) check(Number(ms) <= (id === "echo" ? LIMITS.maxEchoMs : LIMITS.maxAnimationMs), `${label} runs ${ms}ms`);
      for (const [, count] of css.matchAll(/animation:[^;}]*?ms [\w-]+ (\S+) /g)) check(count === "1", `${label} repeats ${count} times`);
      check(EFFECTS[id].motion || !/animation|@keyframes/.test(css), `${label} moves although it is static`);
      for (const [, side, px] of css.matchAll(/(width|height):(\d+)px/g)) check(Number(px) <= (side === "width" ? LIMITS.maxPatchWidthPx : LIMITS.maxPatchHeightPx), `${label} draws a ${px}px ${side}`);
    }
  }
  return result();
}

const PREFS = { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true };

/** Resolves documents against the synthetic standard seeds and audits their compiled appearance. */
export async function themeAudit(root, documents) {
  const { check, result } = tally();
  const seeds = {};
  for (const base of ["light", "dark"]) seeds[base] = JSON.parse(await readFile(join(root, `tests/fixtures/seeds/standard-${base}.json`), "utf8"));
  for (const [label, theme] of documents) {
    const seed = seeds[theme.base];
    let resolved;
    try {
      resolved = resolveTheme(repairTheme(theme, seed).theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
    } catch (error) {
      check(false, `${label}: ${error.message}`);
      continue;
    }
    const css = compileAppearance(resolved, PREFS, "github");
    check(css === compileAppearance(resolved, PREFS, "github"), `${label} compiles differently twice`);
    const preview = compileAppearance(resolved, PREFS, "preview");
    check(css.replace(/!important/g, "") === preview.replace(/!important/g, ""), `${label} differs between the github and preview targets beyond !important`);
    for (const pattern of FORBIDDEN_CSS.slice(0, 8)) check(!pattern.test(css), `${label} compiled CSS contains ${pattern}`);
    check(!/@keyframes/.test(compileAppearance(resolved, { ...PREFS, motion: false }, "github")), `${label} keeps keyframes with Motion off`);
    const reduced = resolveTheme(repairTheme(theme, seed).theme, { seed, policy: "themed", reducedMotion: true, forcedColors: false });
    check(!/@keyframes/.test(compileAppearance(reduced, PREFS, "github")), `${label} keeps keyframes under reduced motion`);
    check(!/\.rs-fx-/.test(compileAppearance(resolved, { ...PREFS, effects: false }, "github")), `${label} keeps effects with Effects off`);
    // Calm keeps solid paints, simple avatar corners and the role fonts, and draws no decoration.
    const calm = compileAppearance(resolved, { ...PREFS, extras: false }, "github");
    check(!/\.rs-|data-reskin-owned|gradient\(|0 0 12px/.test(calm), `${label} keeps decoration in Calm`);
    check(compileAppearance(resolved, { ...PREFS, enabled: false }, "github") === "", `${label} keeps decoration with the extension off`);
    const native = resolveTheme(theme, { seed: null, policy: "native-high-contrast", reducedMotion: false, forcedColors: false });
    check(compileAppearance(native, PREFS, "github") === "", `${label} decorates a native high-contrast island`);
    for (const motion of [true, false]) {
      for (const slots of PAGE_SLOTS) {
        const plan = planAppearance(resolved, { ...PREFS, motion }, slots);
        check(plan.owned <= LIMITS.maxOwnedNodes, `${label} plans ${plan.owned} owned nodes`);
        check(plan.animated <= LIMITS.maxAnimatedNodes, `${label} plans ${plan.animated} animated nodes`);
        check(motion || plan.animated === 0, `${label} animates with Motion off`);
        const textSlots = slots.filter((slot) => resolved.flavor.enabled && resolved.flavor.slots[slot]);
        check(textSlots.every((slot) => plan.slots.some((entry) => entry.slot === slot && entry.copy)), `${label} drops flavor copy for decoration`);
      }
    }
    for (const id of Object.keys(resolved.effects)) check(BOX_EFFECTS.strip.includes(id), `${label} requests ${id}, which no box draws`);
  }
  return result();
}

/** Theme documents to audit: the bundled catalog, the synthetic load themes and any extra directories. */
export async function auditDocuments(root, extraDirs = []) {
  const documents = [];
  const catalog = JSON.parse(await readFile(join(root, "themes/catalog.json"), "utf8"));
  for (const entry of catalog) if (existsSync(join(root, entry.file))) documents.push([entry.id, JSON.parse(await readFile(join(root, entry.file), "utf8"))]);
  documents.push(...loadThemes(documents.find(([id]) => id === "dracula")?.[1]));
  for (const dir of extraDirs) {
    for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json")).sort()) documents.push([name, JSON.parse(await readFile(join(dir, name), "utf8"))]);
  }
  return documents;
}

// Every three-effect combination at maximum parameters, with every slot string: the worst case
// for node counts and motion.
export function loadThemes(base) {
  if (!base) return [];
  const ids = Object.keys(EFFECTS);
  const max = (id) => Object.fromEntries(Object.entries(EFFECT_PARAMETERS[id]).map(([name, rule]) => [name, rule.enum ? rule.enum.at(-1) : rule.maximum]));
  const slots = Object.fromEntries(FLAVOR_SLOT_IDS.map((slot) => [slot, "Load test"]));
  const out = [];
  for (let a = 0; a < ids.length; a++)
    for (let b = a + 1; b < ids.length; b++)
      for (let c = b + 1; c < ids.length; c++) {
        const effects = Object.fromEntries([ids[a], ids[b], ids[c]].map((id) => [id, max(id)]));
        out.push([`load ${ids[a]}+${ids[b]}+${ids[c]}`, { ...base, name: "Load test", fonts: { accent: "bungee" }, effects, flavor: { enabled: true, locale: "en", slots } }]);
      }
  return out;
}
