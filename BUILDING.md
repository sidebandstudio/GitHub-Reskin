# Building GitHub Reskin

## Toolchain

The build needs Node 24.22.2 and npm 11.12.1 exactly. `.node-version` and `release.config.json` pin them, and `npm ci` refuses other versions. `npm run check:toolchain` checks the versions, the installed dependencies and the browsers the tests use.

After `npm ci`, every build and check runs offline. Fonts, GitHub's mode colors and theme data are checked in.

## Build and package

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

## Site

```sh
npm run build:site       # dist/site
npm run serve            # serves the fixture and site on a free port
```

The site build captures each theme's preview in Chromium the first time and caches it in `site/.cache/previews`. It also publishes the userscript at `downloads/`.

## Tests

`npm test` runs the unit tests. Browser tests run per surface with `npm run test:e2e -- --surface=<name>` and `npm run check:a11y -- --surface=<name>`. The surfaces are `platform`, `fixture`, `extension`, `userscript` and `site`. Install the browsers first with `npx --no-install playwright install chromium firefox`. The site surface also needs `webkit`. `scripts/README.md` lists every check.

Run one browser suite at a time. Timing tests can fail on a busy machine, so compare a failure against `main` before trusting it.

## Windows

Build on macOS or Linux where you can. On Windows:

- Set `git config core.autocrlf false` before checkout. The build hashes theme files and expects LF line endings.
- Several unit test files build paths from `new URL(...).pathname`, which doesn't work on Windows, and fail to load. CI runs them on Linux.
- A site build into a temp folder on a different drive than the checkout fails, because Astro moves files with a rename.
