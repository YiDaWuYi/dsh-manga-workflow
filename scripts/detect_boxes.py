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
import os, sys, json
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


def _same_line(a, b, gap):
    """同一行(水平相邻、垂直重叠够多)——用于拟声/无框字,禁止上下连锁合并。"""
    ax0, ay0, ax1, ay1 = a['x'], a['y'], a['x'] + a['w'], a['y'] + a['h']
    bx0, by0, bx1, by1 = b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']
    yo = min(ay1, by1) - max(ay0, by0)
    if yo <= min(a['h'], b['h']) * 0.55:
        return False
    gap_x = max(bx0 - ax1, ax0 - bx1)
    return -gap < gap_x < gap



def _band_same_row(a, b):
    """横带(band)只允许合并同一基线行的碎片,避免上下两行被连锁合并。"""
    dy = abs((a['y'] + a['h'] / 2.0) - (b['y'] + b['h'] / 2.0))
    return dy <= max(6.0, 0.45 * min(a['h'], b['h']))


def merge_fragments(boxes, gap=14, max_iter=8, page_w=None, page_h=None):
    """把被拆碎的相邻文字块合并成一个气泡(竖排多列 / 横排多行)。

    2026-11 修复:原先无约束地递归合并,目录/字幕这类「一行行排列」的页面会被
    连锁合并成覆盖半页的巨框。现在合并前检查:
      · 合并后不能超过整页 8% 面积、宽高不超过页面的 80%;
      · 合并后「文字填充率」不能太低(碎片面积和 / 合并框面积 < 0.20 视为稀疏,不合并)。
    """
    boxes = [dict(b) for b in boxes]
    max_area = (page_w * page_h * 0.03) if (page_w and page_h) else None
    max_w = page_w * 0.8 if page_w else None
    max_h = page_h * 0.8 if page_h else None
    areas = [max(1, b['w'] * b['h']) for b in boxes]
    for _ in range(max_iter):
        merged = False
        out = []
        used = [False] * len(boxes)
        for i in range(len(boxes)):
            if used[i]:
                continue
            cur = dict(boxes[i])
            cur_area = areas[i]
            used[i] = True
            changed = True
            while changed:
                changed = False
                for j in range(i + 1, len(boxes)):
                    if used[j]:
                        continue
                    a_sc = cur.get('scene') or ('plain' if cur.get('kind') == 'plain' else 'bubble')
                    b_sc = boxes[j].get('scene') or ('plain' if boxes[j].get('kind') == 'plain' else 'bubble')
                    if a_sc == 'band' or b_sc == 'band':
                        # 横带(目录/字幕):允许跨「……」点线整行合并,但必须同一基线行
                        _g = (page_w * 0.9) if page_w else gap * 6
                        if not (_same_line(cur, boxes[j], _g) and _band_same_row(cur, boxes[j])):
                            continue
                    elif a_sc == 'plain' or b_sc == 'plain':
                        if not _same_line(cur, boxes[j], gap):
                            continue
                    elif not _merge_pair(cur, boxes[j], gap):
                        continue
                    x0 = min(cur['x'], boxes[j]['x'])
                    y0 = min(cur['y'], boxes[j]['y'])
                    x1 = max(cur['x'] + cur['w'], boxes[j]['x'] + boxes[j]['w'])
                    y1 = max(cur['y'] + cur['h'], boxes[j]['y'] + boxes[j]['h'])
                    nw, nh = x1 - x0, y1 - y0
                    cand_area = max(1, nw * nh)
                    # 约束只在「非纯气泡」场景生效;纯气泡(scene=None/bubble)与旧版逐字一致
                    if a_sc != 'bubble' or b_sc != 'bubble':
                        _band = ('band' in (a_sc, b_sc))
                        _max_area = max_area * 4 if (_band and max_area) else max_area
                        _max_w = (page_w * 0.96) if _band else max_w
                        _density = 0.10 if _band else 0.22
                        if _max_area is not None and cand_area > _max_area:
                            continue
                        if (_max_w and nw > _max_w) or (max_h and nh > max_h):
                            continue
                        if (cur_area + areas[j]) / cand_area < _density:
                            continue
                    _sc = 'bubble' if (a_sc == 'bubble' and b_sc == 'bubble') else (
                        'band' if (a_sc == 'band' or b_sc == 'band') else 'free')
                    cur = dict(cur, x=x0, y=y0, w=nw, h=nh, scene=_sc)
                    cur_area += areas[j]
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


