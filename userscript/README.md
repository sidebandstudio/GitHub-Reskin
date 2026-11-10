# Userscript

`github-reskin.user.js` is generated from the product packages, so Safari and browsers without the
extension get the same runtime and picker. There is no second engine here: only the manager host,
the frame shell and the build.

| File | Contents |
| --- | --- |
| `main.mjs` | The entry. At document start it adds the extension's boot gate, initializes C4's repository over GM storage (first-run defaults, or the 1.1.0 userscript's `theme`, `enabled` and `custom` migrated once), then starts C4's lifecycle with C6's renderer (C3's adapter and Primer compiler, the engine, C5's appearance) and embedded fonts. Sign-in and the other authentication routes stay native. It registers the menu command and opens the panel when the address it loaded with, or a navigation the browser reports as the person's own, ends in `#reskin`; a page script setting the hash opens nothing. The theme's fonts are added from their embedded bytes (`fonts.js`). |
| `storage.js` | `createGmStorage(scope)`: one `StorageAdapter` over `GM_getValue` (sync) or `GM.getValue` (async), `get` with a key list or defaults, and change events from `GM_addValueChangeListener` or a re-read when the tab is shown again. The extension's records live in one manager value, `reskin.state`, so a commit is one write that the manager keeps whole or not at all; a write reported as failed is read back and counts only if it landed. Each write is checked against the stored settings revision just before it is made and confirmed 50 ms after, so of two tabs saving at once one is told instead of being silently overwritten. With neither API it keeps values in page memory for the session and never uses page storage. |
| `host.js` | `createGmHost`: the picker's `UiHost` over the repository. A save another tab overwrote comes back as a conflict, which the picker answers as the extension's does. |
| `panel.js` | The panel: the popup's card in an iframe, inside a closed shadow root page scripts cannot reach, one at a time, sized to the card by a `ResizeObserver`, closed by Escape, Close, a page click or the menu. Escape and Close return focus to the element that had it. Closing disconnects the observer and every listener. |
| `fonts.js` | Adds the bundled faces a theme or picker card uses to `document.fonts` as `FontFace` objects made from the embedded WOFF2. |
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

## Page isolation

Nothing in the page can read, imitate or operate the picker. The script asks to run isolated from
page scripts (`@inject-into content` for Violentmonkey, `@sandbox DOM` for Tampermonkey; Greasemonkey,
FireMonkey and Userscripts for Safari run scripts that way already). The frame sits in a closed
shadow root, so it is not one of the page's `window.frames`, and `window.find`, caret and point
lookups stop at its bare host; keys typed in it reach only the frame. The manager grants are the
script's own, never page globals. A page can still cover the panel with its own elements or remove
it, as it can draw anything on its own page; it cannot reach what is inside.

## Fonts

GitHub's CSP allows fonts only from its own asset host, which refuses an `@font-face` with a data or
blob URL. The script instead hands each face's embedded WOFF2 bytes to `new FontFace()` and adds it
to `document.fonts`: no request, no new grant and no change to the CSP. Where that fails, the system
fallback stack applies. Settings are separate from the extension's; Export theme file is the way
between them.

The builder and import arrive with C6's builder (PR #18). `main.mjs` marks where it mounts.
