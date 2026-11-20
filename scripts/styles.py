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
    """标题:居中 + 加粗 + 自动缩放适配框宽(单行)。"""
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
    tx = x + (w - tw) / 2.0
    ty = y + (h - th) / 2.0
    k = stroke_px(st, s)
    fill = st.get('fill') or (0, 0, 0)
    sf = st.get('stroke_fill')
    sh = st.get('shadow')
    if sh:
        dx, dy, col = sh
        draw.text((tx + dx, ty + dy), text, font=font, fill=col,
                  stroke_width=(k + 2 if st.get('art') else k), stroke_fill=col)
    if st.get('art'):
        draw.text((tx, ty), text, font=font, fill=fill, stroke_width=k + 2, stroke_fill=sf or fill)
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
    if sh:
        dx, dy, col = sh
        draw.text((xy[0] + dx, xy[1] + dy), ch, font=font, fill=col,
                  stroke_width=(k + 2 if st.get('art') else k), stroke_fill=col)
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
