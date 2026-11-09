// Format checks behind check:schema, check:prompt, check:css, check:classic-themes and
// check:themes, routed by scripts/check-routes.mjs to this module's run. run takes {command, args,
// root, outDir} and resolves to {exitCode, testCount}, where testCount is the number of individual
// assertions evaluated. Node only. Direct use:
//   node packages/format/checks.mjs <schema|prompt|css|classic-themes|themes>
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANSI_ROLES,
  BODY_FONT_IDS,
  DEFAULT_THEME_ID,
  DIFF_ROLES,
  EFFECT_IDS,
  EXPANSION_VERSION,
  FLAVOR_SLOT_IDS,
  FONT_IDS,
  FONT_INVENTORY,
  HEADING_FONT_IDS,
  LEGACY_CLASSIC_THEME_IDS,
  LEGACY_THEME_ALIASES,
  LIMITS,
  OVERRIDE_COLOR_ROLES,
  RENDERER_VERSION,
  SANITIZER_VERSION,
  THEME_SCHEMA_URL,
  THEME_SYNTAX_ROLES,
} from "../contracts/index.js";
import { ANIME_CATALOG, CLASSICS_CATALOG, catalogProblems, exportTheme, makeAiPrompt, parseImport, sanitizeCss, validateTheme } from "./index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "../..");
// The reviewed public schema. Changing the schema file is a contract change; update this hash
// only with that review.
export const REVIEWED_SCHEMA_SHA256 = "9cf356d3d97ef3463b075764fb1db63cebe4683d7d34a8205939492292b76d00";
// AI-PROMPT.md caps the copyable prompt at 16 KiB of UTF-8.
const MAX_PROMPT_BYTES = 16384;
// Schema input-limit names that LIMITS spells differently.
const LIMIT_ALIASES = { customSourcesBytes: "maxCustomSourceBytes", draftBytes: "maxDraftBytes", allStorageBytes: "maxStorageBytes", shareLinkCharacters: "maxShareLinkCharacters" };

