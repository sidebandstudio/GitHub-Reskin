# Classics

The twelve palettes from GitHub Reskin 1.x, as public theme v1 documents. Each keeps its 1.x ID as its file name and catalog slug, its display name and its attribution in `description`. 1.x's Cyberpunk is not a Classic: saved `cyberpunk` selections migrate to Choom Circuit, `anime.cyberpunk-edgerunners`.

Each document maps the 1.x fields directly: `bg`, `text` and `accent` to `colors`, `graph` to `colors.contribution`, and `surface`, `border` and `muted` to `overrides.surface`, `overrides.border` and `overrides.mutedText`. `node packages/format/checks.mjs classic-themes` (or `npm run check:classic-themes`) rebuilds every document from the 1.x palette in `tests/format/fixtures/classics-legacy.json`, repairs it against the standard seeds and requires the result to match the file here byte for byte.

## Saved color adjustments

These source colors differ from 1.x because the original value is below 4.5:1 on one of the theme's own surfaces. 1.x already moved most of these muted colors toward the text color when it painted them; renderer 1 saves the corrected value instead.

| Theme | Field | 1.x | Saved |
| --- | --- | --- | --- |
| Dracula | overrides.mutedText | #6272a4 | #b3bad3 |
| Nord | overrides.mutedText | #616e88 | #c0c5cf |
| Gruvbox | overrides.mutedText | #a89984 | #bcb0a0 |
| Tokyo Night | overrides.mutedText | #565f89 | #9aa0b9 |
| Rosé Pine | overrides.mutedText | #908caa | #a29fb8 |
| One Dark | overrides.mutedText | #5c6370 | #a9adb4 |
| Solarized Dark | colors.text | #93a1a1 | #98a6a6 |
| Solarized Dark | overrides.mutedText | #586e75 | #98a6aa |
| Catppuccin Latte | overrides.mutedText | #6c6f85 | #5b5d70 |
| Rosé Pine Dawn | overrides.mutedText | #797593 | #615e76 |
| Solarized Light | overrides.mutedText | #657b83 | #4f6067 |

Editing Suite and Catppuccin Mocha need no saved adjustment.

## Adjusted for the preview

Renderer output that is never saved, such as a link color derived from the accent or a primary button fill, can still be corrected for the active GitHub mode. `check:classic-themes` lists those corrections per seed. They follow from the frozen derivation rules and change only if the renderer or a mode seed changes.
