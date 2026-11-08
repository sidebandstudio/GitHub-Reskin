import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import jsonc from "jsonc-parser";
import { BUDGETS, ISSUE_CODES, LIMITS } from "../../packages/contracts/index.js";
import { colorsOnly, NOTE_CODES, normalizeTheme, parseImport, validateTheme, withoutForeignSchema } from "../../packages/format/index.js";
import { findObjectSpans, parseJson } from "../../packages/format/json.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const MINIMAL = '{"schemaVersion":1,"name":"Moss","base":"light","colors":{"background":"#f6f2e8","text":"#27372d","accent":"#446851"}}';
const codes = (result) => (result.ok ? result.notes : result.issues).map((i) => i.code);

test("prose-wrapped JSONC imports as one theme with wrapper and JSONC notes, keeping the source", () => {
  const input = readFileSync(`${ROOT}tests/fixtures/import/prose-jsonc.txt`, "utf8");
  const result = parseImport(input, "text");
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.source, input);
  assert.equal(result.normalized.name, "Tolerant moss");
  assert.deepEqual(codes(result), [NOTE_CODES.wrapper, NOTE_CODES.jsonc]);
  assert.ok(result.notes.every((n) => n.severity === "info" && typeof n.path === "string"));
  assert.deepEqual(Object.keys(result).sort(), ["normalized", "notes", "ok", "source"]);
});

test("duplicate keys fail before schema validation, with no preview or candidates", () => {
  const result = parseImport(readFileSync(`${ROOT}tests/fixtures/import/duplicate-keys.txt`, "utf8"), "text");
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((i) => [i.code, i.path]), [[ISSUE_CODES.duplicateKey, "/schemaVersion"]]);
  assert.equal(result.candidates, undefined);
  // Nested duplicates and duplicates inside prose fail the same way.
  assert.equal(parseImport(MINIMAL.replace('"text":"#27372d"', '"text":"#27372d","text":"#000000"'), "text").issues[0].path, "/colors/text");
  assert.equal(parseImport(`Theme:\n\`\`\`json\n${MINIMAL.replace('"name":"Moss"', '"name":"Moss","name":"Two"')}\n\`\`\``, "text").issues[0].code, ISSUE_CODES.duplicateKey);
});

test("two plausible themes need a local choice, and each candidate imports alone", () => {
  const second = MINIMAL.replace("Moss", "Second").replace("light", "dark").replace("#f6f2e8", "#101418").replace("#27372d", "#f4f6f8").replace("#446851", "#ca84ff");
  const result = parseImport(`Option A:\n${MINIMAL}\nOption B:\n\`\`\`json\n${second}\n\`\`\``, "text");
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, ISSUE_CODES.ambiguousCandidates);
  assert.deepEqual(result.candidates.map((c) => c.name), ["Moss", "Second"]);
  assert.deepEqual(Object.keys(result.candidates[0]).sort(), ["input", "name"]);
  for (const candidate of result.candidates) assert.ok(parseImport(candidate.input, "text").ok);
});

test("braces in strings, comments and stray prose do not confuse the scanner", () => {
  const tricky = '{"schemaVersion":1,"name":"Brace } { name","base":"light", /* } */ "colors":{"background":"#f6f2e8","text":"#27372d","accent":"#446851"} // }\n}';
  assert.equal(parseImport(`Look: ${tricky} done`, "text").normalized.name, "Brace } { name");
  const stray = parseImport(`I used a { brace in prose.\n\`\`\`json\n${MINIMAL}\n\`\`\``, "text");
  assert.ok(stray.ok, JSON.stringify(stray));
  assert.equal(parseImport(`Not JSON {like this} then ${MINIMAL}`, "text").normalized.name, "Moss");
});

