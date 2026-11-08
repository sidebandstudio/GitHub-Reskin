# Build and check scripts

Every command runs from the repository root under the pinned toolchain (Node 24.22.2, npm 11.12.1)
after `npm ci` and `npx --no-install playwright install chromium firefox`. Builds and checks make
no network requests.

| Script | What it does |
| --- | --- |
| `build.mjs` | Builds `chrome`, `firefox`, `userscript`, `shared` and `site` targets into `dist/`. |
| `package.mjs` | Writes the ZIPs, userscript, reviewer source archive, `SHA256SUMS` and `build-info.json` to `artifacts/`. |
| `verify-artifacts.mjs`, `verify-repro.mjs` | `check:artifacts` and `check:repro`. |
| `check.mjs` | Every other check, through the routing table below. |
| `check-routes.mjs` | The routing table itself. |
| `check-a11y.mjs` | The Playwright surface runner, and the platform surface's e2e and accessibility checks. |
| `serve.mjs` | The static fixture and site server, on a free port bound to 0.0.0.0. |
| `userscript.mjs` | Generates the userscript from the 1.1.0 extension. |
| `github-modes.mjs` | Maintenance only: refetches GitHub's mode CSS. No build or check runs it. |

## Check routing

`node scripts/check.mjs <command> [args]` runs a check, and every `check:*`, `test`, `test:e2e`,
`lint:*`, `qa:*` and video npm script calls it. C1 runs `test`, `harness`, `toolchain`,
`lint-chrome` and `lint-firefox` itself. Every other command is a fixed route in
`check-routes.mjs` to a named export of a module the owning unit writes:

```js
// packages/format/checks.mjs (C2)
export async function schema({ command, args, root, outDir }) {
  // ... run the checks ...
  return { exitCode: 0, testCount: 42 };
}
```

- `command` is the command name, `args` its arguments after `--`, forwarded unchanged; `root` is
  the repository root and `outDir` is `artifacts/reports`, where a check writes its report.
- `exitCode` 0 passes; anything else fails the command with that code. `testCount` is the number
  of tests or assertions actually run. Zero with exit 0 fails, except for `render-video` and
  `capture-release`, which produce files. A thrown error or a malformed result fails with exit 1.
- Until the module and export exist the command fails with exit 2 and
  `NOT IMPLEMENTED: <command> (owner <unit>): <module> does not exist`.
- The type is `CheckRunner` in `packages/contracts`. Units add their module; they never edit
  `check.mjs` or `check-routes.mjs`.

| Command | Owner | Module | Export |
| --- | --- | --- | --- |
| `schema`, `themes`, `classic-themes`, `prompt` | C2 | `packages/format/checks.mjs` | `schema`, `themes`, `classicThemes`, `prompt` |
| `contrast -- --scope=engine` | C2 | `packages/engine/checks.mjs` | `contrast` |
| `contrast` (any other scope, including `--scope=primer`) | C3 | `packages/primer/checks.mjs` | `contrast` |
| `primer`, `slot-contracts` | C3 | `packages/primer/checks.mjs` | `primer`, `slotContracts` |
| `migrations`, `boot` | C4 | `packages/settings/checks.mjs` | `migrations`, `boot` |
| `fonts`, `effects` | C5 | `packages/appearance/checks.mjs` | `fonts`, `effects` |
| `site` | C7 | `site/checks.mjs` | `site` |
| `budgets -- --surface=site` | C7 | `site/checks.mjs` | `budgets` |
| `userscript` | C8 | `userscript/checks.mjs` | `userscript` |
| `video`, `render-video`, `verify-video` | C10 | `scripts/verify-video.mjs` | `check`, `render`, `verify` |
| `release`, `budgets`, `store-links` | C9 | `tests/release/checks.mjs` | `release`, `budgets`, `storeLinks` |
| `capture-release`, `qa-live`, `qa-firefox`, `qa-userscript`, `qa-published-install` | C9 | `tests/release/checks.mjs` | `captureRelease`, `qaLive`, `qaFirefox`, `qaUserscript`, `qaPublishedInstall` |

