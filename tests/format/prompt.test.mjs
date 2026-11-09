import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ANSI_ROLES, DIFF_ROLES, EFFECT_IDS, FLAVOR_SLOT_IDS, FONT_INVENTORY, THEME_SYNTAX_ROLES } from "../../packages/contracts/index.js";
import { makeAiPrompt, MAX_IDEA_LENGTH, parseImport, sanitizeCss, validateTheme } from "../../packages/format/index.js";
import { EFFECT_PARAMETERS, FONT_ROLES } from "../../packages/format/schema-registry.js";
import { EXAMPLE_PATH, PROMPT_TEMPLATE_PATH, promptModule, promptText } from "../../scripts/generate-prompt.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
// The fonts this increment renders as requested: bundled, native-stack and system faces.
const offeredFonts = (role) => FONT_ROLES.filter((font) => font.roles.includes(role) && font.source !== "deferred").map((font) => font.id);
const example = () => /Here is a valid rich example with no images:\n(\{.+\})\n\nMy idea/s.exec(makeAiPrompt())[1];

test("the checked-in prompt is generated from the current schema", () => {
  assert.equal(readFileSync(PROMPT_TEMPLATE_PATH, "utf8"), promptModule());
});

test("generated from the registries, the prompt is exactly AI-PROMPT.md's contract text", () => {
  assert.equal(promptText(), readFileSync(`${ROOT}tests/fixtures/prompt/ai-prompt-r41.txt`, "utf8"));
  assert.ok(Buffer.byteLength(makeAiPrompt("x".repeat(MAX_IDEA_LENGTH))) <= 16384);
});

test("the prompt names every offered font, syntax, ANSI, diff, effect and slot ID with each effect's default", () => {
  const prompt = makeAiPrompt();
  for (const id of [...offeredFonts("heading"), ...offeredFonts("body"), ...THEME_SYNTAX_ROLES, ...ANSI_ROLES, ...DIFF_ROLES, ...EFFECT_IDS, ...FLAVOR_SLOT_IDS]) assert.ok(prompt.includes(id), id);
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
  assert.deepEqual(reply.notes.filter((n) => n.severity === "warning"), []);
});

test("c2b r2 blocker 4: the prompt offers every bundled font and only this increment's at-rules, and names nothing deferred", () => {
  const prompt = makeAiPrompt();
  const heading = /Heading IDs: ([^.]+)\./.exec(prompt)[1].split(", ");
  const body = /Body IDs: ([^.]+)\./.exec(prompt)[1].split(", ");
  assert.deepEqual(heading, offeredFonts("heading"));
  assert.deepEqual(body, ["system", "ibm-plex-sans", "source-sans-3", "nunito-sans", "atkinson-hyperlegible", "barlow"]);
  assert.equal(heading.length, 19);
  assert.ok(heading.includes("roboto-condensed"), "the native condensed stack stays offered");
  assert.deepEqual([...heading, ...body].filter((id) => FONT_INVENTORY.deferred.includes(id)), []);
  // Every offered font resolves as requested, with no deferred-font warning.
  const minimal = { schemaVersion: 1, name: "Font", base: "dark", colors: { background: "#111111", text: "#ffffff", accent: "#ffcc00" } };
  for (const [role, ids] of [["heading", heading], ["body", body]]) {
    for (const id of ids) assert.deepEqual(parseImport(JSON.stringify({ ...minimal, fonts: { [role]: id } }), "text").notes, [], `${role} ${id}`);
  }
  assert.ok(!FONT_INVENTORY.deferred.some((id) => Object.values(JSON.parse(example()).fonts).includes(id)));
  // @media and @supports are the at-rules offered, each as the sanitizer admits it.
  assert.match(prompt, /At-rules: @media, with prefers-reduced-motion, hover, pointer, min-width, max-width tests joined by and, widths <=10000px; and @supports, whose tests are \(property: value\) declarations of properties this CSS may set, such as \(corner-shape: bevel\), alone, after not, or joined by and or by or \(never both, no parenthesized groups\), with literal values and no var\(\) or url\(\)\./);
  assert.match(prompt, /Any other at-rule is rejected\./);
  assert.ok(sanitizeCss("@supports (corner-shape: bevel) or (corner-shape: notch){.AppHeader{border-color:var(--reskin-accent)}}").ok);
  assert.ok(sanitizeCss("@supports not (corner-shape: bevel){.AppHeader{border-color:var(--reskin-accent)}}").ok);
  for (const refused of ["@supports ((corner-shape: bevel) or (corner-shape: notch)){.AppHeader{border-color:red}}", "@supports (corner-shape: bevel) and (color: red) or (color: blue){.AppHeader{border-color:red}}", "@supports (color: var(--reskin-accent)){.AppHeader{border-color:red}}", "@supports (display: grid){.AppHeader{border-color:red}}"]) {
    assert.equal(sanitizeCss(refused).ok, false, refused);
  }
  assert.ok(sanitizeCss("@media (prefers-reduced-motion:reduce) and (min-width:600px){.AppHeader{border-color:var(--reskin-accent)}}").ok);
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
