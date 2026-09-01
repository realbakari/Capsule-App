#!/usr/bin/env python3
"""Draw the DMG installer background.

The window Finder opens for a .dmg is the first thing anyone sees of Capsule,
and by default it is a bare grey rectangle. This paints Capsule's own dark
surface with the same hierarchy the app uses — a letterspaced eyebrow over a
heading — plus the arrow that says what to do with the two icons Finder places
on top.

electron-builder draws the app icon and the Applications alias itself; their
positions are set in electron-builder.yml and the arrow here is drawn to sit
between them. Change one and change the other.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 540, 380
# Must match dmg.contents in electron-builder.yml.
APP_X, APP_Y = 150, 200
LINK_X, LINK_Y = 390, 200
# Finder centres the icon on APP_Y and writes its label underneath, so the
# band has to clear both.
ICON_SIZE = 96

BACKGROUND = (13, 13, 13)
PANEL = (20, 20, 20)
HAIRLINE = (44, 44, 44)
TEXT = (236, 236, 231)
FAINT = (122, 122, 118)

FONT_DIRS = [
    "/System/Library/Fonts/SFCompact.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def load_font(size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    for path in FONT_DIRS:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size, index=index)
            except OSError:
                continue
    return ImageFont.load_default()


def draw(scale: int) -> Image.Image:
    width, height = WIDTH * scale, HEIGHT * scale
    image = Image.new("RGB", (width, height), BACKGROUND)
    canvas = ImageDraw.Draw(image)

    # A slightly lighter band behind the icons, so the two drop targets read as
    # a single row rather than floating in the dark.
    band_top, band_bottom = 138 * scale, 278 * scale
    canvas.rectangle([0, band_top, width, band_bottom], fill=PANEL)
    canvas.line([(0, band_top), (width, band_top)], fill=HAIRLINE, width=scale)
    canvas.line([(0, band_bottom), (width, band_bottom)], fill=HAIRLINE, width=scale)

    eyebrow = load_font(9 * scale)
    heading = load_font(23 * scale)
    caption = load_font(11 * scale)

    # Eyebrow over heading, the same hierarchy the app and the site use.
    canvas.text((36 * scale, 40 * scale), "C A P S U L E", font=eyebrow, fill=FAINT)
    canvas.text((36 * scale, 58 * scale), "Install", font=heading, fill=TEXT)

    # Dashed arrow between the two icon positions, clear of both.
    y = APP_Y * scale
    start = (APP_X + 52) * scale
    end = (LINK_X - 52) * scale
    dash, gap = 6 * scale, 5 * scale
    x = start
    while x < end - dash:
        canvas.line([(x, y), (min(x + dash, end - dash), y)], fill=HAIRLINE, width=max(1, scale))
        x += dash + gap
    head = 5 * scale
    canvas.polygon(
        [(end, y), (end - head, y - head), (end - head, y + head)],
        fill=HAIRLINE,
    )

    canvas.text(
        (36 * scale, 300 * scale),
        "Drag Capsule to Applications, then open it from there.",
        font=caption,
        fill=FAINT,
    )
    return image


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "apps/desktop/build"
    out.mkdir(parents=True, exist_ok=True)
    draw(1).save(out / "dmg-background.png")
    draw(2).save(out / "dmg-background@2x.png")
    print(f"wrote {out/'dmg-background.png'} ({WIDTH}x{HEIGHT}) and @2x")


if __name__ == "__main__":
    main()
