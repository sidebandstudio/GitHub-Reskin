import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EFFECT_IDS, FLAVOR_SLOT_IDS, FONT_IDS } from "../../packages/contracts/index.js";
import { makeAiPrompt, MAX_IDEA_LENGTH, parseImport, validateTheme } from "../../packages/format/index.js";
import { EFFECT_PARAMETERS } from "../../packages/format/schema-registry.js";
import { PROMPT_TEMPLATE_PATH, promptModule } from "../../scripts/generate-prompt.mjs";

test("the checked-in prompt is generated from the current schema", () => {
  assert.equal(readFileSync(PROMPT_TEMPLATE_PATH, "utf8"), promptModule());
});

test("the prompt names every font, effect and slot ID with each effect's default", () => {
  const prompt = makeAiPrompt();
  for (const id of [...FONT_IDS, ...EFFECT_IDS, ...FLAVOR_SLOT_IDS]) assert.ok(prompt.includes(id), id);
  for (const [id, params] of Object.entries(EFFECT_PARAMETERS)) {
    for (const [name, spec] of Object.entries(params)) assert.ok(prompt.includes(`"${name}": `) && prompt.includes(`default ${typeof spec.default === "string" ? `"${spec.default}"` : spec.default}`), `${id}.${name}`);
  }
  assert.ok(prompt.length < 4500);
  assert.doesNotMatch(prompt, /https?:|www\.|<|>/);
  assert.match(prompt, /exactly one ```json code block/);
});

test("the prompt's example is a valid theme a fenced reply imports", () => {
  const example = /```json\n(.+)\n```\n\nMy idea/s.exec(makeAiPrompt())[1];
  assert.ok(validateTheme(JSON.parse(example)).ok);
  assert.ok(parseImport(`Sure! Here is your theme:\n\n\`\`\`json\n${example}\n\`\`\`\n\nEnjoy.`, "text").ok);
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
