# Build and check scripts

Every command runs from the repository root under the pinned toolchain (Node 24.22.2, npm 11.12.1)
after `npm ci` and `npx --no-install playwright install chromium firefox`. Builds and checks make
no network requests.

| Script | What it does |
| --- | --- |
| `build.mjs` | Builds `chrome`, `firefox`, `userscript`, `shared` and `site` targets into `dist/`. |
| `package.mjs` | Writes the ZIPs, userscript, reviewer source archive, `SHA256SUMS` and `build-info.json` to `artifacts/`. |
| `verify-artifacts.mjs`, `verify-repro.mjs` | `check:artifacts` and `check:repro`, run directly or through `check.mjs`. |
| `check.mjs` | Every check, through the routing table below, and C1's own checks. |
| `check-routes.mjs` | The routing table itself. |
| `check-a11y.mjs` | The Playwright surface runner every surface's `test:e2e` and `a11y` checks use. |
| `serve.mjs` | The static fixture and site server, on a free port bound to 0.0.0.0. |
| `userscript.mjs` | Compatibility entry for `userscript/build.mjs`, which generates the userscript from the product packages. |
| `refresh-primer.mjs` | Maintenance only: refetches GitHub's mode CSS into `vendor/primer`. No build or check runs it. |

## Check routing

`node scripts/check.mjs <command> [args]` runs a check, and every `check:*`, `test`, `test:e2e`,
`lint:*`, `qa:*` and video npm script calls it. Each command is a fixed route in
`check-routes.mjs` to one module, which exports the common runner:

```js
// packages/format/checks.mjs (C2), which serves schema, prompt, css, themes and classic-themes
export async function run({ command, args, root, outDir }) {
  if (command === "schema") {
    // ... run the checks ...
    return { exitCode: 0, testCount: 42 };
  }
  // ...
}
```

- `command` is the dispatcher key from the table below (`schema`, `contrast`, `test:e2e`, `a11y`
  and so on). `args` is the ordered argument array after the command, with npm's `--` separator
  removed, forwarded unchanged: `--scope`, `--surface`, `--project`, `--require-live`,
  `--read-only` and the rest reach the module as typed. The module validates what it supports.
  `root` is the absolute implementation root and `outDir` the absolute build-output root,
  `<root>/dist`. Modules never change the working directory.
- `exitCode` 0 passes; anything else fails the command with that code. `testCount` is the number
  of real tests or assertions run. Both are nonnegative integers. Zero with exit 0 fails, except
  for `render-video` and `capture-release`, which produce files. A thrown error or a malformed
  result fails with exit 1.
- Until the module and its `run` export exist the command fails with exit 2 and
  `NOT IMPLEMENTED: <command> (owner <unit>): <module> does not exist` (or `has no run export`).
- The types are `CheckRunner` and `CheckModule` in `packages/contracts`. Units add their module;
  they never edit `check.mjs` or `check-routes.mjs`.

| Command | Owner | Module |
| --- | --- | --- |
| `test`, `harness`, `toolchain`, `lint-chrome`, `lint-firefox` | C1 | `scripts/check.mjs` (local) |
| `artifacts`, `repro` | C1 | `scripts/verify-artifacts.mjs`, `scripts/verify-repro.mjs` |
| `schema`, `prompt`, `css`, `themes`, `classic-themes` | C2 | `packages/format/checks.mjs` |
| `contrast`, every scope (`--scope=engine`, `--scope=primer`, none) | C2 | `packages/engine/checks.mjs` |
| `primer`, `slot-contracts` | C3 | `packages/primer/checks.mjs` |
| `migrations`, `boot` | C4 | `packages/settings/checks.mjs` |
| `fonts`, `effects` | C5 | `packages/appearance/checks.mjs` |
| `site` | C7 | `site/checks.mjs` |
| `budgets -- --surface=site` | C7 | `site/checks.mjs` |
| `userscript` | C8 | `userscript/checks.mjs` |
| `video`, `render-video`, `verify-video` | C10 | `scripts/verify-video.mjs` |
| `release`, `budgets` (no site surface), `store-links` | C9 | `tests/release/checks.mjs` |
| `capture-release`, `qa-live`, `qa-firefox`, `qa-userscript`, `qa-published-install` | C9 | `tests/release/checks.mjs` |

