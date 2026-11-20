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
from PIL import Image, ImageDraw

def load_font(size, bold=False, art=False, family=None):
    return styles.load_font(size, bold, art, family)

def inpaint_rect(arr, x, y, w, h):
    H, W = arr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    region = arr[y0:y1, x0:x1].copy()
    gray = cv2.cvtColor(region, cv2.COLOR_RGB2GRAY)
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    if not mask.any():          # 整框都没检测到文字才跳过(小字也要擦)
        return
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    rgb = cv2.cvtColor(region, cv2.COLOR_RGB2BGR)
    out = cv2.inpaint(rgb, mask, 4, cv2.INPAINT_TELEA)
    arr[y0:y1, x0:x1] = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)

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


def _draw_char(draw, xy, ch, font, st, s):
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


def fit_size(draw, text, w, h, start, st, vertical, grow=False):
    """计算适配框的字号。

    grow=False(正文/标题):从小往大靠 start,放不下就缩小,最小 6 号;
    grow=True (拟声词):在放得下的前提下尽量放大,直到接近填满框。
    返回 (字号, 是否还需要再缩)。
    """
    text = text or ''
    start = max(6, int(start or 20))
    lo_s = 18 if grow else 10  # 可读下限:拟声 18(小框也不缩太小),正文/标题 10
    hi_s = min(140, max(12, int(min(w, h) * 0.9)))
    if grow:
        hi_s = max(hi_s, 28)   # 小框的拟声词也至少能到 28 号(允许溢出盖到框外)
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
        cy = y + 3
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
    cy = y + 3
    for ln in lines:
        _draw_char(draw, (x + 3, cy), ln, font, st, s)
        cy += s + 4
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

def main():
    preview = '--preview' in sys.argv
    lama = '--lama' in sys.argv
    args = [a for a in sys.argv[1:] if a not in ('--preview', '--lama')]
    src = args[0] if len(args) > 0 else "."
    # 读取 config.json(GPU去字开关),命令行 --lama 优先
    auto_size = True
    auto_dir = True
    try:
        _cfg = json.load(open(os.path.join(src, 'config.json'), encoding='utf-8'))
        if not lama:
            lama = bool(_cfg.get('lama', False))
        auto_size = bool(_cfg.get('auto_size', True))
        auto_dir = bool(_cfg.get('auto_dir', True))
    except Exception:
        pass
    if lama:
        # 批量模式:委托给 embed_lama.py(一次加载模型,比逐页快很多)
        import subprocess as _sp
        _here = os.path.dirname(os.path.abspath(__file__))
        _cmd = [sys.executable, os.path.join(_here, 'embed_lama.py'), src]
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
    regions_file = args[1] if len(args) > 1 else os.path.join(src, "regions.json")
    trans_file = args[2] if len(args) > 2 else os.path.join(src, "trans.json")
    out_dir = args[3] if len(args) > 3 else os.path.join(src, "preview" if preview else "out")
    os.makedirs(out_dir, exist_ok=True)
    regions = json.load(open(regions_file, encoding='utf-8'))
    trans = json.load(open(trans_file, encoding='utf-8'))

    for page in sorted(regions):
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
                    if styles.gpu_of(r):
                        # 标记了 GPU 去字的框:收集起来交给 LaMa 统一处理
                        gpu_sub.append(r)
                        gpu_zh.append(zh)
                        continue
                    if r.get('points'):
                        # 自由框选:按自由形状精确擦除
                        inpaint_mask(arr, r['points'])
                    else:
                        x, y, w, h = r['x'], r['y'], r['w'], r['h']
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
                        styles.paint_cover(d2, r, styles.sample_cover_color(src_img, r))
                    arr = np.array(tmp)
        img2 = Image.fromarray(arr)
        draw = ImageDraw.Draw(img2)
        # 第二遍:写中文(只写有译文的框)
        overflow = []
        for i, r in enumerate(regions[page]):
            if i >= len(zh_list):
                break
            zh = zh_list[i]
            if not zh:
                continue
            # 自动标框的框不参与嵌字(需人工改字确认)
            if r.get('auto'):
                continue
            x, y, w, h = r['x'], r['y'], r['w'], r['h']
            size = (r.get('size', 20) if r.get('size_fixed') else (r.get('_auto_size') or r.get('size', 20)))
            kind = styles.kind_of(r)        # body / plain / title
            st = styles.resolve(r)          # 新:样式预设;旧数据自动兼容
            _v = r.get('_auto_vertical')
            raw_v = r.get('vertical', True)
            if isinstance(_v, bool):
                vertical = _v
            elif isinstance(raw_v, bool):
                vertical = raw_v
            else:
                vertical = True          # 'auto' 且没检测出 → 默认竖排
            if kind == 'title':
                # 标题:居中 + 加粗 + 自动缩放
                ok = styles.draw_title(draw, zh, r, size, st)
            else:
                # 字号自适应:
                #   正文 → 超框自动缩小;拟声词 → 自动放大到接近填满框(提升可读性)
                grow = (kind == 'plain') and AutoSizeOn
                new_size, bad = fit_size(draw, zh, w, h, size, st, vertical, grow=grow)
                # 当前方向怎么都放不下 → 试另一方向(竖排↔横排),哪个放得下用哪个
                if bad:
                    alt_size, alt_bad = fit_size(draw, zh, w, h, size, st, not vertical, grow=grow)
                    if not alt_bad or alt_size > new_size:
                        vertical = not vertical
                        new_size, bad = alt_size, alt_bad
                if grow and new_size >= 14:
                    new_size = max(new_size, 14)
                size = new_size
                if bad:
                    overflow.append((i, zh))
                if bad:
                    # 最小字号仍放不下:允许局部溢出(可读优先),不再继续缩小
                    if grow:
                        ew, eh = int(w * 1.9), int(h * 1.55)
                    else:
                        ew, eh = int(w * 1.12), int(h * 1.08)
                    ex = max(0, x - (ew - w) // 2)
                    ey = max(0, y - (eh - h) // 2)
                    size = max(size, lo_s)
                    # 关键:按扩大后的区域重新算字号(拟声词可放大到填满扩展区),
                    # 否则小框里的拟声词会一直卡在下限字号,看起来特别小。
                    try:
                        s2, bad2 = fit_size(draw, zh, ew, eh, max(lo_s, int(r.get('size', 20) or 20)),
                                            st, vertical, grow=grow)
                        if s2 > size:
                            size = s2
                    except Exception:
                        pass
                    ok = (draw_vtext(draw, zh, ex, ey, ew, eh, size, st) if vertical
                          else draw_htext(draw, zh, ex, ey, ew, eh, size, st))
                elif vertical:
                    ok = draw_vtext(draw, zh, x, y, w, h, size, st)
                else:
                    ok = draw_htext(draw, zh, x, y, w, h, size, st)
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
            open(os.path.join(src, '_proofread_post.txt'), 'w', encoding='utf-8').write(r.stdout or '')
    except Exception as e:
        print(f'[校对] 运行失败: {e}')

if __name__ == "__main__":
    main()
