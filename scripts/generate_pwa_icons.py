"""
scripts/generate_pwa_icons.py — Gerador de ícones PWA oficiais de alta resolução para o AetherML.
Gera:
- pwa-192x192.png
- pwa-512x512.png
- maskable-icon-512x512.png (com safe zone de 80% para evitar corte no Android)
- apple-touch-icon.png (180x180)
- favicon-32x32.png
- favicon.ico
"""

import math
import os
import sys
from PIL import Image, ImageDraw

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def hex_to_rgb(hex_str: str):
    hex_str = hex_str.lstrip("#")
    return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))

COLOR_SKY = hex_to_rgb("#0284c7")
COLOR_EMERALD = hex_to_rgb("#10b981")
COLOR_GREEN = hex_to_rgb("#4ade80")
COLOR_YELLOW = hex_to_rgb("#facc15")
COLOR_ORANGE = hex_to_rgb("#fb923c")
COLOR_RED = hex_to_rgb("#f87171")
COLOR_WHITE = (255, 255, 255)

def interpolate_color(c1, c2, factor):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * factor) for i in range(3))

def get_arc_color(t):
    # t from 0.0 (left, 180 deg) to 1.0 (right, 0 deg)
    if t <= 0.45:
        return interpolate_color(COLOR_GREEN, COLOR_YELLOW, t / 0.45)
    elif t <= 0.72:
        return interpolate_color(COLOR_YELLOW, COLOR_ORANGE, (t - 0.45) / (0.72 - 0.45))
    else:
        return interpolate_color(COLOR_ORANGE, COLOR_RED, (t - 0.72) / (1.0 - 0.72))

