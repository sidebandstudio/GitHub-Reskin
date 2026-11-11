# Userscript

`github-reskin.user.js` is generated from the product packages, so Safari and browsers without the
extension get the same runtime, picker and theme builder. There is no second engine here: only the manager host,
the frame shell and the build.

`github-reskin.user.js` in this folder is a frozen copy, not regenerated. Versions 1.0.0 and 1.1.0
first shipped from that path on `main` and check it for updates. This copy is 1.1.2, above both, and
its `@updateURL` moves those installs to the Pages download, which they take from the next release
above 1.1.2. Don't rebuild it, except to fix it. 1.1.1 was this build before `DEFINE` in
`build.mjs`, and under Violentmonkey it left every page native. Installs that took 1.1.1 already
check Pages, so they get the fix from the next release.

| File | Contents |
| --- | --- |
| `main.mjs` | The entry. At document start it adds the extension's boot gate, initializes C4's repository over GM storage (first-run defaults, or the 1.1.0 userscript's `theme`, `enabled` and `custom` migrated once), then starts C4's lifecycle with C6's renderer (C3's adapter and Primer compiler, the engine, C5's appearance) and embedded fonts. Sign-in and the other authentication routes stay native. It registers the menu command and opens the panel when the address it loaded with, or a navigation the browser reports as the person's own, ends in `#reskin`; a page script setting the hash opens nothing. The panel has its controls only when `isolation.js` shows the script runs apart from GitHub's JavaScript; otherwise the script gets session storage only, so the manager's storage stays out of reach of page code that patches built-ins, the card shows the theme and why, and `menu.js` changes settings until the page reloads. With controls, the card's Make a theme and Backup & help open C6's `mountBuilder` and `mountBackup` in the builder's frame over the same host, with C5's offline preview configured once from the embedded fixture images. No approval reaches the renderer, so only a bundled theme's own CSS applies. The CSS sanitizer is installed (`packages/format/authoring.js`), so a saved or imported theme that carries CSS validates and keeps it. The theme's fonts are added from their embedded bytes (`fonts.js`). |
| `isolation.js` | `detectIsolation`: at document start, before GitHub's scripts. Not isolated when the manager reports page injection (Tampermonkey's `GM_info.sandboxMode` `raw`, Violentmonkey's `GM_info.injectInto` `page`). Isolated in Firefox's content-script sandbox, where the global object of the script's own realm, the `this` of a bare sloppy-mode call, is the sandbox and not a window. Otherwise isolated only on the manager's own report (`sandboxMode` `js` or `dom`, `injectInto` `content`, or Userscripts for Safari, whose `GM.*` exists only in its content scope). The report is the one that comes with the storage the script would use (`GM.info` for `GM.*`, otherwise `GM_info`), and only its own fields count (`ownFields`), so a page's getter on `Object.prototype` neither answers for a missing field nor sees the manager's objects. A page can fake `window.wrappedJSObject`, a `null` `window.customElements`, or `let GM_info` and `let exportFunction` for names the manager doesn't bind, so none of those counts, and a Chromium isolated world with no report is not isolated. This assumes the manager binds the report that comes with its storage itself, as Tampermonkey, Violentmonkey and Userscripts for Safari do: a manager that grants `GM_getValue` but leaves `GM_info` unbound lets a page's own `GM_info` stand in. |
| `menu.js` | The manager's menu as the only settings UI when the script is not isolated, over session storage: Open, on/off, Full/Calm, extra theme text, motion and one entry per theme, anime title first, the current one marked. Each command is the host's `apply()`. Labels follow the settings where the manager has `GM_unregisterMenuCommand`; otherwise they are fixed and the switches flip whatever is saved then. A failed change adds an entry that tries it again. |
| `storage.js` | `createGmStorage(scope)`: one `StorageAdapter` over `GM_getValue` (sync) or `GM.getValue` (async), `get` with a key list or defaults, and change events from `GM_addValueChangeListener` or a re-read when the tab is shown again. The extension's records live in one manager value, `reskin.state`, so a commit is one write that the manager keeps whole or not at all; a write reported as failed is read back and counts only if it landed. Every write, and each whole commit through `transaction()`, runs under the Web Lock `github-reskin-userscript-state`, which the origin's tabs share. Inside it the tab waits until its manager shows every other open tab's latest write, which each tab announces with a shared lock named after it. Waiting is bounded at 5 s, after which the change fails with Retry. In Firefox content scripts the lock callback is exported to the page's compartment, or the lock would end as it is granted. `lockBridge` exports it to the document's own window, because Violentmonkey's `window` is a proxy that `exportFunction` refuses. The revision check just before each write and the 50 ms confirmation stay as a second guard, and are the only one between github.com and gist.github.com (different origins share manager storage but not locks) or without Web Locks. With neither API it keeps values in page memory for the session and never uses page storage. |
| `host.js` | `createGmHost`: the picker's `UiHost` over the repository. Each commit runs under the lock: the latest settings are read, the picker's revision checked, the action applied to them and written. A commit from a replaced revision, or a save lost without the lock, is a conflict, which the picker answers as the extension's does; `apply()` is the menu's commit on whatever the settings are inside the lock. Subscribers hear other tabs' changes; this tab's commits answer with their own settings. |
| `panel.js` | The panel: the popup's card in an iframe, inside a closed shadow root page scripts cannot reach, in the top layer as a manual popover, one at a time, sized to the card by a `ResizeObserver`, closed by Escape, Close, a page click or the menu. Escape and Close return focus to the element that had it. Closing disconnects the observer and every listener. Its `make` and `backup` modes are the builder's frame, up to 1120 px wide; switching modes keeps the focus to return to, and Escape in the import dialog closes only the dialog. |
| `copy.js` | The userscript's own words: the storage and capability notes on the card and in the builder, and the Advanced CSS notes. |
| `raster.js` | `xrayRasterEnv`: image conversion for the builder behind Firefox's Xrays, where the encoder's bytes are copied into the script's realm before C5's checks read them. |
| `fonts.js` | Adds the bundled faces a theme or picker card uses to `document.fonts` as `FontFace` objects made from the embedded WOFF2. |
| `frame.css` | The card's frame layout, after the extension's `ui.css` and `popup.css`, and the builder frame's, after `ui.css` and `page.css`. |
| `build.mjs` | `build()` returns the script: metadata, the upstream notices, and one esbuild IIFE with the catalog, cards, fonts, boot CSS, the card document, the builder document and the preview fixture's images embedded. The builder document is `settings.html`'s Make a theme and Backup & help under the frame's header, with each Enable advanced CSS replaced by an inert hidden input and the userscript's note; the build fails if that markup changes shape. `node userscript/build.mjs` and `npm run build:userscript` write `dist/userscript/github-reskin.user.js`, and the site build publishes the same script at `downloads/github-reskin.user.js` on Pages, the address its `@updateURL` names. |
| `verify.mjs`, `checks.mjs` | `check:userscript` (static checks of the artifact, the bridge copy's update address, unit tests) and the `userscript` E2E/a11y surface. The scan for network calls removes exactly one reviewed text first: the preview's read of a resource URL, which never runs here because every URL the userscript's adapter gives is data. |

## Manager differences

| Manager | Storage | Other tabs | Menu |
| --- | --- | --- | --- |
| Tampermonkey, Violentmonkey | `GM_*`, durable | change events | yes, with labels that follow the settings |
| Only `GM.*` (Greasemonkey 4, Userscripts for Safari) | `GM.*`, durable | when shown again | with `GM.registerMenuCommand`, otherwise `github.com/#reskin` |
| No storage grant | session only, labeled, with theme file export | no | if granted, otherwise `#reskin` |

The Playwright surface proves each row with a shim, the isolated runs in a Chromium isolated world
with Violentmonkey's report and a Firefox add-on content script with none; actual Tampermonkey and Violentmonkey runs and Safari remain
manual checks.

## Page isolation

The script asks to run isolated from page scripts (`@inject-into content` for Violentmonkey,
`@sandbox DOM` for Tampermonkey; Greasemonkey, FireMonkey and Userscripts for Safari run scripts
that way already) and checks at startup that it does (`isolation.js`). When it does, nothing in the
page can read or operate the picker: the frame sits in a closed shadow root, so it is not one of the
page's `window.frames`, and `window.find`, caret and point lookups stop at its bare host; keys typed
in it reach only the frame, and a page that patches DOM prototypes sees none of its nodes. The
manager grants are the script's own, never page globals.

When it does not, a page script that patches `Document.prototype.createElement` would hold the
frame, so the card has no control that saves anything, and settings change only through the
manager's menu, which the page cannot draw over or call. A page script there can still replace
built-in functions the script uses.

A page can still draw over the panel. The panel sits in the top layer, so only another top-layer
element (a popover, a modal dialog or a fullscreen element) can cover it; one that appears over it
closes it, and a click in the panel at a point one covers, or while the panel has been taken out of
the top layer, is dropped and closes it. An overlay inside the page's own closed shadow root is not
listed by the document and is not seen, so a page can still give a real control a misleading label.
That reaches only the userscript's theme settings on GitHub; the extension has the full
protections. Advanced CSS in a saved theme never applies here and is never offered for approval.

A GitHub page script can also hold or steal the save lock. Holding it makes saves fail with Retry;
a stolen lock fails the commit it was taken from before it writes, and after that the revision
check is what remains.

## Fonts

GitHub's CSP allows fonts only from its own asset host, which refuses an `@font-face` with a data or
blob URL. The script instead hands each face's embedded WOFF2 bytes to `new FontFace()` and adds it
to `document.fonts`: no request, no new grant and no change to the CSP. Where that fails, the system
fallback stack applies. Settings are separate from the extension's; Export theme file is the way
between them.

## Builder

The settings page's builder, unchanged, on the same `UiHost` as the card: three colors, fonts,
effects, flavor text, backgrounds (gradients, patterns and images with the same caps and on-device
conversion), shape and type, graph and code colors, details, one-change Undo, the kept draft and
its recovery, Save and Save a copy, import by paste, file or share code with the same messages and
repair notes, export as a file, theme JSON or share code, Copy AI prompt, and Backup & help. Saves
and drafts go through the GM host, under the same lock and revision check as the card's choices,
so two tabs editing one theme get the builder's Keep editing or Load saved theme. Where it differs
from the extension:

- Advanced CSS is never approved here. A theme's CSS is shown read-only, kept with the theme and
  off, with a note that custom CSS needs the extension; there is no Enable control, an import that
  carries CSS comes in with it off, and the builder's host refuses any approval request.
- No builder where `isolation.js` cannot show the script runs apart from the page: the card has no
  Make a theme or Backup & help, no builder document is ever loaded, and the note says to use the
  extension or a manager that keeps scripts apart.
- Without durable storage the builder is part of the labeled session preview: what it saves lasts
  for the tab.
- The preview's frames inherit GitHub's CSP, which refuses data: fonts, so the preview shows the
  system fallback; GitHub itself gets the faces from their bytes.
- Files download from a link in the panel's frame, never GitHub's document.
