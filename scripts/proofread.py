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
                warns.append(f"{p}[{i}]: 译文与原文完全相同(可能没翻译)")
            # 超长
            cap = _capacity(b)
            if len(zh) > cap * 1.5:
                warns.append(f"{p}[{i}]: 译文 {len(zh)} 字,框估计只能放 {cap} 字,可能溢出")
            # 框异常小
            if int(b.get('w', 0)) < 6 or int(b.get('h', 0)) < 6:
                warns.append(f"{p}[{i}]: 框异常小 {b.get('w')}x{b.get('h')}")
    for p in pages:
        if _page_ext(src, p) is None:
            issues.append(("error", f"{p}: regions 里有,但找不到对应图片"))
    auto_total = sum(1 for p in pages for b in regions[p] if b.get('auto'))
    if auto_total:
        warns.append(f"有 {auto_total} 个自动标框的框(auto)不参与嵌字,如要参与请双击改字确认")
    return issues, warns


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
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["ok"] else 1


if __name__ == '__main__':
    sys.exit(main())
