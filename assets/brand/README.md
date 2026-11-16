# Brand

The GitHub Reskin icon, Peel, is a coral page frame whose upper-right corner folds inward, on a
charcoal rounded square. It doesn't change with the selected theme.

| File | What it is |
| --- | --- |
| `icon.svg` | The master, drawn on a 16 by 16 grid with two-unit edges. Filled paths only, no filters, gradients, images or fonts. |
| `icon-{16,32,48,64,128,512}.png` | The master rendered at each size. Every size uses the same geometry, so use the file that matches the destination rather than scaling the 512. |
| `fonts/Manrope-Variable.ttf`, `fonts/OFL.txt` | Manrope, weights 200 to 800, with its SIL Open Font License 1.1. |
| `sources/build.mjs` | The editable source of the icon geometry. |
| `rights.json` | Who made what, under which license, with checksums. |

`npm run capture:release` uses the icon and Manrope for the 440x280 tile, the 1400x560 marquee and
the 1200x630 site image. It copies the icon PNGs into the store set unchanged.

## Colors

| Role | Hex |
| --- | --- |
| Coral, the mark | `#FF806C` |
| Charcoal, the icon's backing | `#151A22` |
| Canvas, promo backgrounds | `#0C0F14` |
| Ivory, the name and main text | `#F5F3EE` |
| Muted, secondary text | `#B0B8C5` |

The icon uses coral and charcoal only. Keep the charcoal backing in every export. Coral alone is
hard to see on a white toolbar.

## The name

Set "GitHub Reskin" in Manrope 650, tracking about -0.02em in small artwork and -0.03em in large
type. Use ivory for both words, or ivory "GitHub" and coral "Reskin" on a dark background. Keep
the icon at least 24 CSS px and the name at least 16 CSS px when they appear together. Leave at
least one eighth of the tile's width clear around the icon.

Don't imitate GitHub's logotype, add an Octocat or GitHub mark, add anime characters, emblems or
lettering, or recolor the icon to match a theme. Theme colors belong inside product previews.

## Rebuilding the icon

`sources/build.mjs` needs `@resvg/resvg-js@2.6.2`, `sharp@0.35.5` and `fontkit@2.0.4`, which
aren't project dependencies. Install them in a temporary directory and point `BRAND_RENDER_DEPS`
at it:

```sh
deps="$(mktemp -d)"
npm install --prefix "$deps" --no-audit --no-fund @resvg/resvg-js@2.6.2 sharp@0.35.5 fontkit@2.0.4
BRAND_RENDER_DEPS="$deps" node assets/brand/sources/build.mjs
```

It writes `icon.svg` and the six PNGs, and also the concept studies, proofs, contact sheet and an
early tile and marquee draft. Keep only the icon files. The store tile and marquee come from
`capture:release`, which uses the reviewed store copy.
