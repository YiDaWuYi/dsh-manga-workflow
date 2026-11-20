# -*- coding: utf-8 -*-
"""嵌字前置体检:数组对齐、缺译文清单、数字/拉丁/空译文拦截、艺术字标记。

用法: python preflight.py <本子> [--page 00000001]
输出: 打印 JSON 汇总;并写 <本子>/preflight_report.json
"""
import json
import os
import re
import sys


def _dd(p):
    """工作数据目录:项目库模式由 MANGA_DATA_DIR 指定(源目录只读),否则退回源目录。"""
    return os.environ.get('MANGA_DATA_DIR') or p

CJK = re.compile(r'[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')


def load(p, default):
    try:
        with open(p, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, (dict, list)) else default
    except Exception:
        return default


def save(p, d):
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def has_cjk(s):
    return bool(CJK.search(s or ''))


def is_art(s):
    """原文像艺术字/数字/拉丁:没有任何假名或汉字(排除纯标点)。"""
    t = (s or '').strip()
    if not t:
        return False
    if has_cjk(t):
        return False
    core = re.sub(r'[\s．.…‥・,、。!?！？~～\-—「」『』()（）\[\]【】:：;；"\']', '', t)
    return bool(core)


def main():
    args = sys.argv[1:]
    if not args:
        print('用法: preflight.py <folder> [--page key]')
        return 2
    folder = args[0]
    page_only = None
    auto_part = '--auto-participate' in args
    if '--page' in args:
        i = args.index('--page')
        if i + 1 < len(args):
            page_only = args[i + 1]

    reg = load(os.path.join(_dd(folder), 'regions.json'), {})
    ocr = load(os.path.join(_dd(folder), 'ocr_text.json'), {})
    tr = load(os.path.join(_dd(folder), 'trans.json'), {})
    pages = [page_only] if page_only else sorted(reg)

    aligned = 0
    missing = []      # (page, idx) 无译文
    invalid = []      # (page, idx, 原文译文) 译文无中文且非空(数字/拉丁)
    art = []          # (page, idx) 原文像艺术字/数字
    auto_skip = 0
    unified_total = 0

    auto_cleared = 0
    for pg in pages:
        boxes = reg.get(pg) or []
        _tr0 = tr.get(pg) if isinstance(tr.get(pg), list) else []
        for _i, _b in enumerate(boxes):
            if _b.get('auto') and _i < len(_tr0) and str(_tr0[_i] or '').strip():
                _b['auto'] = False      # 已有译文 → 视为已确认,参与嵌字
                auto_cleared += 1
        n = len(boxes)
        if not n:
            continue
        o = ocr.get(pg)
        t = tr.get(pg)
        if not isinstance(o, list):
            o = [''] * n
            aligned += 1
        if not isinstance(t, list):
            t = [''] * n
            aligned += 1
        if len(o) > n:
            o = o[:n]
            aligned += 1
        elif len(o) < n:
            o = o + [''] * (n - len(o))
            aligned += 1
        if len(t) > n:
            t = t[:n]
            aligned += 1
        elif len(t) < n:
            t = t + [''] * (n - len(t))
            aligned += 1
        ocr[pg], tr[pg] = o, t

        # 同页相同原文(拟声词)统一译名:取出现次数最多的非空译文
        from collections import Counter as _C
        groups = {}
        for i, b in enumerate(boxes):
            key = str(o[i] or '').strip()
            if key and str(t[i] or '').strip():
                groups.setdefault(key, []).append(i)
        unified = 0
        for key, idxs in groups.items():
            if len(idxs) < 2:
                continue
            vals = [str(t[i]).strip() for i in idxs]
            best = _C(vals).most_common(1)[0][0]
            for i in idxs:
                if str(t[i]).strip() != best:
                    t[i] = best
                    unified += 1
        unified_total += unified

        for i, b in enumerate(boxes):
            ot = str(o[i] or '').strip()
            tt = str(t[i] or '').strip()
            art_flag = is_art(ot)
            if art_flag:
                art.append((pg, i, ot[:12]))
            # 只有「含数字/拉丁字母且无中文」才算无效译文;纯标点(……/！？)是合法 SFX
            if tt and not has_cjk(tt) and re.search(r'[0-9A-Za-z０-９Ａ-Ｚａ-ｚ]', tt):
                # 无中文且含数字/拉丁→清空并跳过嵌字,避免把数字盖上去
                invalid.append((pg, i, ot[:12], tt[:16]))
                t[i] = ''
                if not b.get('auto'):
                    b['auto'] = True
                    auto_skip += 1
                tt = ''
            # 艺术字且没有有效译文、且不是标题(标题本来就是英文/艺术字)→ 排除嵌字
            if auto_part and tt and b.get('auto'):
                b['auto'] = False
                auto_skip += 0
            if art_flag and not tt and b.get('kind') != 'title' and not b.get('auto'):
                b['auto'] = True
                auto_skip += 1
            if not tt:
                missing.append((pg, i))

    # 备份 + 写回
    for name, data in (('ocr_text.json', ocr), ('trans.json', tr), ('regions.json', reg)):
        f = os.path.join(folder, name)
        if os.path.exists(f):
            try:
                with open(f + '.bak_preflight', 'wb') as fb:
                    fb.write(open(f, 'rb').read())
            except Exception:
                pass
        save(f, data)

    rep = {
        'folder': folder,
        'aligned': aligned,
        'missing': [{'page': p, 'idx': i} for p, i in missing],
        'missing_total': len(missing),
        'invalid': [{'page': p, 'idx': i, 'orig': o, 'trans': x} for p, i, o, x in invalid],
        'invalid_total': len(invalid),
        'art': [{'page': p, 'idx': i, 'orig': o} for p, i, o in art],
        'art_total': len(art),
        'auto_skip_added': auto_skip,
        'auto_participate': bool(auto_part),
        'unified_total': unified_total,
        'auto_cleared': auto_cleared,
    }
    save(os.path.join(folder, 'preflight_report.json'), rep)
    print(json.dumps(rep, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
