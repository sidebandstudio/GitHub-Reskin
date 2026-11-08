# @github-reskin/engine

Renderer 1 color engine. Pure and deterministic: no DOM, storage, network, clocks or randomness. Inputs are never mutated; outputs are deep-frozen.

| Export | Behavior |
| --- | --- |
| `resolveTheme(theme, context)` | `context` is `{seed, policy, reducedMotion, forcedColors}`. Forced colors, `native-high-contrast` and `native-unknown` return the null-color branch. `themed` needs a same-base, non-high-contrast seed and returns every `ColorSet` color plus font, effects with defaults filled, flavor, `motionAllowed`, render-only `repairs` and the 287-entry `pairAudit`. Invalid themes or contexts throw before anything is derived. |
| `repairTheme(theme, standardSeed)` | Portable source repair against a same-base standard seed. Changes only fields the source already has, through the source-role mapping, plus an invalid supplied `contributions.levels`. Repeats to a fixed point, so a second call returns no repairs. |
| `auditPairs(resolved)` | One unrounded `PairResult` per foreground/background pair of a themed resolution. |
| `PAIR_MATRIX` | `pairs.json`, the C2-owned matrix: 67 records, 287 checks. C3 requests changes; it does not edit this file. |
| `graphProblems`, `rampDirection`, `deriveRamp` | The contribution ramp rules. |
| `contrast`, `luminance`, `mix`, `oklab`, `bestInk`, `fit`, `sha256` | The fixed color math. |
| `seedProblems`, `pairMatrixProblems` | Input validation for ModeSeed records and pair matrices. |

Repair order follows ARCHITECTURE.md: core text, surfaces from the repaired ink, then each pair in a fixed order, with the matrix repeated until nothing changes. A foreground that spans several surfaces keeps its side of the canvas when that side can pass there; offending secondary surfaces move toward the canvas instead, and the canvas never moves. Accent emphasis and status emphasis fills are repaired against the shared emphasis ink, never the reverse. Colorblind and tritanopia seeds replace supplied status inks, logged as render repairs with the reason `GitHub accessibility colors are active.`

Graph ramps: a valid supplied ramp is kept exactly. Otherwise the derived ramp is tried, then the same ramp with its seed moved toward the extreme, then levels 1-4 spread evenly from the first mix that reaches 3:1 on the canvas, then the seed's own ramp. The 35% first level of the derived ramp seldom reaches 3:1 on its own, so most derived ramps take one of the later steps.

`checks.mjs` exports `run({command, args, root, outDir})` for `check:contrast`. `--scope=engine` uses the four synthetic seeds; `--scope=primer` loads every themed seed from C3's `vendor/primer/modes.json` with the twelve Classics; no scope is the full gate over all 25 catalog themes. `--themes <dir>` adds staged theme files. Primer and full scopes report NOT IMPLEMENTED until the mode index exists.
