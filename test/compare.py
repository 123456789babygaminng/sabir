# side-by-side: reference (left) | Sabir app capture (right), both at 2x
import sys
from PIL import Image
for n in sys.argv[1:]:
    ref = Image.open(f'G:/sabir_film/ref/{"permission" if n=="permission" else n}.png').convert('RGBA')
    cap = Image.open(f'G:/sabir_app/test/capture/{n}.png').convert('RGBA')
    bg = Image.new('RGBA', cap.size, (255, 255, 255, 255)); bg.alpha_composite(cap); cap = bg
    W = ref.width + cap.width + 20; H = max(ref.height, cap.height)
    out = Image.new('RGB', (W, H), (255, 0, 255))
    out.paste(ref.convert('RGB'), (0, 0)); out.paste(cap.convert('RGB'), (ref.width + 20, 0))
    out.save(f'G:/sabir_app/test/capture/cmp_{n}.png')
    print(n, ref.size, cap.size)
