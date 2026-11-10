"""One-time acquisition of the eighteen bundled font families. Builds never run this.

Downloads each family from the google/fonts repository at a pinned commit, pins variable fonts to
each reviewed weight, subsets them to the schema's Latin range, writes WOFF2 and OFL.txt to
assets/fonts/<id>/ and records every source and output hash in assets/fonts/provenance.json.

Run from the repository root with fontTools and brotli in a throwaway virtual environment:

    python3 -m venv /tmp/reskin-fonts
    /tmp/reskin-fonts/bin/pip install fonttools==4.60.1 brotli==1.1.0
    /tmp/reskin-fonts/bin/python -I assets/fonts/acquire.py

Downloads land in a fresh temporary directory, never next to this script. Outputs are byte-stable
for the same commit and tool versions; review the provenance diff before committing a refresh.
"""

import hashlib
import json
import os
import sys
import tempfile
import urllib.request

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

COMMIT = "5bb28733cec313b63fbd415b574b5ae35c8aa8b8"
RAW = "https://raw.githubusercontent.com/google/fonts/" + COMMIT + "/ofl/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)))

# The schema's x-reskin.fontBudget.subset.
UNICODES = "U+0020-007E,U+00A0-00FF,U+0152-0153,U+0178,U+2010-2027,U+2030,U+2039-203A,U+20AC"

# id, directory, source, weights, other axis pins, internal family name. The source is one
# variable file instanced at every weight, or a static file per weight. The first weight is the
# registry weight and writes <id>.woff2; each other reviewed weight writes <id>-<weight>.woff2.
# Every axis other than wght is pinned. The internal name is the upstream family, except where
# the OFL declares a Reserved Font Name: a subset is a Modified Version, so it may not carry it.
FONTS = [
    ("rajdhani", "rajdhani", {600: "Rajdhani-SemiBold.ttf", 700: "Rajdhani-Bold.ttf"}, [600, 700], {}, "Rajdhani"),
    ("barlow-condensed", "barlowcondensed", {600: "BarlowCondensed-SemiBold.ttf", 700: "BarlowCondensed-Bold.ttf"}, [600, 700], {}, "Barlow Condensed"),
    # Fraunces: plain shapes (no soft or wonky alternates) at the 24px optical size used for accents.
    ("fraunces", "fraunces", "Fraunces[SOFT,WONK,opsz,wght].ttf", [600, 700], {"SOFT": 0, "WONK": 0, "opsz": 24}, "Fraunces"),
    ("alegreya", "alegreya", "Alegreya[wght].ttf", [600, 700], {}, "Alegreya"),
    ("cormorant-garamond", "cormorantgaramond", "CormorantGaramond[wght].ttf", [700, 600], {}, "Cormorant Garamond"),
    # Reserved Font Name "Josefin Sans".
    ("josefin-sans", "josefinsans", "JosefinSans[wght].ttf", [600, 700], {}, "Reskin Geometric Accent"),
    ("bungee", "bungee", {400: "Bungee-Regular.ttf"}, [400], {}, "Bungee"),
    ("space-grotesk", "spacegrotesk", "SpaceGrotesk[wght].ttf", [600], {}, "Space Grotesk"),
    ("bebas-neue", "bebasneue", {400: "BebasNeue-Regular.ttf"}, [400], {}, "Bebas Neue"),
    ("cinzel", "cinzel", "Cinzel[wght].ttf", [600], {}, "Cinzel"),
    # Reserved Font Name "Orbitron".
    ("orbitron", "orbitron", "Orbitron[wght].ttf", [600], {}, "Reskin Wide Display"),
    ("oxanium", "oxanium", "Oxanium[wght].ttf", [600], {}, "Oxanium"),
    # Reserved Font Name "Plex". Normal width.
    ("ibm-plex-sans", "ibmplexsans", "IBMPlexSans[wdth,wght].ttf", [400, 500, 600, 700], {"wdth": 100}, "Reskin Industrial Sans"),
    # Reserved Font Name "Source".
    ("source-sans-3", "sourcesans3", "SourceSans3[wght].ttf", [400, 600, 700], {}, "Reskin Humanist Sans"),
    # Nunito Sans: default x-height and width at the 12pt text optical size.
    ("nunito-sans", "nunitosans", "NunitoSans[YTLC,opsz,wdth,wght].ttf", [400, 700], {"YTLC": 500, "opsz": 12, "wdth": 100}, "Nunito Sans"),
    ("atkinson-hyperlegible", "atkinsonhyperlegible", {400: "AtkinsonHyperlegible-Regular.ttf", 700: "AtkinsonHyperlegible-Bold.ttf"}, [400, 700], {}, "Atkinson Hyperlegible"),
    ("roboto-condensed", "robotocondensed", "RobotoCondensed[wght].ttf", [600, 700], {}, "Roboto Condensed"),
    ("barlow", "barlow", {400: "Barlow-Regular.ttf", 500: "Barlow-Medium.ttf", 600: "Barlow-SemiBold.ttf", 700: "Barlow-Bold.ttf"}, [400, 500, 600, 700], {}, "Barlow"),
]
# The declared Reserved Font Name's distinctive word, which no family-bearing record may contain.
RESERVED = {"josefin-sans": "Josefin", "orbitron": "Orbitron", "ibm-plex-sans": "Plex", "source-sans-3": "Source"}
STYLES = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold"}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def set_names(font, family, weight, reserved):
    """Names the single-weight subset after its family and weight. Instancing leaves the default
    instance's style in some families, so every family-bearing record is written here."""
    style = STYLES[weight]
    full = family + " " + style
    ps = full.replace(" ", "")
    values = {1: full, 2: "Regular", 3: ps + ";reskin-subset", 4: full, 6: ps}
    names = font["name"]
    names.names = [r for r in names.names if r.nameID not in (1, 2, 3, 4, 6, 16, 17, 21, 22)]
    for name_id, value in values.items():
        names.setName(value, name_id, 3, 1, 0x409)
        names.setName(value, name_id, 1, 0, 0)
    # Copyright (0) and license (13, 14) records keep their wording; no other record may use a
    # reserved name.
    if reserved:
        names.names = [r for r in names.names if r.nameID in (0, 13, 14) or reserved not in r.toUnicode()]


