"""
build_metrics.py — regenerates js/metrics.js
--------------------------------------------------------------------------
Skynet (the CV portal IIM Mumbai uses) turns the CV into a PDF with iText.
iText lays text out by simply adding up each character's "advance width"
from the font file: no kerning, no ligatures. To predict its line breaks
exactly, we copy those same advance widths out of EB Garamond.

Usage (needs:  pip install fonttools):
    python3 tools/build_metrics.py EBGaramond-Regular.ttf EBGaramond-Bold.ttf

Get the two .ttf files from Google Fonts (static 400 and 700 weights).
Widths are stored in font units per 1000 (1 unit = 1/1000 of the font size).
"""
import sys
from fontTools.ttLib import TTFont

# Characters Skynet's copy of EB Garamond does NOT have. iText draws them in
# DejaVu Sans instead, so they are wider than in Google's EB Garamond.
# Measured straight from Skynet-generated PDFs: [regular, bold] widths.
SKYNET_FALLBACK = {
    0x20B9: (636, 695),  # ₹ Indian rupee sign
}


def widths(path):
    font = TTFont(path)
    scale = 1000 / font['head'].unitsPerEm
    hmtx = font['hmtx']
    table = {}
    for code, glyph in font.getBestCmap().items():
        # Skip control characters and anything outside the Basic Multilingual Plane.
        if code < 0x20 or code > 0xFFFF:
            continue
        table[code] = round(hmtx[glyph][0] * scale, 2)
    return table


def to_js(table):
    """Write {code: width} as compact 'code:width' pairs, 12 per line."""
    items = [f'{code}:{w:g}' for code, w in sorted(table.items())]
    lines = [','.join(items[i:i + 12]) for i in range(0, len(items), 12)]
    return '{\n    ' + ',\n    '.join(lines) + '\n  }'


regular, bold = widths(sys.argv[1]), widths(sys.argv[2])
for code, (r, b) in SKYNET_FALLBACK.items():
    regular[code], bold[code] = r, b

out = f"""/* =====================================================================
   metrics.js — EB Garamond character widths (GENERATED, do not hand-edit)
   ---------------------------------------------------------------------
   Built by tools/build_metrics.py from Google Fonts' EB Garamond.
   Key   = Unicode code point of a character (e.g. 97 = "a").
   Value = how wide that character is, in 1/1000ths of the font size.
           At 9.75pt, "a" (399) is 399 / 1000 × 9.75 = 3.89pt wide.

   These are exactly the widths Skynet's PDF engine (iText) uses, so a
   line's width here = its width on the Skynet PDF (checked against real
   Skynet CVs to ±0.01pt). ₹ uses DejaVu Sans widths, like Skynet does.
   ===================================================================== */
const CV_METRICS = {{
  regular: {to_js(regular)},
  bold: {to_js(bold)},
}};
"""
open('js/metrics.js', 'w').write(out)
print(f'wrote js/metrics.js: {len(regular)} regular + {len(bold)} bold widths')
