"""Make the magenta sheet background transparent by flood fill from the border.

The default chroma key in process_assets.py removes every pixel close to magenta,
which also erases pink hair and magenta cabinet panels. Only the background region
connected to the border is removed here; pink inside a dark outline stays.
Output keeps alpha, so process_assets.py skips its own key on these files.
usage: python3 tools/flood_key.py raw/<sheet>.png raw_keyed/<sheet>.png
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
arr = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
border = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
key = np.median(border, axis=0)
dist = np.linalg.norm(arr - key, axis=-1)
near = dist < 120
labels, _ = ndimage.label(near)
edge_ids = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
bg = np.isin(labels, edge_ids[edge_ids > 0])
# also take enclosed background pockets (between arms, under bubbles): big and very close to key
pockets = (dist < 60) & ~bg
plab, n = ndimage.label(pockets)
if n:
    sizes = ndimage.sum(pockets, plab, range(1, n + 1))
    big = np.isin(plab, np.nonzero(sizes > 400)[0] + 1)
    bg |= big
# one pixel of anti-alias fringe next to the background
fringe = ndimage.binary_dilation(bg) & ~bg & (dist < 200)
bg |= fringe
alpha = np.where(bg, 0, 255).astype(np.uint8)
rgb = arr.astype(np.uint8)
rgb[bg] = 0
Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(dst)
print(dst, int((~bg).sum()), "opaque px")