function tally(name) {
  const failures = [];
  let count = 0;
  const check = (ok, message) => {
    count++;
    if (!ok) failures.push(message);
    return ok;
  };
  const done = () => {
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    console.log(`${name}: ${count} checks, ${failures.length} failed`);
    return { exitCode: failures.length ? 1 : 0, testCount: count };
  };
  return { check, done };
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Manifest paths under valid/invalid/repair live in tests/fixtures/schema; the rest in tests/fixtures.
export function fixturePath(root, file) {
  return /^(valid|invalid|repair)\//.test(file) ? join(root, "tests/fixtures/schema", file) : join(root, "tests/fixtures", file);
}

async function checkSchema(root) {
  const { check, done } = tally("check:schema");
  const { generated, createAjv, SCHEMA_PATH } = await import("./generate.mjs");
  const bytes = readFileSync(SCHEMA_PATH);
  const schema = JSON.parse(bytes);
  check(createHash("sha256").update(bytes).digest("hex") === REVIEWED_SCHEMA_SHA256, `${relative(root, SCHEMA_PATH)} differs from the reviewed schema ${REVIEWED_SCHEMA_SHA256}`);
  check(schema.$id === THEME_SCHEMA_URL, "schema $id differs from contracts THEME_SCHEMA_URL");
  check(schema.properties.$schema.const === THEME_SCHEMA_URL, "the $schema hint const differs from the schema $id");

  // Meta-validation and the standalone validator agree with a runtime-compiled Ajv.
  const ajv = await createAjv();
  const runtime = ajv.compile(schema);
  check(ajv.validateSchema(schema), "schema fails Draft 2020-12 meta-validation");
  for (const [path, text] of Object.entries(await generated())) check(readFileSync(path, "utf8") === text, `${relative(root, path)} is out of date; run node packages/format/generate.mjs`);

  // Contract registries match the schema's enums.
  check(same(schema.properties.fonts.properties.accent.enum, HEADING_FONT_IDS), "HEADING_FONT_IDS differ from the schema's accent fonts");
  check(same(schema.properties.fonts.properties.heading.enum, HEADING_FONT_IDS), "HEADING_FONT_IDS differ from the schema's heading fonts");
  check(same(schema.properties.fonts.properties.body.enum, BODY_FONT_IDS), "BODY_FONT_IDS differ from the schema's body fonts");
  check(FONT_IDS.every((id) => HEADING_FONT_IDS.includes(id)), "a bundled font is missing from the schema");
  check(same(Object.keys(schema.properties.code.properties.ansi.properties), ANSI_ROLES), "ANSI_ROLES differ from the schema");
  check(same(Object.keys(schema.$defs.diff.properties), DIFF_ROLES), "DIFF_ROLES differ from the schema");
  check(schema["x-reskin"].expansionVersion === EXPANSION_VERSION && schema["x-reskin"].sanitizerVersion === SANITIZER_VERSION, "expansion or sanitizer version differs from the schema");
  check(same(Object.keys(schema.properties.effects.properties), EFFECT_IDS), "EFFECT_IDS differ from the schema");
  check(same(Object.keys(schema.properties.flavor.properties.slots.properties), FLAVOR_SLOT_IDS), "FLAVOR_SLOT_IDS differ from the schema");
  check(same(Object.keys(schema.properties.overrides.properties).filter((k) => k !== "syntax"), OVERRIDE_COLOR_ROLES), "OVERRIDE_COLOR_ROLES differ from the schema");
  check(same(Object.keys(schema.$defs.syntax.properties), THEME_SYNTAX_ROLES), "THEME_SYNTAX_ROLES differ from the schema");
  for (const [key, value] of Object.entries(schema["x-reskin"].inputLimits)) {
    const name = LIMIT_ALIASES[key] ?? key;
    check(LIMITS[name] === value, `LIMITS.${name} is ${LIMITS[name]}, schema says ${value}`);
  }
  check(LIMITS.cssUtf8Bytes === schema["x-reskin"].cssPolicy.sourceUtf8Bytes && LIMITS.maxBackgroundLayers === schema["x-reskin"].cssPolicy.maxBackgroundLayers, "CSS limits differ from the schema's cssPolicy");
  check(LIMITS.maxEffectsPerTheme === schema.properties.effects.maxProperties, "LIMITS.maxEffectsPerTheme differs from the schema");
  check(RENDERER_VERSION === schema["x-reskin"].rendererVersion, "RENDERER_VERSION differs from the schema");

  const classify = (label, value, expectValid, expectPath) => {
    const result = validateTheme(value);
    check(result.ok === runtime(value), `${label}: the standalone validator and runtime Ajv disagree`);
    if (expectValid) check(result.ok, `${label} should be valid: ${result.issues?.map((i) => `${i.path} ${i.message}`).join("; ")}`);
    else check(!result.ok && result.issues.some((i) => i.path === expectPath), `${label} should be rejected at ${expectPath}; got ${result.ok ? "valid" : result.issues.map((i) => i.path).join(", ")}`);
  };
  const manifest = readJson(join(root, "tests/fixtures/schema/manifest.json"));
  for (const file of manifest.valid) classify(file, readJson(fixturePath(root, file)), true);
  for (const { file, path } of manifest.invalid) classify(file, readJson(fixturePath(root, file)), false, path);
  for (const { file } of [...manifest.repair, ...manifest.roundtrip]) classify(file, readJson(fixturePath(root, file)), true);
  schema.examples.forEach((example, i) => classify(`schema example ${i}`, example, true));
  const minimal = schema.examples[0];
  for (const id of EFFECT_IDS) classify(`effect ${id} with defaults`, { ...minimal, effects: { [id]: {} } }, true);
  for (const id of HEADING_FONT_IDS) classify(`heading font ${id}`, { ...minimal, fonts: { heading: id, accent: id } }, true);
  for (const id of BODY_FONT_IDS) classify(`body font ${id}`, { ...minimal, fonts: { body: id } }, true);
  classify("a heading-only family as body font", { ...minimal, fonts: { body: "rajdhani" } }, false, "/fonts/body");
  for (const id of FLAVOR_SLOT_IDS) classify(`slot ${id}`, { ...minimal, flavor: { slots: { [id]: "Plain words" } } }, true);

  // Import fixtures: prose-wrapped JSONC is one theme with notes; duplicate keys never preview.
  for (const { file, expect } of manifest.import) {
    const result = parseImport(readFileSync(fixturePath(root, file), "utf8"), "text");
    if (/^one normalized valid theme/.test(expect)) {
      check(result.ok, `${file} should import: ${result.issues?.map((i) => i.message).join("; ")}`);
      check(result.ok && ["wrapper", "jsonc"].every((code) => result.notes.some((n) => n.code === code)), `${file} should carry wrapper and JSONC notes`);
    } else check(!result.ok && result.issues.some((i) => i.code === "duplicate-key") && !result.candidates, `${file} should fail with duplicate-key and no preview`);
  }
  return done();
}

async function checkPrompt(root) {
  const { check, done } = tally("check:prompt");
  const { promptModule, promptText, offeredFonts, PROMPT_TEMPLATE_PATH, IDEA_PLACEHOLDER, EXAMPLE_PATH } = await import("../../scripts/generate-prompt.mjs");
  check(readFileSync(PROMPT_TEMPLATE_PATH, "utf8") === promptModule(), `${relative(root, PROMPT_TEMPLATE_PATH)} is out of date; run node scripts/generate-prompt.mjs`);
  // Generated from the registries, the prompt reproduces AI-PROMPT.md's contract text exactly.
  check(promptText() === readFileSync(join(root, "tests/fixtures/prompt/ai-prompt-r41.txt"), "utf8"), "the generated prompt differs from the AI-PROMPT.md contract text");
  const prompt = makeAiPrompt("rain on a midnight train window");
  check(prompt.endsWith("My idea: rain on a midnight train window"), "the idea is not placed at the end");
  check(!prompt.includes(IDEA_PLACEHOLDER), "the placeholder survives substitution");
  const bytes = Buffer.byteLength(makeAiPrompt("x".repeat(500)));
  check(bytes <= MAX_PROMPT_BYTES, `prompt is ${bytes} UTF-8 bytes with a full idea, limit ${MAX_PROMPT_BYTES}`);
  check(!/https?:|www\./i.test(makeAiPrompt()), "prompt contains a URL");
  for (const id of [...offeredFonts("heading"), ...offeredFonts("body"), ...EFFECT_IDS, ...FLAVOR_SLOT_IDS, ...THEME_SYNTAX_ROLES, ...ANSI_ROLES, ...DIFF_ROLES]) check(prompt.includes(id), `prompt omits ${id}`);
  // The prompt offers only what this increment admits and names nothing deferred.
  const listed = ["Heading", "Body"].flatMap((role) => new RegExp(`${role} IDs: ([^.]+)\\.`).exec(prompt)?.[1].split(", ") ?? []);
  const exampleFonts = Object.values(JSON.parse(readFileSync(EXAMPLE_PATH, "utf8")).fonts ?? {});
  for (const id of [...listed, ...exampleFonts]) check(!FONT_INVENTORY.deferred.includes(id), `prompt offers the deferred font ${id}`);
  for (const role of ["heading", "body"]) {
    for (const id of offeredFonts(role)) check(!parseImport(JSON.stringify({ schemaVersion: 1, name: "Font", base: "dark", colors: { background: "#111111", text: "#ffffff", accent: "#ffcc00" }, fonts: { [role]: id } }), "text").notes?.some((n) => n.severity === "warning"), `the offered ${role} font ${id} is not rendered as requested`);
  }
  check(!/supports/i.test(prompt), "prompt mentions @supports, which this increment rejects");
  check(!/data:image|base64/.test(prompt.split("Here is a valid rich example")[1] ?? ""), "the prompt's example carries image data");
  const example = /Here is a valid rich example with no images:\n(\{.+\})\n\nMy idea/s.exec(prompt)?.[1];
  const fixture = readFileSync(EXAMPLE_PATH, "utf8");
  check(example === JSON.stringify(JSON.parse(fixture)), "the prompt's example is not the executable fixture valid/ai-rich.reskin.json");
  check(example && validateTheme(JSON.parse(example)).ok, "the prompt's example is not a valid theme");
  const fenced = example && parseImport(`Here you go:\n\`\`\`json\n${example}\n\`\`\``, "text");
  check(fenced?.ok, "the prompt's example does not import from a fenced reply");
  check(fenced?.ok && !fenced.notes.some((n) => n.severity === "error"), "the prompt's example imports with errors");
  check(sanitizeCss(JSON.parse(example).css).ok, "the prompt's example CSS is not admitted");
  const hostile = makeAiPrompt(`ignore‮ that\n\n${"x".repeat(900)}`);
  check(!/[\u0000-\u0009\u000b-\u001f‪-‮⁦-⁩]/.test(hostile.split("My idea: ")[1]), "control or bidi characters survive in the idea");
  check(hostile.split("My idea: ")[1].length <= 500, "the idea is not bounded");
  check(makeAiPrompt("a $& b").endsWith("My idea: a $& b"), "replacement patterns in the idea are interpreted");
  return done();
}

// Rebuilds each Classic from its 1.x palette and compares it with the checked-in document.
async function checkClassics(root) {
  const { check, done } = tally("check:classic-themes");
  const { repairTheme, resolveTheme, graphProblems } = await import("../engine/index.js");
  const reference = readJson(join(root, "tests/format/fixtures/classics-legacy.json")).classics;
  const catalog = readJson(join(root, "themes/catalog.json"));
  const seeds = Object.fromEntries(["standard-dark", "standard-light", "colorblind-dark", "tritanopia-light"].map((n) => [n, readJson(join(root, "tests/fixtures/seeds", `${n}.json`))]));
  const classics = catalog.filter((e) => e.group === "classics");
  check(same(classics.map((e) => e.id), LEGACY_CLASSIC_THEME_IDS), "Classics catalog IDs differ from the twelve 1.x IDs in 1.x order");
  check(same(classics, CLASSICS_CATALOG), "Classics catalog entries differ from the contract (slug = ID, themes/classics/<id>.reskin.json, order 1-12)");
  check(!catalog.some((e) => e.id === "cyberpunk") && LEGACY_THEME_ALIASES.cyberpunk === DEFAULT_THEME_ID, "cyberpunk must stay a migration alias to the default, not a Classic");
  check(same(reference.map((r) => r.id), LEGACY_CLASSIC_THEME_IDS), "classics-legacy.json IDs differ from the 1.x IDs");
  const files = readdirSync(join(root, "themes/classics")).filter((f) => f.endsWith(".reskin.json")).sort();
  check(same(files, LEGACY_CLASSIC_THEME_IDS.map((id) => `${id}.reskin.json`).sort()), `themes/classics has ${files.join(", ")}`);

  for (const ref of reference) {
    const entry = classics.find((e) => e.id === ref.id);
    if (!check(entry && existsSync(join(root, entry.file)), `${ref.id} has no document`)) continue;
    const bytes = readFileSync(join(root, entry.file));
    const doc = JSON.parse(bytes);
    check(validateTheme(doc).ok, `${ref.id} is not schema-valid`);
    check(doc.name === ref.name, `${ref.id} name ${doc.name} should be ${ref.name}`);
    check(doc.description === ref.credit, `${ref.id} lost its attribution`);
    const p = ref.palette;
    const base = doc.base;
    const original = {
      $schema: THEME_SCHEMA_URL,
      schemaVersion: 1,
      name: ref.name,
      description: ref.credit,
      tags: ["classic", base],
      base,
      colors: { background: p.bg, text: p.text, accent: p.accent, contribution: p.graph },
      ...(p.surface ? { overrides: { surface: p.surface, border: p.border, mutedText: p.muted } } : {}),
    };
    const repaired = repairTheme(original, seeds[`standard-${base}`]);
    check(Buffer.from(exportTheme(repaired.theme).bytes).equals(bytes), `${entry.file} differs from its repaired 1.x palette`);
    check(same(repaired.repairs.map(({ path, before, after }) => ({ path, before, after })), ref.sourceRepairs), `${ref.id} source repairs differ from the documented list`);
    check(repairTheme(doc, seeds[`standard-${base}`]).repairs.length === 0, `${ref.id} is not at its repair fixed point`);
    for (const seed of Object.values(seeds).filter((s) => s.base === base)) {
      const resolved = resolveTheme(doc, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
      const failed = resolved.pairAudit.filter((r) => !r.passed);
      check(!failed.length, `${ref.id} on ${seed.id}: ${failed.map((r) => `${r.id}@${r.background} ${r.ratio.toFixed(2)}`).join(", ")}`);
      check(!graphProblems(resolved.graph, resolved.tokens.canvas, base === "dark" ? "up" : "down").length, `${ref.id} on ${seed.id}: graph ramp invalid`);
      console.log(`  ${ref.id} on ${seed.id}: ${resolved.repairs.length} preview adjustments${resolved.repairs.length ? ` (${resolved.repairs.map((r) => r.path.split("/").slice(-2).join(".")).join(", ")})` : ""}`);
    }
  }
  return done();
}

// The full catalog gate. Passes only once S1 has added all thirteen anime documents.
async function checkThemes(root) {
  const { check, done } = tally("check:themes");
  const catalog = readJson(join(root, "themes/catalog.json"));
  for (const problem of catalogProblems(catalog)) check(false, problem);
  const anime = catalog.filter((e) => e.group === "anime");
  check(anime.length === 13, `catalog has ${anime.length} anime entries; 13 are required`);
  check(catalog.filter((e) => e.group === "classics").length === 12, "catalog needs the 12 Classics");
  check(same(anime.map(({ id, slug, file, order }) => ({ id, slug, file, order })), ANIME_CATALOG.map(({ id, slug, file, order }) => ({ id, slug, file, order }))), "anime entries differ from the stable ID/slug mapping");
  check(anime.some((e) => e.id === DEFAULT_THEME_ID), `the default ${DEFAULT_THEME_ID} is missing`);
  for (const group of ["anime", "classics"]) {
    const dir = join(root, "themes", group);
    const listed = new Set(catalog.filter((e) => e.group === group).map((e) => e.file));
    for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : []) check(listed.has(`themes/${group}/${file}`), `themes/${group}/${file} is not in the catalog`);
  }
  for (const entry of catalog) {
    if (!check(existsSync(join(root, entry.file)), `${entry.file} is missing`)) continue;
    const doc = readJson(join(root, entry.file));
    const result = validateTheme(doc);
    check(result.ok, `${entry.file}: ${result.issues?.map((i) => `${i.path} ${i.message}`).join("; ")}`);
    if (result.ok && typeof doc.css === "string") {
      const css = sanitizeCss(doc.css);
      check(css.ok && css.value.css === doc.css, `${entry.file}: bundled CSS must be stored in its canonical sanitized form`);
    }
    if (entry.group !== "anime") continue;
    check(typeof doc.inspiredBy === "string" && !/^inspired by /i.test(doc.inspiredBy), `${entry.file} needs an inspiredBy credit without the "inspired by" prefix`);
    const effects = Object.keys(doc.effects ?? {}).length;
    check(effects >= 2 && effects <= 3, `${entry.file} has ${effects} effects; anime themes have 2-3`);
    check(Array.isArray(doc.contributions?.levels), `${entry.file} needs a graph palette`);
    check(doc.flavor && Object.keys(doc.flavor.slots ?? {}).length > 0, `${entry.file} needs flavor copy`);
  }
  return done();
}

async function checkCss(root) {
  const { runCssChecks } = await import("./css/checks-css.mjs");
  return runCssChecks(root, tally("check:css"));
}

const COMMANDS = { schema: checkSchema, prompt: checkPrompt, css: checkCss, "classic-themes": checkClassics, themes: checkThemes };

/** @param {{command:string, args?:string[], root?:string, outDir?:string}} options */
export async function run({ command, args = [], root = DEFAULT_ROOT }) {
  if (!Object.hasOwn(COMMANDS, command)) {
    console.error(`packages/format/checks.mjs has no ${command} check. Checks: ${Object.keys(COMMANDS).join(", ")}`);
    return { exitCode: 2, testCount: 0 };
  }
  if (args.length) {
    console.error(`check:${command} takes no arguments; got ${args.join(" ")}`);
    return { exitCode: 2, testCount: 0 };
  }
  return COMMANDS[command](root);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, ...args] = process.argv.slice(2);
  const { exitCode } = await run({ command, args, root: process.cwd() });
  process.exitCode = exitCode;
}
