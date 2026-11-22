# -*- coding: utf-8 -*-
"""按标好的框 + AI 翻译,做嵌字:
- 擦除框内原文字(inpaint,保留气泡形状)
- 把 trans.json 里的中文写进去(竖排/横排按框标记,自动折列/折行、放不下自动缩字号)

用法:
    python embed_regions.py <图片文件夹> [regions.json] [trans.json] [out_dir]

trans.json 格式(与 regions.json 的框一一对应,顺序一致):
    {"00000005": ["中文1", "中文2", ...]}
竖排多列用 "|" 分隔;想在某框内换行(横排)用 "\n"。
"""
import json, os, sys
import styles

# 项目根目录(manga_tool 的上一级),所有路径从这里推导
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import cv2
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def _dd(p):
    """工作数据目录:项目库模式由 MANGA_DATA_DIR 指定(源目录只读),否则退回源目录。"""
    return os.environ.get('MANGA_DATA_DIR') or p

def load_font(size, bold=False, art=False, family=None):
    return styles.load_font(size, bold, art, family)

# ---- 符号字符回退 ----
# 中文字体缺 ♡ ♥ ❤ ♪ 等符号字形(会画成空心方块),这些字符改用 Segoe UI Symbol 绘制。
SYM_CHARS = set('♡♥❤❥❣♪♫♬✦✧⋆✿❀※')
SYM_FONT_CANDIDATES = [
    'C:/Windows/Fonts/seguisym.ttf',
    'C:/Windows/Fonts/SegUISym.ttf',
    'C:/Windows/Fonts/arial.ttf',
]
_sym_font_cache = {}


def symbol_font(size):
    """返回可绘制符号的字体对象;找不到则返回 None。"""
    if size in _sym_font_cache:
        return _sym_font_cache[size]
    f = None
    for cp in SYM_FONT_CANDIDATES:
        if os.path.exists(cp):
            try:
                f = ImageFont.truetype(cp, size)
                break
            except Exception:
                f = None
    _sym_font_cache[size] = f
    return f

def erase_fill_bubble(arr, r, min_share=0.28, diff=38):
    """气泡内正文擦除:用气泡内部主色(白/米白)平涂掉文字像素。

    只在框内主色占比够高(默认 28%)时生效,保证「白气泡里白底黑字」这类场景干净;
    不平涂整块,只替换与主色差异大的像素(即文字),再膨胀 2px 吃掉描边。
    """
    x, y, w, h = int(r['x']), int(r['y']), int(r['w']), int(r['h'])
    H, W = arr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 - x0 < 6 or y1 - y0 < 6:
        return False
    reg = arr[y0:y1, x0:x1]
    q = (reg // 24).astype(np.int32)
    flat = q.reshape(-1, 3)
    uniq, counts = np.unique(flat, axis=0, return_counts=True)
    k = int(counts.argmax())
    share = float(counts[k]) / float(flat.shape[0])
    if share < min_share:
        return False
    bg = (uniq[k].astype(np.float32) + 12).astype(np.uint8)
    d = np.abs(reg.astype(np.int16) - bg.astype(np.int16)).max(axis=2)
    mask = (d > diff).astype(np.uint8)
    if mask.sum() == 0:
        return True
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=1)
    reg[mask.astype(bool)] = bg
    return True


def _ink_angle(arr, r, diff=60):
    """估算框内原文字的倾斜角(度,-45~45)。取与原背景差异大的像素做 minAreaRect。"""
    try:
        x, y, w, h = int(r['x']), int(r['y']), int(r['w']), int(r['h'])
        H, W = arr.shape[:2]
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(W, x + w), min(H, y + h)
        if x1 - x0 < 12 or y1 - y0 < 12:
            return 0.0
        reg = arr[y0:y1, x0:x1].astype(np.float32)
        ring = _ring_outside(arr, max(0, x0 - 6), max(0, y0 - 6), min(W, x1 + 6), min(H, y1 + 6), 2, 4)
        if ring is None or not ring.size:
            return 0.0
        bg = np.median(ring, axis=0)
        d = np.abs(reg - bg).max(axis=2)
        mask = (d > diff).astype(np.uint8)
        if mask.sum() < 40:
            return 0.0
        pts = np.column_stack(np.where(mask > 0))          # (row, col)
        rect = cv2.minAreaRect(pts.astype(np.int32))
        ang = float(rect[2])
        if ang > 45:
            ang -= 90
        if ang < -45:
            ang += 90
        return ang
    except Exception:
        return 0.0


def draw_plain_rotated(img, zh, r, size, st, vertical):
    """拟声词按原图倾斜角旋转绘制。返回 True 表示已绘制,False 表示需要走普通路径。"""
    try:
        arr = np.array(img)
        ang = _ink_angle(arr, r)
        if abs(ang) < 8:
            return False
        x, y, w, h = int(r['x']), int(r['y']), int(r['w']), int(r['h'])
        big_w, big_h = int(w * 1.9) + 20, int(h * 1.9) + 20
        layer = Image.new('RGBA', (big_w, big_h), (0, 0, 0, 0))
        d2 = ImageDraw.Draw(layer)
        if vertical:
            draw_vtext(d2, zh, 10, 10, big_w - 20, big_h - 20, size, st)
        else:
            draw_htext(d2, zh, 10, 10, big_w - 20, big_h - 20, size, st)
        rot = layer.rotate(ang, resample=Image.BICUBIC, expand=True)
        cx, cy = x + w / 2.0, y + h / 2.0
        px, py = int(cx - rot.width / 2), int(cy - rot.height / 2)
        img.alpha_composite(rot, (px, py))
        return True
    except Exception:
        return False


