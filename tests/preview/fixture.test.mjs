// The preview's offline whoisaldo fixture, its Primer variables and its configuration contract.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { FLAVOR_SLOT_IDS, PREVIEW_VIEWS } from "../../packages/contracts/index.js";
import { repairTheme, resolveTheme } from "../../packages/engine/index.js";
import { ASSET_DIR, DEFAULT_DORMANT_SLOTS, FIXTURE, FIXTURE_CSS, PREVIEW_SANDBOX, PREVIEW_VARIABLES, VIEWS, colorAt, configurePreview, createFixtureRenderer, mountPreview, nativeBaseline, styleText } from "../../packages/preview/index.js";
import * as primer from "../fixture-app/product/primer-double.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const ALLOWED = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "a", "img", "strong", "em", "code", "br"]);

test("the profile fixture keeps the capture's identity, pins and full calendar", () => {
  const { profile, contributions, repository, source } = FIXTURE;
  assert.equal(source.profileUrl, "https://github.com/whoisaldo");
  assert.match(source.profileSha256, /^[0-9a-f]{64}$/);
  assert.equal(profile.login, "whoisaldo");
  assert.equal(profile.displayName, "Ali Younes");
  assert.equal(profile.pinned.length, 6);
  assert.equal(contributions.heading, "5,216 contributions in the last year");
  assert.equal(contributions.levels.length, 365);
  assert.equal(contributions.counts.length, 365);
  assert.ok(contributions.levels.every((level) => Number.isInteger(level) && level >= 0 && level <= 4));
  assert.ok(contributions.counts.every((count) => Number.isInteger(count) && count >= 0));
  assert.equal(new Date(`${contributions.start}T00:00:00Z`).getUTCDay(), 0, "weeks start on Sunday");
  assert.equal(`${repository.owner}/${repository.name}`, "sidebandstudio/GitHub-Reskin");
});

