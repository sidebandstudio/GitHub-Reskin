// The compiled stylesheets of every Classic and C2 fixture theme, as sha256 per mode and Full or
// Calm, read from a checkout's own modules, with the Primer stylesheet's declarations of the two
// variables C2c added and C6's Brand guard left out, and the empty day's outline put back to
// main's. Recorded again where later changes are documented in the test. Not a test file itself. The
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
// C6's protected-UI change: a Brand subject that holds protected UI takes no Brand mapping.
const BRAND_HOLDS_PROTECTED = /:not\(:has\(form,a\[href\^="\/login"\][^{]*?\[data-reskin-protected\]\)\)/g;
/** The stylesheet without the declarations of the two added variables and C6's Brand guard. */
export const withoutAdded = (css) => css.replace(ADDED, "").replace(BRAND_HOLDS_PROTECTED, "");
// An empty day's outline now takes the cell's own fill, so the day is a solid square as on GitHub
// and in 1.0, where main gave it the control border. The comparison puts main's value back.
const EMPTY_DAY = "--contribution-default-borderColor-0";
const mainOutline = (css, emitted, resolved) => css.replaceAll(`${EMPTY_DAY}:${emitted.get(EMPTY_DAY)}`, `${EMPTY_DAY}:${resolved.tokens.controlBorder}`);

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
  const { compileGitHub, emittedColors, MODE_INDEX, seedFor, selectMode, standardSeed } = await load("packages/primer/index.js");
  const { repairTheme, resolveTheme } = await load("packages/engine/index.js");
  const { compileAppearance } = await load("packages/appearance/index.js");
  const out = {};
  for (const [file, theme] of baselineThemes(root, only)) {
    const source = repairTheme(theme, standardSeed(MODE_INDEX, theme.base)).theme;
    for (const mode of Object.values(MODE_INDEX.modes)) {
      if (mode.highContrast) continue;
      const plan = selectMode({ colorMode: mode.base, lightTheme: mode.base === "light" ? mode.id : "light", darkTheme: mode.base === "dark" ? mode.id : "dark", systemDark: false }, theme.base, MODE_INDEX);
      const resolved = resolveTheme(source, { seed: seedFor(MODE_INDEX, plan), policy: plan.policy, reducedMotion: false, forcedColors: false });
      const emitted = new Map(emittedColors(resolved));
      for (const [name, prefs] of [["full", PREFS], ["calm", CALM]]) {
        out[`${file} ${mode.id} ${name}`] = {
          primer: sha256(withoutAdded(mainOutline(compileGitHub(resolved, plan, prefs).css, emitted, resolved))),
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
