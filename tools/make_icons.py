"""生成 LCARS 风格的 App 图标（胶囊药丸 + 圆弧装饰）。
用法：python tools/make_icons.py
依赖：Pillow
"""
import os
from PIL import Image, ImageDraw, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

S = 1024
BLACK = (0, 0, 0, 255)
ORANGE = (255, 156, 0, 255)
SKY = (153, 204, 255, 255)
LILAC = (204, 153, 204, 255)
GREEN = (153, 204, 153, 255)

LANCZOS = getattr(Image, "Resampling", Image).LANCZOS


def build():
    img = Image.new("RGBA", (S, S), BLACK)

    # 底部圆弧装饰（LCARS elbow）
    deco = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(deco)
    d.arc([-S * 0.34, S * 0.62, S * 0.78, S * 1.34], 195, 340, fill=LILAC, width=int(S * 0.045))
    img = Image.alpha_composite(img, deco)

    # 胶囊药丸
    w, h = int(S * 0.60), int(S * 0.28)
    x0, y0 = (S - w) // 2, (S - h) // 2
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=h // 2, fill=255)

    left = Image.new("RGBA", (S, S), ORANGE)
    left.putalpha(mask)

    right = Image.new("RGBA", (S, S), SKY)
    half = Image.new("L", (S, S), 0)
    ImageDraw.Draw(half).rectangle([x0 + w // 2, 0, x0 + w, S], fill=255)
    right.putalpha(ImageChops.multiply(half, mask))

    img = Image.alpha_composite(img, left)
    img = Image.alpha_composite(img, right)

    # 中缝
    d2 = ImageDraw.Draw(img)
    gap = int(S * 0.008)
    d2.rectangle([x0 + w // 2 - gap, y0 + h * 0.12, x0 + w // 2 + gap, y0 + h * 0.88], fill=BLACK)

    # 斜放
    img = img.rotate(42, resample=Image.BICUBIC)

    # 右下角小绿点（打卡）
    d3 = ImageDraw.Draw(img)
    r = int(S * 0.055)
    cx, cy = int(S * 0.755), int(S * 0.775)
    d3.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    return img


def save(img, size, name, pad_ratio=0.0):
    canvas = Image.new("RGBA", (size, size), BLACK)
    inner = int(size * (1 - pad_ratio * 2))
    small = img.resize((inner, inner), LANCZOS)
    off = (size - inner) // 2
    canvas.alpha_composite(small, (off, off))
    canvas.convert("RGB").save(os.path.join(OUT, name), "PNG", optimize=True)
    print("wrote", name, size)


if __name__ == "__main__":
    ic = build()
    save(ic, 192, "icon-192.png")
    save(ic, 512, "icon-512.png")
    save(ic, 512, "icon-maskable-512.png", pad_ratio=0.12)  # maskable 需要安全区留白
    save(ic, 180, "apple-touch-icon.png")
    print("done ->", OUT)
