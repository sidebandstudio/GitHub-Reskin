# Brand

The GitHub Reskin icon is 1.0's grid: a three by three contribution graph in Editing Suite's amber
shades, #5B421C, #8A6125, #BF8630 and #F2A93B, on a near-black rounded square with a dark amber
edge. It doesn't change with the selected theme.

| File | What it is |
| --- | --- |
| `icon.svg` | The master, 1.0's grid redrawn on a 16 by 16 grid. Rectangles only, no filters, gradients, images or fonts. |
| `icon-{16,32,48,64,128,512}.png` | The 16, 32, 48 and 128 px files are 1.0's own icons, unchanged. The 64 and 512 px files are `icon.svg` rendered at that size. Use the file that matches the destination rather than scaling the 512. |
| `fonts/Manrope-Variable.ttf`, `fonts/OFL.txt` | Manrope, weights 200 to 800, with its SIL Open Font License 1.1. |
| `sources/build.mjs` | The 2.0 Peel icon studies. It no longer makes the shipped icon; don't run it over these files. |
| `rights.json` | Who made what, under which license, with checksums. |

`npm run capture:release` uses the icon and Manrope for the 440x280 tile, the 1400x560 marquee and
the 1200x630 site image. It copies the icon PNGs into the store set unchanged.

## Colors

| Role | Hex |
| --- | --- |
| Amber, the brightest square and the accent | `#F2A93B` |
| The graph's other squares | `#BF8630`, `#8A6125`, `#5B421C` |
| Near-black, the icon's backing and the canvas | `#0A0A0B` |
| Dark amber, the icon's edge | `#3D2D16` |
| Ivory, the name and main text | `#EDEDEA` |
| Muted, secondary text | `#A4A4A3` |

These are Editing Suite's colors, and the extension's own pages use them too. Keep the near-black
backing in every export; the amber squares alone are hard to see on a white toolbar.

## The name

Set "GitHub Reskin" in Manrope 650, tracking about -0.02em in small artwork and -0.03em in large
type. Use ivory for both words, or ivory "GitHub" and amber "Reskin" on a dark background. Keep
the icon at least 24 CSS px and the name at least 16 CSS px when they appear together. Leave at
least one eighth of the tile's width clear around the icon.

Don't imitate GitHub's logotype, add an Octocat or GitHub mark, add anime characters, emblems or
lettering, or recolor the icon to match a theme. Theme colors belong inside product previews.

## Rebuilding the icon

`icon.svg` is drawn by hand, and the 16 to 128 px PNGs are 1.0's own files. Render the 64 and
512 px PNGs from `icon.svg` at exactly that size, with a transparent background.
