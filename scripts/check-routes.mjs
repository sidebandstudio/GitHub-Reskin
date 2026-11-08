// The fixed table from check commands to the units that implement them. scripts/check.mjs
// imports it; there is no other registration. Every route names one module, which exports the
// common runner (CheckRunner in packages/contracts):
//
//   export async function run({ command, args, root, outDir }) { return { exitCode, testCount }; }
//
// command is the dispatcher key below, args the arguments after it, forwarded unchanged, root the
// absolute implementation root and outDir the absolute build-output root (<root>/dist). A missing
// module or run export fails the command with exit 2 and NOT IMPLEMENTED, naming the owner and the
// path, and testCount 0 fails a command that runs tests. Units implement their own module; they do
// not edit this table. scripts/README.md describes the same table for people.

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

// C1's local implementations live in scripts/check.mjs itself.
const LOCAL = "scripts/check.mjs";
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

const c1 = { owner: "C1", module: LOCAL, local: true };

// Command routes. A command with several routes takes the first whose `when` matches its
// arguments (--surface=site or --surface site); the last has no `when` and is the default.
// `tests: false` marks a command that produces files rather than running tests.
export const ROUTES = Object.freeze({
  test: [c1],
  harness: [c1],
  toolchain: [c1],
  "lint-chrome": [c1],
  "lint-firefox": [c1],
  artifacts: [{ owner: "C1", module: "scripts/verify-artifacts.mjs" }],
  repro: [{ owner: "C1", module: "scripts/verify-repro.mjs" }],
  schema: [{ owner: "C2", module: FORMAT }],
  prompt: [{ owner: "C2", module: FORMAT }],
  themes: [{ owner: "C2", module: FORMAT }],
  "classic-themes": [{ owner: "C2", module: FORMAT }],
  // Every scope, including none: C2 orchestrates contrast and loads C3's data for --scope=primer.
  contrast: [{ owner: "C2", module: ENGINE }],
  primer: [{ owner: "C3", module: PRIMER }],
  "slot-contracts": [{ owner: "C3", module: PRIMER }],
  migrations: [{ owner: "C4", module: SETTINGS }],
  boot: [{ owner: "C4", module: SETTINGS }],
  fonts: [{ owner: "C5", module: APPEARANCE }],
  effects: [{ owner: "C5", module: APPEARANCE }],
  site: [{ owner: "C7", module: SITE }],
  budgets: [
    { when: { surface: "site" }, owner: "C7", module: SITE },
    { owner: "C9", module: RELEASE },
  ],
  userscript: [{ owner: "C8", module: USERSCRIPT }],
  video: [{ owner: "C10", module: VIDEO }],
  "render-video": [{ owner: "C10", module: VIDEO, tests: false }],
  "verify-video": [{ owner: "C10", module: VIDEO }],
  release: [{ owner: "C9", module: RELEASE }],
  "store-links": [{ owner: "C9", module: RELEASE }],
  "capture-release": [{ owner: "C9", module: RELEASE, tests: false }],
  "qa-live": [{ owner: "C9", module: RELEASE }],
  "qa-firefox": [{ owner: "C9", module: RELEASE }],
  "qa-userscript": [{ owner: "C9", module: RELEASE }],
  "qa-published-install": [{ owner: "C9", module: RELEASE }],
});

// The browser-surface commands. Each selects surfaces with --surface=<name> and/or
// --project=<name> and calls each selected surface's module with this command key.
export const SURFACE_COMMANDS = Object.freeze(["test:e2e", "a11y"]);

// Browser test surfaces. Each owns one directory under tests/e2e and its Playwright projects;
// playwright.config.mjs is generated from this. Without a selector both surface commands run
// every surface, so a missing one fails instead of being skipped.
export const SURFACES = Object.freeze({
  platform: { ...c1, projects: [["platform-chromium", "chromium"], ["platform-firefox", "firefox"]] },
  fixture: { owner: "C5", module: APPEARANCE, projects: [["fixture-chromium", "chromium"], ["fixture-firefox", "firefox"]] },
  extension: { owner: "C6", module: UI, projects: [["chromium-extension", "chromium"]] },
  site: { owner: "C7", module: SITE, projects: [["site-chromium", "chromium"], ["site-firefox", "firefox"]] },
  userscript: { owner: "C8", module: USERSCRIPT, projects: [["userscript-chromium", "chromium"], ["userscript-firefox", "firefox"]] },
  release: { owner: "C9", module: RELEASE, projects: [["release-chromium", "chromium"], ["release-firefox", "firefox"]] },
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

// args without the named options whose value fails keep(name, value), in order.
export function withoutOptions(args, names, keep = () => false) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const name = names.find((n) => (args[i] === `--${n}` && i + 1 < args.length) || args[i].startsWith(`--${n}=`));
    if (!name) {
      out.push(args[i]);
      continue;
    }
    const pair = args[i] === `--${name}`;
    const value = pair ? args[i + 1] : args[i].slice(name.length + 3);
    if (keep(name, value)) out.push(...(pair ? [args[i], args[i + 1]] : [args[i]]));
    if (pair) i++;
  }
  return out;
}
