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
DEFAULT_BODY = BODY_IDS[0] if BODY_IDS else 'body_classic'
DEFAULT_SFX = SFX_IDS[0] if SFX_IDS else 'sfx_classic'


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
    p = BY_ID.get(box.get('style') or '')
    if p:
        sh = p.get('shadow')
        shadow = None
        if isinstance(sh, (list, tuple)) and len(sh) >= 5:
            shadow = (int(sh[0]), int(sh[1]), (int(sh[2]), int(sh[3]), int(sh[4])))
        return {
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


def load_font(size, bold=False, art=False):
    """漫画用字体:艺术字优先琥珀/行楷;普通优先雅黑(粗/常规)。"""
    key = (int(size), bool(bold), bool(art))
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    from PIL import ImageFont
    fps = []
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
    """描边宽度:样式里按字号 20 定义,实际按字号轻微缩放。"""
    k = int(st.get('stroke') or 0)
    if k <= 0:
        return 0
    return max(1, int(round(k * max(1.0, s / 24.0))))


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
