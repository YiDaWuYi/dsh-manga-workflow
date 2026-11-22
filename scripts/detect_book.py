# -*- coding: utf-8 -*-
"""整本自动标框:检测每页「气泡内」的文字区域,合并进 regions.json。
用法: python detect_book.py <文件夹>
输出到 stdout 最后一行: {"pages": n, "boxes": total, "dropped": total}
"""
import sys, os, json
import numpy as np
from PIL import Image
import os as _os0, tempfile as _tf0
def _easy_dir0():
    _d = _os0.environ.get('MANGA_DATA_DIR') or ''
    if _d:
        _p = _os0.path.abspath(_d).split(_os0.sep)
        for _i in range(len(_p), 0, -1):
            _c = _os0.path.join(_os0.sep.join(_p[:_i]), '_easyocr')
            try:
                _os0.makedirs(_c, exist_ok=True); return _c
            except Exception: pass
    _c = _os0.path.join(_tf0.gettempdir(), 'manga_easyocr')
    _os0.makedirs(_c, exist_ok=True); return _c
_os0.environ.setdefault('EASYOCR_MODULE_PATH', _easy_dir0())
import easyocr
from detect_boxes import (analyze, in_bubble, merge_fragments, merge_bubble_columns, _is_body,
                          classify_scene, split_tall_bands, drop_contained, absorb_row_fragments,
                          looks_like_dialogue)

def _dd(p):
    return os.environ.get('MANGA_DATA_DIR') or p

EXTS = ('.webp', '.png', '.jpg', '.jpeg', '.bmp')
DEFAULT_BOX = {'vertical': True, 'size': 20, 'nobox': False, 'color': 'black', 'outline': False, 'auto': True}


