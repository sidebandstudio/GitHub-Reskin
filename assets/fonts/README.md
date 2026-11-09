# Bundled accent fonts

Eight OFL-1.1 families, one weight each, subset to the schema's Latin range and stored as WOFF2.
`system` is the ninth font ID and ships no file. Builds and checks only read these files; nothing
fetches fonts at build or run time.

| ID | Family | Weight | Bytes |
| --- | --- | --- | --- |
| rajdhani | Rajdhani | 600 | 8,996 |
| barlow-condensed | Barlow Condensed | 600 | 12,036 |
| fraunces | Fraunces (SOFT 0, WONK 0, opsz 24) | 600 | 17,308 |
| alegreya | Alegreya | 600 | 18,980 |
| cormorant-garamond | Cormorant Garamond | 700 | 16,372 |
| josefin-sans | Josefin Sans, renamed "Reskin Geometric Accent" | 600 | 10,676 |
| bungee | Bungee | 400 | 9,048 |
| space-grotesk | Space Grotesk | 600 | 10,968 |
| Total | | | 104,492 (102 KiB of the 240 KiB budget) |

Each `<id>/<id>.woff2` sits beside its family's `OFL.txt`. `provenance.json` records the
google/fonts commit, source path, URL and SHA-256 of every input, the upstream version string,
the variable-font instance, the license hash and the output hash. `npm run check:fonts` verifies
all of it, plus the weight class, printable-ASCII coverage and names inside each file.

## Reserved Font Name

Josefin Sans declares the Reserved Font Name "Josefin Sans". A subset is a Modified Version under
the OFL, so its family records are renamed "Reskin Geometric Accent" and its CSS family is the
same. The copyright and license records are kept. The other seven families declare no reserved
name and keep theirs; their CSS families are prefixed "Reskin " so a locally installed copy never
substitutes.

## Coverage

Printable ASCII is complete in every face. Rajdhani lacks a few Latin-1 signs (such as the
currency sign) and Cormorant Garamond lacks the micro sign upstream; the `unicode-range` and each
face's fallback stack render those natively.

## Refreshing

`acquire.py` is a one-time maintenance step that needs the network. It downloads from the pinned
google/fonts commit into a temporary directory, instances variable fonts, subsets and writes the
outputs. It is byte-stable for the same commit and tool versions:

```sh
python3 -m venv /tmp/reskin-fonts
/tmp/reskin-fonts/bin/pip install fonttools==4.60.1 brotli==1.1.0
/tmp/reskin-fonts/bin/python -I assets/fonts/acquire.py
npm run check:fonts
```

Review the provenance diff before committing a refresh.