test("the fixture carries no email, no remote image and only allowlisted README markup", () => {
  const text = JSON.stringify(FIXTURE);
  assert.doesNotMatch(text, /mailto:|@[a-z0-9-]+\.(com|dev|edu|io)\b(?!")/i);
  const walk = (nodes) => {
    for (const node of nodes) {
      if (typeof node === "string") continue;
      const [tag, attrs, ...children] = node;
      assert.ok(ALLOWED.has(tag), tag);
      if (tag === "a") assert.match(attrs.href, /^https:\/\//);
      if (tag === "img") {
        assert.ok(existsSync(`${ROOT}${ASSET_DIR}${attrs.asset}`), attrs.asset);
        if (attrs.dark) assert.ok(existsSync(`${ROOT}${ASSET_DIR}${attrs.dark}`), attrs.dark);
        assert.ok(attrs.alt.length > 0);
      }
      walk(children);
    }
  };
  walk(FIXTURE.profile.readme);
  walk(FIXTURE.repository.readme);
  assert.ok(existsSync(`${ROOT}${ASSET_DIR}${FIXTURE.profile.avatar.asset}`));
});

test("every preview variable resolves for seeds and themes, and the fixture CSS uses no others", () => {
  const used = new Set(FIXTURE_CSS.match(/var\(--[A-Za-z0-9-]+/g).map((v) => v.slice(4)));
  for (const name of used) assert.ok(Object.hasOwn(PREVIEW_VARIABLES, name), `${name} is not a preview variable`);
  for (const name of Object.keys(PREVIEW_VARIABLES)) assert.ok(used.has(name), `${name} is unused`);
  assert.doesNotMatch(FIXTURE_CSS, /url\(|@import|@font-face/);
  for (const seed of Object.values(primer.MODE_INDEX.modes)) {
    for (const path of Object.values(PREVIEW_VARIABLES)) assert.match(colorAt(seed.colors, path), /^#[0-9a-f]{6}$/);
    for (const name of Object.keys(PREVIEW_VARIABLES)) assert.ok(primer.MODE_INDEX.nativeCss[seed.id].includes(`${name}:`), `${seed.id} lacks ${name}`);
  }
  const theme = JSON.parse(readFileSync(`${ROOT}themes/classics/dracula.reskin.json`, "utf8"));
  const seed = primer.MODE_INDEX.modes["fixture.standard-dark"];
  const resolved = resolveTheme(repairTheme(theme, seed).theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
  for (const path of Object.values(PREVIEW_VARIABLES)) assert.match(colorAt(resolved, path), /^#[0-9a-f]{6}$/);
});

test("the native baseline wraps the ModeIndex declaration list in a root rule with the mode's color scheme", () => {
  const css = nativeBaseline(primer.MODE_INDEX, "fixture.standard-dark");
  assert.match(css, /^:root\{color-scheme:dark;--bgColor-default:#[0-9a-f]{6};/);
  assert.ok(css.endsWith("}"));
  assert.equal((css.match(/[{}]/g) || []).length, 2, "one rule");
  for (const bad of ["", "--x:#000}body{color:red", "--x:</style>"]) {
    const index = { ...primer.MODE_INDEX, nativeCss: { ...primer.MODE_INDEX.nativeCss, "fixture.standard-dark": bad } };
    assert.throws(() => nativeBaseline(index, "fixture.standard-dark"), /native CSS/);
  }
});

// C3's production mapping and native CSS, when C3 is in the checkout: every variable the fixture
// reads must be emitted by the compiler and declared by each standard mode's native CSS.
const C3 = existsSync(`${ROOT}packages/primer/index.js`) && existsSync(`${ROOT}vendor/primer/modes.json`);
// Registered only with C3 present, since the runner fails on a skipped test.
(C3 ? test : () => {})("every fixture variable is one C3 emits and declares natively", async () => {
  const c3 = await import(`${ROOT}packages/primer/index.js`);
  const mappings = JSON.parse(readFileSync(`${ROOT}packages/primer/mappings.json`, "utf8"));
  const emitted = new Map(mappings.emit.map((entry) => [entry.variable, entry.role]));
  for (const [name, path] of Object.entries(PREVIEW_VARIABLES)) assert.equal(emitted.get(name), path, `${name} maps to ${emitted.get(name)} in C3`);
  for (const mode of ["light", "dark"]) {
    const declared = new Set(c3.MODE_INDEX.nativeCss[mode].split(";").map((d) => d.slice(0, d.indexOf(":"))));
    for (const name of Object.keys(PREVIEW_VARIABLES)) assert.ok(declared.has(name), `${mode} native CSS lacks ${name}`);
    assert.doesNotThrow(() => nativeBaseline(c3.MODE_INDEX, mode));
  }
});

test("the styled frame's sandbox grants nothing, and style text cannot close its element", () => {
  assert.equal(PREVIEW_SANDBOX, "");
  assert.equal(styleText(":root{--a:#000}.x>.y{color:red}"), ":root{--a:#000}.x>.y{color:red}");
  for (const bad of ["</style><script>", "a{content:\"<\"}", "<!--"]) assert.throws(() => styleText(bad), /cannot be written/);
});

test("views cover the contract and anchor only real slot IDs", () => {
  assert.deepEqual(Object.keys(VIEWS).sort(), [...PREVIEW_VIEWS].sort());
  for (const slot of DEFAULT_DORMANT_SLOTS) assert.ok(FLAVOR_SLOT_IDS.includes(slot));
});

test("configuration is required and validated before anything mounts", () => {
  const element = { nodeType: 1 };
  assert.throws(() => configurePreview({ primer: {}, modeIndex: primer.MODE_INDEX }), /selectMode/);
  assert.throws(() => configurePreview({ primer, modeIndex: { contractVersion: 2 } }), /ModeIndex/);
  assert.throws(() => configurePreview({ primer, modeIndex: primer.MODE_INDEX, resources: { fontUrl() {} } }), /resource adapter/);
  const light = Object.fromEntries(Object.entries(primer.MODE_INDEX.modes).filter(([, m]) => m.base === "light"));
  assert.throws(() => configurePreview({ primer, modeIndex: { ...primer.MODE_INDEX, modes: light } }), /standard dark/);
  configurePreview({ primer, modeIndex: primer.MODE_INDEX });
  const theme = JSON.parse(readFileSync(`${ROOT}themes/classics/nord.reskin.json`, "utf8"));
  const preferences = { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true };
  assert.throws(() => mountPreview(element, { view: "settings", theme, preferences }), /view/);
  assert.throws(() => mountPreview(element, { view: "profile", theme: { ...theme, colors: { background: "red" } }, preferences }), /valid theme/);
  assert.throws(() => mountPreview(element, { view: "profile", theme, preferences: { ...preferences, motion: "yes" } }), /motion/);
  assert.throws(() => mountPreview(null, { view: "profile", theme, preferences }), /container/);
  assert.equal(typeof createFixtureRenderer, "function");
});