A command with a selector (`budgets --surface=site`) takes the first matching row and otherwise
the command's default row. Arguments are forwarded either way, so C2's contrast `run` sees
`--scope=primer` and loads C3's data itself.

`check:release` runs DONE.md's gate one step at a time, each as its own `node scripts/check.mjs`
process, and stops at the first failure. With `RESKIN_CHECK_RESULT` set to a file path,
`check.mjs` writes its `{ exitCode, testCount }` there, which is how the release check reads each
step's test count. It writes `artifacts/reports/release.json`. `check:budgets` without a surface
writes `artifacts/reports/budgets.json` and fails on any measurement it can't find, including the
browser timings in `artifacts/reports/release-timings.json`. The release surface's `test:e2e`
writes that file: its timing tests each record one measurement under
`artifacts/reports/release-timings/`, and the module merges them after the run, replacing the
last run's file even when a test fails.

`qa:live -- --read-only` runs `scripts/qa-live.mjs` against public GitHub with the packages in
`artifacts/`, so `npm run package` comes first, and records the commit `build-info.json` names.
It needs the network, and `check:release` does not run it. Each page loads natively and with the
extension in Chromium and Firefox, at 1440 and 390 pixels wide. GitHub's text, labels, controls
and accessibility tree, without the extension's nodes, must match, and rendered text may not
read worse than WCAG AA where GitHub's own does. Chromium also switches through every theme on a
profile, the repository and a diff, and checks each is the selected theme with its own canvas. The report
and screenshots go to `artifacts/reports/live/`. GitHub outages, rate limits and markup changes
are counted apart from product failures, and any failure exits 1. The Gist comes from GitHub's
API, which allows 60 logged-out calls an hour per address; a `GITHUB_TOKEN` lifts that, and the
browsers stay logged out.

`qa:firefox [-- --firefox <path>]` runs `scripts/qa-firefox.mjs` in an actual Firefox release, not
Playwright's patched build. It takes `--firefox`, then `RESKIN_FIREFOX`, then the usual install
path, and fails without one. It installs the Firefox package from `artifacts/` as a temporary
add-on in a fresh profile, as `web-ext run` does, and checks the first-run tab, a theme chosen
there reaching public GitHub, the add-on's fonts under GitHub's CSP, importing a theme file and
exporting it again, settings across a restart and the on/off switch. Playwright's WebDriver BiDi
mode drives the GitHub tab, and Firefox's remote debugging protocol drives and photographs the
add-on's own pages, which BiDi does not reach. The report and screenshots go to
`artifacts/reports/firefox/`, and it prints how to repeat the run by hand.

`qa:userscript [-- --firefox <path>]` runs `scripts/qa-userscript.mjs`: the packaged userscript in
real Violentmonkey and Tampermonkey, in Chromium and an actual Firefox release, installed through
each manager's own install page. On public GitHub, logged out, it checks the default theme, the
panel from `#reskin` with its controls, a pick, typing and Escape in the panel, the pick after a
reload, importing and saving a theme file in Make a theme, and disabling the script in the
manager's dashboard. The panel has its controls only where the manager keeps the script apart from
GitHub's own JavaScript, so a manager that runs it in the page fails that check with the panel's
note. Violentmonkey and Tampermonkey for Firefox are pinned by SHA-256; Tampermonkey for Chrome
comes from the Chrome Web Store, which serves only its current version, so its version and hash are
recorded. Downloads are kept in `artifacts/qa-cache/managers/`; the report and screenshots go to
`artifacts/reports/userscript/`.

`capture-release` and `qa-published-install` still fail with exit 2.

### Browser surfaces

`test:e2e` and `a11y` dispatch by surface, calling each selected surface module's `run` with
command `test:e2e` or `a11y`. Each surface owns one directory under `tests/e2e` and its
Playwright projects in `playwright.config.mjs`:

