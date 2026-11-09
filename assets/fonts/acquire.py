"""One-time acquisition of the eight bundled accent fonts. Builds never run this.

Downloads each family from the google/fonts repository at a pinned commit, pins variable fonts to
the registered weight, subsets them to the schema's Latin range, writes WOFF2 and OFL.txt to
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

# id, directory, file, weight, other axis pins, internal family name. The internal name is the
# upstream family, except where the OFL declares a Reserved Font Name: a subset is a Modified
# Version, so it may not carry that name.
FONTS = [
    ("rajdhani", "rajdhani", "Rajdhani-SemiBold.ttf", 600, {}, "Rajdhani"),
    ("barlow-condensed", "barlowcondensed", "BarlowCondensed-SemiBold.ttf", 600, {}, "Barlow Condensed"),
    # Fraunces: plain shapes (no soft or wonky alternates) at the 24px optical size used for accents.
    ("fraunces", "fraunces", "Fraunces[SOFT,WONK,opsz,wght].ttf", 600, {"SOFT": 0, "WONK": 0, "opsz": 24}, "Fraunces"),
    ("alegreya", "alegreya", "Alegreya[wght].ttf", 600, {}, "Alegreya"),
    ("cormorant-garamond", "cormorantgaramond", "CormorantGaramond[wght].ttf", 700, {}, "Cormorant Garamond"),
    # Reserved Font Name "Josefin Sans".
    ("josefin-sans", "josefinsans", "JosefinSans[wght].ttf", 600, {}, "Reskin Geometric Accent"),
    ("bungee", "bungee", "Bungee-Regular.ttf", 400, {}, "Bungee"),
    ("space-grotesk", "spacegrotesk", "SpaceGrotesk[wght].ttf", 600, {}, "Space Grotesk"),
]
RESERVED = {"josefin-sans": "Josefin"}
STYLES = {400: "Regular", 600: "SemiBold", 700: "Bold"}


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


def build(work, font_id, directory, file, weight, pins, internal):
    source = fetch(RAW + directory + "/" + file)
    license_text = fetch(RAW + directory + "/OFL.txt")
    path = os.path.join(work, file)
    with open(path, "wb") as handle:
        handle.write(source)
    font = TTFont(path, recalcTimestamp=False)
    version = font["name"].getDebugName(5)
    axes = {axis.axisTag for axis in font["fvar"].axes} if "fvar" in font else set()
    location = {}
    if axes:
        location = {tag: value for tag, value in pins.items() if tag in axes}
        if "wght" in axes:
            location["wght"] = weight
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
    woff2 = os.path.join(target, font_id + ".woff2")
    font.flavor = "woff2"
    font.save(woff2, reorderTables=True)
    with open(woff2, "rb") as handle:
        output = handle.read()
    with open(os.path.join(target, "OFL.txt"), "wb") as handle:
        handle.write(license_text.replace(b"\r\n", b"\n"))

    return {
        "id": font_id,
        "weight": weight,
        "file": font_id + "/" + font_id + ".woff2",
        "bytes": len(output),
        "sha256": sha256(output),
        "license": "OFL-1.1",
        "licenseFile": font_id + "/OFL.txt",
        "licenseSha256": sha256(license_text.replace(b"\r\n", b"\n")),
        "reservedFontName": font_id in RESERVED,
        "internalFamily": internal,
        "source": {
            "repository": "https://github.com/google/fonts",
            "commit": COMMIT,
            "path": "ofl/" + directory + "/" + file,
            "url": RAW + directory + "/" + file,
            "licenseUrl": RAW + directory + "/OFL.txt",
            "sha256": sha256(source),
            "version": version,
            "instance": location,
        },
    }


def main():
    records = []
    with tempfile.TemporaryDirectory(prefix="reskin-fonts-") as work:
        for spec in FONTS:
            record = build(work, *spec)
            print(f"{record['id']}: {record['bytes']} bytes")
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