test("truncated, malformed and non-theme input fail with an actionable message", () => {
  const cut = parseImport(`Here it is:\n\`\`\`json\n${MINIMAL.slice(0, 60)}`, "text");
  assert.equal(cut.issues[0].code, ISSUE_CODES.parseError);
  assert.match(cut.issues[0].message, /cut off/);
  assert.match(parseImport(MINIMAL.slice(0, -1), "text").issues[0].message, /cut off/);
  assert.match(parseImport("{'schemaVersion': 1}", "text").issues[0].message, /double quotes/);
  assert.match(parseImport('{schemaVersion: 1, "colors": {}}', "text").issues[0].message, /double quotes/);
  assert.equal(parseImport("Just some words.", "text").issues[0].code, ISSUE_CODES.noCandidate);
  assert.equal(parseImport("[1,2]", "text").issues[0].code, ISSUE_CODES.invalidValue);
  assert.equal(parseImport('{"a":1}', "text").ok, false);
});

test("non-finite numbers, prototype keys and excessive depth are refused", () => {
  assert.equal(parseImport(MINIMAL.replace('"schemaVersion":1', '"schemaVersion":NaN'), "text").issues[0].code, ISSUE_CODES.nonFiniteNumber);
  assert.equal(parseImport(MINIMAL.replace('"schemaVersion":1', '"schemaVersion":1e400'), "text").issues[0].code, ISSUE_CODES.nonFiniteNumber);
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const result = parseImport(MINIMAL.replace('"colors":{', `"colors":{"${key}":{"polluted":true},`), "text");
    assert.equal(result.issues[0].code, ISSUE_CODES.forbiddenKey, key);
    assert.equal(result.issues[0].path, `/colors/${key}`);
  }
  assert.equal({}.polluted, undefined);
  const deep = (n) => `{"schemaVersion":1,"x":${"[".repeat(n)}1${"]".repeat(n)}}`;
  assert.ok(parseImport(deep(11), "text").issues.some((i) => i.code === ISSUE_CODES.unknownField && i.path === "/x"));
  assert.equal(parseImport(deep(12), "text").issues[0].code, ISSUE_CODES.tooDeep);
  // Very deep input is refused at the limit, never by exhausting the stack.
  assert.equal(parseImport(`{"colors":${"[".repeat(60000)}`, "text").ok, false);
});

test("input limits apply before parsing, by UTF-8 bytes", () => {
  const pad = (bytes) => `${MINIMAL}${" ".repeat(bytes - MINIMAL.length)}`;
  assert.ok(parseImport(pad(LIMITS.fileUtf8Bytes), "file").ok);
  assert.equal(parseImport(pad(LIMITS.fileUtf8Bytes + 1), "file").issues[0].code, ISSUE_CODES.inputTooLarge);
  assert.ok(parseImport(pad(LIMITS.pastedUtf8Bytes), "text").ok);
  assert.equal(parseImport(pad(LIMITS.pastedUtf8Bytes + 1), "text").issues[0].code, ISSUE_CODES.inputTooLarge);
  // Multi-byte characters count as their UTF-8 length.
  const wide = `${MINIMAL}${"é".repeat(Math.ceil((LIMITS.fileUtf8Bytes - MINIMAL.length) / 2) + 1)}`;
  assert.equal(parseImport(wide, "file").issues[0].code, ISSUE_CODES.inputTooLarge);
  assert.equal(parseImport(new Uint8Array(LIMITS.fileUtf8Bytes + 1), "file").issues[0].code, ISSUE_CODES.inputTooLarge);
});

test("bytes must be valid UTF-8; a BOM is removed with a note", () => {
  assert.equal(parseImport(new Uint8Array([0x7b, 0xff, 0x7d]), "file").issues[0].code, ISSUE_CODES.invalidUtf8);
  const bom = parseImport(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(MINIMAL)]), "file");
  assert.ok(bom.ok);
  assert.deepEqual(codes(bom), [NOTE_CODES.bom]);
  assert.equal(parseImport(MINIMAL.replace("Moss", "\\ud800"), "text").issues[0].code, ISSUE_CODES.invalidUtf8);
});

