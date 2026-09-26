"""生成桌面端图标 build/icon.ico（五法术力色圆点 + 深色底）。

需要 venv 里的 Pillow：
  C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe scripts/make_icon.py
"""
from PIL import Image, ImageDraw
import os

SIZE = 512
BG = (23, 28, 36, 255)        # #171c24，与分享图底色一致
BORDER = (201, 162, 77, 255)  # 金色描边
COLORS = [
    (249, 250, 244, 255),  # W
    (14, 104, 171, 255),   # U
    (46, 40, 38, 255),     # B
    (211, 32, 42, 255),    # R
    (0, 115, 62, 255),     # G
]


def rounded(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.20)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)
    inset = int(size * 0.045)
    d.rounded_rectangle(
        [inset, inset, size - 1 - inset, size - 1 - inset],
        radius=int(r * 0.75),
        outline=BORDER,
        width=max(1, int(size * 0.022)),
    )
    return img


def draw_dots(img: Image.Image) -> None:
    size = img.width
    d = ImageDraw.Draw(img)
    n = len(COLORS)
    # 五个圆横向等距排列，略呈弧形（中间高两边低）
    margin = size * 0.16
    span = size - margin * 2
    step = span / (n - 1)
    radius = size * 0.085
    base_y = size * 0.54
    arc = size * 0.05
    for i, c in enumerate(COLORS):
        cx = margin + step * i
        t = (i - (n - 1) / 2) / ((n - 1) / 2)  # -1 .. 1
        cy = base_y + arc * (t * t) - arc * 0.0
        d.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            fill=c,
            outline=(12, 14, 18, 255),
            width=max(1, int(size * 0.012)),
        )


def main() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), "..", "build")
    os.makedirs(out_dir, exist_ok=True)
    base = rounded(SIZE)
    draw_dots(base)
    out = os.path.abspath(os.path.join(out_dir, "icon.ico"))
    base.save(
        out,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote", out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
