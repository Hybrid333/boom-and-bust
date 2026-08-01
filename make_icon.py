"""Erzeugt icon.ico fuer BOOM & BUST — ein Wuerfel auf einer Konjunkturkurve."""
from PIL import Image, ImageDraw

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# runder dunkler Hintergrund mit warmem Rand
d.ellipse([8, 8, S - 8, S - 8], fill=(20, 32, 50, 255), outline=(255, 209, 102, 255), width=14)

# Konjunkturkurve: Boom -> Bust -> Erholung
pts = []
import math
for i in range(101):
    x = 60 + i * (S - 120) / 100
    t = i / 100
    y = 250 - 118 * math.sin(t * math.pi * 1.9) * (1 - 0.25 * t)
    pts.append((x, y))
d.line(pts, fill=(126, 224, 129, 255), width=20, joint="curve")

# roter Absturz-Abschnitt hervorheben
d.line(pts[42:68], fill=(255, 107, 107, 255), width=20, joint="curve")

# Wuerfel
cx, cy, r = S // 2, 372, 92
d.rounded_rectangle([cx - r, cy - r, cx + r, cy + r], radius=26,
                    fill=(242, 246, 252, 255), outline=(20, 32, 50, 255), width=8)
for px, py in [(-0.42, -0.42), (0.42, -0.42), (0, 0), (-0.42, 0.42), (0.42, 0.42)]:
    d.ellipse([cx + px * r - 17, cy + py * r - 17, cx + px * r + 17, cy + py * r + 17],
              fill=(22, 34, 52, 255))

img.save("icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.resize((256, 256), Image.LANCZOS).save("icon.png")
print("icon.ico + icon.png geschrieben")