test("normalization covers documented equivalents and notes each change", () => {
  const { theme, notes } = normalizeTheme({
    base: "light",
    colors: { background: "#F6F2E8", text: "27372d", accent: "#4a6" },
    overrides: { syntax: { comment: "#ABC" } },
    contributions: { levels: ["#AAAAAA", "#bbbbbb", "#cccccc", "#dddddd", "#EEEEEE"] },
    description: "  Two   spaces\nand a line  ",
    fonts: { accent: "Space Grotesk" },
  });
  assert.deepEqual(theme.colors, { background: "#f6f2e8", text: "#27372d", accent: "#44aa66" });
  assert.equal(theme.overrides.syntax.comment, "#aabbcc");
  assert.deepEqual(theme.contributions.levels, ["#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd", "#eeeeee"]);
  assert.equal(theme.description, "Two spaces and a line");
  assert.equal(theme.fonts.accent, "space-grotesk");
  assert.equal(theme.name, "My theme");
  assert.equal(theme.schemaVersion, 1);
  assert.ok(validateTheme(theme).ok);
  const byCode = (code) => notes.filter((n) => n.code === code).map((n) => n.path);
  assert.deepEqual(byCode(NOTE_CODES.color), ["/colors/background", "/colors/text", "/colors/accent", "/overrides/syntax/comment", "/contributions/levels/0", "/contributions/levels/4"]);
  assert.deepEqual(byCode(NOTE_CODES.defaultName), ["/name"]);
  assert.deepEqual(byCode(NOTE_CODES.defaultVersion), ["/schemaVersion"]);
});

test("normalization never guesses: unknown fields stay, a v1 version needs a v1 shape, base is not inferred", () => {
  const unknown = parseImport(MINIMAL.replace('"name":"Moss"', '"name":"Moss","css":"body{}"'), "text");
  assert.equal(unknown.issues[0].path, "/css");
  assert.equal(normalizeTheme({ name: "x", base: "dark", colors: { background: "#000000", text: "#ffffff", accent: "#ffffff" }, extra: 1 }).theme.schemaVersion, undefined);
  const noBase = parseImport('{"schemaVersion":1,"name":"x","colors":{"background":"#000000","text":"#ffffff","accent":"#ffffff"}}', "text");
  assert.deepEqual(noBase.issues.map((i) => [i.code, i.path]), [[ISSUE_CODES.missingField, "/base"]]);
  assert.equal(normalizeTheme({ ...JSON.parse(MINIMAL), colors: { background: "red", text: "#12345", accent: "#4468511" } }).theme.colors.background, "red");
  const input = JSON.parse(MINIMAL.replace("#f6f2e8", "#F6F2E8"));
  normalizeTheme(input);
  assert.equal(input.colors.background, "#F6F2E8", "normalization must not mutate its input");
});

test("a foreign $schema and unsupported decorations need an explicit choice", () => {
  const foreign = parseImport(MINIMAL.replace("{", '{"$schema":"https://json-schema.org/draft/2020-12/schema",'), "text");
  assert.equal(foreign.issues[0].path, "/$schema");
  const value = JSON.parse(MINIMAL.replace("{", '{"$schema":"https://json-schema.org/draft/2020-12/schema",'));
  const stripped = withoutForeignSchema(value);
  assert.equal(stripped.removed, true);
  assert.ok(validateTheme(stripped.value).ok);
  assert.equal(withoutForeignSchema(JSON.parse(MINIMAL)).removed, false);

  const rich = { ...JSON.parse(MINIMAL), effects: { sparkle: {} }, flavor: { slots: { "repo.code": "Jack in" } }, css: "x" };
  assert.equal(validateTheme(rich).ok, false);
  const colors = colorsOnly(rich);
  assert.ok(colors.ok);
  assert.deepEqual(colors.theme, JSON.parse(MINIMAL));
  assert.deepEqual(colors.omitted, ["css", "effects", "flavor"]);
  assert.equal(colorsOnly({ name: "x", base: "dark", colors: { background: "red" } }).ok, false);
});

