import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EFFECT_IDS, FONT_IDS, FLAVOR_SLOT_IDS, ISSUE_CODES } from "../../packages/contracts/index.js";
import { REVIEWED_SCHEMA_SHA256, fixturePath } from "../../packages/format/checks.mjs";
import { createAjv, generated, SCHEMA_PATH } from "../../packages/format/generate.mjs";
import { SCHEMA_SHA256, validateTheme } from "../../packages/format/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = json(`${ROOT}tests/fixtures/schema/manifest.json`);
const schema = json(SCHEMA_PATH);
const minimal = schema.examples[0];

test("the bundled schema is the reviewed copy and the generated files are current", async () => {
  const hash = createHash("sha256").update(readFileSync(SCHEMA_PATH)).digest("hex");
  assert.equal(hash, REVIEWED_SCHEMA_SHA256);
  assert.equal(SCHEMA_SHA256, hash);
  for (const [path, text] of Object.entries(await generated())) assert.equal(readFileSync(path, "utf8"), text, `${path} is stale`);
});

test("the standalone validator has no runtime code generation or CommonJS", () => {
  const source = readFileSync(`${ROOT}packages/format/schema-validator.js`, "utf8");
  assert.doesNotMatch(source, /\brequire\(|\beval\(|new Function|Function\(/);
});

test("valid, repair and round-trip fixtures validate", () => {
  for (const file of [...manifest.valid, ...manifest.repair.map((r) => r.file), ...manifest.roundtrip.map((r) => r.file)]) {
    const result = validateTheme(json(fixturePath(ROOT, file)));
    assert.ok(result.ok, `${file}: ${JSON.stringify(result.issues)}`);
  }
});

test("every invalid fixture is rejected at its documented path", () => {
  const expectedCodes = {
    "/css": ISSUE_CODES.unknownField,
    "/schemaVersion": ISSUE_CODES.unsupportedVersion,
    "/fonts/accent": ISSUE_CODES.invalidValue,
    "/flavor/slots/repo.code": ISSUE_CODES.unknownField,
    "/effects/drift/count": ISSUE_CODES.outOfBounds,
    "/effects/echo/selector": ISSUE_CODES.unknownField,
    "/effects": ISSUE_CODES.outOfBounds,
    "/colors/background": ISSUE_CODES.invalidValue,
    "/name": ISSUE_CODES.markup,
    "/colors/text": ISSUE_CODES.invalidValue,
    "/contributions/levels": ISSUE_CODES.outOfBounds,
    "/overrides/primaryHoverBackground": ISSUE_CODES.unknownField,
  };
  for (const { file, path } of manifest.invalid) {
    const result = validateTheme(json(fixturePath(ROOT, file)));
    assert.equal(result.ok, false, file);
    const issue = result.issues.find((i) => i.path === path);
    assert.ok(issue, `${file} has no issue at ${path}: ${JSON.stringify(result.issues)}`);
    assert.equal(issue.code, expectedCodes[path], file);
    assert.equal(issue.severity, "error");
    assert.ok(issue.message.length > 10 && !/must NOT|additionalProperties/.test(issue.message), `${file} message reads like the validator: ${issue.message}`);
  }
});

test("standalone and runtime-compiled Ajv agree on every fixture and edge case", async () => {
  const runtime = (await createAjv()).compile(schema);
  const cases = [
    ...manifest.valid.map((f) => json(fixturePath(ROOT, f))),
    ...manifest.invalid.map(({ file }) => json(fixturePath(ROOT, file))),
    ...schema.examples,
    { ...minimal, name: "Trailing newline\n" },
    { ...minimal, name: "x".repeat(65) },
    { ...minimal, name: "😀".repeat(64) },
    { ...minimal, colors: { ...minimal.colors, background: "#F6F2E8" } },
    { ...minimal, tags: ["a", "a"] },
    { ...minimal, contributions: { levels: ["#000000", "#111111", "#222222", "#333333", "#333333"] } },
    { ...minimal, contributions: { levels: ["#000000", "#111111", "#222222", "#333333", "#444444", "#555555"] } },
    { ...minimal, version: "01.0.0" },
    { ...minimal, effects: { glow: { strength: 0.41 } } },
    { ...minimal, effects: { grid: { size: 32.5 } } },
    { ...minimal, flavor: { locale: "fr" } },
    { ...minimal, $schema: "https://example.com/schema.json" },
    null,
    [],
    "theme",
  ];
  for (const value of cases) assert.equal(validateTheme(value).ok, runtime(value), JSON.stringify(value));
});

test("names count code points and reject trailing newlines, control and bidi characters", () => {
  assert.ok(validateTheme({ ...minimal, name: "😀".repeat(64) }).ok);
  assert.equal(validateTheme({ ...minimal, name: "😀".repeat(65) }).ok, false);
  assert.equal(validateTheme({ ...minimal, name: "Moss\n" }).issues[0].code, ISSUE_CODES.controlText);
  assert.equal(validateTheme({ ...minimal, name: "Moss ‮" }).issues[0].code, ISSUE_CODES.controlText);
});

test("links and resource strings are rejected anywhere except the exact $schema hint", () => {
  for (const [key, value] of [
    ["description", "See https://example.com"],
    ["description", "visit www.example.org today"],
    ["author", "javascript:alert(1)"],
    ["inspiredBy", "data:text/html,hi"],
    ["description", "background: url(x)"],
  ]) {
    const result = validateTheme({ ...minimal, [key]: value });
    assert.equal(result.ok, false, value);
    assert.equal(result.issues[0].code, ISSUE_CODES.resourceString);
  }
  assert.ok(validateTheme({ ...minimal, $schema: schema.$id }).ok);
  assert.ok(validateTheme({ ...minimal, inspiredBy: "Cyberpunk: Edgerunners" }).ok);
  assert.ok(validateTheme({ ...minimal, description: "All about: quiet colors. File: notes." }).ok);
  assert.ok(validateTheme({ ...minimal, flavor: { slots: { "profile.tag": "//choom" } } }).ok);
});

test("every effect with defaults, every font ID and every flavor slot validates", () => {
  for (const id of EFFECT_IDS) assert.ok(validateTheme({ ...minimal, effects: { [id]: {} } }).ok, id);
  for (const id of FONT_IDS) assert.ok(validateTheme({ ...minimal, fonts: { accent: id } }).ok, id);
  for (const id of FLAVOR_SLOT_IDS) assert.ok(validateTheme({ ...minimal, flavor: { enabled: true, locale: "en", slots: { [id]: "Plain words" } } }).ok, id);
});

test("issues are deterministic, unique and ordered by path", () => {
  const bad = { schemaVersion: 1, name: "<b>", base: "dim", colors: { background: "red", text: "#12", accent: "#446851" }, css: "x", effects: { glow: {}, grid: {}, paper: {}, seal: {} } };
  const first = validateTheme(bad);
  assert.deepEqual(validateTheme(structuredClone(bad)), first);
  const paths = first.issues.map((i) => i.path);
  assert.deepEqual(paths, [...paths].sort());
  assert.equal(new Set(first.issues.map((i) => `${i.code} ${i.path}`)).size, first.issues.length);
});
