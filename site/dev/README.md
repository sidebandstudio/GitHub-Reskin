# Temporary development scaffolding

Everything in this directory is phase 1 scaffolding for the site shell. None of it may ship.

| File | Stands in for | Replaced by |
| --- | --- | --- |
| `preview-adapter.mjs` | C5 `mountPreview(container, options)` and its `PreviewHandle`, plus a static CSS path for the no-JS first paint | C5 `packages/preview` and `compileAppearance(resolved, prefs, 'preview')` over C2 `resolveTheme` |
| `importer.mjs` | C2 `parseImport` and `repairTheme` | C2 `packages/format` and `packages/engine` |
| `prompt.mjs` | C2's generated AI prompt | C2 `packages/format` prompt generator |
| `catalog.mjs`, `themes/` | `themes/catalog.json` and the bundled theme documents | The real catalog after C2 and S1 land |

`themes/anime/*.reskin.json` and `themes/catalog-anime.json` are copies of S1's staged documents. `themes/classics.mjs` derives
temporary Classic documents from the 1.1.0 palettes in `extension/themes.js`; C2 owns the real Classics.

Only `site/src/engine.mjs` may import from here. `site/checks.mjs` enforces that, and its `--production` mode fails
while any built file carries the adapter marker (`reskin-dev-adapter`) or the development catalog marker
(`data-catalog-source="site/dev"`). `.github/workflows/pages.yml` runs that mode before uploading, so a build that still
uses this directory cannot deploy.
