// Import, export and sharing: a chatbot answer wrapped in prose, share codes, Advanced CSS that
// stays off until consent, the friendly failures from UX.md's table with their recovery choices,
// and the export round trip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { LIMITS } from "../../packages/contracts/index.js";
import { encodeShare, makeAiPrompt, parseImport } from "../../packages/format/index.js";
import { MODE_INDEX, standardSeed as seedOf } from "../../packages/primer/index.js";
import { COPY, analyzeImport, cssSummary, extractObject, exportFile, fieldName, fixRequest, importFailure, repaired, SHARE_PAGE, shareSheet, themeJson } from "../../packages/ui/importer.js";

const standardSeed = (base) => seedOf(MODE_INDEX, base);
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ANSWER = read("./fixtures/ai-answer.txt");
const RICH = JSON.parse(read("../fixtures/schema/valid/ai-rich.reskin.json"));
const THREE = { schemaVersion: 1, name: "Moss", base: "dark", colors: { background: "#18212b", text: "#e6edf3", accent: "#7fbf7f" } };

test("the generated AI prompt asks for one theme with no images or URLs, and its own example imports", () => {
  const prompt = makeAiPrompt();
  assert.match(prompt, /Reply with exactly one JSON object/);
  assert.match(prompt, /image\/base64\/SVG data/);
  const example = prompt.slice(prompt.indexOf("{", prompt.lastIndexOf("Example")), prompt.lastIndexOf("}") + 1);
  const result = analyzeImport(`Here you go!\n\n\`\`\`json\n${example}\n\`\`\`\nEnjoy.`, "text", { standardSeed });
  assert.equal(result.ok, true, JSON.stringify(result.details));
});

test("a chatbot answer with prose, a fence and comments imports, saying where the theme was found", () => {
  const result = analyzeImport(ANSWER, "text", { standardSeed });
  assert.equal(result.ok, true, JSON.stringify(result.details));
  assert.equal(result.theme.name, "Neon Drizzle");
  assert.equal(result.messages[0].text, COPY.wrapper);
  assert.ok(result.messages[0].details.length);
  // Everything the answer asked for survives: backgrounds, fonts, shape, graph, code, effects, flavor.
  for (const key of ["backgrounds", "fonts", "shape", "typography", "contributions", "code", "effects", "flavor"]) assert.ok(result.theme[key], key);
  // The answer's graph levels sit too close together, so they are spaced and that is explained.
  assert.ok(result.messages.some((m) => m.text === COPY.graph));
  assert.deepEqual(result.repairs.find((r) => r.path === "/contributions/levels").before, ["#161b2e", "#14524f", "#1a8a7d", "#22b8a5", "#2de2c6"]);
  assert.equal(result.theme.contributions.cellStyle, "round");
  assert.equal(result.css, null);
  assert.deepEqual(result.images, []);
});

test("contrast and graph repairs are explained with field names and saved or preview-only labels", () => {
  const dim = { ...THREE, colors: { ...THREE.colors, text: "#555555" }, contributions: { levels: ["#111111", "#121212", "#131313", "#141414", "#151515"] } };
  const result = analyzeImport(JSON.stringify(dim), "text", { standardSeed });
  assert.equal(result.ok, true);
  const texts = result.messages.map((m) => m.text);
  assert.ok(texts.some((t) => /^We adjusted \d+ colors? so links and text are easier to read\.$/.test(t)), texts.join(" | "));
  assert.ok(texts.includes(COPY.graph));
  const text = result.repairs.find((r) => r.path === "/colors/text");
  assert.deepEqual([text.field, text.before, text.persistence], ["Text", "#555555", COPY.savedAdjustment]);
  assert.notEqual(result.theme.colors.text, "#555555", "the repaired source is what Use theme takes");
  assert.ok(result.repairs.some((r) => r.persistence === COPY.previewAdjustment));
  assert.equal(fieldName("/code/syntax/markupHeading"), "Code syntax markup heading");
});

