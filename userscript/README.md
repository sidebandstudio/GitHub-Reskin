# Userscript

`github-reskin.user.js` is generated from the product packages, so Safari and browsers without the
extension get the same runtime and picker. There is no second engine here: only the manager host,
the frame shell and the build.

| File | Contents |
| --- | --- |
| `main.mjs` | The entry. At document start it adds the extension's boot gate, initializes C4's repository over GM storage (first-run defaults, or the 1.1.0 userscript's `theme`, `enabled` and `custom` migrated once), then starts C4's lifecycle with C6's renderer (C3's adapter and Primer compiler, the engine, C5's appearance) and embedded fonts. Sign-in and the other authentication routes stay native. It registers the menu command and opens the panel at `#reskin`. |
| `storage.js` | `createGmStorage(scope)`: one `StorageAdapter` over `GM_getValue` (sync) or `GM.getValue` (async), `get` with a key list or defaults, and change events from `GM_addValueChangeListener` or a re-read when the tab is shown again. With neither API it keeps values in page memory for the session and never uses page storage. |
| `host.js` | `createGmHost`: the picker's `UiHost` over the repository. |
| `panel.js` | The frame: the popup's card in an iframe, one at a time, sized to the card by a `ResizeObserver`, closed by Escape, Close, a page click or the menu. Escape and Close return focus to the element that had it. Closing disconnects the observer and every listener. |
| `frame.css` | The card's frame layout, after the extension's `ui.css` and `popup.css`. |
| `build.mjs` | `build()` returns the script: metadata, the upstream notices, and one esbuild IIFE with the catalog, cards, fonts, boot CSS and the card document embedded. `node userscript/build.mjs` writes the committed copy, which 1.1.0 installs check for updates. |
| `verify.mjs`, `checks.mjs` | `check:userscript` (static checks of the artifact, freshness, unit tests) and the `userscript` E2E/a11y surface. |

## Manager differences

| Manager | Storage | Other tabs | Menu |
| --- | --- | --- | --- |
| Tampermonkey, Violentmonkey | `GM_*`, durable | change events | yes |
| Only `GM.*` (Greasemonkey 4, Userscripts for Safari) | `GM.*`, durable | when shown again | with `GM.registerMenuCommand`, otherwise `github.com/#reskin` |
| No storage grant | session only, labeled, with theme file export | no | if granted, otherwise `#reskin` |

The Playwright surface proves each row with a shim; actual Tampermonkey and Violentmonkey runs and
Safari remain manual checks.

GitHub's CSP allows fonts only from its own asset host, so on github.com the embedded fonts are
refused and the system fallback stack applies, in the picker too. The script does not work around
the CSP. Settings are separate from the extension's; Export theme file is the way between them.

The builder and import arrive with C6's builder (PR #18). `main.mjs` marks where it mounts.
