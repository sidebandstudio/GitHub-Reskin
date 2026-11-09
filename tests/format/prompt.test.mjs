import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ANSI_ROLES, BODY_FONT_IDS, DIFF_ROLES, EFFECT_IDS, FLAVOR_SLOT_IDS, HEADING_FONT_IDS, THEME_SYNTAX_ROLES } from "../../packages/contracts/index.js";
import { makeAiPrompt, MAX_IDEA_LENGTH, parseImport, sanitizeCss, validateTheme } from "../../packages/format/index.js";
import { EFFECT_PARAMETERS } from "../../packages/format/schema-registry.js";
import { EXAMPLE_PATH, PROMPT_TEMPLATE_PATH, promptModule, promptText } from "../../scripts/generate-prompt.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const example = () => /Here is a valid rich example with no images:\n(\{.+\})\n\nMy idea/s.exec(makeAiPrompt())[1];

test("the checked-in prompt is generated from the current schema", () => {
  assert.equal(readFileSync(PROMPT_TEMPLATE_PATH, "utf8"), promptModule());
});

test("generated from the registries, the prompt is exactly AI-PROMPT.md's contract text", () => {
  assert.equal(promptText(), readFileSync(`${ROOT}tests/fixtures/prompt/ai-prompt-r41.txt`, "utf8"));
  assert.ok(Buffer.byteLength(makeAiPrompt("x".repeat(MAX_IDEA_LENGTH))) <= 16384);
});

test("the prompt names every font, syntax, ANSI, diff, effect and slot ID with each effect's default", () => {
  const prompt = makeAiPrompt();
  for (const id of [...HEADING_FONT_IDS, ...BODY_FONT_IDS, ...THEME_SYNTAX_ROLES, ...ANSI_ROLES, ...DIFF_ROLES, ...EFFECT_IDS, ...FLAVOR_SLOT_IDS]) assert.ok(prompt.includes(id), id);
  for (const [id, params] of Object.entries(EFFECT_PARAMETERS)) {
    for (const [name, spec] of Object.entries(params)) assert.ok(prompt.includes(`${name}: `) && prompt.includes(`default ${spec.default}`), `${id}.${name}`);
  }
  assert.doesNotMatch(prompt, /https?:|www\./);
  assert.match(prompt, /exactly one JSON object in one json code block/);
  assert.match(prompt, /Never use url\(\), @import, @font-face/);
  assert.match(prompt, /no images\/URLs|Do not include image layers/);
});

test("the prompt's rich example is the executable fixture and a fenced reply imports it", () => {
  const text = example();
  assert.equal(text, JSON.stringify(JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"))));
  const theme = JSON.parse(text);
  assert.ok(validateTheme(theme).ok);
  assert.ok(sanitizeCss(theme.css).ok);
  assert.doesNotMatch(text, /data:image|base64|url\(/);
  const reply = parseImport(`Sure! Here is your theme:\n\n\`\`\`json\n${text}\n\`\`\`\n\nEnjoy.`, "text");
  assert.ok(reply.ok, JSON.stringify(reply.issues));
  // Its oxanium and Atkinson Hyperlegible requests are noted, not refused, until those files ship.
  assert.deepEqual(reply.notes.filter((n) => n.severity === "warning").map((n) => n.path), ["/fonts/heading", "/fonts/body"]);
});

test("the idea is plain, bounded text and never a template", () => {
  assert.ok(makeAiPrompt().endsWith("My idea: (describe your idea here)"));
  assert.ok(makeAiPrompt("  neon\n\nrain  ").endsWith("My idea: neon rain"));
  assert.ok(makeAiPrompt("$& $1 {{IDEA}}").endsWith("My idea: $& $1 {{IDEA}}"));
  const idea = makeAiPrompt(`a‮b\u0000c${"x".repeat(1000)}`).split("My idea: ")[1];
  assert.equal(Array.from(idea).length, MAX_IDEA_LENGTH);
  assert.doesNotMatch(idea, /[\u0000-\u001f‪-‮]/);
  assert.equal(Array.from(makeAiPrompt("🌙".repeat(600)).split("My idea: ")[1]).length, MAX_IDEA_LENGTH);
});
