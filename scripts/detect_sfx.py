# -*- coding: utf-8 -*-
"""拟声词/无框文字「建议框」检测(纯 OpenCV,不依赖模型下载)。

思路:笔画边缘 → 膨胀合并成文字团 → 过滤气泡内文字(白底) → 外扩 → 输出建议框。
用法: python detect_sfx.py <图片或文件夹> [--out regions_suggest.json] [--expand 0.10]
输出: {"page": [{"x","y","w","h","auto":true,"kind":"plain"}, ...], "_stats": {...}}
"""
import sys, os, json
import numpy as np
import cv2


def detect_page(img, expand=0.10, min_area_ratio=0.0002, max_area_ratio=0.02):
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    # 1) 笔画:自适应阈值,兼顾浅底深字/深底浅字
    inv = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                cv2.THRESH_BINARY_INV, 25, 10)
    edges = cv2.Canny(gray, 60, 160)
    strokes = cv2.bitwise_or(inv, edges)
    # 2) 膨胀合并成文字团
    k = max(3, int(round(min(H, W) / 180)))
    merged = cv2.dilate(strokes, np.ones((k, k), np.uint8), iterations=2)
    merged = cv2.morphologyEx(merged, cv2.MORPH_CLOSE, np.ones((k + 4, k + 4), np.uint8))
    n, _lab, stats, _c = cv2.connectedComponentsWithStats(merged, 8)
    page_area = float(H * W)
    boxes = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if w < 14 or h < 14:
            continue
        ar = float(area) / page_area
        if ar < min_area_ratio or ar > max_area_ratio:
            continue
        asp = w / float(h)
        if asp < 0.18 or asp > 9:
            continue
        # 3) 过滤气泡内文字:框内大部分是白色/浅色(气泡纸)→ 交给气泡流程
        roi = gray[y:y + h, x:x + w]
        if roi.size == 0:
            continue
        light_ratio = float((roi > 225).sum()) / roi.size
        if light_ratio > 0.62:
            continue
        # 4) 外扩,把描边包进来
        ex = int(round(w * expand)); ey = int(round(h * expand))
        x0 = max(0, x - ex); y0 = max(0, y - ey)
        x1 = min(W, x + w + ex); y1 = min(H, y + h + ey)
        boxes.append({'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0),
                      'auto': True, 'kind': 'plain'})
    # 去重叠(保留面积大的)
    boxes.sort(key=lambda b: -b['w'] * b['h'])
    kept = []
    for b in boxes:
        bx, by, bw, bh = b['x'], b['y'], b['w'], b['h']
        dup = False
        for o in kept:
            ox, oy, ow, oh = o['x'], o['y'], o['w'], o['h']
            ix = max(0, min(bx + bw, ox + ow) - max(bx, ox))
            iy = max(0, min(by + bh, oy + oh) - max(by, oy))
            inter = ix * iy
            if inter > 0.55 * min(bw * bh, ow * oh):
                dup = True
                break
        if not dup:
            kept.append(b)
    return kept


def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    target = sys.argv[1]
    out = None; expand = 0.10
    for i, a in enumerate(sys.argv):
        if a == '--out' and i + 1 < len(sys.argv): out = sys.argv[i + 1]
        if a == '--expand' and i + 1 < len(sys.argv): expand = float(sys.argv[i + 1])
    files = []
    if os.path.isdir(target):
        for f in sorted(os.listdir(target)):
            if f.lower().endswith(('.webp', '.png', '.jpg', '.jpeg', '.bmp')):
                files.append(f)
    else:
        files = [os.path.basename(target)]; target = os.path.dirname(target) or '.'
    res = {}
    total = 0
    for f in files:
        p = os.path.join(target, f)
        img = cv2.cvtColor(cv2.imread(p, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
        if img is None:
            continue
        bs = detect_page(img, expand=expand)
        res[os.path.splitext(f)[0]] = bs
        total += len(bs)
        print('%s: %d' % (f, len(bs)))
    res_out = {'pages': res, 'total': total, 'expand': expand}
    if out:
        with open(out, 'w', encoding='utf-8') as fh:
            json.dump(res_out, fh, ensure_ascii=False, indent=1)
        print('written', out, 'total', total)
    return 0


if __name__ == '__main__':
    sys.exit(main())
