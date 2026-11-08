// The fixed table from check commands to the units that implement them. scripts/check.mjs
// imports it; there is no other registration. Each route names a module inside its owner's
// directory and a named export with the signature (CheckRunner in packages/contracts)
//
//   export async function <name>({ command, args, root, outDir }) { return { exitCode, testCount }; }
//
// args are the command's arguments, forwarded unchanged. A missing module or export fails the
// command with exit 2 and "NOT IMPLEMENTED: <command> (owner <unit>)", and testCount 0 fails a
// command that runs tests. Units implement their own module; they do not edit this table.
// scripts/README.md describes the same table for people.

export const UNITS = Object.freeze({
  C1: "Platform and deterministic build",
  C2: "Shared format and color engine",
  C3: "Primer and GitHub adapter",
  C4: "Settings and extension lifecycle",
  C5: "Appearance and shared preview",
  C6: "Extension UI",
  C7: "Showcase site",
  C8: "Userscript parity",
  C9: "Release integration",
  C10: "Hyperframes films",
});

const FORMAT = "packages/format/checks.mjs";
const ENGINE = "packages/engine/checks.mjs";
const PRIMER = "packages/primer/checks.mjs";
const SETTINGS = "packages/settings/checks.mjs";
const APPEARANCE = "packages/appearance/checks.mjs";
const UI = "packages/ui/checks.mjs";
const SITE = "site/checks.mjs";
const USERSCRIPT = "userscript/checks.mjs";
const RELEASE = "tests/release/checks.mjs";
const VIDEO = "scripts/verify-video.mjs";
const PLATFORM = "scripts/check-a11y.mjs";

// Commands C1 runs itself, in scripts/check.mjs.
export const BUILTIN = Object.freeze(["test", "harness", "toolchain", "lint-chrome", "lint-firefox"]);

// Command routes. A command with several routes takes the first whose `when` matches its
// arguments (--scope=engine or --scope engine); the last has no `when` and is the default.
// `tests: false` marks a command that produces files rather than running tests.
export const ROUTES = Object.freeze({
  release: [{ owner: "C9", module: RELEASE, export: "release" }],
  schema: [{ owner: "C2", module: FORMAT, export: "schema" }],
  themes: [{ owner: "C2", module: FORMAT, export: "themes" }],
  "classic-themes": [{ owner: "C2", module: FORMAT, export: "classicThemes" }],
  prompt: [{ owner: "C2", module: FORMAT, export: "prompt" }],
  contrast: [
    { when: { scope: "engine" }, owner: "C2", module: ENGINE, export: "contrast" },
    { owner: "C3", module: PRIMER, export: "contrast" },
  ],
  primer: [{ owner: "C3", module: PRIMER, export: "primer" }],
  "slot-contracts": [{ owner: "C3", module: PRIMER, export: "slotContracts" }],
  migrations: [{ owner: "C4", module: SETTINGS, export: "migrations" }],
  boot: [{ owner: "C4", module: SETTINGS, export: "boot" }],
  fonts: [{ owner: "C5", module: APPEARANCE, export: "fonts" }],
  effects: [{ owner: "C5", module: APPEARANCE, export: "effects" }],
  userscript: [{ owner: "C8", module: USERSCRIPT, export: "userscript" }],
  site: [{ owner: "C7", module: SITE, export: "site" }],
  budgets: [
    { when: { surface: "site" }, owner: "C7", module: SITE, export: "budgets" },
    { owner: "C9", module: RELEASE, export: "budgets" },
  ],
  "store-links": [{ owner: "C9", module: RELEASE, export: "storeLinks" }],
  video: [{ owner: "C10", module: VIDEO, export: "check" }],
  "render-video": [{ owner: "C10", module: VIDEO, export: "render", tests: false }],
  "verify-video": [{ owner: "C10", module: VIDEO, export: "verify" }],
  "capture-release": [{ owner: "C9", module: RELEASE, export: "captureRelease", tests: false }],
  "qa-live": [{ owner: "C9", module: RELEASE, export: "qaLive" }],
  "qa-firefox": [{ owner: "C9", module: RELEASE, export: "qaFirefox" }],
  "qa-userscript": [{ owner: "C9", module: RELEASE, export: "qaUserscript" }],
  "qa-published-install": [{ owner: "C9", module: RELEASE, export: "qaPublishedInstall" }],
});

// Browser test surfaces. Each owns one directory under tests/e2e and its Playwright projects;
// playwright.config.mjs is generated from this. `e2e` takes --project=<name>; `a11y` takes
// --surface=<name> and runs that surface's @a11y tests. Without a selector both run every surface
// listed for them, so a missing one fails instead of being skipped.
export const SURFACES = Object.freeze({
  platform: { owner: "C1", module: PLATFORM, projects: [["platform-chromium", "chromium"], ["platform-firefox", "firefox"]] },
  fixture: { owner: "C5", module: APPEARANCE, projects: [["fixture-chromium", "chromium"], ["fixture-firefox", "firefox"]] },
  extension: { owner: "C6", module: UI, projects: [["chromium-extension", "chromium"]] },
  site: { owner: "C7", module: SITE, projects: [["site-chromium", "chromium"], ["site-firefox", "firefox"]] },
  userscript: { owner: "C8", module: USERSCRIPT, projects: [["userscript-chromium", "chromium"], ["userscript-firefox", "firefox"]] },
  release: { owner: "C9", module: RELEASE, projects: [["release-chromium", "chromium"], ["release-firefox", "firefox"]], a11y: false },
});

export const e2eDir = (surface) => `tests/e2e/${surface}`;

// Values of --name=value or --name value in args, in order.
export function optionValues(args, name) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(`--${name}=`)) values.push(args[i].slice(name.length + 3));
    else if (args[i] === `--${name}` && i + 1 < args.length) values.push(args[++i]);
  }
  return values;
}

// args without the named options and their values.
export function withoutOptions(args, names) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const name = names.find((n) => args[i] === `--${n}` || args[i].startsWith(`--${n}=`));
    if (!name) out.push(args[i]);
    else if (args[i] === `--${name}`) i++;
  }
  return out;
}
