import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { acceptsFileName, canonicalize, exportTheme, fileStem, parseImport } from "../../packages/format/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const rich = JSON.parse(readFileSync(`${ROOT}tests/fixtures/schema/valid/choom-circuit.reskin.json`, "utf8"));

test("canonical JSON sorts keys recursively, keeps array order and is compact", () => {
  const text = canonicalize({ b: 1, a: { d: [3, 1, 2], c: "é" }, $schema: "x", Z: 0 });
  assert.equal(text, '{"$schema":"x","Z":0,"a":{"c":"é","d":[3,1,2]},"b":1}');
  assert.equal(canonicalize(rich), canonicalize(JSON.parse(JSON.stringify(rich))));
  assert.doesNotMatch(canonicalize(rich), /\n|^﻿/);
});

test("exports are sorted, LF-terminated UTF-8 named after the theme", () => {
  const file = exportTheme(rich);
  assert.equal(file.filename, "choom-circuit.reskin.json");
  assert.equal(file.mime, "application/json");
  const text = new TextDecoder().decode(file.bytes);
  assert.ok(text.endsWith("}\n") && !text.includes("\r") && text.charCodeAt(0) !== 0xfeff);
  assert.deepEqual(JSON.parse(text), JSON.parse(canonicalize(rich)));
  assert.equal(text, `${JSON.stringify(JSON.parse(canonicalize(rich)), null, 2)}\n`);
});

test("export, reimport and export again is byte-identical", () => {
  const first = exportTheme(rich).bytes;
  const reimported = parseImport(first, "file");
  assert.ok(reimported.ok);
  assert.deepEqual(reimported.notes, []);
  assert.deepEqual(exportTheme(reimported.normalized).bytes, first);
});

test("invalid documents cannot be exported", () => {
  assert.throws(() => exportTheme({ ...rich, css: "x" }), /valid theme/);
});

test("file names are sanitized and imports accept .json or .reskin.json", () => {
  assert.equal(fileStem("Rosé Pine Dawn"), "rose-pine-dawn");
  assert.equal(fileStem("../../etc/passwd"), "etc-passwd");
  assert.equal(fileStem("夜"), "theme");
  assert.equal(fileStem("a".repeat(100)).length, 48);
  for (const name of ["x.json", "x.reskin.json", "X.RESKIN.JSON"]) assert.ok(acceptsFileName(name), name);
  for (const name of ["x.js", "x.json.exe", "x"]) assert.equal(acceptsFileName(name), false, name);
});
