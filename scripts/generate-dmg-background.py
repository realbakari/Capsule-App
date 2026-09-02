#!/usr/bin/env python3
"""Draw the DMG installer background.

A clean, polished dark canvas matching Capsule's desktop aesthetic:
- Unified deep graphite background
- Clean centered header with crisp native macOS typography
- Sleek vector connector arrow between Capsule and Applications
- High-DPI @2x support for Retina displays
"""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 540, 380
# Must match dmg.contents in electron-builder.yml
APP_X, APP_Y = 145, 195
LINK_X, LINK_Y = 395, 195
ICON_SIZE = 96

BACKGROUND = (13, 13, 16)
ARROW_COLOR = (90, 90, 100)
ARROW_HEAD = (180, 180, 190)
TEXT_PRIMARY = (245, 245, 248)
TEXT_MUTED = (142, 142, 147)

FONT_PATHS = [
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFCompact.ttf",
]


def load_font(size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    for path in FONT_PATHS:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size, index=index)
            except OSError:
                continue
    return ImageFont.load_default()


def draw(scale: int) -> Image.Image:
    width, height = WIDTH * scale, HEIGHT * scale
    image = Image.new("RGBA", (width, height), BACKGROUND + (255,))
    canvas = ImageDraw.Draw(image)

    # Centered Header Typography
    title_font = load_font(20 * scale)
    subtitle_font = load_font(13 * scale)

    title_text = "Install Capsule"
    subtitle_text = "Drag Capsule to Applications to install"

    t_bbox = title_font.getbbox(title_text)
    t_width = t_bbox[2] - t_bbox[0]
    canvas.text(
        ((width - t_width) // 2, 42 * scale),
        title_text,
        font=title_font,
        fill=TEXT_PRIMARY,
    )

    s_bbox = subtitle_font.getbbox(subtitle_text)
    s_width = s_bbox[2] - s_bbox[0]
    canvas.text(
        ((width - s_width) // 2, 70 * scale),
        subtitle_text,
        font=subtitle_font,
        fill=TEXT_MUTED,
    )

    # Sleek Arrow between the two icons
    y = APP_Y * scale
    start_x = (APP_X + 58) * scale
    end_x = (LINK_X - 58) * scale
    line_width = max(2, int(2.5 * scale))

    # Connector line
    canvas.line([(start_x, y), (end_x - 6 * scale, y)], fill=ARROW_COLOR, width=line_width)

    # Modern Chevron Arrowhead
    head_len = 9 * scale
    head_h = 7 * scale
    arrow_points = [
        (end_x, y),
        (end_x - head_len, y - head_h),
        (end_x - head_len + 3 * scale, y),
        (end_x - head_len, y + head_h),
    ]
    canvas.polygon(arrow_points, fill=ARROW_HEAD)

    # Convert to RGB for output
    final_image = Image.new("RGB", (width, height), BACKGROUND)
    final_image.paste(image, (0, 0), image)
    return final_image


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "apps/desktop/build"
    out.mkdir(parents=True, exist_ok=True)
    draw(1).save(out / "dmg-background.png")
    draw(2).save(out / "dmg-background@2x.png")
    print(f"wrote {out/'dmg-background.png'} ({WIDTH}x{HEIGHT}) and @2x")


if __name__ == "__main__":
    main()