def main():
    src = sys.argv[1]
    regions_file = os.path.join(_dd(src), 'regions.json')
    regions = {}
    if os.path.exists(regions_file):
        try:
            regions = json.load(open(regions_file, encoding='utf-8'))
        except Exception:
            regions = {}

    mode = 'bubble'
    if '--mode' in sys.argv:
        mode = sys.argv[sys.argv.index('--mode') + 1]
        if mode not in ('all', 'bubble', 'sfx'):
            mode = 'bubble'
    elif '--all' in sys.argv:
        mode = 'all'
    bubble_only = (mode == 'bubble')
    only_page = ''
    if '--page' in sys.argv:
        _i = sys.argv.index('--page')
        if _i + 1 < len(sys.argv):
            only_page = sys.argv[_i + 1]
    pages = sorted(f for f in os.listdir(src) if f.lower().endswith(EXTS))
    if only_page:
        pages = [f for f in pages if os.path.splitext(f)[0] == only_page]
        if not pages:
            print('[自动标框] 找不到页面 %s -> 退出' % only_page, flush=True)
            return 2
    print('[检测] 正在加载 EasyOCR 模型(首次约 30-60 秒,属正常,不是卡死)…', flush=True)
    try:
        reader = easyocr.Reader(['ko'], gpu=True, verbose=False)
    except Exception:
        reader = easyocr.Reader(['ko'], gpu=False, verbose=False)
    print('[检测] 模型就绪,开始逐页检测', flush=True)

    total_boxes = 0
    total_dropped = 0
    done_pages = 0
    for pi, fn in enumerate(pages, 1):
        key = os.path.splitext(fn)[0]
        try:
            img = np.array(Image.open(os.path.join(src, fn)).convert('RGB'))
        except Exception:
            continue
        labels, stats, holes, H, W = analyze(img)
        gray = np.array(Image.open(os.path.join(src, fn)).convert('L'))
        try:
            horiz, free = reader.detect(img, min_size=8, text_threshold=0.6, low_text=0.3)
        except Exception:
            continue
        existing = regions.get(key, [])
        new_boxes = []
        dropped = 0
        seen = set()

        def add(x0, y0, x1, y1):
            nonlocal dropped
            x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
            w, h = x1 - x0, y1 - y0
            if w < 8 or h < 8:
                return
            k = (x0 // 4, y0 // 4, w // 4, h // 4)
            if k in seen:
                return
            seen.add(k)
            inb = in_bubble(labels, stats, holes, H, W, x0, y0, w, h, gray=gray)
            # 场景判定只在 all 模式启用;bubble 模式保持原逻辑(不动正常气泡页)
            scene = classify_scene(gray, inb, x0, y0, w, h, allow_dark=True, page_h=H) if mode == 'all' else None
            # bubble 模式保持原语义:只留气泡内的框(横带只在 all 模式出,避免动到正常页)
            if bubble_only and (not inb):
                dropped += 1
                return
            if mode == 'sfx' and (inb or scene == 'band'):
                dropped += 1
                return
            # 跳过与已有标注重叠的框(不再把已标注的框重新标一遍)
            for eb in existing:
                try:
                    acx, acy = x0 + w / 2.0, y0 + h / 2.0
                    if eb['x'] <= acx <= eb['x'] + eb['w'] and eb['y'] <= acy <= eb['y'] + eb['h']:
                        return
                    bcx, bcy = eb['x'] + eb['w'] / 2.0, eb['y'] + eb['h'] / 2.0
                    if x0 <= bcx <= x0 + w and y0 <= bcy <= y0 + h:
                        return
                    ix0 = max(x0, eb['x']); iy0 = max(y0, eb['y'])
                    ix1 = min(x0 + w, eb['x'] + eb['w']); iy1 = min(y0 + h, eb['y'] + eb['h'])
                    if ix1 > ix0 and iy1 > iy0:
                        inter = (ix1 - ix0) * (iy1 - iy0)
                        union = w * h + eb['w'] * eb['h'] - inter
                        if union > 0 and inter / float(union) > 0.25:
                            return
                except Exception:
                    continue
            b = dict(DEFAULT_BOX)
            _kind = 'body' if ((scene == 'band') or _is_body(gray, inb, x0, y0, w, h)) else (
                'body' if looks_like_dialogue(gray, x0, y0, w, h) else 'plain')
            b.update({'x': x0, 'y': y0, 'w': w, 'h': h, 'kind': _kind,
                      'scene': scene,
                      'sfx': _kind == 'plain', 'erase': False,
                      'cover': 'overlay' if _kind == 'plain' else 'cover'})
            new_boxes.append(b)

        for group in horiz:
            for b in group:
                x0, x1, y0, y1 = b
                add(x0, y0, x1, y1)
        for group in free:
            for poly in group:
                xs = [p[0] for p in poly]
                ys = [p[1] for p in poly]
                add(min(xs), min(ys), max(xs), max(ys))

        new_boxes = merge_fragments(new_boxes, page_w=W, page_h=H)   # 合并碎片(带面积/填充率约束)
        new_boxes = merge_bubble_columns(new_boxes, gray=gray)                  # 同一气泡内竖排多列 -> 一框
        if mode == 'all':
            new_boxes = split_tall_bands(new_boxes, gray, page_w=W)  # 两行被合成一框时再切开(all 模式)
            new_boxes = drop_contained(new_boxes)                    # 去掉嵌套/重复框
            new_boxes = absorb_row_fragments(new_boxes)              # 行框吸收同排列碎片
            new_boxes = split_tall_bands(new_boxes, gray, page_w=W)   # 吸收后再切一次(吸收会把相邻行合回)
            new_boxes.sort(key=lambda b: (b['y'], b['x']))            # 统一按阅读顺序(y,x)编号,方便译文对齐
            # 过滤「整块马赛克/大插图」类误检:free 场景且面积>5%、高度>20% 页高
            _pg_area = max(1, W * H)
            new_boxes = [b for b in new_boxes
                         if not (b.get('scene') in (None, 'free')
                                 and (b['w'] * b['h']) / _pg_area > 0.05
                                 and b['h'] > 0.2 * H)]
        if new_boxes:
            regions[key] = existing + new_boxes
        total_boxes += len(new_boxes)
        total_dropped += dropped
        done_pages += 1
        print(f'进度 {pi}/{len(pages)} {key} 新增 {len(new_boxes)} 框 (排除 {dropped})', flush=True)

    json.dump(regions, open(regions_file, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({'pages': done_pages, 'boxes': total_boxes, 'dropped': total_dropped}, ensure_ascii=False))


if __name__ == '__main__':
    main()
