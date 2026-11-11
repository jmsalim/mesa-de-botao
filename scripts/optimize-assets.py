#!/usr/bin/env python3
"""Shrink the art in public/assets for phones. Safe to re-run: it only ever downscales.

Originals of the first upload live in git history (commit 2f76ca1).
    python3 scripts/optimize-assets.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "public" / "assets"

# max edge in px, webp quality. Pieces are drawn ~70 px wide on a phone, the felt tile ~300 px.
TARGETS = {
    "textures/feltro.webp": (256, 72),
    "textures/papel.webp": (256, 70),
    "textures/acrilico.webp": (128, 78),
    "textures/marmore.webp": (128, 78),
    "textures/perolado.webp": (128, 78),
    "textures/tartaruga.webp": (128, 78),
    "images/mesa.webp": (880, 76),
}

total_before = total_after = 0
for rel, (edge, quality) in TARGETS.items():
    path = ROOT / rel
    before = path.stat().st_size
    im = Image.open(path).convert("RGB")
    if max(im.size) > edge:
        scale = edge / max(im.size)
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        im.save(path, "WEBP", quality=quality, method=6)
    after = path.stat().st_size
    total_before += before
    total_after += after
    print(f"{rel:28s} {before / 1024:7.1f} KB -> {after / 1024:6.1f} KB  {im.size[0]}x{im.size[1]}")
print(f"{'total':28s} {total_before / 1024:7.1f} KB -> {total_after / 1024:6.1f} KB")
