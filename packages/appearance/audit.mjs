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
import { codePoints, names, readWoff2, weightClass } from "./woff2.mjs";

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

// Printable ASCII must be complete. Some upstream families lack a few Latin-1 signs (Rajdhani has
// no currency sign, Cormorant no micro sign); the unicode-range and font stack fall back natively.
const REQUIRED_RANGE = [[0x20, 0x7e]];
const FONT_FILES = new Set(["acquire.py", "provenance.json", "README.md"]);

/** The bundled fonts: files, budget, licenses, provenance hashes, weights, coverage and names. */
export async function fontAudit(root) {
  const { check, result } = tally();
  const dir = join(root, "assets/fonts");
  const schema = JSON.parse(await readFile(join(root, "packages/format/theme-v1.schema.json"), "utf8"))["x-reskin"];
  const provenance = JSON.parse(await readFile(join(dir, "provenance.json"), "utf8"));
  const recorded = Object.fromEntries(provenance.fonts.map((font) => [font.id, font]));
  check(provenance.subset.replace(/\s/g, "") === schema.fontBudget.subset.replace(/^Latin\s*/, "").replace(/\s/g, ""), "provenance subset differs from the schema's");
  // The schema budgets every family a theme may name; this increment bundles only FONT_IDS.
  const bundled = FONT_IDS.filter((id) => id !== "system");
  check(FONTS.length === bundled.length && FONTS.every((font) => bundled.includes(font.id)), `${FONTS.length} families, the bundled set is ${bundled.length}`);
  check(FONTS.length <= schema.fontBudget.families, `${FONTS.length} families, schema allows ${schema.fontBudget.families}`);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    check(entry.isDirectory() ? FONTS.some((font) => font.id === entry.name) : FONT_FILES.has(entry.name), `unexpected assets/fonts/${entry.name}`);
  }
  let total = 0;
  for (const font of FONTS) {
    const spec = schema.fonts.find((f) => f.id === font.id);
    check(spec && spec.family === font.family && spec.weight === font.weight && spec.minimumAccentPx === font.minimumAccentPx, `${font.id} differs from the schema registry`);
    const path = join(root, font.path);
    if (!check(existsSync(path), `${font.path} is missing`)) continue;
    const bytes = await readFile(path);
    total += bytes.length;
    check(bytes.length <= schema.fontBudget.maxPerFamilyBytes, `${font.id} is ${bytes.length} bytes, over ${schema.fontBudget.maxPerFamilyBytes}`);
    const record = recorded[font.id];
    check(record?.sha256 === createHash("sha256").update(bytes).digest("hex") && record.bytes === bytes.length, `${font.id} does not match provenance.json`);
    check(/^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/[0-9a-f]{40}\/ofl\//.test(record?.source?.url ?? "") && /^[0-9a-f]{64}$/.test(record?.source?.sha256 ?? ""), `${font.id} provenance lacks a pinned google/fonts source and hash`);
    const license = await readFile(join(root, font.license), "utf8").catch(() => "");
    check(/SIL OPEN FONT LICENSE Version 1\.1/.test(license) && /^Copyright/m.test(license), `${font.license} is not the family's OFL 1.1 notice`);
    check(record?.licenseSha256 === createHash("sha256").update(license).digest("hex"), `${font.license} does not match provenance.json`);
    let tables;
    try {
      tables = readWoff2(bytes);
    } catch (error) {
      check(false, `${font.id}: ${error.message}`);
      continue;
    }
    check(weightClass(tables) === font.weight, `${font.id} weight ${weightClass(tables)}, registry ${font.weight}`);
    const points = codePoints(tables);
    const missing = REQUIRED_RANGE.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)).filter((c) => !points.has(c));
    check(!missing.length, `${font.id} lacks ${missing.length} Latin code points, first U+${missing[0]?.toString(16)}`);
    check([...points].every((c) => c < 0x2100 || c === 0x20ac), `${font.id} carries glyphs outside the Latin subset`);
    const familyNames = names(tables).filter((n) => [1, 3, 4, 6, 16, 17, 21, 22].includes(n.nameID)).map((n) => n.value);
    if (record?.reservedFontName) check(!familyNames.some((n) => /Josefin/i.test(n)), `${font.id} subset still carries its Reserved Font Name`);
    check(names(tables).some((n) => n.nameID === 0 && /Copyright/.test(n.value)), `${font.id} lost its copyright record`);
    check(fontFaceCss(font.id, `/${font.path}`).includes(`font-weight:${font.weight}`), `${font.id} @font-face weight`);
  }
  check(total <= schema.fontBudget.totalWoff2Bytes, `fonts total ${total} bytes, over ${schema.fontBudget.totalWoff2Bytes}`);
  check(provenance.totalBytes === total, "provenance totalBytes is stale");
  return { ...result(), total };
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
    check(compileAppearance(resolved, { ...PREFS, extras: false }, "github") === "", `${label} keeps decoration with Flavor extras off`);
    check(compileAppearance(resolved, { ...PREFS, enabled: false }, "github") === "", `${label} keeps decoration with the extension off`);
    const native = resolveTheme(theme, { seed: null, policy: "native-high-contrast", reducedMotion: false, forcedColors: false });
    check(compileAppearance(native, PREFS, "github") === "", `${label} decorates a native high-contrast island`);
    for (const motion of [true, false]) {
      const plan = planAppearance(resolved, { ...PREFS, motion }, FLAVOR_SLOT_IDS);
      check(plan.owned <= LIMITS.maxOwnedNodes, `${label} plans ${plan.owned} owned nodes`);
      check(plan.animated <= LIMITS.maxAnimatedNodes, `${label} plans ${plan.animated} animated nodes`);
      check(motion || plan.animated === 0, `${label} animates with Motion off`);
      const textSlots = FLAVOR_SLOT_IDS.filter((slot) => resolved.flavor.enabled && resolved.flavor.slots[slot]);
      check(textSlots.every((slot) => plan.slots.some((entry) => entry.slot === slot && entry.copy)), `${label} drops flavor copy for decoration`);
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

// Every three-effect combination at maximum parameters, with all eight slot strings: the worst
// case for node counts and motion.
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
