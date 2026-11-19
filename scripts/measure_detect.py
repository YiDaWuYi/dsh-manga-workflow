# -*- coding: utf-8 -*-
"""对比自动标框和人工标注的覆盖率。
用法: python measure_detect.py <本子目录> <自动regions.json>
"""
import json, sys, os, numpy as np

book = sys.argv[1]
T = sys.argv[2]
auto = json.load(open(T, encoding='utf-8'))
manual = json.load(open(os.path.join(book, 'regions.json'), encoding='utf-8'))


def mask_of(boxes, shape):
    m = np.zeros(shape, bool)
    for b in boxes:
        x0 = max(0, int(b['x'])); y0 = max(0, int(b['y']))
        x1 = min(shape[1], int(b['x'] + b['w'])); y1 = min(shape[0], int(b['y'] + b['h']))
        if x1 > x0 and y1 > y0:
            m[y0:y1, x0:x1] = True
    return m


covered = total = 0
full = partial = missing = dial_total = 0
for p in sorted(set(auto) | set(manual)):
    ab = auto.get(p, [])
    mb = manual.get(p, [])
    if not mb:
        continue
    H = max([b['y'] + b['h'] for b in ab + mb] + [1])
    W = max([b['x'] + b['w'] for b in ab + mb] + [1])
    am = mask_of(ab, (H, W))
    for m in mb:
        if m.get('sfx') or m.get('points'):
            continue
        mm = mask_of([m], (H, W))
        ma = int(mm.sum())
        if ma == 0:
            continue
        dial_total += 1
        total += ma
        cov = int((am & mm).sum())
        covered += cov
        r = cov / ma
        if r >= 0.8:
            full += 1
        elif r >= 0.3:
            partial += 1
        else:
            missing += 1

print(f'自动框总数: {sum(len(v) for v in auto.values())}')
print(f'人工正文框: {dial_total}')
print(f'  完全覆盖(>=80%): {full} ({full / max(1, dial_total) * 100:.0f}%)')
print(f'  部分覆盖(30-80%): {partial} ({partial / max(1, dial_total) * 100:.0f}%)')
print(f'  基本没覆盖(<30%): {missing} ({missing / max(1, dial_total) * 100:.0f}%)')
print(f'  总面积覆盖率: {covered / max(1, total) * 100:.1f}%')
