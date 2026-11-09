# @github-reskin/ui

The extension's picker and runtime assembly, shared with the userscript (C8).

| Module | Contents |
| --- | --- |
| `renderer.js` | `createRenderer({github, resources, catalog})`: the renderer C4's `startContent` runs, from C3's adapter (`readNativeMode`, `classifyRoute`, `locateSlots`) and `selectMode`/`seedFor`/`compileGitHub`, the engine's `resolveTheme` and C5's `compileAppearance`/`mountAppearance`/`fontFaceCss`. A bundled theme's own reviewed CSS applies in Full under the `data-reskin-css` scope marker, which lives as long as the decoration; a saved theme's CSS waits for consent. `backgroundRendering()`: the background's boot `snapshot` and source `repair` against the standard seed. `standardCard(entry)`: a picker card. |
| `catalog.js` | `catalogFromData(data)`: a CatalogSource over the catalog the build embedded, without revalidating or rehashing on every page load; registers the build's sanitizer proofs so the parser-free viewer entries admit bundled CSS. `themeCard`, `searchCards`. |
| `model.js` | Pure picker state: groups, search, anime-first labels, the one-change Undo target and status copy. |
| `host.js` | `createExtensionHost(api)`: the UiHost over C4's background (`get`, `commit`, `open-page`) plus the page's own `reskin.ui` record (gallery group, the lastGood revision Undo already used). |
| `picker.js` | `mountPicker(doc, host, {cards, catalog, cardFor, onChange})`: binds whichever `data-rs` controls a page has. Instant commit, one-change Undo, on/off, Full/Calm, Text, Motion, Fonts, Effects, search, groups, failure with Retry. |
| `bundle.mjs` | Node only. The `reskin-2` entry's builder: esbuild IIFE bundles of the content script, background and page script with the `reskin:catalog` and `reskin:cards` build-time modules and the format/engine viewer entries, plus copies of the fonts and preview images. |
| `checks.mjs` | `run` for `test:e2e` and `a11y` on the `extension` surface (`chromium-extension`). |

Undo: C4 keeps one prior committed selection in `reskin.lastGood`. Undo selects it and records that lastGood's revision in `reskin.ui`, so the swapped-back theme is not offered as another Undo until a new choice.

The builder and import are stage 2. Stage 1 has no Customize or Import entry in the popup, and the settings page's Import button is disabled with an explanation.
