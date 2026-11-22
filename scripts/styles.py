# -*- coding: utf-8 -*-
"""文字样式预设:加载 styles.json,并把「框字段」解析成渲染参数。

框字段:
    style: 预设 id(新);没有该字段时按旧字段推导:
        color  = black | white | bw(兼容)
        outline= bool
        bold   = bool
        sfx    = bool(拟声词/艺术字)
渲染参数:
    fill       (r,g,b) 文字颜色
    bold       bool    粗体
    stroke     int     描边宽度(按字号 20 计,实际按字号缩放)
    strokeFill (r,g,b)|None
    art        bool    漫画艺术字(投影 + 双层描边)
    shadow     (dx,dy,color)|None
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
STYLES_FILE = os.path.join(HERE, 'styles.json')

_FALLBACK = [
    {'id': 'body_classic', 'kind': 'body', 'label': '经典', 'desc': '黑字白边',
     'fill': [0, 0, 0], 'stroke': 4, 'strokeFill': [255, 255, 255],
     'bold': False, 'art': False, 'shadow': None},
]


def load():
    try:
        with open(STYLES_FILE, encoding='utf-8') as f:
            d = json.load(f)
        presets = [p for p in (d.get('presets') or []) if p.get('id')]
        if presets:
            return presets
    except Exception:
        pass
    return list(_FALLBACK)


PRESETS = load()
BY_ID = {p['id']: p for p in PRESETS}
BODY_IDS = [p['id'] for p in PRESETS if p.get('kind') == 'body']
SFX_IDS = [p['id'] for p in PRESETS if p.get('kind') == 'sfx']
TITLE_IDS = [p['id'] for p in PRESETS if p.get('kind') == 'title']
DEFAULT_BODY = BODY_IDS[0] if BODY_IDS else 'body_classic'
DEFAULT_SFX = SFX_IDS[0] if SFX_IDS else 'sfx_classic'
DEFAULT_TITLE = TITLE_IDS[0] if TITLE_IDS else 'title_bold'

KINDS = ('body', 'plain', 'title')
KIND_LABEL = {'body': '正文', 'plain': '无框正文/拟声词', 'title': '标题'}
KIND_DEFAULT_STYLE = {'body': DEFAULT_BODY, 'plain': DEFAULT_SFX, 'title': DEFAULT_TITLE}


def kind_of(box):
    """框类型:body=正文(绿框) / plain=无框正文·拟声词(红框) / title=标题(蓝框)。

    兼容旧数据:有 kind 用它;否则 sfx/nobox/points 视为 plain,其余 body。
    """
    b = box or {}
    k = b.get('kind')
    if k in KINDS:
        return k
    if b.get('title'):
        return 'title'
    if b.get('sfx') or b.get('nobox') or b.get('points'):
        return 'plain'
    return 'body'


COVER_MODES = ('overlay', 'erase', 'cover')
COVER_LABEL = {'overlay': '直盖', 'erase': '抹除', 'cover': '覆盖'}


def cover_mode(box):
    """原文处理方式。

    overlay = 译文直盖(不处理原文,直接叠字)
    erase   = 抹除(按需修复/擦除原文)
    cover   = 色块覆盖(用框边缘颜色盖住原文)

    旧数据保持原行为:erase=False→直盖;否则抹除;上一版 'keep' 视作直盖。
    """
    b = box or {}
    # 拟声词:不允许色块覆盖(会挡住画面/网点)→ 降级为直盖;抹除仍可用
    if kind_of(b) == 'plain':
        if b.get('cover') == 'erase':
            return 'erase'
        return 'overlay'
    m = b.get('cover')
    if m == 'keep':
        return 'overlay'
    if m in COVER_MODES:
        return m
    if 'erase' in b:
        return 'erase' if b.get('erase') else 'overlay'
    return 'cover' if kind_of(b) in ('body', 'title') else 'erase'


def gpu_of(box):
    """该框抹除时是否用 GPU(LaMa)去字。"""
    b = box or {}
    if 'gpu' in b:
        return bool(b.get('gpu'))
    return bool(b.get('lama'))


def sample_cover_color(img, box, margin=8):
    """取框边缘一圈像素的中位色,作为「色块覆盖」的颜色(取不到用白色)。"""
    try:
        import numpy as np
        a = np.asarray(img.convert('RGB'))
        H, W = a.shape[:2]
        x, y = int(box.get('x', 0)), int(box.get('y', 0))
        w, h = int(box.get('w', 1)), int(box.get('h', 1))
        x0, y0 = max(0, x - margin), max(0, y - margin)
        x1, y1 = min(W, x + w + margin), min(H, y + h + margin)
        px = max(1, margin // 2)
        strips = [
            a[y0:min(y0 + px, y1), x0:x1],
            a[max(y1 - px, y0):y1, x0:x1],
            a[y0:y1, x0:min(x0 + px, x1)],
            a[y0:y1, max(x1 - px, x0):x1],
        ]
        vals = [st.reshape(-1, 3) for st in strips if st.size]
        if not vals:
            return (255, 255, 255)
        med = np.median(np.concatenate(vals, axis=0), axis=0)
        return (int(med[0]), int(med[1]), int(med[2]))
    except Exception:
        return (255, 255, 255)


def paint_cover(draw, box, color, shape='rect', inset=0.10):
    """用色块盖住原文。

    框选框:填满矩形;
    涂抹(自由框选)框:只按笔画围出的形状覆盖(沿笔画粗线 + 多边形),
    不会把整个外接矩形涂掉(v1.0 的顽固问题)。
    """
    x, y = int(box.get('x', 0)), int(box.get('y', 0))
    w, h = int(box.get('w', 1)), int(box.get('h', 1))
    pts = box.get('points')
    if pts:
        pl = [tuple(p) for p in pts]
        # 笔画粗细:取框短边的 1/4,至少 10px
        brush = max(10, int(min(w or 20, h or 20) / 4))
        if len(pl) >= 3:
            draw.polygon(pl, fill=color)
        if len(pl) >= 2:
            draw.line(pl, fill=color, width=brush, joint='curve')
        elif pl:
            draw.ellipse([pl[0][0] - brush, pl[0][1] - brush,
                          pl[0][0] + brush, pl[0][1] + brush], fill=color)
        return
    # 只画在框内(内缩 10%,不挡框外画面);形状:rect=按框,ellipse=内接椭圆
    ix, iy = int(w * inset), int(h * inset)
    x0, y0 = x + ix, y + iy
    x1, y1 = x + w - ix, y + h - iy
    if x1 <= x0 or y1 <= y0:
        x0, y0, x1, y1 = x, y, x + w, y + h
    try:
        if shape == 'ellipse':
            draw.ellipse([x0, y0, x1, y1], fill=color)
        else:
            r = max(2, int(min(x1 - x0, y1 - y0) * 0.06))   # 圆角矩形,边缘更自然
            draw.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=color)
    except Exception:
        draw.rectangle([x0, y0, x1, y1], fill=color)


def draw_title(draw, text, box, size, st=None):
    """标题:加粗 + 自动缩放适配框宽(单行);对齐方式由 box['align'] 决定(默认 center)。"""
    text = '' if text is None else str(text).strip()
    if not text:
        return False
    st = dict(st or {})
    x, y = int(box.get('x', 0)), int(box.get('y', 0))
    w, h = max(8, int(box.get('w', 1))), max(8, int(box.get('h', 1)))
    s = max(8, int(size or 20))
    font = load_font(s, bold=True, family=st.get('font'))
    try:
        tw = draw.textlength(text, font=font)
    except Exception:
        tw = s * len(text)
    maxw = max(8, int(w * 0.96))
    guard = 0
    while tw > maxw and s > 8 and guard < 400:
        s -= 1
        guard += 1
        font = load_font(s, bold=True, family=st.get('font'))
        try:
            tw = draw.textlength(text, font=font)
        except Exception:
            tw = s * len(text)
    th = s
    _align = str((box or {}).get('align') or 'center').lower()
    _pad = max(2.0, w * 0.02)
    if _align == 'left':
        tx = x + _pad
    elif _align == 'right':
        tx = x + w - tw - _pad
    else:
        tx = x + (w - tw) / 2.0
    ty = y + (h - th) / 2.0
    k = stroke_px(st, s)
    fill = st.get('fill') or (0, 0, 0)
    sf = st.get('stroke_fill')
    if st.get('hollow') and st.get('bg') is not None and not st.get('art'):
        bgc = tuple(int(v) for v in st['bg'])
        draw.text(xy, ch, font=font, fill=bgc, stroke_width=max(2, k + 1), stroke_fill=fill)
        return
    sh = st.get('shadow')
    if not sh and st.get('shadow_rel'):
        try:
            _rx, _ry, _rc = st['shadow_rel']
            sh = (int(round(float(_rx) * s)), int(round(float(_ry) * s)),
                  tuple(int(v) for v in _rc))
        except Exception:
            sh = None
    if sh:
        dx, dy, col = sh
        draw.text((tx + dx, ty + dy), text, font=font, fill=col,
                  stroke_width=(k + 2 if st.get('art') else k), stroke_fill=col)
    k2 = 0
    sf2 = st.get('stroke2')
    if sf2 is not None and st.get('stroke2_w'):
        k2 = max(1, int(round(float(st['stroke2_w']) * s / 20.0)))
    if st.get('art'):
        draw.text((tx, ty), text, font=font, fill=fill, stroke_width=k + 2, stroke_fill=sf or fill)
    if k2 and sf2 is not None:
        # 外层第二种描边:先画粗的外描边,再画内描边与字
        draw.text((tx, ty), text, font=font, fill=tuple(int(v) for v in sf2),
                  stroke_width=k + k2, stroke_fill=tuple(int(v) for v in sf2))
    draw.text((tx, ty), text, font=font, fill=fill, stroke_width=k, stroke_fill=sf)
    return True


def preset(style_id):
    return BY_ID.get(style_id)


def label(style_id):
    p = BY_ID.get(style_id)
    return p.get('label', style_id) if p else str(style_id or '')


def _rgb(v, default=None):
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        return (int(v[0]), int(v[1]), int(v[2]))
    return default


def resolve(box):
    """把框字段解析成渲染参数(兼容没有 style 字段的旧数据)。"""
    box = box or {}
    sid = box.get('style') or ''
    if not sid and box.get('kind') in KINDS:
        sid = KIND_DEFAULT_STYLE[box.get('kind')]
    p = BY_ID.get(sid)
    if p:
        sh = p.get('shadow')
        shadow = None
        if isinstance(sh, (list, tuple)) and len(sh) >= 5:
            shadow = (int(sh[0]), int(sh[1]), (int(sh[2]), int(sh[3]), int(sh[4])))
        return {
            'font': box.get('font') or p.get('font'),
            'fill': _rgb(p.get('fill'), (0, 0, 0)),
            'bold': bool(p.get('bold')),
            'stroke': max(0, int(p.get('stroke') or 0)),
            'stroke_fill': _rgb(p.get('strokeFill')),
            'art': bool(p.get('art')),
            'shadow': shadow,
            'id': p['id'],
        }
    # ---- 旧数据兼容 ----
    is_sfx = bool(box.get('sfx', False))
    color = str(box.get('color') or 'black')
    if color == 'bw':                     # 旧:黑字白框
        color, outline = 'black', True
    else:
        outline = bool(box.get('outline', is_sfx))
    fill = (255, 255, 255) if color == 'white' else (0, 0, 0)
    if outline:
        stroke = 4
        stroke_fill = (0, 0, 0) if color == 'white' else (255, 255, 255)
    else:
        stroke, stroke_fill = 0, None
    shadow = None
    if is_sfx:
        shadow = (2, 3, (55, 55, 55))
    return {
        'font': box.get('font'),
        'fill': fill,
        'bold': bool(box.get('bold', is_sfx)),
        'stroke': stroke,
        'stroke_fill': stroke_fill,
        'art': is_sfx,
        'shadow': shadow,
        'id': None,
    }

# ---------------- 绘制原语(PIL) ----------------
_FONT_CACHE = {}

# 可选字体(界面里显示的名字 → Windows 字体文件候选)
FONT_FAMILIES = [
    ('默认', None),
    ('微软雅黑', [r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\msyhbd.ttc']),
    ('宋体', [r'C:\Windows\Fonts\simsun.ttc']),
    ('黑体', [r'C:\Windows\Fonts\simhei.ttf']),
    ('楷体', [r'C:\Windows\Fonts\simkai.ttf']),
    ('仿宋', [r'C:\Windows\Fonts\simfang.ttf']),
    ('华文仿宋', [r'C:\Windows\Fonts\STFANGSO.TTF']),
    ('华文楷体', [r'C:\Windows\Fonts\STKAITI.TTF']),
    ('华文琥珀', [r'C:\Windows\Fonts\STHUPO.TTF']),
    ('瘦金体', [r'C:\Windows\Fonts\STXINGKA.TTF']),
    ('隶书', [r'C:\Windows\Fonts\SIMLI.TTF']),
    ('幼圆', [r'C:\Windows\Fonts\SIMYOU.TTF']),
]
FONT_NAMES = [n for n, _ in FONT_FAMILIES if n != '默认']
_FONT_BY_NAME = {n: fs for n, fs in FONT_FAMILIES if fs}


def load_font(size, bold=False, art=False, family=None):
    """漫画用字体:可指定字体族(宋体/瘦金体…),否则艺术字优先琥珀/行楷、普通优先雅黑。"""
    key = (int(size), bool(bold), bool(art), family or '')
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    from PIL import ImageFont
    fps = []
    if family:
        fs = _FONT_BY_NAME.get(family)
        if fs:
            fps += list(fs)
    if art:
        fps += [r'C:\Windows\Fonts\STHUPO.TTF', r'C:\Windows\Fonts\STXINGKA.TTF',
                r'C:\Windows\Fonts\STLITI.TTF', r'C:\Windows\Fonts\simkai.ttf']
    if bold:
        fps += [r'C:\Windows\Fonts\msyhbd.ttc', r'C:\Windows\Fonts\simhei.ttf']
    fps += [r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf']
    font = None
    for fp in fps:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, int(size))
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


def stroke_px(st, s):
    """描边宽度:按字号缩放,小字号时收敛(避免小字被描边糊成一团)。"""
    k = int(st.get('stroke') or 0)
    if k <= 0:
        return 0
    scale = max(0.55, min(1.25, s / 30.0))
    return max(1, int(round(k * scale)))


def draw_styled(draw, xy, ch, font, st, s):
    """按样式画一个字/一行:任意颜色、描边宽度、艺术字双层描边、投影。"""
    k = stroke_px(st, s)
    fill = st.get('fill') or (0, 0, 0)
    sf = st.get('stroke_fill')
    sh = st.get('shadow')
    if not sh:
        sr = st.get('shadow_rel')
        if sr:
            try:
                sh = (int(round(float(sr[0]) * s)), int(round(float(sr[1]) * s)), tuple(sr[2]))
            except Exception:
                sh = None
    if sh:
        dx, dy, col = sh
        draw.text((xy[0] + dx, xy[1] + dy), ch, font=font, fill=col,
                  stroke_width=(k + 2 if st.get('art') else k), stroke_fill=col)
    k2 = 0
    if st.get('stroke2'):
        try:
            k2 = int(round(float(st.get('stroke2_w') or 1.0) * s / 20.0))
        except Exception:
            k2 = 1
        k2 = max(1, min(12, k2))
    if k2:
        draw.text(xy, ch, font=font, fill=st['stroke2'], stroke_width=k + k2, stroke_fill=st['stroke2'])
    if st.get('art'):
        draw.text(xy, ch, font=font, fill=fill, stroke_width=k + 2, stroke_fill=sf or fill)
        draw.text(xy, ch, font=font, fill=fill, stroke_width=max(1, k), stroke_fill=sf or fill)
    else:
        draw.text(xy, ch, font=font, fill=fill, stroke_width=k, stroke_fill=sf)


def smart_clear_white(arr, box, thresh=205, max_ratio=0.42):
    """智能清除框内的白色原字(拟声词白描边字)。

    只处理框内高亮低饱和像素,用周围纹理修补(cv2.INPAINT_TELEA),不涂色块、
    不碰框外画面;白色占比过大(可能是白气泡)时跳过。
    """
    try:
        import numpy as np
        import cv2
    except Exception:
        return arr
    try:
        x, y = int(box.get('x', 0)), int(box.get('y', 0))
        w, h = int(box.get('w', 0)), int(box.get('h', 0))
        H, W = arr.shape[:2]
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(W, x + w), min(H, y + h)
        if x1 - x0 < 4 or y1 - y0 < 4:
            return arr
        crop = arr[y0:y1, x0:x1]
        gray = crop if crop.ndim == 2 else cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        mask = ((gray >= thresh).astype(np.uint8)) * 255
        if mask.mean() / 255.0 > max_ratio or mask.mean() < 0.01:
            return arr
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)
        arr[y0:y1, x0:x1] = cv2.inpaint(crop, mask, 4, cv2.INPAINT_TELEA)
        return arr
    except Exception:
        return arr

def sample_style(img, x, y, w, h, st, is_plain=True, size=None):
    """样式跟随:从原图框内采样文字主色/描边色/描边粗细。
    仅对拟声词(is_plain=True)使用;采样失败返回原样式。
    符号(♡♪ 等)由调用方用符号字体绘制,颜色同样跟随本函数结果。
    """
    try:
        import numpy as np
    except Exception:
        return st
    if not is_plain:
        return st
    try:
        W, H = img.size
        x0 = max(0, int(x)); y0 = max(0, int(y))
        x1 = min(W, int(x + w)); y1 = min(H, int(y + h))
        if x1 - x0 < 6 or y1 - y0 < 6:
            return st
        arr = np.asarray(img.crop((x0, y0, x1, y1)).convert('RGB')).astype(np.int16)
        hh, ww = arr.shape[:2]
        k = max(1, int(round(min(hh, ww) * 0.10)))
        edge = np.concatenate([
            arr[:k].reshape(-1, 3), arr[-k:].reshape(-1, 3),
            arr[:, :k].reshape(-1, 3), arr[:, -k:].reshape(-1, 3),
        ]).astype(np.float32)
        if edge.size == 0:
            return st
        bg = np.median(edge, axis=0)
        flat = arr.reshape(-1, 3).astype(np.float32)
        dist = np.abs(flat - bg).sum(axis=1)
        sel = dist > 120
        if sel.sum() < max(24, flat.shape[0] * 0.02):
            return st
        px = flat[sel]
        fill = np.median(px, axis=0).astype(int).tolist()
        # 字心主色:取距离变换峰值(笔画中心)的颜色,多层描边时不受描边色干扰
        try:
            import cv2 as _cv2
            _m0 = sel.reshape(hh, ww).astype(np.uint8)
            _dt = _cv2.distanceTransform(_m0, _cv2.DIST_L2, 5)
            if _dt.max() >= 2.0:
                _peaks = _dt >= max(2.0, 0.55 * float(_dt.max()))
                if int(_peaks.sum()) >= 20:
                    fill = np.median(flat.reshape(hh, ww, 3)[_peaks], axis=0).astype(int).tolist()
        except Exception:
            pass
        lum = 0.299 * fill[0] + 0.587 * fill[1] + 0.114 * fill[2]
        bg_lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]
        # 描边:字亮底暗用深描边,字暗底亮用白描边
        stroke_fill = (0, 0, 0) if lum > bg_lum else (255, 255, 255)
        # 描边粗细估计:统计「与描边色接近」的像素比例,再折算成 stroke(按字号 20 计)
        flat_l = flat.mean(axis=1)
        if stroke_fill == (0, 0, 0):
            stroke_ratio = float((flat_l < 45).sum()) / max(1, flat.shape[0])
        else:
            stroke_ratio = float((flat_l > 218).sum()) / max(1, flat.shape[0])
        if stroke_ratio > 0.30:
            stroke = 4
        elif stroke_ratio > 0.18:
            stroke = 3
        elif stroke_ratio > 0.08:
            stroke = 2
        else:
            stroke = 1
        out = dict(st)
        out['fill'] = tuple(int(v) for v in fill)
        out['stroke_fill'] = stroke_fill
        out['stroke'] = stroke
        out['bg'] = tuple(int(v) for v in bg)
        # ---- 空心字 + 字距 采样 ----
        try:
            import cv2
            mask = (dist > 120).reshape(hh, ww).astype(np.uint8)
            if int(mask.sum()) >= 30:
                n, lab, st2, _c = cv2.connectedComponentsWithStats(mask, 8)
                # 空心判定:字形内部有「封闭的背景空洞」(不接触框边)
                bgm = (1 - mask).astype(np.uint8)
                n2, lab2, st3, _c2 = cv2.connectedComponentsWithStats(bgm, 8)
                holes = 0
                for i in range(1, n2):
                    x2, y2 = st3[i, cv2.CC_STAT_LEFT], st3[i, cv2.CC_STAT_TOP]
                    w2, h2 = st3[i, cv2.CC_STAT_WIDTH], st3[i, cv2.CC_STAT_HEIGHT]
                    area2 = int(st3[i, cv2.CC_STAT_AREA])
                    touch = (x2 <= 0 or y2 <= 0 or x2 + w2 >= ww or y2 + h2 >= hh)
                    if (not touch) and area2 >= 30:
                        holes += 1
                _ys, _xs = np.nonzero(mask)
                if len(_xs) > 0:
                    _bw = float(_xs.max() - _xs.min() + 1); _bh = float(_ys.max() - _ys.min() + 1)
                    _ink_ratio = float(mask.sum()) / max(1.0, _bw * _bh)
                else:
                    _ink_ratio = 1.0
                out['hollow'] = bool(holes >= 2 and _ink_ratio < 0.32)
                # 字距:同一条线上相邻字的中心间距 / 字宽
                comps = []
                for i in range(1, n):
                    area2 = int(st2[i, cv2.CC_STAT_AREA])
                    if area2 < 30:
                        continue
                    comps.append((st2[i, cv2.CC_STAT_LEFT] + st2[i, cv2.CC_STAT_WIDTH] / 2.0,
                                  st2[i, cv2.CC_STAT_TOP] + st2[i, cv2.CC_STAT_HEIGHT] / 2.0,
                                  float(st2[i, cv2.CC_STAT_WIDTH]), float(st2[i, cv2.CC_STAT_HEIGHT])))
                if len(comps) >= 2:
                    axis = 0 if ww >= hh else 1
                    comps.sort(key=lambda c: c[axis])
                    exts = [c[2] if axis == 0 else c[3] for c in comps]
                    ds = [abs(comps[i + 1][axis] - comps[i][axis]) for i in range(len(comps) - 1)]
                    ds = [d for d in ds if d >= 6]
                    ext = sum(exts) / len(exts)
                    if ds and ext >= 6:
                        ds.sort()
                        pitch = ds[len(ds) // 2]
                        _raw = pitch / ext
                        out['spacing'] = float(min(1.60, max(1.0, round(_raw - 0.25, 2))))
                # ---- 多层描边(外描边):墨迹最外层 3px「皮」的中位色≠内描边/填充色时,记作第二层描边 ----
                try:
                    _img3 = flat.reshape(hh, ww, 3).astype(np.int16)
                    _ink2 = (np.abs(_img3 - np.array(bg, dtype=np.int16)).sum(axis=2) > 70).astype(np.uint8)
                    _ys_, _xs_ = np.nonzero(_ink2)
                    if len(_xs_) >= 40:
                        _bh_ = float(_ys_.max() - _ys_.min() + 1)
                        _skin = cv2.subtract(_ink2, cv2.erode(_ink2, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))))
                        _sy, _sx = np.nonzero(_skin)
                        if len(_sx) >= 80:
                            _sc = _img3[_sy, _sx]
                            _q = (_sc // 24).astype(np.int32)
                            _key = _q[:, 0] * 121 + _q[:, 1] * 11 + _q[:, 2]
                            _u, _cnt = np.unique(_key, return_counts=True)
                            _dom = _u[int(np.argmax(_cnt))]
                            _sel = _sc[_key == _dom]
                            _med = np.median(_sel, axis=0).astype(int).tolist()
                            _d_fill = np.abs(np.array(_med) - np.array(fill)).sum()
                            _d_stroke = np.abs(np.array(_med) - np.array(stroke_fill)).sum()
                            _d_bg = np.abs(np.array(_med) - np.array(bg)).sum()
                            _spread = float(np.median(np.abs(_sel - np.array(_med)).sum(axis=1)))
                            _share = float(len(_sel)) / max(1, len(_sc))
                            _chroma = int(max(_med) - min(_med))
                            if _d_fill > 95 and _d_stroke > 95 and _d_bg > 120 and _chroma >= 25:
                                if _share >= 0.22:
                                    out['stroke2'] = tuple(int(v) for v in _med)
                                    out['stroke2_w'] = float(max(0.6, min(1.0, round(0.6 + (1.0 - _share) * 0.6, 2))))
                except Exception:
                    pass
                # ---- 阴影方向采样:墨迹里的「第三色簇」(≠填充/描边)若整块偏移,记为投影方向 ----
                try:
                    _ys2, _xs2 = np.nonzero(mask)
                    if len(_xs2) > 200:
                        _cx2, _cy2 = float(_xs2.mean()), float(_ys2.mean())
                        _bh2 = float(_ys2.max() - _ys2.min() + 1)
                        _img2 = flat.reshape(hh, ww, 3).astype(np.int16)
                        _ps = _img2[_ys2, _xs2]
                        _qq = (_ps // 28).astype(np.int32)
                        _kk = _qq[:, 0] * 121 + _qq[:, 1] * 11 + _qq[:, 2]
                        _uu, _cc = np.unique(_kk, return_counts=True)
                        _order = np.argsort(-_cc)[:4]
                        _clusters = []
                        for _j in _order:
                            _m3 = _kk == _uu[_j]
                            if int(_m3.sum()) < max(40, int(len(_ps) * 0.06)):
                                continue
                            _sel3 = _ps[_m3]
                            _col = np.median(_sel3, axis=0).astype(int).tolist()
                            _cenx = float(_xs2[_m3].mean()); _ceny = float(_ys2[_m3].mean())
                            _clusters.append((_col, _cenx, _ceny, float(_m3.sum()) / len(_ps)))
                        if len(_clusters) >= 2:
                            _fillc = np.array(fill); _strokec = np.array(stroke_fill)
                            _cand = [c for c in _clusters
                                     if np.abs(np.array(c[0]) - _fillc).sum() > 70
                                     and np.abs(np.array(c[0]) - _strokec).sum() > 70]
                            if _cand:
                                _cc2 = max(_cand, key=lambda c: c[3])
                                _dx2 = _cc2[1] - _cx2; _dy2 = _cc2[2] - _cy2
                                _mag2 = (abs(_dx2) ** 2 + abs(_dy2) ** 2) ** 0.5
                                _fr = 6
                                _edge = np.concatenate([flat.reshape(hh, ww, 3)[: _fr].reshape(-1, 3),
                                                        flat.reshape(hh, ww, 3)[- _fr:].reshape(-1, 3),
                                                        flat.reshape(hh, ww, 3)[:, : _fr].reshape(-1, 3),
                                                        flat.reshape(hh, ww, 3)[:, - _fr:].reshape(-1, 3)])
                                _eg = _edge.mean(axis=1)
                                _unif = float(_eg.std())
                                if _mag2 >= max(2.0, _bh2 * 0.045) and _bh2 >= 20 and _unif <= 10.0:
                                    _sx2 = max(-0.12, min(0.12, (_dx2 / _bh2) * 0.3))
                                    _sy2 = max(-0.12, min(0.12, (_dy2 / _bh2) * 0.3))
                                    out['shadow_rel'] = (round(_sx2, 3), round(_sy2, 3),
                                                         tuple(int(v) for v in _cc2[0]))
                except Exception:
                    pass
        except Exception:
            pass
        return out
    except Exception:
        return st
