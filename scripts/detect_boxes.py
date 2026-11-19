# -*- coding: utf-8 -*-
"""用 EasyOCR 的 CRAFT 检测器自动找「文本框(气泡)内」的文字区域。
拟声词等直接画在画面/白底上、没有被气泡包围的文字会被过滤掉。

判定方式(任一满足即认为是气泡内文字):
 1. 轮廓洞:文字框附近某个点落在一个"被暗线包围的白色洞"里,
    且洞面积是文字框面积的 1.5~80 倍(气泡内部)。
 2. 白色连通块:文字所在白块不触及页面边缘,且面积 >= 文字框面积。

用法: python detect_boxes.py <图片路径>
输出到 stdout: {"boxes":[{x,y,w,h}...], "dropped": n}
"""
import sys, json
from collections import Counter
import numpy as np
import cv2
from PIL import Image
import easyocr

WHITE_THRESHOLD = 200
MIN_BLOCK_RATIO = 0.30

HOLE_MIN_RATIO = 1.5
HOLE_MAX_RATIO = 80.0


def analyze(img):
    """返回 (labels, stats, holes, H, W)。"""
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    H, W = gray.shape

    _, bw = cv2.threshold(gray, WHITE_THRESHOLD, 255, cv2.THRESH_BINARY)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(bw, connectivity=4)

    _, dark = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY_INV)
    contours, hierarchy = cv2.findContours(dark, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    holes = []
    if hierarchy is not None:
        for i, cnt in enumerate(contours):
            if hierarchy[0][i][3] != -1:
                a = cv2.contourArea(cnt)
                if a > 100:
                    holes.append((cnt, a))
    return labels, stats, holes, H, W


def _hole_check(holes, x, y, w, h):
    box_area = max(1.0, float(w * h))
    m = 3
    x0, y0 = x - m, y - m
    x1, y1 = x + w + m, y + h + m
    pts = [(x0, y0), (x1, y0), (x0, y1), (x1, y1),
           ((x0 + x1) // 2, y0), (x0, (y0 + y1) // 2),
           (x1, (y0 + y1) // 2), ((x0 + x1) // 2, y1),
           (x + w // 2, y + h // 2)]
    for cx, cy in pts:
        best = None
        for cnt, a in holes:
            if cv2.pointPolygonTest(cnt, (float(cx), float(cy)), False) >= 0:
                if best is None or a < best:
                    best = a
        if best is not None:
            r = best / box_area
            if HOLE_MIN_RATIO <= r <= HOLE_MAX_RATIO:
                return True
    return False


def _label_check(labels, stats, H, W, x, y, w, h):
    pts = [(x + w // 2, y + h // 2), (x + 2, y + 2), (x + w - 2, y + 2),
           (x + 2, y + h - 2), (x + w - 2, y + h - 2)]
    labs = []
    for px, py in pts:
        px = min(W - 1, max(0, px))
        py = min(H - 1, max(0, py))
        labs.append(int(labels[py, px]))
    cnt = Counter(l for l in labs if l != 0)
    if not cnt:
        return False
    lab = cnt.most_common(1)[0][0]
    area = int(stats[lab, cv2.CC_STAT_AREA])
    bw = int(stats[lab, cv2.CC_STAT_WIDTH])
    bh = int(stats[lab, cv2.CC_STAT_HEIGHT])
    if bw * bh > 0.25 * H * W:      # 页面背景
        return False
    return area >= w * h * MIN_BLOCK_RATIO


def _merge_pair(a, b, gap):
    ax0, ay0, ax1, ay1 = a['x'], a['y'], a['x'] + a['w'], a['y'] + a['h']
    bx0, by0, bx1, by1 = b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']
    xo = min(ax1, bx1) - max(ax0, bx0)
    yo = min(ay1, by1) - max(ay0, by0)
    if xo > 0 and yo > 0:
        return True                                  # 相交
    if xo > min(a['w'], b['w']) * 0.5 and -gap < by0 - ay1 < gap:
        return True                                  # 上下相邻(横排折行)
    if yo > min(a['h'], b['h']) * 0.5 and -gap < bx0 - ax1 < gap:
        return True                                  # 左右相邻(竖排多列)
    return False


def merge_fragments(boxes, gap=14, max_iter=8):
    """把被拆碎的相邻文字块合并成一个气泡(竖排多列 / 横排多行)。"""
    boxes = [dict(b) for b in boxes]
    for _ in range(max_iter):
        merged = False
        out = []
        used = [False] * len(boxes)
        for i in range(len(boxes)):
            if used[i]:
                continue
            cur = dict(boxes[i])
            used[i] = True
            changed = True
            while changed:
                changed = False
                for j in range(i + 1, len(boxes)):
                    if used[j]:
                        continue
                    if _merge_pair(cur, boxes[j], gap):
                        x0 = min(cur['x'], boxes[j]['x'])
                        y0 = min(cur['y'], boxes[j]['y'])
                        x1 = max(cur['x'] + cur['w'], boxes[j]['x'] + boxes[j]['w'])
                        y1 = max(cur['y'] + cur['h'], boxes[j]['y'] + boxes[j]['h'])
                        cur = dict(cur, x=x0, y=y0, w=x1 - x0, h=y1 - y0)
                        used[j] = True
                        merged = changed = True
            out.append(cur)
        boxes = out
        if not merged:
            break
    return boxes


def _bright(gray, x, y, w, h, pad=0, ring=False):
    """区域内(灰度>200)亮像素比例;ring=True 只算框外一圈。"""
    H, W = gray.shape
    x0 = max(0, x - pad); y0 = max(0, y - pad)
    x1 = min(W, x + w + pad); y1 = min(H, y + h + pad)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    sub = gray[y0:y1, x0:x1]
    if not ring:
        return float((sub.ravel() > 200).mean())
    m = np.ones(sub.shape, bool)
    ix0 = max(0, x - x0); iy0 = max(0, y - y0)
    ix1 = min(sub.shape[1], x + w - x0); iy1 = min(sub.shape[0], y + h - y0)
    if ix1 > ix0 and iy1 > iy0:
        m[iy0:iy1, ix0:ix1] = False
    vals = sub[m]
    return 0.0 if vals.size == 0 else float((vals > 200).mean())


def _ink_ratio(gray, x, y, w, h):
    """框内深色像素比例(0-1)。拟声词笔画粗/底色深,墨量通常明显更高。"""
    H, W = gray.shape
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    sub = gray[y0:y1, x0:x1]
    return float((sub < 128).mean()) if sub.size else 0.0


def _is_body(gray, in_bubble_flag, x, y, w, h):
    """正文判定:气泡内且墨量不高;或超大浅墨块(大气泡对话)。其余按拟声词。"""
    H = gray.shape[0]
    ink = _ink_ratio(gray, x, y, w, h)
    if in_bubble_flag and ink < 0.25:
        return True
    if (not in_bubble_flag) and ink < 0.12 and h >= 0.12 * H:
        return True
    return False


def in_bubble(labels, stats, holes, H, W, x, y, w, h, gray=None):
    """只标气泡内文字。先看轮廓洞(准),再补一条宽松判定:文字块 + 框内/框外都很白。
    加 --all 参数时不过滤,由主程序决定要不要用。"""
    if _hole_check(holes, x, y, w, h):
        return True
    if gray is not None and _label_check(labels, stats, H, W, x, y, w, h):
        inner = _bright(gray, x, y, w, h)
        ring = _bright(gray, x, y, w, h, pad=6, ring=True)
        if inner >= 0.85 and ring >= 0.85:
            return True
    return False


def main():
    path = sys.argv[1]
    # 模式:all=全部(自动区分正文/拟声词) bubble=只标气泡 sfx=只标气泡外的拟声词
    mode = 'bubble'
    if '--mode' in sys.argv:
        mode = sys.argv[sys.argv.index('--mode') + 1]
        if mode not in ('all', 'bubble', 'sfx'):
            mode = 'bubble'
    elif '--all' in sys.argv:
        mode = 'all'
    bubble_only = (mode == 'bubble')
    img = np.array(Image.open(path).convert('RGB'))
    gray = np.array(Image.open(path).convert('L'))
    labels, stats, holes, H, W = analyze(img)

    reader = easyocr.Reader(['ko'], gpu=True, verbose=False)
    horiz, free = reader.detect(img, min_size=8, text_threshold=0.6, low_text=0.3)

    boxes = []
    seen = set()
    dropped = 0

    def add(x0, y0, x1, y1):
        nonlocal dropped
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        w, h = x1 - x0, y1 - y0
        if w < 8 or h < 8:
            return
        key = (x0 // 4, y0 // 4, w // 4, h // 4)
        if key in seen:
            return
        seen.add(key)
        inb = in_bubble(labels, stats, holes, H, W, x0, y0, w, h, gray=gray)
        if bubble_only and not inb:
            dropped += 1
            return
        if mode == 'sfx' and inb:
            dropped += 1
            return
        boxes.append({'x': x0, 'y': y0, 'w': w, 'h': h,
                      'kind': 'body' if _is_body(gray, inb, x0, y0, w, h) else 'plain'})

    for group in horiz:
        for b in group:
            x0, x1, y0, y1 = b
            add(x0, y0, x1, y1)
    for group in free:
        for poly in group:
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            add(min(xs), min(ys), max(xs), max(ys))

    boxes = merge_fragments(boxes)   # 把被拆碎的竖排多列/横排多行合并回一个气泡
    # 合并后重新判定类型(气泡内=正文,气泡外=拟声词)
    for b in boxes:
        try:
            inb = in_bubble(labels, stats, holes, H, W,
                            b['x'], b['y'], b['w'], b['h'], gray=gray)
            b['kind'] = 'body' if _is_body(gray, inb, b['x'], b['y'], b['w'], b['h']) else 'plain'
        except Exception:
            b.setdefault('kind', 'body')
    print(json.dumps({'boxes': boxes, 'dropped': dropped, 'mode': mode}, ensure_ascii=False))


if __name__ == '__main__':
    main()