def build(work, font_id, directory, file, weight, pins, internal, name):
    url = RAW + directory + "/" + file
    path = os.path.join(work, file)
    if not os.path.exists(path):
        with open(path, "wb") as handle:
            handle.write(fetch(url))
    with open(path, "rb") as handle:
        source = handle.read()
    font = TTFont(path, recalcTimestamp=False)
    version = font["name"].getDebugName(5)
    axes = {axis.axisTag for axis in font["fvar"].axes} if "fvar" in font else set()
    location = {}
    if axes:
        location = {tag: value for tag, value in pins.items() if tag in axes}
        if "wght" in axes:
            location["wght"] = weight
        if set(location) != axes:
            raise SystemExit(f"{font_id}: pin every axis of {file}, unpinned {sorted(axes - set(location))}")
        font = instancer.instantiateVariableFont(font, location, updateFontNames=False)
    font["OS/2"].usWeightClass = weight

    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.desubroutinize = True
    options.layout_features = ["kern", "liga", "clig", "calt", "ccmp", "locl", "mark", "mkmk"]
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17]
    options.notdef_outline = True
    options.recalc_timestamp = False
    options.drop_tables += ["DSIG", "STAT"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    set_names(font, internal, weight, RESERVED.get(font_id))
    # Pin the head timestamps so a rebuild from the same inputs writes the same bytes.
    font["head"].created = font["head"].modified = 0

    target = os.path.join(OUT, font_id)
    os.makedirs(target, exist_ok=True)
    woff2 = os.path.join(target, name)
    font.flavor = "woff2"
    font.save(woff2, reorderTables=True)
    with open(woff2, "rb") as handle:
        output = handle.read()

    return {
        "id": font_id,
        "weight": weight,
        "file": font_id + "/" + name,
        "bytes": len(output),
        "sha256": sha256(output),
        "source": {
            "path": "ofl/" + directory + "/" + file,
            "url": url,
            "sha256": sha256(source),
            "version": version,
            "instance": location,
        },
    }


def family(work, font_id, directory, sources, weights, pins, internal):
    license_text = fetch(RAW + directory + "/OFL.txt").replace(b"\r\n", b"\n")
    files = []
    for weight in weights:
        file = sources[weight] if isinstance(sources, dict) else sources
        name = font_id + (".woff2" if weight == weights[0] else "-" + str(weight) + ".woff2")
        files.append(build(work, font_id, directory, file, weight, pins, internal, name))
    with open(os.path.join(OUT, font_id, "OFL.txt"), "wb") as handle:
        handle.write(license_text)
    return {
        "id": font_id,
        "weights": weights,
        "bytes": sum(f["bytes"] for f in files),
        "license": "OFL-1.1",
        "licenseFile": font_id + "/OFL.txt",
        "licenseSha256": sha256(license_text),
        "licenseUrl": RAW + directory + "/OFL.txt",
        "reservedFontName": RESERVED.get(font_id),
        "internalFamily": internal,
        "repository": "https://github.com/google/fonts",
        "commit": COMMIT,
        "files": files,
    }


def main():
    records = []
    with tempfile.TemporaryDirectory(prefix="reskin-fonts-") as work:
        for spec in FONTS:
            record = family(work, *spec)
            print(f"{record['id']}: {record['bytes']} bytes in {len(record['files'])} files")
            records.append(record)
    manifest = {
        "subset": UNICODES,
        "tools": {"fonttools": fontTools.version, "python": sys.version.split()[0]},
        "acquire": "assets/fonts/acquire.py",
        "totalBytes": sum(r["bytes"] for r in records),
        "fonts": records,
    }
    with open(os.path.join(OUT, "provenance.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    print(f"total: {manifest['totalBytes']} bytes")


if __name__ == "__main__":
    main()
