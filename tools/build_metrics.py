"""
build_metrics.py — regenerates js/metrics.js
--------------------------------------------------------------------------
Skynet (the CV portal IIM Mumbai uses) turns the CV into a PDF with iText.
iText lays text out by simply adding up each character's "advance width"
from the font file: no kerning, no ligatures. To predict its line breaks
exactly, we copy those same advance widths out of EB Garamond.

Usage (needs:  pip install fonttools brotli):
    python3 tools/build_metrics.py Regular.ttf Bold.ttf Italic.ttf BoldItalic.ttf

Get the four .ttf files from Google Fonts (static 400/700, upright and italic).
It also writes the matching .woff2 web fonts into fonts/.
Widths are stored in font units per 1000 (1 unit = 1/1000 of the font size).
"""
import sys
from fontTools.ttLib import TTFont

# Characters Skynet's copy of EB Garamond does NOT have. iText draws them in
# DejaVu Sans instead, so they are wider than in Google's EB Garamond.
# Measured straight from Skynet-generated PDFs: [regular, bold] widths
# (DejaVu's slanted versions are just as wide, so italic uses the same numbers).
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


regular, bold, italic, bold_italic = (widths(p) for p in sys.argv[1:5])
for code, (r, b) in SKYNET_FALLBACK.items():
    regular[code], bold[code], italic[code], bold_italic[code] = r, b, r, b

# Web fonts for the preview, made from the very same files.
for path, name in zip(sys.argv[1:5], ['Regular', 'Bold', 'Italic', 'BoldItalic']):
    font = TTFont(path)
    font.flavor = 'woff2'
    font.save(f'fonts/EBGaramond-{name}.woff2')

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
  italic: {to_js(italic)},
  boldItalic: {to_js(bold_italic)},
}};
"""
open('js/metrics.js', 'w').write(out)
print(f'wrote js/metrics.js ({len(regular)} characters × 4 styles) and 4 fonts in fonts/')