def _comp_count(gray, x, y, w, h, min_area=12):
    """框内墨迹连通块数量(用于区分「多字台词」与「1~2 个大字拟声」)。"""
    try:
        import numpy as _np
        import cv2 as _cv
        H, W = gray.shape[:2]
        x0, y0 = max(0, int(x)), max(0, int(y))
        x1, y1 = min(W, int(x + w)), min(H, int(y + h))
        crop = gray[y0:y1, x0:x1]
        if crop.size < 100:
            return 0
        _th, ink = _cv.threshold(crop, 0, 255, _cv.THRESH_BINARY_INV + _cv.THRESH_OTSU)
        n, _lab, st, _c = _cv.connectedComponentsWithStats(ink, 8)
        return sum(1 for i in range(1, n) if int(st[i, _cv.CC_STAT_AREA]) >= min_area)
    except Exception:
        return 0


def _is_body(gray, in_bubble_flag, x, y, w, h):
    """正文判定:气泡内 + 多字块(≥3) + 墨量不高;或超大浅墨块(大气泡对话)。其余按拟声词。"""
    H = gray.shape[0]
    ink = _ink_ratio(gray, x, y, w, h)
    comps = _comp_count(gray, x, y, w, h)
    if in_bubble_flag and ink < 0.50 and comps >= 3:
        return True
    if (not in_bubble_flag) and ink < 0.12 and h >= 0.12 * H:
        return True
    return False



