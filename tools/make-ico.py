# Builds assets/icon.ico from assets/sizes/*.png:
# 16-64 px as classic 32-bit BMP (DIB) entries, 256 px as PNG. Works everywhere in Windows.
import struct, io, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets')
SIZES = [16, 20, 24, 32, 40, 48, 64, 256]

def dib(img):
    w, h = img.size
    px = img.convert('RGBA').load()
    header = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    rows = bytearray()
    for y in range(h - 1, -1, -1):  # bottom-up
        for x in range(w):
            r, g, b, a = px[x, y]
            rows += bytes((b, g, r, a))
    mask_row = ((w + 31) // 32) * 4
    mask = bytearray()
    for y in range(h - 1, -1, -1):
        row = bytearray(mask_row)
        for x in range(w):
            if px[x, y][3] == 0:
                row[x // 8] |= 0x80 >> (x % 8)
        mask += row
    return header + bytes(rows) + bytes(mask)

entries = []
for s in SIZES:
    img = Image.open(os.path.join(ROOT, 'sizes', f'{s}.png')).convert('RGBA')
    if s >= 256:
        buf = io.BytesIO(); img.save(buf, 'PNG'); data = buf.getvalue()
    else:
        data = dib(img)
    entries.append((s, data))

out = bytearray(struct.pack('<HHH', 0, 1, len(entries)))
offset = 6 + 16 * len(entries)
for s, data in entries:
    d = 0 if s >= 256 else s
    out += struct.pack('<BBBBHHII', d, d, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
for _, data in entries:
    out += data
open(os.path.join(ROOT, 'icon.ico'), 'wb').write(out)
print('icon.ico', len(out), 'bytes,', len(entries), 'sizes')
