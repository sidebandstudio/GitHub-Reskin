# Contributing

## Reporting a problem

Open an issue at https://github.com/sidebandstudio/GitHub-Reskin/issues. For a page that looks wrong, include a public URL that shows it, the theme, Full or Calm, and your browser and version. Don't attach screenshots of private pages.

## Adding a theme

1. Make the theme in the builder and export it as a `.reskin.json` file. Check the profile, a repository, a diff and the contribution graph in both Full and Calm.
2. Give it an original name. For an anime theme, put the show's title in `inspiredBy` so it leads the label, and keep `name` as the theme's own name.
3. Use original patterns and images only. No logos, title logotypes, emblems, character art, screenshots, dialogue or music from any show, and no outside resources or scripts.
4. Put the file in `themes/anime/` or `themes/classics/` and add one entry to `themes/catalog.json`. Never change an existing ID. Talk to the maintainers before adding to the bundled lineup.
5. Run `npm run check:schema`, `npm run check:themes` and `npm run check:contrast`.

The theme format is documented in `packages/format/README.md` and `packages/format/theme-v1.schema.json`.

## Building and testing

### Toolchain

The build needs Node 24.22.2 and npm 11.12.1 exactly. `.node-version` and `release.config.json` pin them, and `npm ci` refuses other versions. `npm run check:toolchain` checks the versions, the installed dependencies and the browsers the tests use.

After `npm ci`, building and checking the extension, the userscript and the site runs offline. Fonts, GitHub's mode colors and theme data are checked in.

### Build and package

```sh
npm ci
npm run build:stores     # dist/chrome, dist/firefox and dist/userscript
npm run package          # store ZIPs, userscript, reviewer source archive, SHA256SUMS, build-info.json
npm run check:artifacts  # layout, version, Gecko ID, permissions, licenses and hashes
npm run check:repro      # builds twice and compares the bytes
```

`npm run package` writes to `artifacts/`:

- `github-reskin-<version>-chrome.zip`, the Chrome package.
- `github-reskin-<version>-firefox.zip`, the unsigned Firefox package.
- `github-reskin-<version>.user.js`, the userscript.
- `github-reskin-<version>-amo-source.zip`, the source archive for Firefox Add-ons reviewers. It carries its own build notes.
- `SHA256SUMS` and `build-info.json`.

To try a build, load `dist/chrome` unpacked in Chrome, or `dist/firefox/manifest.json` as a temporary add-on in Firefox.

### Site

```sh
npm run build:site       # dist/site
npm run serve -- dist/site --base /GitHub-Reskin   # serves the built site on a free port
```

The site build captures each theme's preview in Chromium the first time and caches it in `site/.cache/previews`. It also publishes the userscript at `downloads/`.

### Tests

`npm test` runs the unit tests. Browser tests run per surface with `npm run test:e2e -- --surface=<name>` and `npm run check:a11y -- --surface=<name>`. The surfaces are `platform`, `fixture`, `extension`, `userscript` and `site`. Install the browsers first with `npx --no-install playwright install chromium firefox`. The site surface also needs `webkit`. `scripts/README.md` lists every check.

Run one browser suite at a time. Timing tests can fail on a busy machine, so compare a failure against `main` before trusting it.

### Windows

Build on macOS or Linux where you can. On Windows:

- Set `git config core.autocrlf false` before checkout. The build hashes theme files and expects LF line endings.
- Several unit test files build paths from `new URL(...).pathname`, which doesn't work on Windows, and fail to load. CI runs them on Linux.
- A site build into a temp folder on a different drive than the checkout fails, because Astro moves files with a rename.

## Changing code

Each package under `packages/` has a README that says what it owns. GitHub page changes belong in `extension/content/github` and `packages/primer`.

- Keep a change to one thing, and add or update the tests that cover it.
- Run `npm test` and the browser surfaces your change touches.
- Never edit generated output by hand: `dist/`, `artifacts/`, or a userscript that `userscript/build.mjs` writes.
- If a change affects what userscript users see, raise `version` in `release.config.json`.

## Pull requests

Say what changed and what you ran, with the real results. CI has to pass before a merge.
