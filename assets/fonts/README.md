# Bundled fonts

Eighteen OFL-1.1 families, one WOFF2 per reviewed weight, subset to the schema's Latin range.
`system` is the nineteenth font ID and ships no file. Builds and checks only read these files;
nothing fetches fonts at build or run time.

Each family ships exactly the weights its schema registry entry reviews (`weights`, or its one
`weight`): art-used display weights 600/700, readable body weights 400/700 and the board-used
500/600 where the registry admits them. Bungee, Space Grotesk, Bebas Neue, Cinzel, Orbitron and
Oxanium ship one weight. Body fonts are IBM Plex Sans, Source Sans 3, Nunito Sans, Atkinson
Hyperlegible and Barlow; every family can be a heading. Code keeps native monospace.

| ID | Family | Roles | Bytes by weight | Family bytes |
| --- | --- | --- | --- | --- |
| rajdhani | Rajdhani | heading | 600: 8,996, 700: 8,856 | 17,852 |
| barlow-condensed | Barlow Condensed | heading | 600: 12,036, 700: 12,048 | 24,084 |
| fraunces | Fraunces (SOFT 0, WONK 0, opsz 24) | heading | 600: 17,308, 700: 17,388 | 34,696 |
| alegreya | Alegreya | heading | 600: 18,980, 700: 18,932 | 37,912 |
| cormorant-garamond | Cormorant Garamond | heading | 700: 16,372, 600: 17,228 | 33,600 |
| josefin-sans | Josefin Sans, as "Reskin Geometric Accent" | heading | 600: 10,784, 700: 10,464 | 21,248 |
| bungee | Bungee | heading | 400: 9,048 | 9,048 |
| space-grotesk | Space Grotesk | heading | 600: 10,968 | 10,968 |
| bebas-neue | Bebas Neue | heading | 400: 6,916 | 6,916 |
| cinzel | Cinzel | heading | 600: 14,368 | 14,368 |
| orbitron | Orbitron, as "Reskin Wide Display" | heading | 600: 6,228 | 6,228 |
| oxanium | Oxanium | heading | 600: 6,380 | 6,380 |
| ibm-plex-sans | IBM Plex Sans (wdth 100), as "Reskin Industrial Sans" | heading, body | 400: 12,648, 500: 13,588, 600: 13,520, 700: 12,948 | 52,704 |
| source-sans-3 | Source Sans 3, as "Reskin Humanist Sans" | heading, body | 400: 11,280, 600: 11,280, 700: 11,236 | 33,796 |
| nunito-sans | Nunito Sans (YTLC 500, opsz 12, wdth 100) | heading, body | 400: 11,012, 700: 10,892 | 21,904 |
| atkinson-hyperlegible | Atkinson Hyperlegible | heading, body | 400: 9,936, 700: 10,220 | 20,156 |
| roboto-condensed | Roboto Condensed | heading | 600: 12,456, 700: 12,452 | 24,908 |
| barlow | Barlow | heading, body | 400: 12,748, 500: 12,696, 600: 12,836, 700: 12,760 | 51,040 |
| Total | | | 35 files | 427,808 (417.8 KiB of the 768 KiB budget) |

Budgets (schema `x-reskin.fontBudget`): each file is at most 32 KiB (largest 13,588), each family at
most 64 KiB and its registry `maxBytes` (largest 52,704), and the total at most 768 KiB.

`<id>/<id>.woff2` is the registry weight; each other reviewed weight is `<id>/<id>-<weight>.woff2`.
Each family's directory also holds its `OFL.txt`. `provenance.json` records the google/fonts
commit, then per family the license URL and hash and any Reserved Font Name, and per file the
source path, URL and SHA-256, the upstream version string, the variable-font instance and the
output hash. `npm run check:fonts` verifies all of it, plus the budgets, the weight class,
printable-ASCII coverage and the names inside each file.

A theme names font IDs only. A runtime emits one `@font-face` per reviewed weight of its heading and
body families (`roleFontFaceCss` in packages/appearance), and the browser fetches only the weights
its text uses.

## Reserved Font Names

A subset is a Modified Version under the OFL, so a family that declares a Reserved Font Name is
renamed in its family records and its CSS family; its copyright and license records are kept:

| ID | Reserved Font Name | Subset and CSS family |
| --- | --- | --- |
| josefin-sans | "Josefin Sans" | Reskin Geometric Accent |
| orbitron | "Orbitron" | Reskin Wide Display |
| ibm-plex-sans | "Plex" | Reskin Industrial Sans |
| source-sans-3 | 'Source' | Reskin Humanist Sans |

The other families declare no reserved name and keep theirs. Their CSS families are prefixed
"Reskin " so a locally installed copy never substitutes, except Roboto Condensed.

## Roboto Condensed and Choom

Choom Circuit's heading is the owner's original display stack, `Bahnschrift, "DIN Alternate",
"Roboto Condensed", "Arial Narrow", ui-monospace, monospace`. The bundled face is declared under
the family name that stack already uses, so the stack is unchanged: Windows and macOS still render
Bahnschrift or DIN Alternate and never fetch the file, and the bundled Roboto Condensed renders only
where those faces are missing. Its upstream name records still say Apache 2.0 from before Roboto's
move to the OFL; the google/fonts directory it comes from carries the OFL notice shipped here.

## Coverage

Printable ASCII is complete in every face but Orbitron, which never drew the circumflex accent
(U+005E) upstream. Some families lack a few Latin-1 signs upstream (Rajdhani has no currency sign,
Cormorant Garamond no micro sign, Orbitron 27 Latin-1 characters). The `unicode-range` and each
face's fallback stack render those natively, per character.

## Refreshing

`acquire.py` is a one-time maintenance step that needs the network. It downloads from the pinned
google/fonts commit into a temporary directory, instances variable fonts with every axis pinned,
subsets and writes the outputs. It is byte-stable for the same commit and tool versions:

```sh
python3 -m venv /tmp/reskin-fonts
/tmp/reskin-fonts/bin/pip install fonttools==4.60.1 brotli==1.1.0
/tmp/reskin-fonts/bin/python -I assets/fonts/acquire.py
npm run check:fonts
```

Review the provenance diff before committing a refresh.
