# Rebuilds the card images, the rail faces and the walking mirror from ui-assets/assets/.
# The results are committed; this script only regenerates them.
# Usage: python3 -I tools/make-sprites.py [<cards-mod-dir> <rail-mod-dir>]   (needs Pillow)
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "ui-assets", "assets")
CHARS = ["kid", "robot", "cat", "oldman", "frog", "punk"]
BODY = 256
FACE = 64
# The head sits in the top 60 % of each 192 px tall sprite; a square from there frames it.
HEAD_SHARE = 0.60
_resample = getattr(Image, "Resampling", Image).NEAREST


def bottom_center(im):
    # Never interpolate: a pixel edge stays hard when the sprite is scaled.
    height = BODY
    width = round(im.width * height / im.height)
    if width > BODY:
        width = BODY
        height = round(im.height * width / im.width)
    scaled = im.resize((width, height), _resample)
    out = Image.new("RGBA", (BODY, BODY), (0, 0, 0, 0))
    out.alpha_composite(scaled, ((BODY - width) // 2, BODY - height))
    return out


def head(im):
    side = min(im.width, round(im.height * HEAD_SHARE))
    left = (im.width - side) // 2
    return im.crop((left, 0, left + side, side)).resize((FACE, FACE), _resample)


def main():
    cards = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "mods", "arcade-cards")
    rail = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "mods", "arcade-rail")
    os.makedirs(os.path.join(cards, "chars"), exist_ok=True)
    os.makedirs(os.path.join(rail, "faces"), exist_ok=True)
    for who in CHARS:
        source = Image.open(os.path.join(ASSETS, f"{who}_alert.webp")).convert("RGBA")
        char = bottom_center(source)
        char.save(os.path.join(cards, "chars", f"{who}.png"))
        char.transpose(Image.FLIP_LEFT_RIGHT).save(os.path.join(cards, "chars", f"{who}_l.png"))
        head(source).save(os.path.join(rail, "faces", f"{who}.png"))
    print("wrote", cards, rail)


if __name__ == "__main__":
    main()
