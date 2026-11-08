# @github-reskin/primer

The Primer adapter for renderer 1. It turns GitHub's frozen mode stylesheets into `ModeSeed` records, picks the seed for a page's GitHub mode, and compiles a resolved theme into the stylesheet GitHub reads. Pure and deterministic: no DOM, storage or network. Runtime modules import the frozen data; the engine never does.

| Export | Behavior |
| --- | --- |
| `selectMode(native, base, index)` | `ModePlan` for a `NativeMode` and theme base. Standard modes (light, dark, dimmed) use the standard seed of the theme's base; colorblind and tritanopia use their own family's seed and carry `GitHub accessibility colors are active`; every high-contrast mode returns `native-high-contrast`; an unknown mode or missing counterpart returns `native-unknown`. |
| `seedFor(index, plan)`, `standardSeed(index, base)` | The seed to pass as `ResolveContext.seed`, and the standard seed `repairTheme` needs. |
| `compileGitHub(resolved, plan, prefs, index?)` | `CompiledStyle`. Native, forced-color and disabled inputs give empty CSS. Themed output is the family seed's native baseline, then every variable in `mappings.json` from its resolved role, scoped to the GitHub mode islands the plan covers, inside `not (forced-colors: active)`. `index` defaults to the frozen production index. |
| `modeSelectors()`, `scopeSelectors(modes)` | GitHub's own island selectors per reviewed mode, mirrored exactly and checked against the frozen files. |
| `islandScope(covered, known, baseOf, branch)`, `BRAND_FOOTER` | The compiler's island selectors for one color-scheme branch: the gate, themed and native islands, and the nearest-island helper for rules that are not inherited. |
| `MODE_INDEX`, `MODE_POLICY`, `NOTICES` | The deep-frozen `vendor/primer/modes.json`, the reviewed policy and the plan notices. |

Files:

- `mode-policy.json`: every reviewed GitHub mode with its base, family, high-contrast flag and policy, plus each family's seed per base. A mode missing here blocks `scripts/refresh-primer.mjs --accept`.
- `mappings.json`: the maintained table. `seed` names the upstream variable for every `ColorSet` leaf and the opaque role a translucent value is flattened over. `emit` names every GitHub variable the compiler writes and its role, or why it is exempt from pair checks. `rolePairs` lists the C2 pair-matrix IDs covering each role. `inheritedPairs` lists foreground and background variables GitHub's own stylesheets paint together that the matrix does not name. `readableWith` and `readableOn` fall back to another resolved role, with a warning, where one of those pairings would not read. `brandFooter` maps the Primer Brand footer variables.
- `css.js`, `convert.js`, `generate.mjs`: the offline parser and converter. `node packages/primer/generate.mjs` rewrites `vendor/primer/modes.json` and `provenance.json` from `vendor/primer/source`; `--check` compares instead.
- `checks.mjs`: `check:primer` and `check:slot-contracts`.

Refreshing upstream data is a separate maintenance step: `node scripts/refresh-primer.mjs` downloads into a temporary directory and prints the delta; `--accept <dir>` freezes that reviewed download. No build or check fetches anything.

Nested islands: GitHub declares all of its mode variables on every element carrying a known mode, so an island of a high-contrast or other-family mode resets every variable the compiler writes. The compiler writes only variables every frozen mode declares.

An island whose native reset cannot be proved leaves the whole document native: an unknown mode, a color mode without the theme attribute it reads, a stray value, or an island without theme attributes other than the Primer Brand footer's. Every themed rule sits behind a `:has()` gate on the root, so browsers without `:has()` stay native too. An island without theme attributes and without element children is not detected, since nothing below it can hold another mode. In Chromium the gate re-walks the document after each DOM change that triggers a style recalculation: about 0.7 ms on a 2,800-element profile and 3.5 ms at 20,000 elements on the reference machine.

Rules that are not inherited custom properties (activity overview shape, commit-share bars, issue labels, Brand footer, selection) follow the nearest island, the native island itself included, and a themed island nested in a native one starts again. Themed islands set the inherited `--reskin-on` switch and native islands clear it. Chromium reads it with a container style query. Gecko matches gated selectors through up to three alternating islands from the root, and deeper nesting keeps GitHub's styles.

Selection: Gecko matches selection per element, so themed islands carry the selection colors in Reskin properties and everything else keeps HighlightText on Highlight. Chromium's selection inherits from the parent, and its own colors cannot be restored once an ancestor has a selection rule. So Chromium themes selection from the body of a themed root, and only while no native island is on the page. Otherwise the whole page keeps the browser's selection.
