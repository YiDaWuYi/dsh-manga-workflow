# -*- coding: utf-8 -*-
"""嵌字流程校对工具。

用法:
    python proofread.py <文件夹> [--stage pre|post] [--mode orig|both] [--lama]

stage:
    pre  = 嵌字前(标注/OCR/译文检查)
    post = 嵌字后(先做原文/译文检查,再检查输出页)

mode:
    orig = 只校对原文(OCR 识别文本)
    both = 校对原文 + 对照中文译文(默认)

输出: 人类可读报告 + 最后一行 JSON 摘要 {"ok": bool, "issues": n}
"""
import sys, os, json
import re
import numpy as np
from PIL import Image

EXTS = ('.webp', '.png', '.jpg', '.jpeg', '.bmp')


def _load(path):
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding='utf-8'))
        except Exception:
            return {}
    return {}


def _page_ext(src, key):
    for ext in EXTS:
        if os.path.exists(os.path.join(src, key + ext)):
            return key + ext
    return None


def _capacity(b):
    w = max(1, int(b.get('w', 1)))
    h = max(1, int(b.get('h', 1)))
    size = max(6, int(b.get('size', 20) or 20))
    if b.get('vertical', True):
        cols = max(1, w // size)
        per_col = max(1, int(h / (size * 1.15)))
        return cols * per_col
    rows = max(1, int(h / (size * 1.15)))
    per_row = max(1, w // size)
    return rows * per_row


def _looks_garbled(t):
    """粗判 OCR 原文是否可疑:只有空文本或纯标点才可疑。"""
    s = str(t).strip()
    if not s:
        return True
    alnum = sum(1 for c in s if c.isalnum() or '\u3040' <= c <= '\u30ff' or '\u4e00' <= c <= '\u9fff')
    if alnum == 0:
        return True       # 纯标点/符号
    return False


def check_original(src, regions):
    """校对①原文:OCR 文本是否齐全/疑似失败。"""
    issues, warns = [], []
    ocr = _load(os.path.join(src, 'ocr_text.json'))
    pages = [p for p in regions if isinstance(regions[p], list) and regions[p]]
    if not ocr:
        warns.append("缺少 ocr_text.json(还没做自动识别)")
        return issues, warns
    for p in pages:
        texts = ocr.get(p, [])
        n = len(regions[p])
        if len(texts) < n:
            issues.append(("error", f"{p}: OCR 原文 {len(texts)} 条 < 框 {n} 个"))
        for i in range(min(n, len(texts))):
            t = texts[i]
            if _looks_garbled(t):
                # 本来就没有日文/中文的原文(纯符号、拟声标注、英文标题)不算识别失败
                import re as _re
                if not _re.search(r'[\u3040-\u30ff\u4e00-\u9fff]', str(t or '')):
                    continue
                warns.append(f"{p}[{i}]: 原文可疑(可能识别失败): {str(t)[:20]!r}")
    return issues, warns


def check_translation(src, regions):
    """校对②原文对照中文译文:缺译、数量不符、疑似过长、疑似未翻译。"""
    issues, warns = [], []
    trans = _load(os.path.join(src, 'trans.json'))
    ocr = _load(os.path.join(src, 'ocr_text.json'))
    pages = [p for p in regions if isinstance(regions[p], list) and regions[p]]
    if not trans:
        issues.append(("error", "缺少 trans.json(还没有译文)"))
        return issues, warns
    for p in pages:
        boxes = regions[p]
        t = trans.get(p, [])
        if not t:
            issues.append(("error", f"{p}: 整页没有译文"))
            continue
        if len(t) < len(boxes):
            issues.append(("error", f"{p}: 译文 {len(t)} 条 < 框 {len(boxes)} 个"))
        empty_idx = [i for i in range(min(len(t), len(boxes)))
                     if not str(t[i]).strip()
                     and not (boxes[i].get('sfx') or boxes[i].get('nobox') or boxes[i].get('points')
                              or not boxes[i].get('erase', not boxes[i].get('nobox', False)))]
        if empty_idx:
            issues.append(("error", f"{p}: {len(empty_idx)} 个框没有译文 {empty_idx[:12]}"))
        texts = ocr.get(p, [])
        for i, b in enumerate(boxes):
            if i >= len(t) or not str(t[i]).strip():
                continue
            zh = str(t[i])
            # 译文疑似与原文相同(没翻译)
            if i < len(texts) and zh.strip() == str(texts[i]).strip():
                # 原文本身是符号/拟声(无日文假名或汉字)→ 保留原文是合法的,不告警
                if re.search(r'[\u3040-\u30ff\u4e00-\u9fff]', str(texts[i])):
                    warns.append(f"{p}[{i}]: 译文与原文完全相同(可能没翻译)")
            # 超长(拟声词允许少量溢出,不再告警)
            cap = _capacity(b)
            _is_plain = (b.get('kind') == 'plain') or bool(b.get('sfx')) or bool(b.get('nobox'))
            if (not _is_plain) and len(zh) > cap * 1.5:
                warns.append(f"{p}[{i}]: 译文 {len(zh)} 字,框估计只能放 {cap} 字,可能溢出")
            # 框异常小
            if int(b.get('w', 0)) < 6 or int(b.get('h', 0)) < 6:
                warns.append(f"{p}[{i}]: 框异常小 {b.get('w')}x{b.get('h')}")
            # ---- 译文质量自检(抓"明显不对"的译文)----
            src_text = str(texts[i]) if i < len(texts) else ''
            # 纯标点/符号的译文(如「……」「！！」)是合法的,跳过质量检查
            only_punct = not re.search(r'[A-Za-z0-9\u3040-\u30ff\u4e00-\u9fff]', zh)
            if src_text.strip() and not only_punct:
                # ① 译文里没有中文(大概率没翻译/翻译失败)
                if not re.search(r'[\u4e00-\u9fff]', zh):
                    issues.append(("error", f"{p}[{i}]: 译文没有中文,疑似翻译失败: {zh[:40]!r}"))
                # ② 翻译引擎/占位符残留
                elif re.search(r'MyMemory|Google|translat|@@|\{\}|<\w+>', zh, re.I):
                    warns.append(f"{p}[{i}]: 译文疑似残留引擎文本: {zh[:40]!r}")
                # ③ 长度比例异常(太长/太短)
                else:
                    ls, lz = len(src_text.strip()), len(zh.strip())
                    if lz > max(60, ls * 4):
                        warns.append(f"{p}[{i}]: 译文过长({lz} 字,原文 {ls} 字),可能翻错")
                    elif ls >= 12 and lz <= max(1, int(ls * 0.15)):
                        warns.append(f"{p}[{i}]: 译文过短({lz} 字,原文 {ls} 字),可能翻错")
            # ④ 同一页大量重复译文
        zh_list_page = [str(x).strip() for x in t if str(x).strip()]
        if zh_list_page:
            from collections import Counter as _C
            for val, cnt in _C(zh_list_page).items():
                if cnt >= 3 and len(val) <= 6:
                    # 重复的拟声词:若这些框原文也相同,属于正常(如 4 个「扑通」)
                    _idxs = [k for k, x in enumerate(t) if str(x).strip() == val]
                    _origs = [str(texts[k]).strip() for k in _idxs if k < len(texts)]
                    if len(set(_origs)) <= 1:
                        continue
                    warns.append(f"{p}: 有 {cnt} 个框译文相同 {val!r},疑似翻译失败")
    for p in pages:
        if _page_ext(src, p) is None:
            issues.append(("error", f"{p}: regions 里有,但找不到对应图片"))
    auto_total = sum(1 for p in pages for b in regions[p] if b.get('auto'))
    if auto_total:
        warns.append(f"有 {auto_total} 个自动标框的框(auto)不参与嵌字,如要参与请双击改字确认")
    return issues, warns


def _iou(a, b):
    x0 = max(a['x'], b['x']); y0 = max(a['y'], b['y'])
    x1 = min(a['x'] + a['w'], b['x'] + b['w']); y1 = min(a['y'] + a['h'], b['y'] + b['h'])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    inter = (x1 - x0) * (y1 - y0)
    u = a['w'] * a['h'] + b['w'] * b['h'] - inter
    return inter / u if u > 0 else 0.0


def _img_size(folder, page):
    import glob
    for ext in ('.webp', '.png', '.jpg', '.jpeg'):
        fs = glob.glob(os.path.join(folder, page + ext))
        if fs:
            try:
                from PIL import Image
                with Image.open(fs[0]) as im:
                    return im.size
            except Exception:
                return None
    return None


def structural_checks(folder, regions, ocr):
    """结构问题:大框少字(疑似漏识别) + 重复/重叠框。返回问题列表。"""
    out = []
    for pg, boxes in regions.items():
        texts = ocr.get(pg) or []
        w, h = _img_size(folder, pg) or (0, 0)
        page_area = float(w * h) if w and h else 0
        for i, b in enumerate(boxes):
            t = str(texts[i] if i < len(texts) else '').strip()
            eff = len([c for c in t if c not in '．.…‥・,、。!?！？~～-—「」『』()（）[]【】:：;；\"' ])
            area = float(b.get('w', 0)) * float(b.get('h', 0))
            big = (page_area and area / page_area >= 0.02) or (b.get('w', 0) >= 150 and b.get('h', 0) >= 120)
            if big and eff <= 2:
                out.append('[问题] %s[%d] 框很大但有效字数仅 %d(可能漏识别/框错/重复框)' % (pg, i, eff))
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                if _iou(boxes[i], boxes[j]) >= 0.6:
                    out.append('[问题] %s[%d] 与 [%d] 框高度重叠(重复框?建议删一个)' % (pg, i, j))
    return out

def check_pre(src, mode='both'):
    regions = _load(os.path.join(src, 'regions.json'))
    if not regions:
        return [("error", "缺少 regions.json 或没有任何标框")], []
    pages = [p for p in regions if isinstance(regions[p], list) and regions[p]]
    if not pages:
        return [("error", "没有任何页有标框")], []
    issues, warns = check_original(src, regions)
    if mode != 'orig':
        i2, w2 = check_translation(src, regions)
        issues += i2
        warns += w2
    return issues, warns


def check_post(src, lama, mode='both'):
    # 先做原文 + 译文校对
    issues, warns = check_pre(src, mode)
    regions = _load(os.path.join(src, 'regions.json'))
    cfg = _load(os.path.join(src, 'config.json'))
    use_lama = lama or bool(cfg.get('lama'))
    out_dir = os.path.join(src, 'out_lama' if use_lama else 'out')

    if not os.path.isdir(out_dir):
        issues.append(("error", f"缺少输出目录: {out_dir}"))
        return issues, warns

    imgs = sorted(f for f in os.listdir(src) if f.lower().endswith(EXTS))
    outs = set(os.listdir(out_dir))
    missing = [f for f in imgs if os.path.splitext(f)[0] + '.png' not in outs]
    if missing:
        issues.append(("error", f"输出缺页 {len(missing)} 张: {missing[:8]}"))

    pages = [p for p in regions if isinstance(regions[p], list) and regions[p]]
    unchanged = []
    for p in pages:
        fn = _page_ext(src, p)
        outp = os.path.join(out_dir, p + '.png')
        if fn is None or not os.path.exists(outp):
            continue
        try:
            a = np.array(Image.open(os.path.join(src, fn)).convert('RGB').resize((320, 320)))
            b = np.array(Image.open(outp).convert('RGB').resize((320, 320)))
            diff = float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean())
        except Exception:
            continue
        if diff < 0.2:  # 变化太小才认为没嵌上
            unchanged.append(p)
    if unchanged:
        issues.append(("error", f"{len(unchanged)} 页有标框但输出几乎没变化(可能没嵌上): {unchanged[:8]}"))

    trans = _load(os.path.join(src, 'trans.json'))
    has_trans = [p for p in pages if any(str(x).strip() for x in (trans.get(p) or []))]
    if has_trans and not unchanged:
        warns.append(f"{len(has_trans)} 页有译文,输出均已变化")
    return issues, warns


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "."
    stage = 'pre'
    if '--stage' in sys.argv:
        stage = sys.argv[sys.argv.index('--stage') + 1]
    mode = 'both'
    if '--mode' in sys.argv:
        mode = sys.argv[sys.argv.index('--mode') + 1]
    lama = '--lama' in sys.argv

    if stage == 'post':
        issues, warns = check_post(src, lama, mode)
    else:
        issues, warns = check_pre(src, mode)

    label = '原文' if mode == 'orig' else '原文+译文'
    print(f"===== 校对({stage}, {label}) {src} =====")
    if not issues and not warns:
        print("✅ 没有发现问题")
    for level, msg in issues:
        print(f"[问题] {msg}")
    for msg in warns:
        print(f"[提示] {msg}")
    summary = {"stage": stage, "mode": mode, "ok": len(issues) == 0,
               "issues": len(issues), "warns": len(warns)}
    try:
        # 结构化报告:缺译文/结构问题,供 DSH 接管
        _reg = _load(os.path.join(src, 'regions.json'))
        _tr = _load(os.path.join(src, 'trans.json'))
        _missing = {}
        for _pg, _bs in _reg.items():
            _row = _tr.get(_pg) or []
            _idx = [i for i in range(len(_bs))
                    if not (i < len(_row) and str(_row[i]).strip())]
            if _idx:
                _missing[_pg] = _idx
        _rep = {'stage': 'pre', 'folder': src,
                'missing_translations': _missing,
                'missing_total': sum(len(v) for v in _missing.values())}
        try:
            with open(os.path.join(src, 'proofread_report.json'), 'w', encoding='utf-8') as _f:
                json.dump(_rep, _f, ensure_ascii=False, indent=1)
        except Exception:
            pass
        if _missing:
            print('  [报告] 有框缺译文: %d 页 / %d 框(见 proofread_report.json)'
                  % (len(_missing), _rep['missing_total']), flush=True)
        _struct = structural_checks(src, _reg, _load(os.path.join(src, 'ocr_text.json')))
        if _struct:
            print('  [提示] 结构性疑点 %d 条:' % len(_struct), flush=True)
            for _m in _struct[:40]:
                print('   ' + _m, flush=True)
    except Exception as _e:
        print('  [提示] 结构校验跳过: %s' % _e, flush=True)
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["ok"] else 1


if __name__ == '__main__':
    sys.exit(main())