def erase_guarded(orig, arr, r):
    """擦除并自检:宁可留残影,也不要出现"大色块"。

    规则:擦完如果这块变得很均匀(标准差 <7),但和周围环带中位色差 >28,
    说明擦成了色块 → 还原原图,保留残影(用户可接受 <=30% 残影)。
    """
    x, y, w, h = int(r['x']), int(r['y']), int(r['w']), int(r['h'])
    H, W = arr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return 'skip'

    def op():
        if styles.kind_of(r) == 'plain' and FOLLOW_STYLE:
            if not erase_fill_plain(arr, x, y, w, h):
                inpaint_rect(arr, x, y, w, h)
        else:
            inpaint_rect(arr, x, y, w, h)

    op()
    try:
        if x1 - x0 >= 8 and y1 - y0 >= 8:
            reg = arr[y0:y1, x0:x1].astype(np.float32)
            oreg = orig[y0:y1, x0:x1].astype(np.float32)
            rstd = float(reg.reshape(-1, 3).std(axis=0).mean())
            ostd = float(oreg.reshape(-1, 3).std(axis=0).mean())
            mean = reg.reshape(-1, 3).mean(axis=0)
            px0, py0 = max(0, x0 - 16), max(0, y0 - 16)
            px1, py1 = min(W, x1 + 16), min(H, y1 + 16)
            patch = orig[py0:py1, px0:px1].reshape(-1, 3).astype(np.float32)
            med = np.median(patch, axis=0)
            differ = float(np.abs(mean - med).max())
            # 背景参考色:取**框外**环带中位色(框内被文字占满,主色不可靠)
            _ring = _ring_outside(orig, max(0, x0 - 6), max(0, y0 - 6), min(W, x1 + 6), min(H, y1 + 6), 2, 4)
            obg = np.median(_ring, axis=0).astype(np.float32) if _ring.size else None
            if rstd < 7 and ostd > 25:
                # 与原框「主背景色」的差距:接近 → 属于正常擦除(黑底填黑/白底填白),不回滚
                if obg is not None:
                    gap = float(np.abs(mean - obg.astype(np.float32)).sum())
                    if gap <= 60:
                        return 'ok'
                # 与原背景差了 60 以上,或周围环带色差大 → 判为"擦成色块",回滚保留残影
                if differ > 28 or (obg is not None and float(np.abs(mean - obg.astype(np.float32)).sum()) > 60):
                    arr[y0:y1, x0:x1] = orig[y0:y1, x0:x1]
                    return 'restored'
            if rstd < 7 and ostd > 25 and differ > 28:
                arr[y0:y1, x0:x1] = orig[y0:y1, x0:x1]
                return 'restored'
    except Exception:
        pass
    return 'ok'


def inpaint_rect(arr, x, y, w, h):
    """整框 inpaint:遮罩按「与框内中位色差异大」判定文字(深浅底通用)。

    旧实现用 Otsu INV:当框内白字占比大时,遮罩会落到**背景**上,
    结果把背景涂成字色(白字黑底 → 整块涂白)。改为按颜色差异取遮罩。
    """
    H, W = arr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    region = arr[y0:y1, x0:x1].copy()
    med = np.median(region.reshape(-1, 3), axis=0).astype(np.int16)
    diff = np.abs(region.astype(np.int16) - med).sum(axis=2)
    mask = (diff > 100).astype(np.uint8) * 255
    if not mask.any():
        return
    if mask.mean() < 1:
        return
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    rgb = cv2.cvtColor(region, cv2.COLOR_RGB2BGR)
    out = cv2.inpaint(rgb, mask, 4, cv2.INPAINT_TELEA)
    arr[y0:y1, x0:x1] = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)


def _ring_outside(arr, x0, y0, x1, y1, dist, band):
    """取「框外 dist~dist+band」的环带像素(不碰框内文字)。"""
    H, W = arr.shape[:2]
    ax0, ay0 = max(0, x0 - dist - band), max(0, y0 - dist - band)
    ax1, ay1 = min(W, x1 + dist + band), min(H, y1 + dist + band)
    o = arr[ay0:ay1, ax0:ax1].reshape(-1, 3)
    m = np.ones(arr[ay0:ay1, ax0:ax1].shape[:2], dtype=bool)
    ix0, iy0 = (x0 - dist) - ax0, (y0 - dist) - ay0
    ix1, iy1 = (x1 + dist) - ax0, (y1 + dist) - ay0
    ix0, iy0 = max(0, ix0), max(0, iy0)
    ix1, iy1 = min(m.shape[1], ix1), min(m.shape[0], iy1)
    m[iy0:iy1, ix0:ix1] = False    # 去掉内圈
    return o[m.reshape(-1)]


def _dominant_color(arr, x, y, w, h, q=24):
    """框内像素量化后出现最多的颜色(黑底/纯色底文字擦除用)。返回 (color, share)。"""
    H, W = arr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None, 0.0
    reg = arr[y0:y1, x0:x1].reshape(-1, 3).astype(np.int32)
    uniq, counts = np.unique(reg // q, axis=0, return_counts=True)
    k = int(np.argmax(counts))
    base = uniq[k] * q + q // 2
    sel = (np.abs(reg - base).sum(axis=1) < q)
    if sel.sum() > 0:
        base = np.median(reg[sel], axis=0)
    return base.astype(np.uint8), float(counts[k]) / float(len(reg))


def erase_fill_solid(arr, x, y, w, h, min_share=0.42, diff=38):
    """纯色底(黑底目录/白底字幕):按框内主色平涂掉与主色差异大的文字像素。"""
    bg, share = _dominant_color(arr, x, y, w, h)
    if bg is None or share < min_share:
        return False
    H, W = arr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    reg = arr[y0:y1, x0:x1].astype(np.int32)
    mask = (np.abs(reg - bg.astype(np.int32)).sum(axis=2) > diff).astype(np.uint8)
    if mask.mean() < 0.01 or mask.mean() > 0.75:
        return False
    try:
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)
    except Exception:
        pass
    out = arr[y0:y1, x0:x1]
    out[mask.astype(bool)] = bg
    return True


def erase_fill_plain(arr, x, y, w, h, pad=0.06):
    """纯色/近纯色背景的文字抹除:框外采样背景主色 → 平涂文字像素。

    v1 的 bug:环带是从「框内(外扩 pad)」采的,框紧贴文字时采到的是字色
    (白字→填白块)。现在改为从**框外**采 2/4/6px 三档环带,取离散度最低的一档,
    并同时要求文字与背景差异明显;复杂背景(离散度大)返回 False 交回 inpaint。
    """
    H, W = arr.shape[:2]
    px, py = int(round(w * pad)), int(round(h * pad))
    x0, y0 = max(0, x - px), max(0, y - py)
    x1, y1 = min(W, x + w + px), min(H, y + h + py)
    if x1 - x0 < 3 or y1 - y0 < 3:
        return False
    best = None
    for dist in (2, 4, 6):
        ring = _ring_outside(arr, x0, y0, x1, y1, dist, 3)
        if ring.size == 0:
            continue
        bg = np.median(ring, axis=0)
        spread = float(np.mean(np.abs(ring.astype(np.float32) - bg).sum(axis=1)))
        if best is None or spread < best[0]:
            best = (spread, bg, dist)
        if spread <= 18:
            break
    if best is None:
        return False
    spread, bg, dist = best
    if spread > 22:          # 背景不均匀(线条/网点/渐变)
        return False
    bg = bg.astype(np.uint8)
    region = arr[y0:y1, x0:x1]
    # 文字像素 = 与背景色差异大的像素(不依赖 Otsu,深浅底都适用)
    diff = np.abs(region.astype(np.int16) - bg.astype(np.int16)).sum(axis=2)
    mask = (diff > 90).astype(np.uint8) * 255
    if mask.mean() < 1:     # 框内几乎没有文字(已经是背景)
        return False
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=1)
    mask = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=1)
    region[mask.astype(bool)] = bg
    return True


