# Extension manifests

These files are build inputs, not an installable extension. `scripts/build.mjs` writes each
browser's `manifest.json` from them:

- `base.json` is the manifest both browsers share, without a version.
- `chrome.json` and `firefox.json` are overlays merged on top. Objects merge key by key; any other
  value replaces the base value. Chrome output never contains `browser_specific_settings`.
- The version comes from `release.config.json`.

`entries.json` lists runtime entries. `release.config.json` `extension.entry` picks one. An entry
names its source `root`, every runtime `file` the package gets, the sha256 of `frozen` inputs
the build must not see change, and the upstream license `notices` for material it ships. Each
frozen input must be covered by a notice. The build copies exactly those files plus `LICENSE`,
each notice file at its repository path, and the manifest. It does not discover files, so a file missing from the list is missing from the
package, and the build fails when the manifest names a file the entry lacks.

An entry may also name a `builder` module and the `generated` files it produces. The build calls
its `build({root, entry})` and packages exactly those paths from its output; every other file is read
from the entry's root. The current entry, `reskin-2`, uses `packages/ui/bundle.mjs` to bundle the
content script, background and page script with esbuild and to copy the bundled fonts and preview
images from their repository paths. A notice marked `"userscript": false` covers material only the
browser packages carry.

## The 1.1.0 files

The 1.1.0 product (`extension/manifest.json`, `popup.*`, `themes.js`, `slang.js`, `content.js`,
`github-modes.js`, `icons/`) is no longer packaged. It stays in the repository because
`scripts/userscript.mjs` still builds the userscript from it; C8 removes it when the userscript
moves to the new runtime.

`manifestProblems()` in `scripts/build.mjs` stays the gate: the permissions and host matches in
`release.config.json`, top frame only, no Gecko keys in Chrome, the studio Gecko ID with minimum
140 and no data collection in Firefox, no service worker in Firefox, and a packaged-code-only CSP.