def render_aetherml_icon(size: int, is_maskable: bool = False, is_apple: bool = False) -> Image.Image:
    # Render at high super-sampling resolution (4x) for crisp antialiasing
    scale = 4
    canvas_size = size * scale
    img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Base coordinate system: 64x64
    # If maskable, scale content down to ~76% and center with safe margin
    if is_maskable:
        content_scale = 0.76
        offset_x = (1.0 - content_scale) / 2.0 * canvas_size
        offset_y = (1.0 - content_scale) / 2.0 * canvas_size
    else:
        content_scale = 1.0
        offset_x = 0
        offset_y = 0

    def transform(x64, y64):
        cx = offset_x + (x64 / 64.0) * canvas_size * content_scale
        cy = offset_y + (y64 / 64.0) * canvas_size * content_scale
        return cx, cy

    # Background
    if is_maskable:
        # Full background gradient filling the entire square for adaptive masks
        bg = Image.new("RGBA", (canvas_size, canvas_size))
        bg_draw = ImageDraw.Draw(bg)
        for y in range(canvas_size):
            for x in range(canvas_size):
                # Diagonal gradient from top-left to bottom-right
                t = (x + y) / (2.0 * canvas_size)
                t = max(0.0, min(1.0, t))
                r = int(COLOR_SKY[0] + (COLOR_EMERALD[0] - COLOR_SKY[0]) * t)
                g = int(COLOR_SKY[1] + (COLOR_EMERALD[1] - COLOR_SKY[1]) * t)
                b = int(COLOR_SKY[2] + (COLOR_EMERALD[2] - COLOR_SKY[2]) * t)
                bg.putpixel((x, y), (r, g, b, 255))
        img = bg
        draw = ImageDraw.Draw(img)
    elif is_apple:
        # Full square gradient for iOS (iOS adds its own corner radius)
        bg = Image.new("RGBA", (canvas_size, canvas_size))
        for y in range(canvas_size):
            for x in range(canvas_size):
                t = (x + y) / (2.0 * canvas_size)
                t = max(0.0, min(1.0, t))
                r = int(COLOR_SKY[0] + (COLOR_EMERALD[0] - COLOR_SKY[0]) * t)
                g = int(COLOR_SKY[1] + (COLOR_EMERALD[1] - COLOR_SKY[1]) * t)
                b = int(COLOR_SKY[2] + (COLOR_EMERALD[2] - COLOR_SKY[2]) * t)
                bg.putpixel((x, y), (r, g, b, 255))
        img = bg
        draw = ImageDraw.Draw(img)
    else:
        # Rounded rectangle: rect x="2" y="2" width="60" height="60" rx="16"
        x0, y0 = transform(2, 2)
        x1, y1 = transform(62, 62)
        radius = (16.0 / 64.0) * canvas_size * content_scale

        mask = Image.new("L", (canvas_size, canvas_size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=255)

        bg = Image.new("RGBA", (canvas_size, canvas_size))
        for y in range(int(y0), int(y1) + 1):
            if y < 0 or y >= canvas_size:
                continue
            for x in range(int(x0), int(x1) + 1):
                if x < 0 or x >= canvas_size:
                    continue
                # Gradient based on relative position within the rect
                t = ((x - x0) + (y - y0)) / ((x1 - x0) + (y1 - y0))
                t = max(0.0, min(1.0, t))
                r = int(COLOR_SKY[0] + (COLOR_EMERALD[0] - COLOR_SKY[0]) * t)
                g = int(COLOR_SKY[1] + (COLOR_EMERALD[1] - COLOR_SKY[1]) * t)
                b = int(COLOR_SKY[2] + (COLOR_EMERALD[2] - COLOR_SKY[2]) * t)
                bg.putpixel((x, y), (r, g, b, 255))

        img.paste(bg, (0, 0), mask)
        draw = ImageDraw.Draw(img)

    # Gauge Arc: center (32, 41), radius 17, stroke width 7
    # Path d="M15 41 A17 17 0 0 1 49 41" (angle from pi to 0)
    arc_cx, arc_cy = transform(32, 41)
    arc_r = (17.0 / 64.0) * canvas_size * content_scale
    stroke_w = (7.0 / 64.0) * canvas_size * content_scale
    half_stroke = stroke_w / 2.0

    steps = 400
    for i in range(steps):
        t1 = i / steps
        t2 = (i + 1) / steps
        # theta from pi (180 deg, left) down to 0 (right)
        theta1 = math.pi * (1.0 - t1)
        theta2 = math.pi * (1.0 - t2)

        x_a = arc_cx + arc_r * math.cos(theta1)
        y_a = arc_cy - arc_r * math.sin(theta1)
        x_b = arc_cx + arc_r * math.cos(theta2)
        y_b = arc_cy - arc_r * math.sin(theta2)

        color = get_arc_color((t1 + t2) / 2.0)
        draw.line([(x_a, y_a), (x_b, y_b)], fill=(*color, 255), width=int(round(stroke_w)))

    # Arc round caps at ends
    cap_r = stroke_w / 2.0
    x_start = arc_cx - arc_r
    y_start = arc_cy
    draw.ellipse([x_start - cap_r, y_start - cap_r, x_start + cap_r, y_start + cap_r], fill=(*COLOR_GREEN, 255))

    x_end = arc_cx + arc_r
    y_end = arc_cy
    draw.ellipse([x_end - cap_r, y_end - cap_r, x_end + cap_r, y_end + cap_r], fill=(*COLOR_RED, 255))

    # Needle: line from (32, 41) to (23, 33), stroke-width 4.5, stroke-linecap round
    nx1, ny1 = transform(32, 41)
    nx2, ny2 = transform(23, 33)
    needle_w = (4.5 / 64.0) * canvas_size * content_scale
    draw.line([(nx1, ny1), (nx2, ny2)], fill=(*COLOR_WHITE, 255), width=int(round(needle_w)))

    needle_cap_r = needle_w / 2.0
    draw.ellipse([nx2 - needle_cap_r, ny2 - needle_cap_r, nx2 + needle_cap_r, ny2 + needle_cap_r], fill=(*COLOR_WHITE, 255))

    # Center Hub: circle at (32, 41) radius 4.5
    hub_cx, hub_cy = transform(32, 41)
    hub_r = (4.5 / 64.0) * canvas_size * content_scale
    draw.ellipse([hub_cx - hub_r, hub_cy - hub_r, hub_cx + hub_r, hub_cy + hub_r], fill=(*COLOR_WHITE, 255))

    # Resample to final requested size with Lanczos filter for high quality
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

def main():
    out_dir = os.path.join("apps", "web", "public")
    os.makedirs(out_dir, exist_ok=True)

    print("[PWA] Gerando ícones...")
    # 1. PWA 192x192
    img192 = render_aetherml_icon(192)
    img192.save(os.path.join(out_dir, "pwa-192x192.png"), "PNG")
    print("  ✓ pwa-192x192.png")

    # 2. PWA 512x512
    img512 = render_aetherml_icon(512)
    img512.save(os.path.join(out_dir, "pwa-512x512.png"), "PNG")
    print("  ✓ pwa-512x512.png")

    # 3. Maskable 512x512 (with safe zone)
    maskable = render_aetherml_icon(512, is_maskable=True)
    maskable.save(os.path.join(out_dir, "maskable-icon-512x512.png"), "PNG")
    print("  ✓ maskable-icon-512x512.png")

    # 4. Apple Touch Icon 180x180
    apple_icon = render_aetherml_icon(180, is_apple=True)
    apple_icon.save(os.path.join(out_dir, "apple-touch-icon.png"), "PNG")
    print("  ✓ apple-touch-icon.png")

    # 5. Favicon 32x32 & favicon.ico
    fav32 = render_aetherml_icon(32)
    fav32.save(os.path.join(out_dir, "favicon-32x32.png"), "PNG")
    fav32.save(os.path.join(out_dir, "favicon.ico"), "ICO", sizes=[(32, 32), (16, 16)])
    print("  ✓ favicon-32x32.png e favicon.ico")

    print("[PWA] Todos os ícones foram gerados com sucesso!")

if __name__ == "__main__":
    main()
