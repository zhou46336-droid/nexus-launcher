"""生成「更多应用」的图标：彩色底 + 白色九宫格，iOS 式超椭圆外形。

用法：python3 tools/make-icon.py [输出目录] [底色风格]
  输出目录默认 app/assets，生成 app-icon.png（256px）、app-icon.ico（16~256 多尺寸）和 app-icon-preview.png
  底色风格：iosconic（默认，iOS 系统色彩虹）、iosdiag、conic、diagonal，或一个数字（随机弥散混色的种子）
需要：pip install pillow numpy"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 1024  # 先画大图再缩小，边缘更顺滑


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def superellipse_mask(size, box, n=5.0, ss=4):
    """iOS 图标那种连续曲率的外形（|x|^n + |y|^n <= 1），超采样抗锯齿。"""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ax, ay = (x1 - x0) / 2, (y1 - y0) / 2
    big = size * ss
    ys, xs = np.mgrid[0:big, 0:big].astype(np.float32)
    u = np.abs((xs + 0.5) / ss - cx) / ax
    v = np.abs((ys + 0.5) / ss - cy) / ay
    inside = (u ** n + v ** n) <= 1.0
    m = Image.fromarray((inside * 255).astype(np.uint8), 'L')
    return m.resize((size, size), Image.LANCZOS)


def rounded_sq_mask(w, h, r, n=4.0, ss=4):
    """小方块：圆角区域也用超椭圆曲线，和面板里的圆角风格一致。"""
    big_w, big_h = w * ss, h * ss
    ys, xs = np.mgrid[0:big_h, 0:big_w].astype(np.float32)
    px = (xs + 0.5) / ss
    py = (ys + 0.5) / ss
    qx = np.maximum(np.maximum(r - px, px - (w - r)), 0) / r
    qy = np.maximum(np.maximum(r - py, py - (h - r)), 0) / r
    inside = (qx ** n + qy ** n) <= 1.0
    m = Image.fromarray((inside * 255).astype(np.uint8), 'L')
    return m.resize((w, h), Image.LANCZOS)


def mesh_gradient(size, points, sigma):
    """几团颜色按距离加权混在一起，得到柔和的弥散渐变。"""
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32) / size
    acc = np.zeros((size, size, 3), np.float32)
    wsum = np.zeros((size, size, 1), np.float32)
    for (px, py, col, wt) in points:
        d2 = (xs - px) ** 2 + (ys - py) ** 2
        w = (np.exp(-d2 / (2 * sigma ** 2)) * wt)[..., None]
        acc += w * hexrgb(col)
        wsum += w
    rgb = acc / np.maximum(wsum, 1e-6)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def oklch_to_srgb(L, C, H):
    """OKLCH → sRGB(0~255)。用感知均匀的色彩空间，彩虹各段亮度一致，不会出现发灰或某种颜色特别刺眼。"""
    a = C * np.cos(H)
    b = C * np.sin(H)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    rgb = np.stack([r, g, bb], -1)
    rgb = np.clip(rgb, 0, 1)
    rgb = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    return np.clip(rgb * 255, 0, 255)


def rainbow_mesh(size, seed=7):
    """全色相混色：色相绕着中心转一整圈（红橙黄绿青蓝紫粉都有），
    再用几层正弦扭曲把规整的色环揉开，像颜料在水里晕开那样自然混在一起。"""
    rng = np.random.default_rng(seed)
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32) / size
    x, y = xs - 0.5, ys - 0.5
    # 扭曲坐标（domain warp）
    for _ in range(3):
        fx, fy, px, py = rng.uniform(1.0, 2.2), rng.uniform(1.0, 2.2), rng.uniform(0, 6.28), rng.uniform(0, 6.28)
        amp = rng.uniform(0.08, 0.13)
        x, y = x + amp * np.sin(fy * 6.28 * y + py), y + amp * np.sin(fx * 6.28 * x + px)
    ang = np.arctan2(y, x)
    r = np.sqrt(x * x + y * y)
    H = ang + 1.6 * r + 0.9  # 越往外色相转得越多，颜色层次更丰富
    L = 0.84 - 0.06 * np.clip(r * 1.6, 0, 1)
    C = 0.15 + 0.03 * np.sin(ang * 3 + 1.0)
    rgb = oklch_to_srgb(L, C, H)
    return Image.fromarray(rgb.astype(np.uint8), 'RGB').convert('RGBA')


def hsv_to_rgb(h, s, v):
    h = (h % 1.0) * 6.0
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], -1)


def vivid_rainbow(size, mode='conic'):
    """经典彩虹光谱（红橙黄绿青蓝紫），饱和度拉满。
    conic：绕中心转一圈，带一点旋涡感，和 iOS「照片」、Game Center 一类图标同一个思路；
    diagonal：从左上到右下斜着铺一道彩虹。"""
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32) / size
    x, y = xs - 0.5, ys - 0.5
    r = np.sqrt(x * x + y * y)
    if mode == 'conic':
        # 上方起红色，顺时针 红→橙→黄→绿→青→蓝→紫→粉→红
        h = (np.arctan2(x, -y) / (2 * np.pi)) % 1.0
        h = h + 0.10 * r          # 一点点旋涡
    else:
        h = (xs * 0.55 + ys * 0.45) * 0.85
    # 彩虹里黄、青两段天生偏亮偏宽，把色相稍微重新分布，让每种颜色占的面积更均匀
    h = h % 1.0
    h = h + 0.035 * np.sin(h * 2 * np.pi * 3)
    rgb = hsv_to_rgb(h, 0.80, 1.0)
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), 'RGB').convert('RGBA')


# iOS 系统色：苹果在全系统里用的那套标准彩色，鲜艳又耐看
IOS_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#5AC8FA', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55']


def srgb_to_oklab(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    l = 0.4122214708 * c[..., 0] + 0.5363325363 * c[..., 1] + 0.0514459929 * c[..., 2]
    m = 0.2119034982 * c[..., 0] + 0.6806995451 * c[..., 1] + 0.1073969566 * c[..., 2]
    s = 0.0883024619 * c[..., 0] + 0.2817188376 * c[..., 1] + 0.6299787005 * c[..., 2]
    l, m, s = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    return np.stack([0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                     1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                     0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s], -1)


def oklab_to_srgb(lab):
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    rgb = np.stack([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s], -1)
    rgb = np.clip(rgb, 0, 1)
    rgb = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    return np.clip(rgb * 255, 0, 255)


def ios_spectrum(size, mode='conic'):
    """用 iOS 系统色按彩虹顺序排一圈，在感知均匀的 OKLab 里过渡，颜色之间不会发灰发脏。"""
    stops = np.stack([hexrgb(c) for c in IOS_COLORS + IOS_COLORS[:1]]).astype(np.float32)
    labs = srgb_to_oklab(stops)
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32) / size
    x, y = xs - 0.5, ys - 0.5
    r = np.sqrt(x * x + y * y)
    if mode == 'iosconic':
        t = (np.arctan2(x, -y) / (2 * np.pi) + 0.18 * r) % 1.0
    else:
        t = np.clip((xs * 0.5 + ys * 0.5 - 0.05) / 0.9, 0, 1) * (len(IOS_COLORS) - 1) / len(IOS_COLORS)
    pos = t * (len(stops) - 1)
    i0 = np.clip(np.floor(pos).astype(int), 0, len(stops) - 2)
    f = (pos - i0)[..., None]
    f = f * f * (3 - 2 * f)  # 每段两端停留久一点，每种颜色更“纯”
    lab = labs[i0] * (1 - f) + labs[i0 + 1] * f
    img = Image.fromarray(oklab_to_srgb(lab).astype(np.uint8), 'RGB').convert('RGBA')
    if mode == 'iosconic':
        # 中心所有颜色汇聚的那个点揉开一点，不显得生硬
        soft = img.filter(ImageFilter.GaussianBlur(size * 0.08))
        w = np.clip(1 - r / 0.22, 0, 1)
        w = Image.fromarray((w * 255).astype(np.uint8), 'L')
        img = Image.composite(soft, img, w)
    return img


def make():
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    pad = int(S * 0.07)
    box = [pad, pad, S - pad, S - pad - int(S * 0.02)]

    # 底部柔和投影
    sh_mask = superellipse_mask(S, [box[0] + 24, box[1] + 50, box[2] - 24, box[3] + 30])
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sh.putalpha(sh_mask.point(lambda a: a * 140 // 255))
    sh = sh.filter(ImageFilter.GaussianBlur(S * 0.03))
    img = Image.alpha_composite(img, sh)

    # 彩色混色底：全色相（红橙黄绿青蓝紫粉）揉在一起的弥散渐变
    style = sys.argv[2] if len(sys.argv) > 2 else 'iosconic'
    if style in ('iosconic', 'iosdiag'):
        bg = ios_spectrum(512, style).resize((S, S), Image.BICUBIC).filter(ImageFilter.GaussianBlur(S * 0.008))
    elif style in ('conic', 'diagonal'):
        bg = vivid_rainbow(512, style).resize((S, S), Image.BICUBIC).filter(ImageFilter.GaussianBlur(S * 0.008))
    else:
        bg = rainbow_mesh(256, int(style)).resize((S, S), Image.BICUBIC).filter(ImageFilter.GaussianBlur(S * 0.02))
    mask = superellipse_mask(S, box)
    img.paste(bg, (0, 0), mask)

    # 顶部一层很淡的高光，让底色有点玻璃的通透感（不画描边）
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse([box[0] - S * 0.2, box[1] - S * 0.6, box[2] + S * 0.2, box[1] + S * 0.3], fill=(255, 255, 255, 30))
    hl = hl.filter(ImageFilter.GaussianBlur(S * 0.02))
    clear = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img = Image.alpha_composite(img, Image.composite(hl, clear, mask))

    # 3×3 白色宫格
    inner0x, inner1x = box[0] + (box[2] - box[0]) * 0.2, box[2] - (box[2] - box[0]) * 0.2
    inner0y = box[1] + (box[3] - box[1]) * 0.2
    cw = (inner1x - inner0x) / 3
    sq = int(round(cw * 0.76))
    cr = sq * 0.34
    cell_mask = rounded_sq_mask(sq, sq, cr)
    # 白色带极轻的上下渐变，不会显得发灰
    cell_rgb = Image.new('RGBA', (sq, sq))
    cd = ImageDraw.Draw(cell_rgb)
    for yy in range(sq):
        t = yy / max(1, sq - 1)
        c = tuple(int(a + (b - a) * t) for a, b in zip((255, 255, 255), (238, 241, 248))) + (255,)
        cd.line([(0, yy), (sq, yy)], fill=c)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    for j in range(3):
        for i in range(3):
            x = int(round(inner0x + i * cw + (cw - sq) / 2))
            y = int(round(inner0y + j * cw + (cw - sq) / 2))
            s_one = Image.new('RGBA', (sq, sq), (40, 20, 70, 0))
            s_one.putalpha(cell_mask.point(lambda a: a * 70 // 255))
            shadow.alpha_composite(s_one, (x, y + int(S * 0.012)))
            layer.paste(cell_rgb, (x, y), cell_mask)
    shadow = shadow.filter(ImageFilter.GaussianBlur(S * 0.01))
    img = Image.alpha_composite(img, shadow)
    img = Image.alpha_composite(img, layer)
    return img


out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'app', 'assets')
icon = make()
icon.resize((256, 256), Image.LANCZOS).save(os.path.join(out, 'app-icon.png'))
icon.resize((256, 256), Image.LANCZOS).save(os.path.join(out, 'app-icon.ico'), sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
# 预览：放在深色和浅色背景上
prev = Image.new('RGBA', (820, 300), (24, 22, 26, 255))
ImageDraw.Draw(prev).rectangle([410, 0, 820, 300], fill=(236, 238, 242, 255))
big = icon.resize((220, 220), Image.LANCZOS)
prev.alpha_composite(big, (95, 40))
prev.alpha_composite(big, (505, 40))
prev.convert('RGB').save(os.path.join(out, 'app-icon-preview.png'))
print('ok', os.path.abspath(out))
