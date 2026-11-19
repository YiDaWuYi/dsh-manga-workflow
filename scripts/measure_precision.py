# -*- coding: utf-8 -*-
"""统计自动框的精确率(多少框能对上人工框)。用法: python measure_precision.py <本子目录> <自动regions.json>"""
import json, sys, os

book = sys.argv[1]
T = sys.argv[2]
auto = json.load(open(T, encoding='utf-8'))
manual = json.load(open(os.path.join(book, 'regions.json'), encoding='utf-8'))


def inter(a, b):
    ax0, ay0 = a['x'], a['y']
    ax1, ay1 = ax0 + a['w'], ay0 + a['h']
    bx0, by0 = b['x'], b['y']
    bx1, by1 = bx0 + b['w'], by0 + b['h']
    iw = max(0, min(ax1, bx1) - max(ax0, bx0))
    ih = max(0, min(ay1, by1) - max(ay0, by0))
    return iw * ih


tp = 0
fp = 0
for p in sorted(auto):
    mb = manual.get(p, [])
    for a in auto[p]:
        aa = max(1, a['w'] * a['h'])
        ok = any(inter(a, m) >= aa * 0.5 for m in mb)
        if ok:
            tp += 1
        else:
            fp += 1
n = tp + fp
print(f'自动框: {n} | 能对上人工框(精确): {tp} | 疑似噪声: {fp}')
print(f'  精确率: {tp / max(1, n) * 100:.0f}%')
print(f'  噪声率: {fp / max(1, n) * 100:.0f}%')
