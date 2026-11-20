# -*- coding: utf-8 -*-
"""用 LaMa(GPU)批量擦除 + 嵌字。一次加载模型处理所有页,比逐页快很多。

用法: python embed_lama.py <图片文件夹> [--preview]
输出: <文件夹>/out_lama/  (成品) 或 preview_lama/ (预览)
"""
import json, os, sys, shutil, subprocess

# 项目根目录(manga_tool 的上一级),所有路径从这里推导
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from embed_regions import draw_vtext, draw_htext, estimate_font_size, detect_vertical, inpaint_rect, inpaint_mask, fit_size
import styles

IOPAINT = os.path.join(BASE, '_venv', 'Scripts', 'iopaint.exe')
LAMA_IO = os.path.join(BASE, '_lama_io')
TORCH_HOME = os.path.join(BASE, '_torchcache')
HF_HOME = os.path.join(BASE, '_hfcache')

def build_mask(img, boxes, zh_list):
    mask = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(mask)
    for i, r in enumerate(boxes):
        zh = zh_list[i] if i < len(zh_list) else ""
        if not zh:
            continue
        if styles.cover_mode(r) != 'erase':
            continue      # 直盖 / 覆盖 不进 LaMa 遮罩
        if not styles.gpu_of(r):
            continue      # 没勾 GPU 去字的框用普通抹除(后面 cv2 处理)
        if r.get('points'):
            for (px, py) in r['points']:
                d.ellipse([px - 10, py - 10, px + 10, py + 10], fill=255)
        else:
            d.rectangle([r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']], fill=255)
    return mask

def main():
    AUTO_SIZE = '--no-auto-size' not in sys.argv
    AUTO_DIR = '--no-auto-dir' not in sys.argv
    src = sys.argv[1] if len(sys.argv) > 1 else "."
    preview = '--preview' in sys.argv
    regions = json.load(open(os.path.join(src, 'regions.json'), encoding='utf-8'))
    trans = json.load(open(os.path.join(src, 'trans.json'), encoding='utf-8'))

    ind = os.path.join(LAMA_IO, 'in')
    mkd = os.path.join(LAMA_IO, 'mask')
    outd = os.path.join(LAMA_IO, 'out')
    for d in (ind, mkd, outd):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d, exist_ok=True)

    pages = [p for p in sorted(regions) if regions[p] and p in trans]
    print(f'准备 {len(pages)} 页的图+遮罩...')
    for page in pages:
        img = None
        for ext in ('.webp', '.png', '.jpg', '.jpeg', '.bmp'):
            p = os.path.join(src, page + ext)
            if os.path.exists(p):
                img = Image.open(p).convert('RGB')
                break
        if img is None:
            continue
        img.save(os.path.join(ind, page + '.png'))
        build_mask(img, regions[page], trans[page]).save(os.path.join(mkd, page + '.png'))

    print('LaMa 批量处理中(一次加载)...')
    env = dict(os.environ)
    env['TORCH_HOME'] = TORCH_HOME
    env['HF_HOME'] = HF_HOME
    r = subprocess.run([IOPAINT, 'run', '--model=lama', '--device=cuda',
                        '--image', ind, '--mask', mkd, '--output', outd],
                       env=env, capture_output=True, text=True)
    print('iopaint 返回码', r.returncode)
    if r.returncode != 0:
        print(r.stderr[-800:])

    out_dir = os.path.join(src, 'preview_lama' if preview else 'out_lama')
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for page in pages:
        res = os.path.join(outd, page + '.png')
        if not os.path.exists(res):
            print(f'[跳过] LaMa 没出 {page}')
            continue
        base = Image.open(res).convert('RGB')
        # 色块覆盖:用原图框边缘中位色盖住原文(LaMa 只负责需要修复的框)
        try:
            _src_img = None
            for ext in ('.webp', '.png', '.jpg', '.jpeg', '.bmp'):
                _sp = os.path.join(src, page + ext)
                if os.path.exists(_sp):
                    _src_img = Image.open(_sp).convert('RGB')
                    break
            if _src_img is not None:
                _d2 = ImageDraw.Draw(base)
                for _r in regions[page]:
                    _i = regions[page].index(_r)
                    _zh = trans[page][_i] if _i < len(trans[page]) else ""
                    if not _zh or _r.get('auto'):
                        continue
                    if styles.cover_mode(_r) == 'cover':
                        # 放不下 → 自动「直盖」(不涂色块,文字直接叠在原图);
                        # 放得下但很吃紧 → 椭圆色块;宽松 → 圆角矩形(均内缩,不超框)
                        _kind = styles.kind_of(_r)
                        _w, _h = int(_r.get('w', 1)), int(_r.get('h', 1))
                        _v = bool(_r.get('vertical', True))
                        _tight = False
                        _bad = False
                        if _kind == 'body':
                            _st0 = min(max(int(min(_w, _h) * 0.28), 22), 40)
                            _s, _bad = fit_size(_d2, _zh, _w, _h, _st0, {}, _v,
                                                grow=False, cap_ratio=0.9, lo=14)
                            _tight = (not _bad) and _s < _st0
                        elif _kind == 'plain':
                            _s, _bad = fit_size(_d2, _zh, _w, _h, 20, {}, _v,
                                                grow=True, cap_ratio=0.9, lo=18)
                        if _bad:
                            continue   # 直盖:跳过色块
                        styles.paint_cover(_d2, _r, styles.sample_cover_color(_src_img, _r),
                                           shape='ellipse' if _tight else 'rect')
        except Exception as _e:
            print('[覆盖] 失败:', _e)
        # 非 GPU 的「抹除」框:LaMa 没处理,这里用普通抹除补上
        try:
            import numpy as _np
            _arr = _np.array(base)
            _need = False
            for _i2, _r2 in enumerate(regions[page]):
                _zh2 = trans[page][_i2] if _i2 < len(trans[page]) else ""
                if not _zh2 or _r2.get('auto'):
                    continue
                if styles.cover_mode(_r2) == 'erase' and not styles.gpu_of(_r2):
                    if _r2.get('points'):
                        inpaint_mask(_arr, _r2['points'])
                    else:
                        inpaint_rect(_arr, _r2['x'], _r2['y'], _r2['w'], _r2['h'])
                    _need = True
            if _need:
                base = Image.fromarray(_arr)
        except Exception as _e:
            print('[普通抹除] 失败:', _e)
        draw = ImageDraw.Draw(base)
        zh_list = trans[page]
        # 用原图估每个框的原文字号(擦除前)
        src_arr = None
        for ext in ('.webp', '.png', '.jpg', '.jpeg', '.bmp'):
            sp = os.path.join(src, page + ext)
            if os.path.exists(sp):
                try:
                    src_arr = np.array(Image.open(sp).convert('RGB'))
                except Exception:
                    src_arr = None
                break
        for i, rr in enumerate(regions[page]):
            if i >= len(zh_list):
                break
            zh = zh_list[i]
            if not zh:
                continue
            # 自动标框的框不参与嵌字(需人工改字确认)
            if rr.get('auto'):
                continue
            x, y, w, h = rr['x'], rr['y'], rr['w'], rr['h']
            st = styles.resolve(rr)                      # 样式预设(旧数据自动兼容)
            size = rr.get('size', 20)
            if AUTO_SIZE and not rr.get('size_fixed') and src_arr is not None:
                size = estimate_font_size(src_arr, rr)   # 自动检测原文字号
            _v = detect_vertical(src_arr, rr) if (AUTO_DIR and src_arr is not None) else None
            vertical = _v if isinstance(_v, bool) else bool(rr.get('vertical', True))
            kind = styles.kind_of(rr)
            if kind == 'title':
                # 标题:按框高放大(标题框通常很高),再由 draw_title 按宽自动缩
                sizes = max(int(size or 20), 28, int(h * 0.5))
                styles.draw_title(draw, zh, rr, sizes, st)
            else:
                # 与 embed_regions 一致:可读下限 + 放不下时允许局部溢出并重算字号
                is_body = (kind == 'body')
                grow = (kind == 'plain') and AUTO_SIZE
                _cap = 0.9
                _lo = 14 if is_body else 18
                base_sz = int(size or 20)
                if is_body:
                    # 正文:字号保持稳定(20~40),放不下只缩不放
                    base_sz = min(max(int(min(w, h) * 0.28), 22), 40)
                    s_fit, bad = fit_size(draw, zh, w, h, base_sz, st, vertical,
                                          grow=False, cap_ratio=0.9, lo=14)
                    s_fit = max(s_fit, 14)
                else:
                    s_fit, bad = fit_size(draw, zh, w, h, base_sz, st, vertical, grow=grow,
                                          cap_ratio=_cap, lo=_lo)
                if bad:
                    lo = _lo
                    ew, eh = ((int(w * 1.22), int(h * 1.12)) if grow
                              else (int(w * 1.12), int(h * 1.08)))
                    ex = max(0, x - (ew - w) // 2)
                    ey = max(0, y - (eh - h) // 2)
                    s2, _ = fit_size(draw, zh, ew, eh, max(lo, base_sz), st, vertical, grow=grow,
                                      cap_ratio=_cap, lo=_lo)
                    s_fit = max(s_fit, s2, lo)
                    cap = int(min(ew, eh) * 0.55)
                    if cap > 8:
                        s_fit = min(s_fit, cap)
                    W, H = img.size
                    ex = min(ex, max(0, W - ew))
                    ey = min(ey, max(0, H - eh))
                    ok = (draw_vtext(draw, zh, ex, ey, ew, eh, s_fit, st) if vertical
                          else draw_htext(draw, zh, ex, ey, ew, eh, s_fit, st))
                else:
                    ok = (draw_vtext(draw, zh, x, y, w, h, s_fit, st) if vertical
                          else draw_htext(draw, zh, x, y, w, h, s_fit, st))
        base.save(os.path.join(out_dir, page + '.png'))
        n += 1
    # 把未翻译的页(封面/版权页等)也转成 PNG 带上,保证整本完整
    done = set(pages)
    for f in sorted(os.listdir(src)):
        b0, e0 = os.path.splitext(f)
        if e0.lower() in ('.webp', '.png', '.jpg', '.jpeg', '.bmp') and b0 not in done:
            try:
                Image.open(os.path.join(src, f)).convert('RGB').save(os.path.join(out_dir, b0 + '.png'))
                n += 1
            except Exception:
                pass
    print(f'完成 {n} 页 -> {out_dir}')

if __name__ == '__main__':
    main()