test("share codes import from a code field, a bare paste or a share link", () => {
  const code = "RS1.eNodjEEOgyAQAL9itlcuUquGP_Ta-7qsYirQsDQxMf5d8DozmQMmFAYD27q4DAoobjEJmAOQiEMu6tF1_fhqi5yQvkuK_2ArnvtZ81hw5v3u9PActIVTQUBfp-8o0mCwzQ8TOV93CoQce_xwkjUGMO15AW2aKQo.eaed7600";
  for (const [input, kind] of [[code, "code"], [code, "text"], [`https://sidebandstudio.github.io/GitHub-Reskin/share/#${code}`, "text"], [` ${code}\n`, "code"]]) {
    const result = parseImport(input, kind);
    assert.ok(result.ok, `${kind}: ${JSON.stringify(result)}`);
    assert.equal(result.normalized.name, "Moss and parchment");
    assert.equal(result.source, input);
  }
  const two = parseImport(`${code} and ${code.replace(/^RS1\./, "RS1.x")}`, "text");
  assert.equal(two.issues[0].code, ISSUE_CODES.ambiguousCandidates);
});

test("the parser matches jsonc-parser on accepted input and rejects what it rejects", () => {
  const samples = [
    MINIMAL,
    '{"a":[1,2,{"b":null}],"c":true,"d":-0.5e+3, "e": "\\u00e9\\n"}',
    '{ // comment\n "a": 1, /* block */ "b": [1,2,], }',
    '{"a":"/* not a comment */","b":"// nor this"}',
    // JSONC ends a line comment at LF, CR or CRLF.
    ...["\n", "\r", "\r\n"].map((end) => `{ // one${end} "a": 1, // two${end}"b": [1, // three${end}2]${end}}`),
    readFileSync(`${ROOT}tests/fixtures/import/prose-jsonc.txt`, "utf8").split("```jsonc\n")[1].split("```")[0],
  ];
  for (const file of readdirSync(`${ROOT}tests/fixtures/schema/valid`)) samples.push(readFileSync(`${ROOT}tests/fixtures/schema/valid/${file}`, "utf8"));
  for (const text of samples) {
    const errors = [];
    const expected = jsonc.parse(text, errors, { allowTrailingComma: true });
    assert.deepEqual(errors, [], text);
    const ours = parseJson(text, { maxDepth: 12 });
    assert.ok(ours.ok, text);
    assert.deepEqual(ours.value, expected);
  }
  for (const text of ['{"a":01}', '{"a":.5}', '{"a":1,,}', '{"a" 1}', '{"a":"\\x41"}', '{"a":"tab\there"}', '{"a":1}{"b":2}', '{"a":undefined}']) {
    const errors = [];
    jsonc.parse(text, errors, { allowTrailingComma: true });
    assert.ok(errors.length || text === '{"a":"tab\there"}', `jsonc-parser accepted ${text}`);
    assert.equal(parseJson(text, { maxDepth: 12 }).ok, false, text);
  }
});

test("CR, LF and CRLF end line comments alike in themes, prose and candidate extraction", () => {
  const second = MINIMAL.replace("Moss", "Second");
  for (const end of ["\n", "\r", "\r\n"]) {
    const label = JSON.stringify(end);
    const commented = MINIMAL.replace('"name"', `// the name${end}"name"`).replace('"colors"', `// colors${end}"colors"`);
    const one = parseImport(commented, "text");
    assert.ok(one.ok, `${label}: ${JSON.stringify(one)}`);
    assert.deepEqual(codes(one), [NOTE_CODES.jsonc], label);
    // A comment never swallows the next theme, so two themes still need a choice.
    const two = parseImport(`${MINIMAL} // first${end}${second}`, "text");
    assert.equal(two.ok, false, label);
    assert.equal(two.issues[0].code, ISSUE_CODES.ambiguousCandidates, label);
    assert.deepEqual(two.candidates.map((c) => c.name), ["Moss", "Second"], label);
    // Inside prose the span scanner ends the comment at the same place.
    const prose = parseImport(`Here:${end}{ // note }${end}${MINIMAL.slice(1)}${end}Enjoy.`, "text");
    assert.ok(prose.ok, `${label}: ${JSON.stringify(prose)}`);
    assert.deepEqual(findObjectSpans(`a {"x":1, // }${end}"y":2} b`).spans.length, 1, label);
    // Line numbers in messages count each line end once.
    assert.match(parseImport(`{${end}${end}"a" 1}`, "text").issues[0].message, /line 3, column 5/, label);
  }
});