test("a share code imports alone or inside a message, and a damaged one gets the damaged-code message", () => {
  const code = encodeShare(RICH);
  for (const input of [code, `Try my theme: ${code} !`, `${SHARE_PAGE}#${code}`]) {
    const result = analyzeImport(input, "code", { standardSeed });
    assert.equal(result.ok, true, input.slice(0, 40));
    assert.equal(result.theme.name, RICH.name);
  }
  const damaged = analyzeImport(`${code.slice(0, -3)}zzz`, "code", { standardSeed });
  assert.deepEqual([damaged.ok, damaged.message], [false, COPY.badCode]);
  assert.equal(analyzeImport(code.slice(0, 40), "code", { standardSeed }).message, COPY.badCode);
});

test("Advanced CSS is reported with its size, canonical text and hash, and nothing enables it", () => {
  const result = analyzeImport(JSON.stringify(RICH), "text", { standardSeed });
  assert.equal(result.ok, true);
  assert.equal(result.css.ok, true);
  assert.equal(result.css.bytes, new TextEncoder().encode(result.theme.css).length);
  assert.match(result.css.hash, /^[0-9a-f]{64}$/);
  assert.equal(typeof result.css.canonical, "string");
  assert.equal("cssEnabled" in result, false);
  assert.match(COPY.cssWarning, /^Advanced CSS changes GitHub's appearance and can break layout or reduce readability\. .* Calm turns it off\.$/);
  assert.equal(cssSummary(THREE), null);
});

test("CSS outside the policy is rejected with its location, and removing it is a separate choice", () => {
  const theme = { ...THREE, css: ".AppHeader { box-shadow: 0 1px 0 var(--reskin-accent); }\n.x { background: url(https://example.com/a.png) }" };
  const text = `Here it is:\n\`\`\`json\n${JSON.stringify(theme, null, 2)}\n\`\`\``;
  const result = analyzeImport(text, "text", { standardSeed });
  assert.equal(result.ok, false);
  assert.equal(result.message, COPY.unsafe);
  assert.ok(result.details.some((d) => d.path.startsWith("/css") && /line 2/.test(d.message)), JSON.stringify(result.details));
  const remove = result.actions.find((a) => a.id === "remove-css");
  assert.equal(remove.label, "Remove CSS and preview structured theme");
  const retried = analyzeImport(remove.input, "text", { standardSeed });
  assert.equal(retried.ok, true);
  assert.equal(retried.theme.css, undefined);
  assert.match(result.fixRequest, /complete corrected theme/);
});

test("unknown fields offer Preview colors only, listing what it leaves out", () => {
  const result = analyzeImport(JSON.stringify({ ...THREE, sparkles: true, shape: { corners: { style: "rounded" } } }), "text", { standardSeed });
  assert.equal(result.ok, false);
  assert.equal(result.message, COPY.unsafe);
  const colors = result.actions.find((a) => a.id === "colors-only");
  assert.deepEqual(colors.omitted, ["shape", "sparkles"]);
  assert.equal(analyzeImport(colors.input, "text", { standardSeed }).ok, true);
});

test("cut-off, two themes, newer version, missing color and too large each get their message", () => {
  const cut = analyzeImport(ANSWER.slice(0, ANSWER.indexOf('"shape"')), "text", { standardSeed });
  assert.deepEqual([cut.ok, cut.message], [false, COPY.cutOff]);
  const two = analyzeImport(`${JSON.stringify(THREE)}\n\nor\n\n${JSON.stringify({ ...THREE, name: "Moss light", base: "light", colors: { background: "#f5f1e8", text: "#1d2a1d", accent: "#3b6e3b" } })}`, "text", { standardSeed });
  assert.equal(two.message, COPY.two);
  assert.deepEqual(two.candidates.map((c) => c.name), ["Moss", "Moss light"]);
  assert.equal(analyzeImport(two.candidates[1].input, "text", { standardSeed }).theme.name, "Moss light");
  assert.equal(analyzeImport(JSON.stringify({ ...THREE, schemaVersion: 2 }), "text", { standardSeed }).message, COPY.newer);
  const missing = analyzeImport(JSON.stringify({ ...THREE, colors: { text: "#ffffff", accent: "#ff0000" } }), "text", { standardSeed });
  assert.equal(missing.message, "Add a background color like #18212b.");
  assert.match(missing.fixRequest, /colors\/background/);
  assert.equal(missing.missingColor, "/colors/background");
  assert.equal(analyzeImport(JSON.stringify({ ...THREE, colors: { background: "#000000", text: "#ffffff" } }), "text", { standardSeed }).message, "Add an accent color like #ff806c.");
  const big = analyzeImport("x".repeat(LIMITS.pastedUtf8Bytes + 1), "text", { standardSeed });
  assert.equal(big.message, COPY.tooLarge);
});

test("a base that contradicts the colors is not repaired; the import offers the one-tap fix", () => {
  const result = analyzeImport(JSON.stringify({ ...THREE, base: "light" }), "text", { standardSeed });
  assert.equal(result.ok, true);
  assert.ok(result.polarity);
  assert.equal(result.messages.at(-1).text, COPY.basePolarity("light"));
  assert.equal(repaired(THREE, standardSeed).polarity, null);
});

test("extractObject finds the object behind a failed validation, comments and trailing commas included", () => {
  assert.deepEqual(extractObject('Hi! {"a": "}{", // note\n "b": [1, 2,], /* x */ "c": {"d": 1,},}\n bye {"e":1}'), { a: "}{", b: [1, 2], c: { d: 1 } });
  assert.equal(extractObject("no object"), null);
  assert.equal(extractObject('{"a": 1'), null);
  assert.equal(importFailure({ issues: [{ code: "parse-error", path: "", message: "Unexpected token." }] }).message, "Unexpected token.");
  assert.match(fixRequest([{ path: "/colors/text", message: "Text is missing." }]), /- \/colors\/text: Text is missing\./);
});

test("export: the file, theme JSON and share code round-trip to the same theme", () => {
  for (const theme of [THREE, RICH, JSON.parse(read("../fixtures/schema/valid/embedded-images.reskin.json"))]) {
    const file = exportFile(theme);
    assert.match(file.filename, /^[a-z0-9-]+\.reskin\.json$/);
    const back = parseImport(file.bytes, "file");
    assert.equal(back.ok, true);
    assert.deepEqual(back.normalized, parseImport(JSON.stringify(theme), "text").normalized);
    assert.equal(themeJson(theme), new TextDecoder().decode(file.bytes));
    const sheet = shareSheet(theme);
    assert.deepEqual(parseImport(sheet.code, "code").normalized, back.normalized);
    if (sheet.link) assert.ok(sheet.link.startsWith(`${SHARE_PAGE}#RS1.`) && sheet.link.length <= LIMITS.maxShareLinkCharacters);
  }
  const images = shareSheet(JSON.parse(read("../fixtures/schema/valid/embedded-images.reskin.json")));
  assert.ok(images.images.length > 0);
  assert.equal(shareSheet(RICH).css, true);
  assert.match(COPY.sharedImages(2), /2 embedded images/);
});

test("a theme too big for a preview link is offered as a file, never a truncated link", () => {
  // A 64x64 noise PNG barely compresses, so its share code passes the 8192-character link bound.
  const theme = { ...THREE, backgrounds: { page: { layers: [{ image: { data: noisePng(64, 64), width: 64, height: 64 } }] } } };
  assert.equal(analyzeImport(JSON.stringify(theme), "text", { standardSeed }).ok, true);
  const sheet = shareSheet(theme);
  assert.equal(sheet.linkTooLong, true);
  assert.equal(sheet.link, null);
  assert.ok(sheet.code.length > LIMITS.maxShareLinkCharacters);
  assert.equal(parseImport(sheet.code, "code").ok, true, "the code itself still imports");
  assert.match(COPY.linkOverLimit, /Share the \.reskin\.json file instead/);
});

function noisePng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  let seed = 7;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let i = 0; i < rows.length; i++) rows[i] = i % (width * 3 + 1) === 0 ? 0 : (seed = (seed * 48271) % 2147483647) & 0xff;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
