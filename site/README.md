# Showcase site

Astro static site for GitHub Pages at `https://sidebandstudio.github.io/GitHub-Reskin/`. Owner: C7.

| Path | Purpose |
| --- | --- |
| `build.mjs` | `build({ outDir, config })`, called by `npm run build:site`. |
| `checks.mjs`, `budgets.mjs` | `check:site`, `check:budgets -- --surface=site`, and the site `test:e2e`/`a11y` surface. |
| `src/engine.mjs`, `src/catalog.mjs` | The only two seams to the preview, resolver, importer, prompt and catalog. |
| `src/` | Pages, components, the preview fixture markup and client scripts. |
| `src/fixture/`, `public/site-fixture/` | The approved offline whoisaldo fixture (captured 2026-11-08), production content. |
| `dev/` | Temporary adapter and theme copies. Never ships; see `dev/README.md`. |
| `scripts/screenshots.mjs` | Review screenshots of a served build. |

Serve a build for review with `node scripts/serve.mjs dist/site --port 4321 --base /GitHub-Reskin` (binds 0.0.0.0).
The site makes no runtime network requests beyond its own files and loads no trackers.