test("validation is linear on long strings: the reviewer's 120,000-letter name rejects quickly", () => {
  for (const n of [64000, 120000]) {
    const input = JSON.stringify({ schemaVersion: 1, name: "a".repeat(n), base: "dark", colors: { background: "#121212", text: "#eeeeee", accent: "#ff0000" } });
    const started = performance.now();
    const result = parseImport(input, "text");
    assert.ok(performance.now() - started < BUDGETS.longTaskMs, `a ${n}-letter name took ${performance.now() - started} ms`);
    assert.deepEqual(result.issues.map((i) => [i.code, i.path]), [[ISSUE_CODES.outOfBounds, "/name"]]);
  }
});

// Each import of a maximum-size paste must finish within one long task. The fastest of three runs
// keeps scheduling noise out while a super-linear path, which is slow on every run, still fails.
test("every hostile shape of a maximum-size paste imports within the long-task budget", () => {
  const MAX = LIMITS.pastedUtf8Bytes;
  const fill = (unit, room) => unit.repeat(Math.floor(room / unit.length));
  const inName = (unit) => {
    const [head, tail] = MINIMAL.split("Moss");
    return head + fill(unit, MAX - head.length - tail.length) + tail;
  };
  const shapes = {
    letters: inName("a"),
    schemeRuns: inName("a1://"),
    digitSchemes: inName("12://"),
    colons: inName("a:"),
    www: inName("www."),
    wwwDashes: inName("www-"),
    urls: inName("url "),
    dataWords: inName("data"),
    escapes: inName("\\n"),
    surrogatePairs: inName("\\ud83d\\ude00"),
    urlSpaces: `url${" ".repeat(MAX - 4)}x`,
    proseLetters: fill("a", MAX),
    proseScheme: `${fill("ab1+.-", MAX - 3)}://`,
    braces: fill("{", MAX),
    braceQuotes: fill('{"', MAX),
    brackets: fill("[", MAX),
    openKeys: fill('{"a":', MAX),
    blockComments: fill("/*", MAX),
    lineComments: fill("//", MAX),
    crComments: `{${fill("//\r", MAX - 2)}}`,
    crlfComments: `{${fill("// x\r\n", MAX - 2)}}`,
    smallObjects: fill('{"x":1} ', MAX),
    plausibleObjects: fill('{"base":"x"} ', MAX),
    openThemes: fill('text {"schemaVersion":1,"name":"', MAX),
    shareLetters: `RS1.${fill("a", MAX - 4)}`,
    shareRepeats: fill(" RS1.a", MAX),
    fences: fill("```json\n", MAX),
    proseFences: fill("Here {\n```", MAX),
  };
  parseImport(MINIMAL, "text");
  for (const [name, input] of Object.entries(shapes)) {
    assert.ok(input.length > MAX - 64 && input.length <= MAX, name);
    let fastest = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      const result = parseImport(input, "text");
      fastest = Math.min(fastest, performance.now() - started);
      assert.equal(typeof result.ok, "boolean", name);
    }
    assert.ok(fastest < BUDGETS.longTaskMs, `${name} took ${fastest.toFixed(1)} ms`);
  }
});

test("the span scanner is linear and bounded on hostile input", () => {
  const started = performance.now();
  findObjectSpans("{".repeat(LIMITS.pastedUtf8Bytes));
  findObjectSpans('{"'.repeat(LIMITS.pastedUtf8Bytes / 2));
  parseImport("{ ".repeat(LIMITS.pastedUtf8Bytes / 2), "text");
  assert.ok(performance.now() - started < 2000, "scanner took too long");
});

test("format runtime sources never evaluate code, fetch or touch storage", () => {
  for (const file of readdirSync(`${ROOT}packages/format`).filter((f) => f.endsWith(".js"))) {
    const source = readFileSync(`${ROOT}packages/format/${file}`, "utf8");
    assert.doesNotMatch(source, /\beval\(|new Function|\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|\bdocument\.|\bwindow\.|Math\.random|Date\.now/, file);
  }
});
