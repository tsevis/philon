"""Cut the splash banner from the key art.

The engraving is a scholar holding a closed book — the subject the application
is named for, not a decoration. The banner needs a 2.56:1 band from a 1.29:1
plate, so the crop is the whole design decision: it is taken around the book
and the hand rather than the face, because the book is what this program is
about.

The lockup sits at the lower left over white type, and the plate is a pale
sepia. `AboutView` scrims the bottom of the banner in the view; a pale image
needs more than that, so a corner scrim is burned in here where the type
actually lands, leaving the rest of the engraving at its own value.

Usage:
    python scripts/make-splash-art.py assets/philon.jpg src/assets/splash-banner.jpg
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

# Twice the 640x250 the splash reserves, so the banner stays sharp on Retina.
WIDTH, HEIGHT = 1280, 500

#: Where the band sits in the plate, as a fraction of its height. The book and
#: the hand holding it are a little below centre.
CROP_CENTRE = 0.54

#: The corner the lockup occupies, and how dark it has to go for white type.
SCRIM_WIDTH = 0.78
SCRIM_HEIGHT = 0.60
SCRIM_INK = (10, 16, 14)
SCRIM_STRENGTH = 0.93


def band(plate: Image.Image) -> Image.Image:
    """The widest band of the plate at the banner's ratio, around the book."""
    ratio = WIDTH / HEIGHT
    height = round(plate.width / ratio)
    if height > plate.height:  # a plate too wide to give a full-width band
        height = plate.height
    top = round(plate.height * CROP_CENTRE - height / 2)
    top = max(0, min(plate.height - height, top))
    return plate.crop((0, top, plate.width, top + height)).resize((WIDTH, HEIGHT), Image.LANCZOS)


def falloff(length: int, reach: float, power: float) -> list[int]:
    """A one-dimensional falloff: full at index 0, gone by `reach`."""
    span = max(1.0, length * reach)
    return [round(255 * max(0.0, 1.0 - index / span) ** power) for index in range(length)]


def corner_scrim(image: Image.Image) -> Image.Image:
    """Carry the lower left toward ink, so the lockup has something to sit on.

    Two falloffs multiplied rather than one straight gradient: a hard edge
    across a picture reads as a mistake, and the type only needs the corner.
    The rest of the engraving keeps its own value.
    """
    across = falloff(WIDTH, SCRIM_WIDTH, 1.4)
    up = falloff(HEIGHT, SCRIM_HEIGHT, 1.3)

    horizontal = Image.new("L", (WIDTH, 1))
    horizontal.putdata(across)
    # Built bottom-up, so the full end of the falloff lands on the last row.
    vertical = Image.new("L", (1, HEIGHT))
    vertical.putdata(list(reversed(up)))

    mask = ImageChops.multiply(horizontal.resize((WIDTH, HEIGHT)), vertical.resize((WIDTH, HEIGHT)))
    mask = mask.point(lambda value: round(value * SCRIM_STRENGTH)).filter(ImageFilter.GaussianBlur(16))

    corner, opposite = mask.getpixel((4, HEIGHT - 4)), mask.getpixel((WIDTH - 4, 4))
    assert corner > 180 and opposite < 12, f"scrim is not in the corner: {corner=} {opposite=}"
    return Image.composite(Image.new("RGB", (WIDTH, HEIGHT), SCRIM_INK), image, mask)


def compose(plate_path: Path, destination: Path) -> None:
    plate = Image.open(plate_path).convert("RGB")
    banner = corner_scrim(band(plate))
    destination.parent.mkdir(parents=True, exist_ok=True)
    # An engraving is a photograph of ink on paper, not a diagram: PNG stores
    # it losslessly at ten times the size the shipped bundle needs.
    if destination.suffix.lower() in {".jpg", ".jpeg"}:
        banner.save(destination, "JPEG", quality=88, optimize=True, progressive=True)
    else:
        banner.save(destination, "PNG", optimize=True)
    print(f"{destination}  {WIDTH}x{HEIGHT}  {destination.stat().st_size // 1024}K  "
          f"from {plate.size[0]}x{plate.size[1]}")


if __name__ == "__main__":
    compose(Path(sys.argv[1]), Path(sys.argv[2]))