A command with a selector (`--scope`, `--surface`) takes the first matching row and otherwise
the command's default row. Arguments are forwarded either way, so C3's `contrast` sees
`--scope=primer`.

### Browser surfaces

`e2e` and `a11y` dispatch by surface. Each surface owns one directory under `tests/e2e` and
its Playwright projects in `playwright.config.mjs`:

| Surface | Owner | Projects | Module (`e2e`, `a11y` exports) |
| --- | --- | --- | --- |
| platform | C1 | platform-chromium, platform-firefox | `scripts/check-a11y.mjs` |
| fixture | C5 | fixture-chromium, fixture-firefox | `packages/appearance/checks.mjs` |
| extension | C6 | chromium-extension | `packages/ui/checks.mjs` |
| site | C7 | site-chromium, site-firefox | `site/checks.mjs` |
| userscript | C8 | userscript-chromium, userscript-firefox | `userscript/checks.mjs` |
| release | C9 | release-chromium, release-firefox | `tests/release/checks.mjs` (e2e only) |

- `npm run test:e2e -- --project=<name>` calls the owning surface's `e2e` export with those
  projects. Without `--project` every surface runs.
- `npm run check:a11y -- --surface=<name>` calls that surface's `a11y` export. Without
  `--surface` every surface except release runs.
- A surface module builds what its tests need, then calls the shared runner:

  ```js
  import { runSurface } from "../../scripts/check-a11y.mjs";
  export const e2e = (options) => runSurface("fixture", options);
  export const a11y = (options) => runSurface("fixture", { ...options, a11y: true });
  ```

  `runSurface` lists the projects without launching a browser and fails if any discovers no
  tests, then runs them and fails on any failure, skip, `fixme` or expected failure. With `a11y`
  it runs only tests tagged `@a11y`. Other arguments, such as `--headed`, go to Playwright.
- Specs are `*.spec.mjs`. `*.chromium.spec.mjs` runs only in Chromium projects and
  `*.firefox.spec.mjs` only in Firefox ones, so no test skips itself.
- Import `test` and `expect` from `tests/helpers/e2e.mjs`, which adds a `serveDir(root)` fixture
  (scripts/serve.mjs on a free port, closed after the worker) and `platformApp`. Browser launch
  and cleanup are in `tests/helpers/browsers.mjs`: `launchTestExtension()` builds the Chrome
  package with the test-only `http://127.0.0.1/*` match into a temporary directory and loads it
  unpacked in Chromium; `launchFirefox()` starts Playwright's Firefox. axe-core runs through
  `tests/helpers/a11y.mjs`, where serious and critical findings block.

`npm run check:harness` runs `tests/foundation/harness.test.mjs` (routing, zero-discovery and
missing-target failures, without a browser), then `e2e` for both platform projects and
`a11y --surface=platform`, so the same dispatch later surfaces use is proven in Chromium and Firefox.

## Build targets

- `build:shared -- --scope=<scope>` bundles each package of a scope into `dist/shared/<name>.js`,
  platform-neutral ESM:

  | Scope | Packages | Data |
  | --- | --- | --- |
  | `engine` | contracts, format, engine | |
  | `primer` | engine's, primer | `vendor/primer/modes.json` |
  | `preview` | primer's, appearance, preview | `vendor/primer/modes.json` |
  | none | preview's, settings, ui | `vendor/primer/modes.json` |

  A missing package or data file fails with exit 2, `NOT IMPLEMENTED: shared --scope=<scope>
  (owner ...)`, naming each missing path and its owner. A package that bundles to nothing fails.
- `build:site` calls `build({ outDir, config })` exported by `site/build.mjs` (C7, type
  `SiteBuild`), with `outDir` the emptied `dist/site` and `config` the parsed
  `release.config.json`. It fails with exit 2 until that export exists, and with exit 1 if it
  writes nothing.
- `build` builds every target and fails while any is not implemented.
