# Extension manifests

These files are build inputs, not an installable extension. `scripts/build.mjs` writes each
browser's `manifest.json` from them:

- `base.json` is the manifest both browsers share, without a version.
- `chrome.json` and `firefox.json` are overlays merged on top. Objects merge key by key; any other
  value replaces the base value. Chrome output never contains `browser_specific_settings`.
- The version comes from `release.config.json`.

`entries.json` lists runtime entries. `release.config.json` `extension.entry` picks one. An entry
names its source `root`, every runtime `file` the package gets, and the sha256 of `frozen` inputs
the build must not see change. The build copies exactly those files plus `LICENSE` and the
manifest. It does not discover files, so a file missing from the list is missing from the
package, and the build fails when the manifest names a file the entry lacks.

## Moving to the new extension (C6)

The current entry, `legacy-1.1.0`, packages the 1.1.0 product from `extension/` as merged.
`extension/manifest.json` stays so `extension/` can still be loaded unpacked and
`scripts/userscript.mjs` can read it; `tests/foundation/manifests.test.mjs` keeps the generated
manifests equal to it while that entry is selected.

To switch:

1. Add a new entry to `entries.json` whose files are the built outputs C4 to C6 provide (background
   script, content entry, pages, fonts, icons).
2. Update `base.json` to reference them, and the overlays for the background: Chrome
   `{"background": {"service_worker": ...}}`, Firefox `{"background": {"scripts": [...]}}`.
   Font files go in `web_accessible_resources` for the two GitHub origins only.
3. Change `release.config.json` `extension.entry` to the new entry.
4. Remove `legacy-1.1.0`, `extension/manifest.json` and the legacy-equality test together with the
   old files, after porting their behavioral tests.

`manifestProblems()` in `scripts/build.mjs` stays the gate: the permissions and host matches in
`release.config.json`, top frame only, no Gecko keys in Chrome, the studio Gecko ID with minimum
140 and no data collection in Firefox, no service worker in Firefox, and a packaged-code-only CSP.
