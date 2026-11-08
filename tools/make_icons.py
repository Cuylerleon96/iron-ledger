#!/usr/bin/env python3
"""Generate the Android launcher icons from the same hexagon motif as the app.

ImageMagick's built-in SVG renderer mangles gradients (empty corners, black
centres), and rsvg/inkscape are not installed, so the icons are drawn directly
with Pillow at 4x and downsampled for antialiasing.
"""
import math
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
RES = ROOT / "android/app/src/main/res"

TEAL_TOP, TEAL_BOT = (26, 90, 80), (7, 30, 32)
CREAM, GOLD, GOLD_D = (248, 248, 240), (248, 208, 48), (160, 120, 0)
PERI, PERI_HI = (150, 172, 248), (196, 212, 255)

DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}
SS = 4  # supersample factor


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_plate(w, h):
    plate = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(plate)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(TEAL_TOP, TEAL_BOT, y / max(1, h - 1)) + (255,))
    return plate


def hex_pts(cx, cy, r, rot=-90):
    return [(cx + r * math.cos(math.radians(rot + 60 * i)),
             cy + r * math.sin(math.radians(rot + 60 * i))) for i in range(6)]


def draw_hexagon(d, cx, cy, r, line, dot_r):
    outer = hex_pts(cx, cy, r)
    inner = hex_pts(cx, cy, r * 0.56)
    d.polygon(outer, fill=PERI, outline=None)
    # facets from the centre out to each edge midpoint — the in-game look
    for i in range(6):
        a, b = outer[i], outer[(i + 1) % 6]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        d.polygon([(cx, cy), a, mid], fill=PERI_HI if i % 2 == 0 else PERI)
        d.polygon([(cx, cy), b, mid], fill=PERI)
    d.polygon(inner, outline=(255, 255, 255, 90), width=max(1, int(r * 0.05)))
    d.line(list(outer) + [outer[0]], fill=(255, 255, 255, 255), width=max(2, int(r * 0.09)), joint="curve")
    for p in outer:
        d.ellipse([p[0] - dot_r, p[1] - dot_r, p[0] + dot_r, p[1] + dot_r], fill=(10, 42, 42, 255))
        d.ellipse([p[0] - dot_r, p[1] - dot_r, p[0] + dot_r, p[1] + dot_r],
                  outline=GOLD, width=max(2, int(dot_r * 0.85)))


def make(size_px, kind, out):
    S = size_px * SS
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    if kind in ("legacy", "round"):
        mask = Image.new("L", (S, S), 0)
        md = ImageDraw.Draw(mask)
        if kind == "round":
            md.ellipse([0, 0, S - 1, S - 1], fill=255)
        else:
            md.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        im.paste(gradient_plate(S, S), (0, 0), mask)
        inset = S * 0.045
        d.rounded_rectangle([inset, inset, S - inset, S - inset],
                            radius=int(S * 0.19), outline=GOLD, width=max(2, int(S * 0.035)))
        d.rounded_rectangle([inset * 1.9, inset * 1.9, S - inset * 1.9, S - inset * 1.9],
                            radius=int(S * 0.15), outline=(248, 208, 48, 110), width=max(1, int(S * 0.012)))
        r = S * 0.27
    else:  # adaptive foreground: transparent, content inside the 66% safe zone
        r = S * 0.205

    draw_hexagon(d, S / 2, S / 2, r, CREAM, r * 0.075)
    im.resize((size_px, size_px), Image.LANCZOS).save(out, "PNG")
    return out


count = 0
for name, scale in DENSITIES.items():
    base = round(48 * scale)
    for kind, fname in (("legacy", "ic_launcher.png"), ("round", "ic_launcher_round.png")):
        p = RES / f"mipmap-{name}" / fname
        if p.parent.exists():
            make(base, kind, p); count += 1
    fg = round(108 * scale)
    p = RES / f"mipmap-{name}" / "ic_launcher_foreground.png"
    if p.parent.exists():
        make(fg, "foreground", p); count += 1

# adaptive background colour = the app's teal
(RES / "values/ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<resources>\n"
    '    <color name="ic_launcher_background">#0D3B38</color>\n'
    "</resources>\n"
)
print(f"wrote {count} launcher icons + adaptive background colour")
