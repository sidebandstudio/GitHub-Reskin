# @github-reskin/primer

The Primer adapter for renderer 1. It turns GitHub's frozen mode stylesheets into `ModeSeed` records, picks the seed for a page's GitHub mode, and compiles a resolved theme into the stylesheet GitHub reads. Pure and deterministic: no DOM, storage or network. Runtime modules import the frozen data; the engine never does.

| Export | Behavior |
| --- | --- |
| `selectMode(native, base, index)` | `ModePlan` for a `NativeMode` and theme base. Standard modes (light, dark, dimmed) use the standard seed of the theme's base; colorblind and tritanopia use their own family's seed and carry `GitHub accessibility colors are active`; every high-contrast mode returns `native-high-contrast`; an unknown mode or missing counterpart returns `native-unknown`. |
| `seedFor(index, plan)`, `standardSeed(index, base)` | The seed to pass as `ResolveContext.seed`, and the standard seed `repairTheme` needs. |
| `compileGitHub(resolved, plan, prefs, index?)` | `CompiledStyle`. Native, forced-color and disabled inputs give empty CSS. Themed output is the family seed's native baseline, then every variable in `mappings.json` from its resolved role, scoped to the GitHub mode islands the plan covers, inside `not (forced-colors: active)`. `index` defaults to the frozen production index. |
| `modeSelectors()`, `scopeSelectors(modes)` | GitHub's own island selectors per reviewed mode, mirrored exactly and checked against the frozen files. |
| `islandScope(covered, known, baseOf, branch)`, `BRAND_FOOTER` | The compiler's island selectors for one color-scheme branch: unsafe boundaries, eligible, themed and native islands, and the nearest-island helper for rules that are not inherited. |
| `MODE_INDEX`, `MODE_POLICY`, `NOTICES` | The deep-frozen `vendor/primer/modes.json`, the reviewed policy and the plan notices. |

Files:

- `mode-policy.json`: every reviewed GitHub mode with its base, family, high-contrast flag and policy, plus each family's seed per base. A mode missing here blocks `scripts/refresh-primer.mjs --accept`.
- `mappings.json`: the maintained table. `seed` names the upstream variable for every `ColorSet` leaf and the opaque role a translucent value is flattened over. `emit` names every GitHub variable the compiler writes and its role, or why it is exempt from pair checks. `rolePairs` lists the C2 pair-matrix IDs covering each role. `inheritedPairs` lists foreground and background variables GitHub's own stylesheets paint together that the matrix does not name. `readableWith` and `readableOn` fall back to another resolved role, with a warning, where one of those pairings would not read. `brandFooter` maps the Primer Brand footer variables.
- `css.js`, `convert.js`, `generate.mjs`: the offline parser and converter. `node packages/primer/generate.mjs` rewrites `vendor/primer/modes.json` and `provenance.json` from `vendor/primer/source`; `--check` compares instead.
- `checks.mjs`: `check:primer` and `check:slot-contracts`.

Refreshing upstream data is a separate maintenance step: `node scripts/refresh-primer.mjs` downloads into a temporary directory and prints the delta; `--accept <dir>` freezes that reviewed download. No build or check fetches anything.

Nested islands: GitHub declares all of its mode variables on every element carrying a known mode, so an island of a high-contrast or other-family mode resets every variable the compiler writes. The compiler writes only variables every frozen mode declares.

An island whose native reset cannot be proved is unsafe: an unknown mode, a color mode without the theme attribute it reads, a stray value, or any island without theme attributes, empty and text-only ones included, other than the Primer Brand footer's. That footer is recognized only in GitHub's structure, `react-partial[partial-name="marketing-footer"] > div > [data-color-mode]` around `footer[role="contentinfo"]`. An unsafe island inherits from its nearest island with theme attributes. When that island is themed it is suppressed: it keeps GitHub's own declarations for its mode and clears the Reskin switches. When it is a native island, its reset already protects the unsafe one, and nothing above it is suppressed. Every other island stays themed. The nearest island is found through three islands with theme attributes from the root; a deeper island is suppressed by any unsafe island inside it. Brand footer variables are not reset by GitHub's mode files, so the footer keeps GitHub's Brand colors while it holds an island of an unknown mode. Each suppression depth is a `:has()` on the islands themselves, so browsers without `:has()` drop the themed rules and stay native.

In Chromium each `:has()` walks the subtree it is anchored on after a DOM change below it. The compiler anchors them on islands and, for selection, once on the body. On the reference M1 Max, an append, remove and style flush takes 0.6 ms p95 on a 2,800-element page and 2.2 ms at 20,000 elements with a themed root, and 0.1 ms when the root is suppressed.

Rules that are not inherited custom properties (activity overview shape, commit-share bars, issue labels, Brand footer, selection) follow the nearest island, the native island itself included, and a themed island nested in a native one starts again. Eligible islands set the inherited `--reskin-on` switch and every other island with theme attributes clears it. A graph or label that is itself an island follows its own mode. For other subjects Chromium reads the switch with a container style query, which reads the parent's. Gecko matches selectors through up to three islands with theme attributes from the root, and deeper subjects keep GitHub's styles.

Selection: Gecko matches selection per element, so themed islands carry the selection colors in Reskin properties and everything else keeps HighlightText on Highlight. Chromium's selection inherits from the parent, and its own colors cannot be restored once an ancestor has a selection rule. So Chromium themes selection from the body of a themed root, and only while every island on the page is the plan's or the Brand footer's. Otherwise the whole page keeps the browser's selection.
