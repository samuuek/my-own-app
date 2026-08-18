from pathlib import Path
import sys

from PIL import Image


if len(sys.argv) != 3:
    raise SystemExit("usage: generate-app-icons.py SOURCE_PNG OUTPUT_DIRECTORY")

source = Path(sys.argv[1])
output = Path(sys.argv[2])

if not source.is_file():
    raise SystemExit(f"source image not found: {source}")

output.mkdir(parents=True, exist_ok=True)

with Image.open(source) as original:
    if original.width != original.height:
        raise SystemExit("source image must use a square 1:1 aspect ratio")

    image = original.convert("RGB")
    for size, name in {
        1024: "app-icon-1024-v2.png",
        512: "app-icon-brand-512-v2.png",
        180: "apple-touch-icon-180-v2.png",
        64: "favicon-64-v2.png",
    }.items():
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(output / name, format="PNG", optimize=True)

    icon = image.resize((256, 256), Image.Resampling.LANCZOS)
    icon.save(
        output / "muzi-workspace-v2.ico",
        format="ICO",
        sizes=[
            (16, 16),
            (24, 24),
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256),
        ],
    )