def looks_like_dialogue(gray, x, y, w, h):
    """亮底 + 多字块(≥3 个连通块)+ 墨量适中 → 判为气泡台词(body),而不是拟声。
    解决「浅色/粉色气泡里的台词被判成 plain → 直盖 → 双语重叠」。
    """
    try:
        import numpy as _np
        import cv2 as _cv
        H, W = gray.shape[:2]
        x0, y0 = max(0, int(x)), max(0, int(y))
        x1, y1 = min(W, int(x + w)), min(H, int(y + h))
        if x1 - x0 < 50 or y1 - y0 < 45:
            return False
        crop = gray[y0:y1, x0:x1]
        bg = float(_np.median(crop))
        if bg < 140:                      # 只在浅色底面上启用(气泡/浅色背景)
            return False
        _th, ink = _cv.threshold(crop, 0, 255, _cv.THRESH_BINARY_INV + _cv.THRESH_OTSU)
        ratio = float((ink > 0).sum()) / float(crop.size)
        if not (0.02 <= ratio <= 0.40):
            return False
        _std = float(crop.std())
        if _std > 45:                     # 底不够干净(压在画面上)不判台词
            return False
        n, _lab, st, _c = _cv.connectedComponentsWithStats(ink, 8)
        comps = [i for i in range(1, n) if int(st[i, _cv.CC_STAT_AREA]) >= 12]
        if len(comps) < 4:                # 拟声通常 1~3 个大字块
            return False
        _hs = [int(st[i, _cv.CC_STAT_HEIGHT]) for i in comps]
        _hs.sort()
        _med_h = _hs[len(_hs) // 2]
        if _med_h > 0.55 * (y1 - y0):     # 单字占满整框 → 更像拟声
            return False
        _big = max(int(st[i, _cv.CC_STAT_AREA]) for i in comps)
        if _big > 0.35 * float(ink.sum() / 255.0):
            return False
        return True
    except Exception:
        return False


def _scene_of(b):
    """场景键:scene 为 None 时按 kind 推断(bubble 模式不做场景判定,scene 恒为 None)。"""
    return b.get('scene') or ('plain' if b.get('kind') == 'plain' else 'bubble')


def _gap_is_bubble(gray, a, b, min_bright=150.0, max_std=42.0):
    """判断两框之间的水平间隙是不是气泡内壁(亮且均匀) —— 防止把相邻两个气泡合并。"""
    if gray is None:
        return True
    ax1, bx0 = a['x'] + a['w'], b['x']
    bx1, ax0 = b['x'] + b['w'], a['x']
    gx0, gx1 = (ax1, bx0) if bx0 >= ax1 else (bx1, ax0)
    if gx1 - gx0 < 2:
        return True
    oy0 = max(a['y'], b['y'])
    oy1 = min(a['y'] + a['h'], b['y'] + b['h'])
    if oy1 - oy0 < 4:
        return False
    H, W = gray.shape[:2]
    x0, x1 = max(0, int(gx0)), min(W, int(gx1))
    y0, y1 = max(0, int(oy0)), min(H, int(oy1))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return True
    seg = gray[y0:y1, x0:x1].astype('float32')
    return float(seg.mean()) >= min_bright and float(seg.std()) <= max_std


def merge_bubble_columns(boxes, max_gap_ratio=0.45, min_overlap=0.7, gray=None):
    """把同一气泡内被竖排文字切成多列的小框合并成一框(仅 bubble 场景)。

    判据:两框水平间隙 <= max_gap_ratio*较小宽、垂直重叠 >= min_overlap*较小高,
    且间隙区域是「亮而均匀」的气泡内壁(见 `_gap_is_bubble`)。
    """
    changed = True
    while changed:
        changed = False
        n = len(boxes)
        for i in range(n):
            a = boxes[i]
            if _scene_of(a) != 'bubble':
                continue
            for j in range(i + 1, n):
                b = boxes[j]
                if _scene_of(b) != 'bubble':
                    continue
                ax0, ay0, ax1, ay1 = a['x'], a['y'], a['x'] + a['w'], a['y'] + a['h']
                bx0, by0, bx1, by1 = b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']
                gap = max(bx0 - ax1, ax0 - bx1)
                ov = min(ay1, by1) - max(ay0, by0)
                if gap < 0:
                    gap = 0
                if gap > max_gap_ratio * min(a['w'], b['w']):
                    continue
                if ov < min_overlap * min(a['h'], b['h']):
                    continue
                if not _gap_is_bubble(gray, a, b):
                    continue
                nx0, ny0 = min(ax0, bx0), min(ay0, by0)
                nx1, ny1 = max(ax1, bx1), max(ay1, by1)
                m = dict(a)
                m.update({'x': nx0, 'y': ny0, 'w': nx1 - nx0, 'h': ny1 - ny0,
                          'scene': 'bubble',
                          'kind': a.get('kind') or b.get('kind') or 'body'})
                if m.get('kind') != 'plain':
                    m['sfx'] = False
                boxes[i] = m
                boxes.pop(j)
                changed = True
                break
            if changed:
                break
    return boxes


def split_tall_bands(boxes, gray, page_w=None, ratio=1.28, max_passes=6):
    """把明显偏高的横带框按水平投影低谷切开(可多行递归切),气泡页不生效。"""
    import numpy as np

    def _split_once(b, med):
        x, y, w, h = b['x'], b['y'], b['w'], b['h']
        band_img = gray[max(0, y):y + h, max(0, x):x + w]
        if band_img.size == 0 or h < 24:
            return None
        row_ink = (np.abs(band_img.astype(np.float32) - float(band_img.mean())) > 40).sum(axis=1)
        thr = max(1.0, float(row_ink.max()) * 0.06)
        quiet = row_ink < thr
        lo, hi = int(h * 0.15), int(h * 0.85)
        best = None
        run_start = None
        for i in range(lo, hi):
            if quiet[i]:
                if run_start is None:
                    run_start = i
            else:
                if run_start is not None:
                    if best is None or (i - run_start) > (best[1] - best[0]):
                        best = (run_start, i)
                    run_start = None
        if run_start is not None and (best is None or (hi - run_start) > (best[1] - best[0])):
            best = (run_start, hi)
        if best and (best[1] - best[0]) >= max(3, h * 0.02):
            cut = (best[0] + best[1]) // 2
        elif h >= med * 1.20 or h >= med * 1.05:
            # 没有明显空白行:在中间 40% 找最安静的一行硬切
            mid_lo, mid_hi = int(h * 0.3), int(h * 0.7)
            if mid_hi <= mid_lo:
                return None
            cut = mid_lo + int(np.argmin(row_ink[mid_lo:mid_hi]))
            # 硬切前再确认两侧都还有内容(避免把单行切成两半)
            import numpy as _np
            if row_ink[max(0, cut - 6):cut + 6].sum() > 0 and h < med * 1.05:
                return None
        else:
            return None
        if cut < 12 or (h - cut) < 12:
            return None
        b1 = dict(b); b2 = dict(b)
        b1['h'] = cut
        b2['y'] = y + cut
        b2['h'] = h - cut
        return [b1, b2]

    out = list(boxes)
    for _ in range(max_passes):
        bands = [b for b in out if b.get('scene') == 'band']
        if len(bands) < 2:
            break
        hs = sorted(b['h'] for b in bands)
        med = hs[len(hs) // 2] or 1
        changed = False
        nxt = []
        for b in out:
            if b.get('scene') != 'band' or b['h'] <= med * ratio:
                nxt.append(b)
                continue
            piece = _split_once(b, med)
            if piece is None:
                nxt.append(b)
            else:
                nxt.extend(piece)
                changed = True
        out = nxt
        if not changed:
            break
    return out



def absorb_row_fragments(boxes, overlap=0.6, pad=40):
    """横带行框吸收同一行里的列碎片(目录/字幕被拆成列的情况)。气泡页不生效。"""
    bands = [b for b in boxes if b.get('scene') == 'band']
    if not bands:
        return boxes
    used = [False] * len(boxes)
    out = []
    for i, b in enumerate(boxes):
        if b.get('scene') == 'band':
            used[i] = True
            out.append(b)
    for i, c in enumerate(boxes):
        if used[i]:
            continue
        cy = c['y'] + c['h'] / 2.0
        host = None
        for b in out:
            oy = max(0, min(b['y'] + b['h'], c['y'] + c['h']) - max(b['y'], c['y']))
            if oy / max(1.0, min(b['h'], c['h'])) >= overlap and (b['x'] - pad) <= (c['x'] + c['w']) and (c['x'] - pad) <= (b['x'] + b['w']):
                host = b
                break
        if host is None:
            out.append(c)
            continue
        x1 = min(host['x'], c['x']); y1 = min(host['y'], c['y'])
        x2 = max(host['x'] + host['w'], c['x'] + c['w']); y2 = max(host['y'] + host['h'], c['y'] + c['h'])
        host['x'], host['y'], host['w'], host['h'] = x1, y1, x2 - x1, y2 - y1
    return out

def drop_contained(boxes, thr=0.75):
    """去掉被更大框几乎完全包含的重复框(band 合并会造出嵌套框)。"""
    def area(b):
        return max(1, b['w'] * b['h'])
    def inter(a, b):
        x1 = max(a['x'], b['x']); y1 = max(a['y'], b['y'])
        x2 = min(a['x'] + a['w'], b['x'] + b['w']); y2 = min(a['y'] + a['h'], b['y'] + b['h'])
        if x2 <= x1 or y2 <= y1:
            return 0
        return (x2 - x1) * (y2 - y1)
    order = sorted(range(len(boxes)), key=lambda k: -area(boxes[k]))
    keep = []
    for k in order:
        b = boxes[k]
        dup = False
        for q in keep:
            a = boxes[q]
            if inter(a, b) / area(b) >= thr:
                dup = True
                break
        if not dup:
            keep.append(k)
    return [boxes[k] for k in sorted(keep)]

def classify_scene(gray, inb, x, y, w, h, allow_dark=False, page_h=None):
    """判定文字块所在场景:bubble(白气泡内) / band(亮色横带·弹窗字幕) / free(画面上无框字)。

    目前只用来决定"合并规则"和"是否算正文",不改动既有气泡判定逻辑。
    """
    if inb:
        return 'bubble'
    try:
        crop = gray[y:y + h, x:x + w]
        if crop.size < 64:
            return 'free'
        med = float(np.median(crop))
        # 横带一定是「扁而宽」的:宽高比 >=2.6,高度不超过页高 22%(避免把普通气泡/画面上文字误判)
        _flat = (w >= 2.6 * h) and (page_h is None or h <= 0.22 * page_h)
        if _flat and med >= 140:
            dark = float((crop < med - 60).mean())
            if 0.05 <= dark <= 0.65:
                return 'band'
        # 深色底板(目录/黑底字幕):只有 all 模式才认,避免把黑画面上的拟声字当正文
        if _flat and allow_dark and med <= 95:
            bright = float((crop > med + 80).mean())
            if 0.03 <= bright <= 0.60:
                return 'band'
    except Exception:
        pass
    return 'free'


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
        scene = classify_scene(gray, inb, x0, y0, w, h, allow_dark=(mode == 'all'))
        if bubble_only and (not inb) and scene != 'band':
            dropped += 1
            return
        if mode == 'sfx' and (inb or scene == 'band'):
            dropped += 1
            return
        boxes.append({'x': x0, 'y': y0, 'w': w, 'h': h,
                      'scene': scene,
                      'kind': 'body' if (inb or scene == 'band' or _is_body(gray, inb, x0, y0, w, h)) else 'plain'})

    for group in horiz:
        for b in group:
            x0, x1, y0, y1 = b
            add(x0, y0, x1, y1)
    for group in free:
        for poly in group:
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            add(min(xs), min(ys), max(xs), max(ys))

    boxes = merge_fragments(boxes, page_w=W, page_h=H)   # 合并碎片(带面积/填充率约束)
    # 合并后重新判定类型(气泡内=正文,气泡外=拟声词)
    for b in boxes:
        try:
            inb = in_bubble(labels, stats, holes, H, W,
                            b['x'], b['y'], b['w'], b['h'], gray=gray)
            if b.get('scene') == 'band' or inb:
                b['kind'] = 'body'
            else:
                b['kind'] = 'body' if _is_body(gray, inb, b['x'], b['y'], b['w'], b['h']) else 'plain'
        except Exception:
            b.setdefault('kind', 'body')
    try:
        import provenance
        _pdir = os.environ.get('MANGA_DATA_DIR') or os.path.dirname(os.path.abspath(path))
        provenance.log(_pdir, 'detect',
                       '本地 CRAFT 检测器(easyocr)', None,
                       'mode=%s · %d 框 · 丢弃 %d' % (mode, len(boxes), dropped))
    except Exception:
        pass
    print(json.dumps({'boxes': boxes, 'dropped': dropped, 'mode': mode}, ensure_ascii=False))


if __name__ == '__main__':
    main()
