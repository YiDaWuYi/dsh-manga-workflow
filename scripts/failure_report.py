# -*- coding: utf-8 -*-
"""OCR/翻译失败报告:把「框有、字没认出来」「认出来但没译文」「兜底也失败」的框汇总成
`ocr_failure_report.json` + `.md`,供 DSH/助手直接读取并接管处理。

用法:
    python failure_report.py <书目录> [--page 00000003] [--quiet]
退出码: 有失败=0(仍写出报告),数据缺失=2。
"""
import json, os, sys, time

def _dd(src):
    d = os.environ.get('MANGA_DATA_DIR') or ''
    return d if d and os.path.isdir(d) else src

def _load(p, default):
    try:
        return json.load(open(p, encoding='utf-8'))
    except Exception:
        return default

def build(src, only_page=''):
    data = _dd(src)
    reg = _load(os.path.join(data, 'regions.json'), {})
    ocr = _load(os.path.join(data, 'ocr_text.json'), {})
    tr = _load(os.path.join(data, 'trans.json'), {})
    fb = _load(os.path.join(data, 'ocr_fallback_done.json'), {})
    fb_keys = (fb or {}).get('keys', {}) if isinstance(fb, dict) else {}
    items, counts = [], {'ocr_empty': 0, 'fallback_failed': 0, 'ocr_suspect': 0, 'trans_missing': 0}
    pages = sorted(reg) if not only_page else [p for p in sorted(reg) if p == only_page]
    total = 0
    for pg in pages:
        boxes = reg.get(pg, []) or []
        o = ocr.get(pg, []) or []
        t = tr.get(pg, []) or []
        for i, b in enumerate(boxes):
            total += 1
            ot = str((o[i] if i < len(o) else '') or '').strip()
            tt = str((t[i] if i < len(t) else '') or '').strip()
            geo = '%d,%d,%d,%d' % (b.get('x', 0), b.get('y', 0), b.get('w', 0), b.get('h', 0))
            fk = '%s|%d|%s' % (pg, i, geo)
            why = (fb_keys.get(fk) or {}).get('why', '') if isinstance(fb_keys, dict) else ''
            reason = ''
            if not ot:
                reason = 'ocr_empty'
                if why in ('empty-out', 'failed', 'no-output'):
                    reason = 'fallback_failed'
            elif why in ('empty-out', 'failed', 'no-output'):
                # OCR 有字,但视觉兜底认为框内空白/失败 -> 多半是识别错了(装饰字、反白、透字)
                reason = 'ocr_suspect'
            elif not tt:
                reason = 'trans_missing'
            if not reason:
                continue
            counts[reason] += 1
            items.append({
                'page': pg, 'index': i,
                'box': {'x': b.get('x', 0), 'y': b.get('y', 0), 'w': b.get('w', 0), 'h': b.get('h', 0)},
                'kind': b.get('kind', 'body'), 'cover': b.get('cover', ''),
                'ocr': ot, 'trans': tt,
                'reason': reason,
                'fallback': why,
                'hint': _hint(reason),
            })
    # 细分归类:同样的报告给面板与 DSH 用,避免两边建议不一致
    import re as _re
    def _cls(it):
        ocr = (it.get('ocr') or '').strip()
        b = it.get('box') or {}
        if it.get('reason') == 'ocr_suspect' and it.get('kind') == 'title':
            return 'decorative'
        if it.get('reason') == 'ocr_suspect':
            return 'suspect'
        if not ocr:
            return 'ocr_empty'
        if _re.fullmatch(r'[0-9０-９\s\W_]+', ocr) or _re.fullmatch(r'[A-Za-zＡ-Ｚａ-ｚ0-9０-９\s\W_]+', ocr):
            return 'noise'
        if (b.get('w') or 0) < 40 or (b.get('h') or 0) < 25:
            return 'noise'
        return 'untranslated'
    cls_counts = {'untranslated': 0, 'noise': 0, 'decorative': 0, 'suspect': 0, 'ocr_empty': 0}
    for it in items:
        it['cls'] = _cls(it)
        cls_counts[it['cls']] = cls_counts.get(it['cls'], 0) + 1
        if it['cls'] == 'noise':
            it['skip_suggested'] = True
    rep = {
        'version': 1,
        'generated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'book': os.path.basename(os.path.normpath(src)),
        'data_dir': data,
        'pages_scanned': len(pages),
        'boxes_total': total,
        'failure_counts': counts,
        'class_counts': cls_counts,
        'failures_total': len(items),
        'items': items,
        'how_to_fix': {
            'ocr_empty': '框里没认出字:先确认框位置有字;可对该框用「单页识图/视觉兜底」,或手填原文。',
            'fallback_failed': '视觉兜底也没给出结果:多为装饰字/艺术字,建议手填原文或换框。',
            'ocr_suspect': '原文有字但视觉兜底判定框内为空:多为装饰字/反白字被认错,建议对照原图手改原文。',
            'trans_missing': '有原文但没译文:对该页跑「翻译」,或手填译文(双击框编辑)。',
        },
        'advisory': [
            ('untranslated', cls_counts['untranslated'], '未翻译正文/拟声:跑一次「整本 翻译」即可,无需手工。'),
            ('noise', cls_counts['noise'], '页码/水印/UI/小碎框:已自动跳过翻译与嵌字(不会盖到画面上);想彻底清掉可在面板右键删框。'),
            ('decorative', cls_counts['decorative'], '装饰字/艺术字页(如目录):OCR 不可靠,建议手填原文或留原样。'),
            ('suspect', cls_counts['suspect'], 'OCR 文本其实像正常台词,是视觉兜底误判「空框」:可忽略,不必逐条改。'),
            ('ocr_empty', cls_counts['ocr_empty'], '框内确实没字:手填原文,或删框。'),
        ],
    }
    return rep

