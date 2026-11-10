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

## Changing code

Read [BUILDING.md](BUILDING.md) for the toolchain and commands. Each package under `packages/` has a README that says what it owns. GitHub page changes belong in `extension/content/github` and `packages/primer`.

- Keep a change to one thing, and add or update the tests that cover it.
- Run `npm test` and the browser surfaces your change touches.
- Never edit generated output by hand: `dist/`, `artifacts/`, or a userscript that `userscript/build.mjs` writes.
- If a change affects what userscript users see, raise `version` in `release.config.json`.

## Pull requests

Say what changed and what you ran, with the real results. CI has to pass before a merge.
