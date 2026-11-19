# Brand

The GitHub Reskin icon is 1.0's grid, reskinned: a three by three contribution graph on a
near-black rounded square, with each row drawn in a different theme's shades, cyan, pink and
yellow. The busiest day moves one column per row, as it did in 1.0. It doesn't change with the
selected theme.

| File | What it is |
| --- | --- |
| `icon.svg` | The master, on a 16 by 16 grid. Rectangles only, no filters, gradients, images or fonts. |
| `icon-{16,32,48,64,128,512}.png` | Rendered by `sources/icon.mjs`, each size with its squares snapped to whole pixels. The 128 px file keeps 16 px of clear space on each side for the Chrome Web Store; the others fill their square. Use the file that matches the destination rather than scaling the 512. |
| `sources/icon.mjs` | Writes `icon.svg`, the PNGs and the site's `apple-touch-icon.png`. Run it with `node assets/brand/sources/icon.mjs`, then copy the files into `extension/pages/` and `site/public/` as the table below says. |
| `fonts/Manrope-Variable.ttf`, `fonts/OFL.txt` | Manrope, weights 200 to 800, with its SIL Open Font License 1.1. |
| `sources/build.mjs` | The 2.0 Peel icon studies. It no longer makes the shipped icon; don't run it over these files. |
| `rights.json` | Who made what, under which license, with checksums. |

The extension uses `icon.svg` and the 16, 32, 48 and 128 px files in `extension/pages/`. The
site uses `icon.svg`, `icon-32.png` and `apple-touch-icon.png` in `site/public/`.

`npm run capture:release` uses the icon and Manrope for the 440x280 tile, the 1400x560 marquee and
the 1200x630 site image. It copies the icon PNGs into the store set unchanged.

## Colors

| Role | Hex |
| --- | --- |
| Cyan row, darkest to busiest | `#0E3B47`, `#127A93`, `#1BB5D6`, `#3FE0FF` |
| Pink row | `#4A1631`, `#8C2A5C`, `#CC3F86`, `#FF5FA8` |
| Yellow row | `#4A3B08`, `#8C700F`, `#CCA517`, `#FFD23F` |
| Near-black, the icon's backing and the canvas | `#0A0A0B` |
| Edge of the backing | `#2C2C31` |
| Ivory, the name, main text and the accent | `#EDEDEA` |
| Muted, secondary text | `#A4A4A3` |

The extension's pages and the site are neutral near-black and ivory, so the icon and the theme
previews are the only color. Keep the near-black backing in every export; the squares alone are
hard to see on a white toolbar.

## The name

Set "GitHub Reskin" in Manrope 650, tracking about -0.02em in small artwork and -0.03em in large
type, in ivory. Keep the icon at least 24 CSS px and the name at least 16 CSS px when they appear
together. Leave at least one eighth of the tile's width clear around the icon.

Don't imitate GitHub's logotype, add an Octocat or GitHub mark, add anime characters, emblems or
lettering, or recolor the icon to match a theme. Theme colors belong inside product previews.