def inpaint_mask(arr, points, brush=9):
    """按「自由框选」的笔画生成遮罩并 inpaint。

    笔画围成的区域(多边形)一起处理,笔画本身也处理;
    但**不会**把外接矩形整块抹掉(v1.0 的顽固问题)。
    """
    H, W = arr.shape[:2]
    mask = np.zeros((H, W), np.uint8)
    if len(points) >= 3:
        cv2.fillPoly(mask, [np.array(points, dtype=np.int32)], 255)
    for x, y in points:
        cv2.circle(mask, (int(x), int(y)), brush, 255, -1)
    if mask.sum() < 20:
        return
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    out = cv2.inpaint(bgr, mask, 4, cv2.INPAINT_TELEA)
    arr[:] = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)

def detect_vertical(arr, b, margin=2):
    """根据框内文字包围盒宽高比判断竖排/横排。True=竖排,False=横排,None=不确定。"""
    H, W = arr.shape[:2]
    bx, by = b.get('x', 0), b.get('y', 0)
    bw, bh = b.get('w', 0), b.get('h', 0)
    x0 = max(0, bx - margin); y0 = max(0, by - margin)
    x1 = min(W, bx + bw + margin); y1 = min(H, by + bh + margin)
    if x1 <= x0 or y1 <= y0:
        return None
    crop = arr[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    try:
        _, thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    except Exception:
        return None
    ys, xs = np.where(thr > 0)
    if len(xs) < 20:
        return None
    tw = int(xs.max() - xs.min()) + 1
    th = int(ys.max() - ys.min()) + 1
    if th >= tw * 1.6:
        return True
    if tw >= th * 1.6:
        return False
    return None


def estimate_font_size(arr, b, margin=2):
    """从框内原文自动估计字号(连通域的中位高度/宽度)。"""
    H, W = arr.shape[:2]
    bx, by = b.get('x', 0), b.get('y', 0)
    bw, bh = b.get('w', 0), b.get('h', 0)
    x0 = max(0, bx - margin); y0 = max(0, by - margin)
    x1 = min(W, bx + bw + margin); y1 = min(H, by + bh + margin)
    default = int(b.get('size', 20) or 20)
    if x1 <= x0 or y1 <= y0:
        return default
    crop = arr[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    try:
        _, thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    except Exception:
        return default
    n, labels, stats, _ = cv2.connectedComponentsWithStats(thr, connectivity=8)
    sizes = []
    ha, wa = crop.shape[0], crop.shape[1]
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 8:
            continue
        if w > wa * 0.9 or h > ha * 0.9:   # 太大可能是气泡边框
            continue
        sizes.append(max(w, h))
    if not sizes:
        return default
    sizes.sort()
    return int(max(10, min(80, sizes[len(sizes) // 2])))



# ---------------- 字体缺字回退(繁体/生僻字) ----------------
_FALLBACK_FONT_FILES = (
    'C:/Windows/Fonts/msjh.ttc',      # 微软正黑(繁体)
    'C:/Windows/Fonts/simsun.ttc',    # 宋体(含繁体)
    'C:/Windows/Fonts/mingliu.ttc',   # 细明体
)
_fb_cache = {}


def fallback_font(size):
    key = int(size)
    if key in _fb_cache:
        return _fb_cache[key]
    f = None
    for cp in _FALLBACK_FONT_FILES:
        try:
            f = ImageFont.truetype(cp, key)
            break
        except Exception:
            f = None
    _fb_cache[key] = f
    return f


def _has_glyph(font, ch):
    try:
        return font.getmask(ch).getbbox() is not None
    except Exception:
        return True


def guess_layout(arr, r, diff=40):
    """按框内墨迹判断对齐方式与垂直中心。

    返回 (align, ink_cy)：
      align   : 'left' | 'center' | 'right'（墨迹左侧留白 <=12% 宽且右侧留白 >15% → 左对齐）
      ink_cy  : 墨迹竖直中心(绝对坐标),取不到墨迹时返回 None
    """
    H, W = arr.shape[:2]
    x0, y0 = max(0, int(r['x'])), max(0, int(r['y']))
    x1, y1 = min(W, x0 + int(r['w'])), min(H, y0 + int(r['h']))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return 'center', None
    reg = arr[y0:y1, x0:x1]
    try:
        lum = reg.astype('float32').mean(axis=2)
    except Exception:
        return 'center', None
    med = float(np.median(lum))
    mask = (np.abs(lum - med) > diff)
    if mask.sum() < 30:
        return 'center', None
    cols = mask.any(axis=0)
    rows = mask.any(axis=1)
    cs = np.where(cols)[0]
    rs = np.where(rows)[0]
    if cs.size == 0 or rs.size == 0:
        return 'center', None
    w = float(x1 - x0)
    left_gap = float(cs[0]) / w
    right_gap = float(w - 1 - cs[-1]) / w
    if left_gap <= 0.12 and right_gap > 0.15:
        align = 'left'
    elif right_gap <= 0.12 and left_gap > 0.15:
        align = 'right'
    else:
        # 墨迹横向重心落在明显偏左/偏右时也给出对应对齐
        cols_sum = mask.sum(axis=0).astype('float32')
        cx = float((np.arange(cols_sum.size) * cols_sum).sum()) / (float(cols_sum.sum()) or 1.0) / w
        align = 'left' if cx < 0.40 else ('right' if cx > 0.60 else 'center')
    ink_cy = y0 + (float(rs[0]) + float(rs[-1])) / 2.0
    return align, ink_cy

def _draw_char(draw, xy, ch, font, st, s):
    if ch in SYM_CHARS:
        sf = symbol_font(s)
        if sf is not None:
            st2 = st
            try:
                f = st.get('fill') or (0, 0, 0)
                lum = 0.299 * f[0] + 0.587 * f[1] + 0.114 * f[2]
                if lum < 120 and st.get('stroke_fill'):
                    # 原字深色 → 符号用白填充 + 深描边(贴合原图的空心/描边符号)
                    st2 = dict(st)
                    st2['fill'] = (255, 255, 255)
                    st2['stroke_fill'] = tuple(f)
            except Exception:
                st2 = st
            styles.draw_styled(draw, xy, ch, sf, st2, s)
            return
    if not _has_glyph(font, ch):
        # 主字体缺这个字(常见:繁体/生僻字) → 换系统字体补上,别让字消失
        fb = fallback_font(s)
        if fb is not None and _has_glyph(fb, ch):
            styles.draw_styled(draw, xy, ch, fb, st, s)
            return
    styles.draw_styled(draw, xy, ch, font, st, s)


def _fits_vertical(text, w, h, s):
    """竖排:按框高每列字数 + 列宽,判断字号 s 是否放得下。"""
    if s <= 0 or not text:
        return False
    per_col = max(1, int((h - 6) // (s + 3)))
    ncol = int(math.ceil(len(text) / float(per_col)))
    return ncol * (s + 4) <= w + 2


def _fits_horizontal(draw, text, w, h, s, st):
    """横排:按框宽折行后看行高总和是否放得下。"""
    if s <= 0 or not text:
        return False
    font = load_font(s, bool(st.get('bold')), bool(st.get('art')), st.get('font'))
    lines = []
    for para in text.split(chr(10)):
        cur = ''
        for ch in para:
            try:
                tw = draw.textlength(cur + ch, font=font)
            except Exception:
                tw = (len(cur) + 1) * s
            if tw <= w - 6:
                cur += ch
            else:
                if cur:
                    lines.append(cur)
                cur = ch
        if cur:
            lines.append(cur)
    return len(lines) * (s + 4) <= h + 4


def fit_size(draw, text, w, h, start, st, vertical, grow=False, cap_ratio=0.9, lo=None):
    """计算适配框的字号。

    grow=False(正文/标题):从小往大靠 start,放不下就缩小,最小 6 号;
    grow=True (拟声词):在放得下的前提下尽量放大,直到接近填满框。
    返回 (字号, 是否还需要再缩)。
    """
    text = text or ''
    start = max(6, int(start or 20))
    lo_s = 18 if grow else 10  # 可读下限:拟声 18(小框也不缩太小),正文/标题 10
    hi_s = min(140, max(12, int(min(w, h) * cap_ratio)))
    if grow:
        hi_s = int(min(w, h) * 0.72) if hi_s > 0 else hi_s   # 小框的拟声词也至少能到 28 号(允许溢出盖到框外)
    def fits(s):
        return _fits_vertical(text, w, h, s) if vertical else _fits_horizontal(draw, text, w, h, s, st)
    if grow:
        s = max(start, lo_s)
        cap = hi_s
        if not fits(s):
            # 起点就放不下 → 退化为缩小
            while s > lo_s and not fits(s):
                s -= 1
            return s, not fits(s)
        while s + 1 <= cap and fits(s + 1):
            s += 1
        return s, False
    s = start
    if s > hi_s:
        s = hi_s
    while s > lo_s and not fits(s):
        s -= 1
    return s, not fits(s)


def flatten_plain_region(arr, r, pad=6, feather=3):
    """拟声直盖前把框内底色压平:用框外环带中位色填充(边缘羽化),减少双语叠字。

    只在 config `sfx_flatten` 开启时调用;失败返回 False(保持原图)。
    """
    try:
        from PIL import ImageFilter
        H, W = arr.shape[:2]
        x, y = int(r.get('x', 0)), int(r.get('y', 0))
        w, h = int(r.get('w', 0)), int(r.get('h', 0))
        if w < 4 or h < 4:
            return False
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(W, x + w + pad), min(H, y + h + pad)
        ring = arr[y0:y1, x0:x1].reshape(-1, 3)
        # 排除框内像素,只用环带估底色
        m = np.ones((y1 - y0, x1 - x0), dtype=bool)
        m[max(0, y - y0):max(0, y - y0) + h, max(0, x - x0):max(0, x - x0) + w] = False
        sel = arr[y0:y1, x0:x1][m]
        if sel.size < 30:
            return False
        col = np.median(sel, axis=0).astype(np.uint8)
        # 用羽化蒙版覆盖框内(略外扩 1px,避免留原字边缘)
        mask = Image.new('L', (w + 2, h + 2), 0)
        ImageDraw.Draw(mask).rectangle([1, 1, w, h], fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
        patch = Image.new('RGB', (w + 2, h + 2), tuple(int(v) for v in col))
        base = Image.fromarray(arr[max(0, y - 1):y + h + 1, max(0, x - 1):x + w + 1])
        base.paste(patch, (0, 0), mask)
        arr[max(0, y - 1):y + h + 1, max(0, x - 1):x + w + 1] = np.array(base)
        return True
    except Exception:
        return False


def draw_vtext(draw, text, x, y, w, h, size, st):
    """竖排:按框高自动折列(超框另起一列),放不下则逐步缩小字号。返回是否放得下。"""
    chunks = [c for c in text.split('|') if c]
    if not chunks:
        return True
    s = size
    cols = []
    col_w = s + 4
    fits = False
    while s > 6:
        # 字号较小时收紧行距/字距,尽量塞进窄框(减少"放不下")
        gap = 1 if s <= 14 else 3
        gap = max(1, int(round(gap * float(st.get('spacing') or 1.0))))
        per_col = max(1, int((h - 6) // (s + gap)))
        col_w = s + gap + 1
        max_cols = max(1, int((w + 2) // col_w))
        cols = []
        for c in chunks:
            for i in range(0, len(c), per_col):
                cols.append(c[i:i + per_col])
        if len(cols) <= max_cols:
            fits = True
            break
        s -= 1
    if not cols:
        return False
    font = load_font(s, bool(st.get('bold')), bool(st.get('art')), st.get('font'))
    ncol = len(cols)
    total_w = ncol * col_w
    start_x = x + (w - total_w) / 2
    for ci, chunk in enumerate(cols):
        cx = start_x + (ncol - 1 - ci) * col_w
        block_h = len(chunk) * (s + 3)
        cy = y + max(0, int((h - block_h) // 2))
        for ch in chunk:
            _draw_char(draw, (cx, cy), ch, font, st, s)
            cy += s + 3
    return fits


def draw_htext(draw, text, x, y, w, h, size, st):
    """横排:按框宽自动折行,放不下则逐步缩小字号。返回是否放得下。"""
    s = size
    lines = []
    fits = False
    while s > 8:
        font = load_font(s, bool(st.get('bold')), bool(st.get('art')), st.get('font'))
        lines = []
        for para in text.split(chr(10)):
            cur = ''
            for ch in para:
                if draw.textlength(cur + ch, font=font) <= w - 6:
                    cur += ch
                else:
                    if cur:
                        lines.append(cur)
                    cur = ch
            if cur:
                lines.append(cur)
        if len(lines) * (s + 4) <= h + 4:
            fits = True
            break
        s -= 1
    font = load_font(s, bool(st.get('bold')), bool(st.get('art')), st.get('font'))
    _al = str(st.get('align') or 'center').lower()
    if _al not in ('left', 'center', 'right'):
        _al = 'center'
    gap = max(2, int(s * 0.18))
    gap = max(2, int(round(gap * float(st.get('spacing') or 1.0))))
    block_h = len(lines) * s + max(0, len(lines) - 1) * gap
    cy = y + max(0, int((h - block_h) // 2))
    for ln in lines:
        tw = 0
        for ch in ln:
            f_ch = symbol_font(s) if ch in SYM_CHARS else font
            if f_ch is None:
                f_ch = font
            try:
                tw += draw.textlength(ch, font=f_ch)
            except Exception:
                tw += s
        if _al == 'left':
            cx = x + 3
        elif _al == 'right':
            cx = x + max(3, w - tw - 3)
        else:
            cx = x + max(3, int((w - tw) // 2))
        for ch in ln:
            _draw_char(draw, (cx, cy), ch, font, st, s)
            f_ch = symbol_font(s) if ch in SYM_CHARS else font
            if f_ch is None:
                f_ch = font
            try:
                cx += draw.textlength(ch, font=f_ch)
            except Exception:
                cx += s
        cy += s + gap
    return fits


_ENV_DIR = os.environ.get('MANGA_ENV_DIR') or os.path.join(BASE, '_venv')
IOPAINT_BIN = os.path.join(_ENV_DIR, 'Scripts', 'iopaint.exe')
LAMA_TMP = os.path.join(BASE, '_lama_io')

def lama_erase(img, boxes, zh_list):
    """用 LaMa(GPU)擦除所有有译文的区域,返回擦除后的 PIL Image。"""
    import subprocess, shutil
    from PIL import ImageDraw as _ID
    mask = Image.new('L', img.size, 0)
    d = _ID.Draw(mask)
    for i, r in enumerate(boxes):
        zh = zh_list[i] if i < len(zh_list) else ""
        if not zh:
            continue
        # 自动标框的框不参与嵌字(需人工改字确认)
        if r.get('auto'):
            continue
        # 只看「抹除原文」开关,不勾则不擦(旧 nobox 取反兼容)
        if not r.get('erase', not r.get('nobox', False)):
            continue
        if r.get('points'):
            for (px, py) in r['points']:
                d.ellipse([px - 10, py - 10, px + 10, py + 10], fill=255)
        else:
            d.rectangle([r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']], fill=255)
    os.makedirs(LAMA_TMP, exist_ok=True)
    od = os.path.join(LAMA_TMP, 'out')
    shutil.rmtree(od, ignore_errors=True)
    os.makedirs(od, exist_ok=True)
    ip = os.path.join(LAMA_TMP, 'in.png')
    mp = os.path.join(LAMA_TMP, 'mask.png')
    img.save(ip)
    mask.save(mp)
    env = dict(os.environ)
    env['TORCH_HOME'] = os.path.join(BASE, '_torchcache')
    env['HF_HOME'] = os.path.join(BASE, '_hfcache')
    try:
        subprocess.run([IOPAINT_BIN, 'run', '--model=lama', '--device=cuda',
                        '--image', ip, '--mask', mp, '--output', od],
                       capture_output=True, env=env, timeout=300)
    except Exception as e:
        print(f"[LaMa] 调用失败: {e}")
        return img
    res = os.path.join(od, 'in.png')
    if os.path.exists(res):
        return Image.open(res).convert('RGB')
    print("[LaMa] 未生成结果,回退原图")
    return img

FOLLOW_STYLE = True   # 拟声词样式跟随(可在 config.json 用 follow_style=false 关闭)
STYLE_LAYERS = False  # 多层描边跟随(实验:灰度页易误报,config.json style_layers=true 才开)
STYLE_SHADOW = False  # 投影方向跟随(实验:同上,style_shadow=true 才开)
SFX_ERASE = False     # 拟声词允许抹除?默认 False=一律直盖(不留擦除痕);config.json 可用 sfx_erase=true 打开

def main():
    global _stat
    _stat = {}
    global FOLLOW_STYLE, SFX_ERASE, STYLE_LAYERS, STYLE_SHADOW
    preview = '--preview' in sys.argv
    lama = '--lama' in sys.argv
    args = [a for a in sys.argv[1:] if a not in ('--preview', '--lama')]
    only_page = ''
    if '--page' in args:
        _pi = args.index('--page')
        only_page = args[_pi + 1] if _pi + 1 < len(args) else ''
        del args[_pi:_pi + 2]
    src = args[0] if len(args) > 0 else "."
    # 读取 config.json(GPU去字开关),命令行 --lama 优先
    auto_size = True
    auto_dir = True
    SFX_FLATTEN = False
    try:
        _cfg = json.load(open(os.path.join(_dd(src), 'config.json'), encoding='utf-8'))
        if not lama:
            lama = bool(_cfg.get('lama', False))
        auto_size = bool(_cfg.get('auto_size', True))
        FOLLOW_STYLE = bool(_cfg.get('follow_style', True))
        STYLE_LAYERS = bool(_cfg.get('style_layers', False))
        STYLE_SHADOW = bool(_cfg.get('style_shadow', False))
        SFX_FLATTEN = bool(_cfg.get('sfx_flatten', False))
        _env_sfx = os.environ.get('MANGA_SFX_ERASE')
        SFX_ERASE = (bool(_cfg.get('sfx_erase', False)) if _env_sfx is None
                     else _env_sfx == '1')
        auto_dir = bool(_cfg.get('auto_dir', True))
    except Exception:
        pass
    if lama:
        # 批量模式:委托给 embed_lama.py(一次加载模型,比逐页快很多)
        import subprocess as _sp
        _here = os.path.dirname(os.path.abspath(__file__))
        _cmd = [sys.executable, os.path.join(_here, 'embed_lama.py'), src]
        if only_page:
            _cmd += ['--page', only_page]
        if preview:
            _cmd.append('--preview')
        if not auto_size:
            _cmd.append('--no-auto-size')
        if not auto_dir:
            _cmd.append('--no-auto-dir')
        _sp.run(_cmd)
        # LaMa 模式下的嵌字后自动校对
        try:
            penv = dict(os.environ)
            penv['PYTHONIOENCODING'] = 'utf-8'
            pf = os.path.join(_here, 'proofread.py')
            _r = _sp.run([sys.executable, pf, src, '--stage', 'post', '--lama'],
                         capture_output=True, text=True, encoding='utf-8', errors='replace',
                         env=penv)
            print('\n===== 嵌字后自动校对 =====')
            print((_r.stdout or '').strip())
        except Exception as e:
            print('[校对] 运行失败:', e)
        return
    regions_file = args[1] if len(args) > 1 else os.path.join(_dd(src), "regions.json")
    trans_file = args[2] if len(args) > 2 else os.path.join(_dd(src), "trans.json")
    out_dir = args[3] if len(args) > 3 else os.path.join(_dd(src), "preview" if preview else "out")
    os.makedirs(out_dir, exist_ok=True)
    regions = json.load(open(regions_file, encoding='utf-8'))
    trans = json.load(open(trans_file, encoding='utf-8'))
    try:
        _ocr_all = json.load(open(os.path.join(os.path.dirname(regions_file), 'ocr_text.json'), encoding='utf-8'))
    except Exception:
        _ocr_all = {}

    for page in sorted(regions):
        if only_page and page != only_page:
            continue
        img = None
        for ext in ('.webp', '.png', '.jpg', '.jpeg', '.bmp'):
            p = os.path.join(src, page + ext)
            if os.path.exists(p):
                img = Image.open(p).convert('RGB')
                break
        if img is None:
            print(f"[跳过] 找不到源图 {page}")
            continue
        if page not in trans:
            print(f"[跳过] trans.json 缺 {page} 的译文")
            continue
        arr = np.array(img)
        arr_orig = arr.copy()   # 擦除前原图,用于估原文字号
        for _r in regions[page]:
            _r['_auto_size'] = estimate_font_size(arr_orig, _r) if auto_size else None
            _r['_auto_vertical'] = detect_vertical(arr_orig, _r) if auto_dir else None
        AutoSizeOn = bool(auto_size)
        zh_list = trans[page]
        # 框数与译文数不一致时:按 y 顺序做比例配对,避免整页错行(band 目录/字幕类常见)
        if zh_list and len(zh_list) != len(regions[page]):
            _bs = sorted(range(len(regions[page])),
                         key=lambda k: (regions[page][k].get('y', 0) + regions[page][k].get('h', 0) / 2.0))
            _n, _m = len(_bs), len(zh_list)
            _paired = [""] * len(regions[page])
            for _i, _bi in enumerate(_bs):
                _j = int(round(_i * (_m - 1) / (_n - 1))) if _n > 1 else 0
                _paired[_bi] = zh_list[max(0, min(_m - 1, _j))]
            print(f"[对齐] {page} 框数 {_n} ≠ 译文数 {_m},按 y 比例配对(建议人工复核)")
            zh_list = _paired
        # 第一遍:擦除(预览模式跳过;只有有译文才擦,没译文的保持原样避免模糊)
        if not preview:
            if lama:
                # LaMa(GPU)擦除所有有译文的区域(对白+拟声词),质量远好于 cv2
                img = lama_erase(img, regions[page], zh_list)
                arr = np.array(img)
            else:
                gpu_sub, gpu_zh = [], []
                for i, r in enumerate(regions[page]):
                    zh = zh_list[i] if i < len(zh_list) else ""
                    if not zh:
                        continue
                    # 自动标框的框不参与嵌字(需人工改字确认)
                    if r.get('auto'):
                        continue
                    mode = styles.cover_mode(r)     # overlay / erase / cover
                    if mode != 'erase':
                        continue
                    # 拟声词:默认不抹除(直盖,保证不留擦除痕),除非 config 显式允许
                    if styles.kind_of(r) == 'plain' and styles.cover_mode(r) != 'erase':
                        continue
                    if styles.gpu_of(r):
                        # 标记了 GPU 去字的框:收集起来交给 LaMa 统一处理
                        gpu_sub.append(r)
                        gpu_zh.append(zh)
                        continue
                    if r.get('points'):
                        # 自由框选:按自由形状精确擦除
                        inpaint_mask(arr, r['points'])
                    else:
                        # 擦除:先按经验最优方式擦,再自检——只有"擦成与原背景不符的纯色块"才回滚
                        x, y, w, h = r['x'], r['y'], r['w'], r['h']
                        if styles.kind_of(r) == 'plain':
                            # 拟声类:环带采样平涂,失败再 inpaint;并做自检(防白块)
                            try:
                                if erase_guarded(arr_orig, arr, r) == 'restored':
                                    _stat['restored'] = _stat.get('restored', 0) + 1
                            except NameError:
                                if not erase_fill_plain(arr, x, y, w, h):
                                    inpaint_rect(arr, x, y, w, h)
                        else:
                            # 正文/标题:气泡内先尝试「主色平涂」(白气泡白底黑字最干净),
                            # 失败再走颜色差异 inpaint(历史最优版,不做自检回滚)
                            _bub = (str(r.get('scene') or '') == 'bubble')
                            _ok = False
                            if _bub and os.environ.get('MANGA_BUBBLE_ERASE', '1') != '0':
                                try:
                                    _ok = erase_fill_bubble(arr, r)
                                except Exception:
                                    _ok = False
                            if not _ok:
                                inpaint_rect(arr, x, y, w, h)
                if gpu_sub:
                    try:
                        img2g = lama_erase(Image.fromarray(arr), gpu_sub, gpu_zh)
                        arr = np.array(img2g)
                    except Exception as e:
                        print('[GPU去字] 失败,改用普通抹除:', str(e)[:120])
                        for r in gpu_sub:
                            if r.get('points'):
                                inpaint_mask(arr, r['points'])
                            else:
                                inpaint_rect(arr, r['x'], r['y'], r['w'], r['h'])
            # 色块覆盖:用框边缘中位色盖住原文(只覆盖,不做修复)
            if not preview:
                cover_list = []
                for i, r in enumerate(regions[page]):
                    zh = zh_list[i] if i < len(zh_list) else ""
                    if not zh or r.get('auto'):
                        continue
                    if styles.cover_mode(r) == 'cover':
                        cover_list.append(r)
                if cover_list:
                    tmp = Image.fromarray(arr)
                    d2 = ImageDraw.Draw(tmp)
                    src_img = Image.fromarray(arr_orig)
                    for r in cover_list:
                        _i = regions[page].index(r)
                        _zh = zh_list[_i] if _i < len(zh_list) else ''
                        _kind = styles.kind_of(r)
                        _w, _h = int(r.get('w', 1)), int(r.get('h', 1))
                        _v = bool(r.get('vertical', True))
                        _tight = False
                        _bad = False
                        if _kind == 'body':
                            _st0 = min(max(int(min(_w, _h) * 0.28), 22), 40)
                            _s, _bad = fit_size(d2, _zh, _w, _h, _st0, {}, _v,
                                                grow=False, cap_ratio=0.9, lo=14)
                            _tight = (not _bad) and _s < _st0
                        elif _kind == 'plain':
                            _s, _bad = fit_size(d2, _zh, _w, _h, 20, {}, _v,
                                                grow=True, cap_ratio=0.9, lo=18)
                        if _bad:
                            continue   # 直盖:跳过色块
                        styles.paint_cover(d2, r, styles.sample_cover_color(src_img, r),
                                           shape='ellipse' if _tight else 'rect')
                    arr = np.array(tmp)
        # 短拟声直盖:先智能清除框内原日文白描边字(不涂色块,只修补白像素)
        try:
            for _i3, _r3 in enumerate(regions[page]):
                _zh3 = zh_list[_i3] if _i3 < len(zh_list) else ''
                if not _zh3 or _r3.get('auto'):
                    continue
                if styles.cover_mode(_r3) != 'overlay':
                    continue
                if len(str(_zh3).strip()) > 5:
                    continue
                pass  # 不处理原字,直接覆盖(用户要求)
        except Exception as _e:
            print('[智能清字] 失败:', _e)
        # 拟声直盖前「底色压平」(可选,config sfx_flatten):压掉原字底纹,减少双语叠字
        if SFX_FLATTEN and not preview:
            _flat_n = 0
            for _idx, _rf in enumerate(regions[page]):
                try:
                    if _rf.get('auto') or styles.kind_of(_rf) != 'plain':
                        continue
                    if styles.cover_mode(_rf) != 'overlay':
                        continue
                    _zhf = zh_list[_idx] if _idx < len(zh_list) else ''
                    if not str(_zhf or '').strip():
                        continue
                    if flatten_plain_region(arr, _rf):
                        _flat_n += 1
                except Exception:
                    pass
            if _flat_n:
                _stat['flatten'] = _stat.get('flatten', 0) + _flat_n
                print('[拟声压平] %s 页 %d 框' % (page, _flat_n), flush=True)

        img2 = Image.fromarray(arr)
        draw = ImageDraw.Draw(img2)
        # 第二遍:写中文(只写有译文的框)
        overflow = []
        _title_hs = sorted([int(rr['h']) for rr in regions[page]
                            if styles.kind_of(rr) == 'title' and not rr.get('auto')])
        _title_med_h = _title_hs[len(_title_hs) // 2] if _title_hs else 0
        _band_hs = sorted([int(rr['h']) for rr in regions[page]
                          if styles.kind_of(rr) != 'title' and not rr.get('auto')
                          and rr['w'] >= 2.2 * max(1, rr['h'])])
        _band_med_h = _band_hs[len(_band_hs) // 2] if _band_hs else 0
        # 行距(相邻行框中心间距的中位数)才是字号真正上限,框高会互相重叠不可靠
        _bc = sorted((rr['y'] + rr['h'] / 2.0) for rr in regions[page]
                     if styles.kind_of(rr) != 'title' and not rr.get('auto')
                     and rr['w'] >= 2.2 * max(1, rr['h']))
        _diffs = sorted(_bc[i + 1] - _bc[i] for i in range(len(_bc) - 1))
        _band_pitch = _diffs[len(_diffs) // 2] if _diffs else 0
        _title_scale = 1.0
        if _title_med_h:
            _base_sz = max(28, int(_title_med_h * 0.62))
            _f = styles.load_font(_base_sz, bold=True)
            for _i2, _r2 in enumerate(regions[page]):
                if styles.kind_of(_r2) != 'title' or _r2.get('auto'):
                    continue
                _zh2 = zh_list[_i2] if _i2 < len(zh_list) else ''
                if not _zh2:
                    continue
                try:
                    _tw2 = draw.textlength(_zh2, font=_f)
                except Exception:
                    _tw2 = _base_sz * len(_zh2)
                _avail = max(8, int(_r2['w'] * 0.96))
                if _tw2 > _avail:
                    _title_scale = min(_title_scale, float(_avail) / float(_tw2))
            _title_scale = max(0.45, _title_scale)
        for i, r in enumerate(regions[page]):
            if i >= len(zh_list):
                break
            zh = zh_list[i]
            if not zh:
                continue
            # 自动标框的框不参与嵌字(需人工改字确认)
            if r.get('auto'):
                continue
            # 噪音框(页码/水印/UI/小碎框)一律不嵌,避免中文盖到画面上
            try:
                from boxtools import is_noise_box as _is_noise
                _ot = _ocr_all.get(page) or []
                _nt = str(_ot[i]) if i < len(_ot) else ''
                if _is_noise(r, _nt):
                    continue
            except Exception:
                pass
            x, y, w, h = r['x'], r['y'], r['w'], r['h']
            size = (r.get('size', 20) if r.get('size_fixed') else (r.get('_auto_size') or r.get('size', 20)))
            kind = styles.kind_of(r)        # body / plain / title
            st = styles.resolve(r)          # 新:样式预设;旧数据自动兼容
            # 样式跟随:拟声词按原图采样字色/描边色(可用 follow_style=false 关闭)
            if kind == 'plain' and FOLLOW_STYLE and r.get('follow_style', True) is not False:
                st = styles.sample_style(img, x, y, w, h, st, True,
                                         size=max(18, int(min(w, h) * 0.7)))
                if not STYLE_LAYERS:
                    st.pop('stroke2', None); st.pop('stroke2_w', None)
                if not STYLE_SHADOW:
                    st.pop('shadow_rel', None); st.pop('shadow', None)
            _v = r.get('_auto_vertical')
            raw_v = r.get('vertical', True)
            if isinstance(_v, bool):
                vertical = _v
            elif isinstance(raw_v, bool):
                vertical = raw_v
            else:
                # 'auto' 且没检测出:按框形状判断(宽扁→横排;高窄→竖排;接近方形→竖排)
                if w >= h * 1.15:
                    vertical = False
                elif h >= w * 1.15:
                    vertical = True
                else:
                    vertical = True
            if kind == 'title':
                # 标题:加粗 + 自动缩放;对齐方式可显式指定,或按原图墨迹自动判定
                _al = str(r.get('align') or 'auto').lower()
                _ink_cy = None
                if _al not in ('left', 'center', 'right'):
                    # 默认全开:按原图墨迹判断对齐与垂直中心,标记 align_auto 供界面提示人工更正
                    try:
                        _al, _ink_cy = guess_layout(arr_orig, r) if arr_orig is not None else ('center', None)
                    except Exception:
                        _al, _ink_cy = 'center', None
                    r['align_auto'] = True
                r['align'] = _al
                # 艺术字效果:加粗 + 双层描边(art) + 轻微投影,让标题更像原版美术字
                _st_t = dict(st)
                _st_t.setdefault('art', True)
                if not _st_t.get('stroke'):
                    _st_t['stroke'] = 4
                if not _st_t.get('shadow'):
                    _st_t['shadow'] = (2, 2, (60, 60, 60))
                st = _st_t
                if _ink_cy is not None:
                    r['_ink_cy'] = float(_ink_cy)
                # 同页标题用统一字号(按标题框中位高度),避免每行大小不一
                _base_h = _title_med_h or h
                size = max(int(size or 20), 28, int(round(_base_h * 0.62 * _title_scale)))
                _r_draw = r
                if r.get('_ink_cy') is not None:
                    # 让绘制框的中心落在墨迹中心:临时调整 y
                    _th_est = max(8, int(round(size * 1.0)))
                    _ny = int(round(float(r['_ink_cy']) - _th_est / 2.0))
                    _r_draw = dict(r)
                    _r_draw['y'] = _ny
                    _r_draw['h'] = _th_est
                ok = styles.draw_title(draw, zh, _r_draw, size, st)
            else:
                # 字号自适应:
                #   正文 → 超框自动缩小;拟声词 → 自动放大到接近填满框(提升可读性)
                is_body = (kind == 'body')
                _dx, _dy, _dw, _dh = x, y, w, h      # 正文按描边内缩,避免压到相邻行
                grow = (kind == 'plain') and AutoSizeOn
                _cap = 0.9
                _lo = 14 if is_body else 18
                if is_body:
                    # 正文:字号保持稳定(20~40),放不下只缩不放;再按描边宽度内缩,防止压到相邻行
                    _pad = int(st.get('stroke') or 0) + 2
                    _dx, _dy = x + _pad, y + _pad
                    _dw, _dh = max(24, w - 2 * _pad), max(24, h - 2 * _pad)
                    _band = (w >= 2.2 * max(1, h))     # 宽扁行框(目录/字幕条)
                    if _band:
                        # 横带正文:按行高给字号(点线不计入高度),再用略宽的预算防点线挤压
                        _pitch = _band_pitch or _band_med_h or h
                        _start = min(max(int(min(h * 0.85, _pitch * 0.72)), 24), 96)
                        new_size, bad = fit_size(draw, zh, int(_dw * 1.04), _dh, _start, st, vertical,
                                                 grow=False, cap_ratio=0.95, lo=20)
                    else:
                        _start = min(max(int(min(_dw, _dh) * 0.28), 22), 40)
                        new_size, bad = fit_size(draw, zh, _dw, _dh, _start, st, vertical,
                                                 grow=False, cap_ratio=0.9, lo=14)
                    # C 短气泡缩字:放不下时允许再降到 10 号(优先不溢出),能放下才保底 14
                    if bad:
                        try:
                            s3, bad3 = fit_size(draw, zh, _dw, _dh, new_size, st, vertical,
                                                grow=False, cap_ratio=0.9, lo=10)
                            if (not bad3 and s3 >= 10) or s3 < new_size:
                                new_size, bad = max(10, s3), bad3
                        except Exception:
                            pass
                    new_size = max(new_size, 10 if bad else 14)
                else:
                    new_size, bad = fit_size(draw, zh, w, h, size, st, vertical, grow=grow, cap_ratio=_cap, lo=_lo)
                # 当前方向怎么都放不下 → 试另一方向(竖排↔横排),哪个放得下用哪个
                if bad:
                    alt_size, alt_bad = fit_size(draw, zh, w, h, size, st, not vertical, grow=grow, cap_ratio=_cap, lo=_lo)
                    if not alt_bad or alt_size > new_size:
                        vertical = not vertical
                        new_size, bad = alt_size, alt_bad
                if grow and new_size >= 14:
                    new_size = max(new_size, 14)
                size = new_size
                if os.environ.get('MANGA_DEBUG_SIZES'):
                    print('[size] p=%s i=%d kind=%s w=%d h=%d start=%s -> size=%d bad=%s vertical=%s band=%s' % (
                        page, i, kind, w, h, locals().get('_start'), size, bad, vertical, locals().get('_band')))
                if bad:
                    overflow.append((i, zh))
                if bad:
                    # 最小字号仍放不下:允许局部溢出(可读优先),不再继续缩小
                    if grow:
                        ew, eh = int(w * 1.22), int(h * 1.12)
                    else:
                        ew, eh = int(w * 1.12), int(h * 1.08)
                    ex = max(0, x - (ew - w) // 2)
                    ey = max(0, y - (eh - h) // 2)
                    size = max(size, lo_s)
                    # 关键:按扩大后的区域重新算字号(拟声词可放大到填满扩展区),
                    # 否则小框里的拟声词会一直卡在下限字号,看起来特别小。
                    try:
                        s2, bad2 = fit_size(draw, zh, ew, eh, min(max(lo_s, int(r.get('size', 20) or 20)), 40 if is_body else 999),
                                            st, vertical, grow=grow, cap_ratio=_cap, lo=_lo)
                        if s2 > size:
                            size = s2
                        cap = int(min(ew, eh) * 0.55)
                        if cap > 8:
                            size = min(size, cap)
                        try:
                            W, H = img.size
                            ex = min(ex, max(0, W - ew))
                            ey = min(ey, max(0, H - eh))
                        except Exception:
                            pass
                    except Exception:
                        pass
                    if kind == 'plain' and FOLLOW_STYLE and draw_plain_rotated(img, zh, r, size, st, vertical):
                        ok = True
                    else:
                        ok = (draw_vtext(draw, zh, ex, ey, ew, eh, size, st) if vertical
                              else draw_htext(draw, zh, ex, ey, ew, eh, size, st))
                elif kind == 'plain' and FOLLOW_STYLE and draw_plain_rotated(img, zh, r, size, st, vertical):
                    ok = True
                elif vertical:
                    _st2 = dict(st); _st2['align'] = str(r.get('align') or 'center')
                    ok = draw_vtext(draw, zh, _dx, _dy, _dw, _dh, size, _st2)
                else:
                    # 宽扁行框:单行放得下时按框高垂直居中,避免相邻行上下压字
                    _yd = _dy
                    try:
                        if (w >= 2.2 * max(1, h)) and len(zh) <= 40:
                            _f = load_font(size, bool(st.get('bold')), bool(st.get('art')), st.get('font'))
                            _tw = draw.textlength(zh, font=_f) if _f is not None else 0
                            if _tw and _tw <= _dw - 6:
                                _yd = _dy + max(0, int((_dh - size) / 2))
                    except Exception:
                        pass
                    _st2 = dict(st); _st2['align'] = str(r.get('align') or 'center')
                    ok = draw_htext(draw, zh, _dx, _yd, _dw, max(24, _dh), size, _st2)
            if not ok:
                overflow.append((i, zh))
        if overflow:
            print(f"[警告] {page} 以下框文字太长,可能被截断:")
            for i, zh in overflow:
                print(f"  框[{i}]: {zh}")
        out = os.path.join(out_dir, page + '.png')
        img2.save(out)
        print(f"saved {out}")

    # 把没翻译的页(封面/版权页等)也转成 PNG 带上,保证整本完整
    done = set(p for p in regions if regions[p] and p in trans)
    for f in sorted(os.listdir(src)):
        b0, e0 = os.path.splitext(f)
        if e0.lower() in ('.webp', '.png', '.jpg', '.jpeg', '.bmp') and b0 not in done:
            try:
                Image.open(os.path.join(src, f)).convert('RGB').save(os.path.join(out_dir, b0 + '.png'))
                print(f"copied {b0}")
            except Exception:
                pass

    # ---- 来源标注:记录本次嵌字由谁执行,并写出报告 ----
    try:
        import provenance
        via = os.environ.get('MANGA_EMBED_VIA') or ('本地嵌字' + ('(LaMa GPU 抹除)' if lama else '(普通抹除)'))
        _pages = list(regions.keys()) if isinstance(regions, dict) else []
        _cnt = sum(len(v) for v in regions.values()) if isinstance(regions, dict) else 0
        provenance.log(_dd(src), 'embed', via, _pages, '%d 页 / %d 框' % (len(_pages), _cnt))
        _rp = provenance.write_markdown(_dd(src))
        if _rp:
            print('[来源报告] %s' % _rp)
            for _line in provenance.summary(_dd(src)):
                print('  ' + _line)
    except Exception as _e:
        print('[来源报告] 写入失败: %s' % str(_e)[:100])

    # 嵌字结束后自动校对(检查输出页是否齐全、该嵌的页是否真的变了)
    try:
        import subprocess
        pf = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proofread.py')
        penv = dict(os.environ)
        penv['PYTHONIOENCODING'] = 'utf-8'
        r = subprocess.run([sys.executable, pf, src, '--stage', 'post'] + (['--lama'] if lama else []),
                           capture_output=True, text=True, encoding='utf-8', errors='replace',
                           env=penv)
        print('\n===== 嵌字后自动校对 =====')
        try:
            print((r.stdout or '').strip())
        except Exception:
            print('(校对输出含控制台无法显示的字符,已写入 _proofread_post.txt)')
            open(os.path.join(_dd(src), '_proofread_post.txt'), 'w', encoding='utf-8').write(r.stdout or '')
    except Exception as e:
        print(f'[校对] 运行失败: {e}')

if __name__ == "__main__":
    main()
