// The compiled stylesheets of every Classic and C2 fixture theme, as sha256 per mode and Full or
// Calm, read from a checkout's own modules, with the Primer stylesheet's declarations of the two
// variables C2c added, and C6's protected-UI rules, left out. Not a test file itself. The
// accent emphasis tests compare this checkout with the hashes recorded on main before
// overrides.accentEmphasis existed:
//   node tests/primer/compile-baseline.mjs <checkout>   prints that checkout's hashes as JSON
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PREFS = Object.freeze({ enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true });
const CALM = Object.freeze({ ...PREFS, extras: false });
const FIXTURE_DIRS = ["tests/fixtures/roundtrip", "tests/fixtures/schema/repair", "tests/fixtures/schema/valid"];
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
// The two audited variables C2c added. The Primer stylesheet clears every audited variable on
// GitHub's elements and sets each in the theme CSS scope, so it gains their declarations, and
// only those, wherever it writes the others.
const ADDED = /--reskin-accent-emphasis(?:-text)?:[^;}]*(?:;|(?=\}))/g;
// C6's protected-UI changes: a Brand subject that holds protected UI takes no Brand mapping, and
// protected UI takes back its island's own values, or the seed mode's where its island's text
// does not read at 4.5:1 on the theme's canvas, with the seed's default text for its muted text
// where the seed's does not read either. The restoring rules are left out on both sides; the
// compiler and browser tests check them.
const BRAND_HOLDS_PROTECTED = /:not\(:has\(form,a\[href\^="\/login"\][^{]*?\[data-reskin-protected\]\)\)/g;
const PROTECTED_RESTORE = /^@container style\(--reskin-on: 1\) and style\(--reskin-mode: [a-z_]+\)\{[^\n]*\n/gm;
const SEED_MUTED = /;--fgColor-muted:#[0-9a-f]{6}\}/g;
/** The stylesheet without the declarations of the two added variables and C6's protected-UI rules. */
export const withoutAdded = (css) => css.replace(ADDED, "").replace(BRAND_HOLDS_PROTECTED, "").replace(PROTECTED_RESTORE, "").replace(SEED_MUTED, "}");

/** The baseline's theme sources in a checkout: the Classics and the fixtures, by path. */
export function baselineThemes(root, only = null) {
  const catalog = JSON.parse(readFileSync(join(root, "themes/catalog.json"), "utf8"));
  const files = [
    ...catalog.filter((e) => e.group === "classics").map((e) => e.file),
    ...FIXTURE_DIRS.filter((dir) => existsSync(join(root, dir))).flatMap((dir) => readdirSync(join(root, dir)).filter((n) => n.endsWith(".reskin.json")).sort().map((n) => `${dir}/${n}`)),
  ];
  return files.filter((file) => !only || only.includes(file)).map((file) => [file, JSON.parse(readFileSync(join(root, file), "utf8"))]);
}

/** { "<file> <mode> <full|calm>": { primer, appearance } } for the checkout at root. */
export async function compileHashes(root, only = null) {
  const load = (path) => import(pathToFileURL(join(root, path)).href);
  const { compileGitHub, MODE_INDEX, seedFor, selectMode, standardSeed } = await load("packages/primer/index.js");
  const { repairTheme, resolveTheme } = await load("packages/engine/index.js");
  const { compileAppearance } = await load("packages/appearance/index.js");
  const out = {};
  for (const [file, theme] of baselineThemes(root, only)) {
    const source = repairTheme(theme, standardSeed(MODE_INDEX, theme.base)).theme;
    for (const mode of Object.values(MODE_INDEX.modes)) {
      if (mode.highContrast) continue;
      const plan = selectMode({ colorMode: mode.base, lightTheme: mode.base === "light" ? mode.id : "light", darkTheme: mode.base === "dark" ? mode.id : "dark", systemDark: false }, theme.base, MODE_INDEX);
      const resolved = resolveTheme(source, { seed: seedFor(MODE_INDEX, plan), policy: plan.policy, reducedMotion: false, forcedColors: false });
      for (const [name, prefs] of [["full", PREFS], ["calm", CALM]]) {
        out[`${file} ${mode.id} ${name}`] = {
          primer: sha256(withoutAdded(compileGitHub(resolved, plan, prefs).css)),
          appearance: sha256(compileAppearance(resolved, prefs, "github", { css: theme.css ?? null, cssAllowed: true })),
        };
      }
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await compileHashes(resolve(process.argv[2] ?? "."))));
}
