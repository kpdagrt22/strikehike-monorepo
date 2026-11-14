"""Generate the hosted email logo and icon set.

One-off build tool, not a runtime dependency. Run from `frontend/`:

    python scripts/generate-email-assets.py

Pillow is used only here. The output is committed under `public/email/`.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "email"
ICONS = OUT / "icons"
FONT_MEDIUM = ROOT / "src" / "app" / "_og" / "Onest-Medium.ttf"
FONT_LIGHT = ROOT / "src" / "app" / "_og" / "Onest-Light.ttf"

INK = "#f2ede4"
GOLD = "#ff8b77"
HALO = "#090910"
BG = "#14121a"


def _font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def _halo(draw: ImageDraw.ImageDraw, shape: str, box, **kwargs) -> None:
    """Draw the same shape once in the dark halo colour, then in the fill."""
    draw_fn = getattr(draw, shape)
    draw_fn(box, outline=HALO, width=kwargs.pop("width", 2) + 2, **kwargs)


def logo() -> None:
    image = Image.new("RGBA", (300, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, 299, 63), radius=14, fill=BG)
    # The mark: a gold ring with an ivory centre and a small coral dot.
    draw.ellipse((20, 14, 56, 50), outline=GOLD, width=3)
    draw.ellipse((31, 25, 45, 39), fill=INK)
    draw.ellipse((43, 20, 49, 26), fill=GOLD)
    draw.text((70, 13), "Strike", font=_font(FONT_MEDIUM, 29), fill=INK)
    strike_width = draw.textlength("Strike", font=_font(FONT_MEDIUM, 29))
    draw.text(
        (70 + strike_width, 13),
        "Hike",
        font=_font(FONT_LIGHT, 29),
        fill=INK,
    )
    image.save(OUT / "logo-dark.png", optimize=True)


def _icon(name: str, draw_fn) -> None:
    image = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw_fn(draw)
    image.save(ICONS / f"{name}.png", optimize=True)


def _moon(fraction: str):
    def draw(d: ImageDraw.ImageDraw) -> None:
        d.ellipse((6, 6, 26, 26), outline=HALO, width=4)
        d.ellipse((6, 6, 26, 26), outline=GOLD, width=2)
        if fraction == "full":
            d.ellipse((8, 8, 24, 24), fill=INK)
        elif fraction == "first":
            d.pieslice((8, 8, 24, 24), start=270, end=90, fill=INK)
        elif fraction == "last":
            d.pieslice((8, 8, 24, 24), start=90, end=270, fill=INK)

    return draw


def _ingress(d: ImageDraw.ImageDraw) -> None:
    d.line((7, 25, 25, 7), fill=HALO, width=5)
    d.line((7, 25, 25, 7), fill=GOLD, width=2)
    d.line((7, 7, 7, 25), fill=HALO, width=4)
    d.line((7, 7, 7, 25), fill=INK, width=1)
    d.polygon([(25, 7), (17, 9), (23, 15)], fill=GOLD)


def _station(d: ImageDraw.ImageDraw) -> None:
    d.ellipse((7, 9, 23, 25), outline=HALO, width=4)
    d.ellipse((7, 9, 23, 25), outline=GOLD, width=2)
    d.arc((3, 3, 29, 29), start=200, end=340, fill=INK, width=2)
    d.polygon([(27, 8), (21, 9), (25, 14)], fill=INK)


def _eclipse(d: ImageDraw.ImageDraw) -> None:
    d.ellipse((4, 8, 22, 26), outline=HALO, width=4)
    d.ellipse((4, 8, 22, 26), fill=INK)
    d.ellipse((11, 6, 29, 24), outline=HALO, width=4)
    d.ellipse((11, 6, 29, 24), outline=GOLD, width=2)


def _finance(d: ImageDraw.ImageDraw) -> None:
    for x, top in ((7, 19), (13, 13), (19, 9), (25, 15)):
        d.rectangle((x, top, x + 4, 25), fill=HALO)
        d.rectangle((x + 1, top + 1, x + 3, 24), fill=GOLD)


def _culture(d: ImageDraw.ImageDraw) -> None:
    points = []
    for index in range(10):
        angle = -90 + index * 36
        radius = 11 if index % 2 == 0 else 5
        import math

        points.append(
            (
                16 + math.cos(math.radians(angle)) * radius,
                16 + math.sin(math.radians(angle)) * radius,
            )
        )
    d.polygon(points, fill=HALO)
    d.polygon(points, fill=GOLD)
    d.ellipse((14, 14, 18, 18), fill=INK)


def _regime(d: ImageDraw.ImageDraw) -> None:
    points = [(5, 22), (11, 17), (17, 19), (23, 11), (27, 8)]
    d.line(points, fill=HALO, width=5, joint="curve")
    d.line(points, fill=GOLD, width=2, joint="curve")
    for x, y in points:
        d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=INK)


def _calendar(d: ImageDraw.ImageDraw) -> None:
    d.rounded_rectangle((5, 7, 27, 27), radius=4, outline=HALO, width=4)
    d.rounded_rectangle((5, 7, 27, 27), radius=4, outline=GOLD, width=2)
    d.line((5, 13, 27, 13), fill=GOLD, width=2)
    d.line((10, 4, 10, 10), fill=INK, width=2)
    d.line((22, 4, 22, 10), fill=INK, width=2)


def _ledger(d: ImageDraw.ImageDraw) -> None:
    for y in (9, 15, 21):
        d.line((6, y, 20, y), fill=HALO, width=4)
        d.line((6, y, 20, y), fill=INK, width=1)
    d.line((22, 8, 27, 13), fill=HALO, width=4)
    d.line((22, 8, 27, 13), fill=GOLD, width=2)
    d.line((27, 13, 22, 24), fill=HALO, width=4)
    d.line((27, 13, 22, 24), fill=GOLD, width=2)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ICONS.mkdir(parents=True, exist_ok=True)
    logo()
    _icon("moon-new", _moon("new"))
    _icon("moon-first-quarter", _moon("first"))
    _icon("moon-full", _moon("full"))
    _icon("moon-last-quarter", _moon("last"))
    _icon("ingress", _ingress)
    _icon("station", _station)
    _icon("eclipse", _eclipse)
    _icon("finance", _finance)
    _icon("culture", _culture)
    _icon("regime", _regime)
    _icon("calendar", _calendar)
    _icon("ledger", _ledger)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
