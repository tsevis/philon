"""Shape the artwork into a macOS application icon.

A macOS icon is not a square picture. It is a continuous rounded rectangle —
a squircle, not a circular-arc round-rect — inset inside a larger transparent
canvas, with a soft shadow beneath it. Ship a full-bleed square and it sits in
the Dock looking a size too big and a decade out of date, next to every other
icon that follows the grid.

Apple's icon grid for a 1024pt canvas puts the shape at 824x824, which is the
100pt margin this uses. The corner is a superellipse rather than an arc,
because an arc meets the straight edge at a visible break and the continuous
curve does not.

Usage:
    python scripts/make-app-icon.py assets/Icon!.png src-tauri/icons/source-icon.png
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageFilter

CANVAS = 1024
#: Apple's icon grid: an 824pt shape on a 1024pt canvas.
PLATE = 824
#: The superellipse exponent. 4 is noticeably boxy against a real Mac icon and
#: 6 is nearly a circle at the corners; 5 is the shape the system draws.
EXPONENT = 5.0
#: Supersampling for the mask, so the curve has no visible stair-stepping.
OVERSAMPLE = 4

SHADOW_BLUR = 11
SHADOW_OFFSET = 8
SHADOW_OPACITY = 60


def squircle(size: int) -> Image.Image:
    """An antialiased continuous-corner mask, drawn by the superellipse itself."""
    big = size * OVERSAMPLE
    mask = Image.new("L", (big, big), 0)
    pixels = mask.load()
    half = big / 2
    for y in range(big):
        # |x/a|^n + |y/a|^n <= 1, solved for the x extent of this row.
        normalised_y = abs((y + 0.5 - half) / half)
        remainder = 1.0 - normalised_y ** EXPONENT
        if remainder <= 0:
            continue
        extent = half * remainder ** (1.0 / EXPONENT)
        left = int(round(half - extent))
        right = int(round(half + extent))
        for x in range(max(0, left), min(big, right)):
            pixels[x, y] = 255
    return mask.resize((size, size), Image.LANCZOS)


def compose(art_path: Path, destination: Path) -> None:
    art = Image.open(art_path).convert("RGBA").resize((PLATE, PLATE), Image.LANCZOS)
    mask = squircle(PLATE)
    plate = Image.new("RGBA", (PLATE, PLATE), (0, 0, 0, 0))
    plate.paste(art, (0, 0), mask)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    inset = (CANVAS - PLATE) // 2

    # The shadow is the plate's own silhouette, offset and blurred — so it
    # follows the squircle rather than a rectangle behind it.
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, SHADOW_OPACITY), (inset, inset + SHADOW_OFFSET), mask)
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR)))

    canvas.paste(plate, (inset, inset), plate)
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, "PNG", optimize=True)
    print(f"{destination}  {CANVAS}x{CANVAS}  plate {PLATE}px  margin {inset}px  "
          f"{destination.stat().st_size // 1024}K")


if __name__ == "__main__":
    compose(Path(sys.argv[1]), Path(sys.argv[2]))
