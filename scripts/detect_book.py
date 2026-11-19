# -*- coding: utf-8 -*-
"""整本自动标框:检测每页「气泡内」的文字区域,合并进 regions.json。
用法: python detect_book.py <文件夹>
输出到 stdout 最后一行: {"pages": n, "boxes": total, "dropped": total}
"""
import sys, os, json
import numpy as np
from PIL import Image
import easyocr
from detect_boxes import analyze, in_bubble, merge_fragments, _is_body

EXTS = ('.webp', '.png', '.jpg', '.jpeg', '.bmp')
DEFAULT_BOX = {'vertical': True, 'size': 20, 'nobox': False, 'color': 'black', 'outline': False, 'auto': True}


def main():
    src = sys.argv[1]
    regions_file = os.path.join(src, 'regions.json')
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
    pages = sorted(f for f in os.listdir(src) if f.lower().endswith(EXTS))
    reader = easyocr.Reader(['ko'], gpu=True, verbose=False)

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
            if bubble_only and not inb:
                dropped += 1
                return
            if mode == 'sfx' and inb:
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
            _kind = 'body' if _is_body(gray, inb, x0, y0, w, h) else 'plain'
            b.update({'x': x0, 'y': y0, 'w': w, 'h': h, 'kind': _kind,
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

        new_boxes = merge_fragments(new_boxes)   # 合并被拆碎的碎片
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
