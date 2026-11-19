# -*- coding: utf-8 -*-
"""整本自动标框:检测每页「气泡内」的文字区域,合并进 regions.json。
用法: python detect_book.py <文件夹>
输出到 stdout 最后一行: {"pages": n, "boxes": total, "dropped": total}
"""
import sys, os, json
import numpy as np
from PIL import Image
import easyocr
from detect_boxes import analyze, in_bubble, merge_fragments

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

    bubble_only = '--all' not in sys.argv
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
            if bubble_only and not in_bubble(labels, stats, holes, H, W, x0, y0, w, h, gray=gray):
                dropped += 1
                return
            # 跳过与已有框高度重叠的
            for eb in existing:
                if abs(eb['x'] - x0) < 12 and abs(eb['y'] - y0) < 12 and abs(eb['w'] - w) < 16 and abs(eb['h'] - h) < 16:
                    return
            b = dict(DEFAULT_BOX)
            b.update({'x': x0, 'y': y0, 'w': w, 'h': h})
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