| Surface | Owner | Projects | Module |
| --- | --- | --- | --- |
| platform | C1 | platform-chromium, platform-firefox | `scripts/check.mjs` (local) |
| fixture | C5 | fixture-chromium, fixture-firefox | `packages/appearance/checks.mjs` |
| extension | C6 | chromium-extension | `packages/ui/checks.mjs` |
| site | C7 | site-chromium, site-firefox | `site/checks.mjs` |
| userscript | C8 | userscript-chromium, userscript-firefox | `userscript/checks.mjs` |
| release | C9 | release-chromium, release-firefox | `tests/release/checks.mjs` |

- `--surface=<name>` selects a surface and `--project=<name>` selects the surface owning that
  project. Both may be given only when they agree; unknown or conflicting selectors fail exit 1
  before anything runs. Without a selector every surface runs, release included, and the
  dispatcher prints each route's result and count.
- A request touching one surface passes `args` unchanged. One spanning several gives each
  surface the same arguments without the other surfaces' `--surface`/`--project` selectors.
- A surface module builds what its tests need, then calls the shared runner:

  ```js
  import { runSurface } from "../../scripts/check-a11y.mjs";
  export async function run({ command, args, root }) {
    if (command === "test:e2e") return runSurface("fixture", { args, root });
    if (command === "a11y") return runSurface("fixture", { args, root, a11y: true });
    // fonts, effects ...
  }
  ```

  `runSurface` rejects projects and surfaces that are not its own, lists the projects without
  launching a browser and fails if any discovers no tests, then runs them and fails on any
  failure, skip, `fixme` or expected failure. With `a11y` it runs only tests tagged `@a11y`.
  Other arguments, such as `--headed`, go to Playwright.
- Specs are `*.spec.mjs`. `*.chromium.spec.mjs` runs only in Chromium projects and
  `*.firefox.spec.mjs` only in Firefox ones, so no test skips itself.
- Import `test` and `expect` from `tests/helpers/e2e.mjs`, which adds a `serveDir(root)` fixture
  (scripts/serve.mjs on a free port, closed after the worker) and `platformApp`. Browser launch
  and cleanup are in `tests/helpers/browsers.mjs`: `launchTestExtension()` builds the Chrome
  package with the test-only `http://127.0.0.1/*` match into a temporary directory and loads it
  unpacked in Chromium; `launchFirefox()` starts Playwright's Firefox. axe-core runs through
  `tests/helpers/a11y.mjs`, where serious and critical findings block.

`npm run check:harness` runs `tests/foundation/harness.test.mjs` (routing, zero-discovery and
missing-target failures against stub modules, without a browser), then `test:e2e --surface=platform`
for both platform projects and `a11y --surface=platform`, so the same dispatch later surfaces use
is proven in Chromium and Firefox.

## Build targets

- `build:shared -- --scope=<scope>` (JS: `build({ target: "shared", scope })`) bundles each
  package of a scope into `dist/shared/<name>.js`, platform-neutral ESM, and copies the scope's
  required inputs to `dist/shared/<same path>`:

  | Scope | Packages | Inputs |
  | --- | --- | --- |
  | `engine` | contracts, format, engine | |
  | `primer` | engine's, primer (C3) | `vendor/primer/modes.json` (C3), `licenses/primer-primitives.txt` (C1) |
  | `preview` | primer's, appearance, preview (C5) | primer's, and for each bundled font ID its WOFF2 per reviewed weight (`assets/fonts/<id>/<id>.woff2`, `<id>-<weight>.woff2`) and `assets/fonts/<id>/OFL.txt` (C5) |
  | none | preview's, settings (C4), ui (C6) | preview's |

  A missing package, package entry or input fails with exit 2, `NOT IMPLEMENTED: shared
  --scope=<scope> (owner ...)`, naming each missing path and its owner. An input or entry that
  is not a nonempty regular file, JSON that does not parse or holds no data, and a bundle that
  comes out empty fail with exit 1, naming the path and owner.
- `build:site` calls `build({ outDir, config })` exported by `site/build.mjs` (C7, type
  `SiteBuild`), with `outDir` the emptied `dist/site` and `config` the parsed
  `release.config.json`. It fails with exit 2 until that export exists, and with exit 1 if it
  writes nothing or no nonempty `index.html`.
- `build` builds every target and fails while any is not implemented.
