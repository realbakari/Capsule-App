#!/usr/bin/env python3
"""Derive desktop icons from assets/logo.png without modifying that file."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "logo.png"
BUILD = ROOT / "apps" / "desktop" / "build"
RENDERER_PUBLIC = ROOT / "apps" / "desktop" / "src" / "renderer" / "public"

# macOS iconutil names: 1x and 2x companions.
ICONSET_SIZES = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]


# Apple's macOS app-icon grid: the rounded body occupies 824 of a 1024 canvas,
# centred, with the remainder transparent. An icon drawn edge to edge renders
# noticeably larger than every neighbour in the Dock — measured against shipping
# apps, Cursor sits at 80.3%, Claude 84.6%, Notes and Mail 87.5%.
ICON_BODY_RATIO = 824 / 1024


def macos_icon_mask(size: int) -> Image.Image:
    """Squircle mask so Dock/dev icons are not a sharp square.

    radius ≈ 22.37% matches Apple's continuous-corner app icon.
    """
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = max(2, round(size * 0.2237))
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def apply_macos_shape(image: Image.Image) -> Image.Image:
    """Shape the art, then inset it on a transparent canvas of the full size.

    The mask is applied at the body size so the corner radius stays correct
    relative to the visible icon rather than to the padded canvas.
    """
    canvas = image.width
    body = max(1, round(canvas * ICON_BODY_RATIO))
    art = image.convert("RGBA").resize((body, body), Image.Resampling.LANCZOS)
    shaped = Image.new("RGBA", (body, body), (0, 0, 0, 0))
    shaped.paste(art, mask=macos_icon_mask(body))
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    offset = (canvas - body) // 2
    out.paste(shaped, (offset, offset))
    return out


def resize_app_icon(source: Image.Image, size: int) -> Image.Image:
    image = source.resize((size, size), Image.Resampling.LANCZOS)
    if size <= 64:
        image = image.filter(ImageFilter.UnsharpMask(radius=0.6, percent=120, threshold=2))
    return apply_macos_shape(image.convert("RGBA"))


def tray_template(source: Image.Image, size: int) -> Image.Image:
    """Black glyph + alpha, so Electron can mark it as a macOS template image."""
    mask = source.convert("L").point(lambda pixel: 255 if pixel > 48 else 0)
    bounds = mask.getbbox()
    if bounds:
        pad = max(8, int(max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 0.14))
        mask = mask.crop(
            (
                max(0, bounds[0] - pad),
                max(0, bounds[1] - pad),
                min(mask.width, bounds[2] + pad),
                min(mask.height, bounds[3] + pad),
            )
        )
    # Thicken hairlines so the mark survives 16px menu-bar size.
    mask = mask.filter(ImageFilter.MaxFilter(9))
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    mask = mask.point(lambda pixel: 255 if pixel > 20 else 0)
    glyph = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(glyph, mask=mask)
    return out


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Missing logo at {SOURCE}")

    source = Image.open(SOURCE).convert("RGB")
    BUILD.mkdir(parents=True, exist_ok=True)
    RENDERER_PUBLIC.mkdir(parents=True, exist_ok=True)

    master = resize_app_icon(source, 1024)
    master.save(BUILD / "icon.png", format="PNG", optimize=True)
    resize_app_icon(source, 256).save(RENDERER_PUBLIC / "icon.png", format="PNG", optimize=True)
    resize_app_icon(source, 32).save(RENDERER_PUBLIC / "favicon.png", format="PNG", optimize=True)

    tray_template(source, 16).save(BUILD / "trayTemplate.png", format="PNG", optimize=True)
    tray_template(source, 32).save(BUILD / "trayTemplate@2x.png", format="PNG", optimize=True)

    with tempfile.TemporaryDirectory(prefix="capsule-iconset-") as tmp:
        iconset = Path(tmp) / "Capsule.iconset"
        iconset.mkdir()
        for name, size in ICONSET_SIZES:
            resize_app_icon(source, size).save(iconset / name, format="PNG", optimize=True)
        icns = BUILD / "icon.icns"
        subprocess.run(["iconutil", "-c", "icns", "-o", str(icns), str(iconset)], check=True)
        if not icns.is_file():
            raise SystemExit("iconutil did not write icon.icns")

    print(f"Wrote icons from {SOURCE.relative_to(ROOT)} (source unchanged)")
    for path in sorted(BUILD.iterdir()):
        print(f"  {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