def _hint(reason):
    return {
        'ocr_empty': 'OCR 未识别出文字 → 手填原文 / 单页识图兜底',
        'fallback_failed': 'OCR 与视觉兜底都失败 → 手填原文,或调整框',
        'ocr_suspect': 'OCR 文本可疑(兜底判定为空)→ 对照原图手改原文',
        'trans_missing': '有原文但缺译文 → 跑翻译或手填译文',
    }.get(reason, '')

def _write(src, rep):
    data = rep['data_dir']
    jp = os.path.join(data, 'ocr_failure_report.json')
    mp = os.path.join(data, 'ocr_failure_report.md')
    json.dump(rep, open(jp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    c = rep['failure_counts']
    lines = [
        '# OCR / 翻译失败报告',
        '',
        '- 生成时间:%s' % rep['generated_at'],
        '- 书:%s' % rep['book'],
        '- 扫描页:%d,框总数:%d,失败:%d' % (rep['pages_scanned'], rep['boxes_total'], rep['failures_total']),
        '- 分类:OCR 空 %d / 兜底失败 %d / 疑似识别错 %d / 缺译文 %d' % (
            c['ocr_empty'], c['fallback_failed'], c['ocr_suspect'], c['trans_missing']),
        '',
    ]
    if rep['items']:
        lines += ['| 页 | # | 框(x,y,w,h) | 类型 | 原因 | 兜底 | 原文 | 译文 |', '|---|---|---|---|---|---|---|---|']
        for it in rep['items'][:400]:
            b = it['box']
            lines.append('| %s | %d | %d,%d,%d,%d | %s | %s | %s | %s | %s |' % (
                it['page'], it['index'], b['x'], b['y'], b['w'], b['h'],
                it['kind'], it['reason'], it['fallback'] or '-',
                (it['ocr'] or '').replace('|', '/'), (it['trans'] or '').replace('|', '/')))
        if len(rep['items']) > 400:
            lines.append('| … | | | | | | | 共 %d 条,见 json |' % len(rep['items']))
    cc = rep.get('class_counts') or {}
    lines += ['', '## 细分归类', '']
    for k, c in cc.items():
        if c: lines.append('- %s:%d' % (k, c))
    lines += ['', '## 建议处理', '']
    for k, c, text in (rep.get('advisory') or []):
        if c: lines.append('- **%s** %d 条:%s' % (k, c, text))
    for k, v in rep['how_to_fix'].items():
        lines.append('- **%s**:%s' % (k, v))
    open(mp, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return jp, mp

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    src = args[0] if args else '.'
    only = ''
    if '--page' in sys.argv:
        i = sys.argv.index('--page')
        if i + 1 < len(sys.argv):
            only = sys.argv[i + 1]
    rep = build(src, only)
    if '--print' in sys.argv:
        import json as _json
        print(_json.dumps(rep, ensure_ascii=False))
        return 0
    jp, mp = _write(src, rep)
    if '--quiet' not in sys.argv:
        c = rep['failure_counts']
        print('[失败报告] %s' % jp)
        print('[失败报告] 框 %d 个,失败 %d 个(OCR 空 %d / 兜底失败 %d / 疑似错 %d / 缺译文 %d)' % (
            rep['boxes_total'], rep['failures_total'], c['ocr_empty'], c['fallback_failed'],
            c.get('ocr_suspect', 0), c['trans_missing']))
        cc = rep.get('class_counts') or {}
        print('[失败报告] 细分:未翻译 %d / 噪音(建议排除) %d / 装饰字 %d / 疑似误判 %d' % (
            cc.get('untranslated', 0), cc.get('noise', 0), cc.get('decorative', 0), cc.get('suspect', 0)))
    return 0 if rep['boxes_total'] else 2

if __name__ == '__main__':
    sys.exit(main())
