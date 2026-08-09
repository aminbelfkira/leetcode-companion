#!/usr/bin/env python3
"""Génère extension/icon/*.png : tuile verte NeetCode arrondie + « N » blanc.

Aucune dépendance (zlib + struct). Rendu supersamplé x4 puis moyenné.

    python3 tools/make-icons.py
"""

import os
import struct
import zlib

SIZES = (16, 32, 48, 96, 128)
SS = 4  # facteur de supersampling

BG = (0x48, 0xC7, 0x8E)  # vert NeetCode
FG = (0xFF, 0xFF, 0xFF)

RADIUS = 0.2237  # rayon des coins, en fraction du côté (proche du squircle iOS)

# Le « N » en coordonnées unitaires : deux barres verticales + une diagonale.
BAR_TOP, BAR_BOTTOM = 0.255, 0.745
LEFT_BAR = (0.250, 0.380)
RIGHT_BAR = (0.620, 0.750)
DIAGONAL = (
    (0.250, 0.255),
    (0.380, 0.255),
    (0.750, 0.745),
    (0.620, 0.745),
)


def in_rounded_square(x, y, radius):
    """x, y dans [0, 1]. Coins arrondis de rayon `radius`."""
    dx = max(radius - x, x - (1.0 - radius), 0.0)
    dy = max(radius - y, y - (1.0 - radius), 0.0)
    return dx * dx + dy * dy <= radius * radius


def in_convex_quad(x, y, quad):
    """Vrai si le point est du même côté des quatre arêtes (quad en sens horaire)."""
    sign = None
    for i in range(4):
        ax, ay = quad[i]
        bx, by = quad[(i + 1) % 4]
        cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
        if cross == 0:
            continue
        current = cross > 0
        if sign is None:
            sign = current
        elif sign != current:
            return False
    return True


def in_glyph(x, y):
    if BAR_TOP <= y <= BAR_BOTTOM:
        if LEFT_BAR[0] <= x <= LEFT_BAR[1]:
            return True
        if RIGHT_BAR[0] <= x <= RIGHT_BAR[1]:
            return True
    return in_convex_quad(x, y, DIAGONAL)


def render(size):
    """Renvoie les pixels RGBA (bytearray) de l'icône."""
    hi = size * SS
    # Rendu haute résolution : 1 octet d'alpha + booléen de glyphe par pixel.
    hi_rows = []
    for py in range(hi):
        y = (py + 0.5) / hi
        row = bytearray(hi * 2)
        for px in range(hi):
            x = (px + 0.5) / hi
            inside = in_rounded_square(x, y, RADIUS)
            row[px * 2] = 255 if inside else 0
            row[px * 2 + 1] = 1 if inside and in_glyph(x, y) else 0
        hi_rows.append(row)

    # Moyennage vers la résolution cible.
    out = bytearray(size * size * 4)
    samples = SS * SS
    for oy in range(size):
        for ox in range(size):
            alpha_sum = 0
            glyph_sum = 0
            for sy in range(SS):
                row = hi_rows[oy * SS + sy]
                base = (ox * SS) * 2
                for sx in range(SS):
                    alpha_sum += row[base + sx * 2]
                    glyph_sum += row[base + sx * 2 + 1]
            alpha = alpha_sum // samples
            glyph = glyph_sum / samples
            r = round(BG[0] + (FG[0] - BG[0]) * glyph)
            g = round(BG[1] + (FG[1] - BG[1]) * glyph)
            b = round(BG[2] + (FG[2] - BG[2]) * glyph)
            i = (oy * size + ox) * 4
            out[i] = r
            out[i + 1] = g
            out[i + 2] = b
            out[i + 3] = alpha
    return out


def write_png(path, size, pixels):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filtre None
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "extension", "icon")
    os.makedirs(out_dir, exist_ok=True)
    for size in SIZES:
        path = os.path.join(out_dir, f"{size}.png")
        write_png(path, size, render(size))
        print(f"{path} ({size}x{size})")


if __name__ == "__main__":
    main()
