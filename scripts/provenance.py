# -*- coding: utf-8 -*-
"""记录每一步的来源(本地 OCR / 视觉引擎 / DSH 翻译 / DSH 嵌字),用于出图后给报告标注。

数据写在数据目录(MANGA_DATA_DIR)的 provenance.json,不做任何判定,只追加事件。
"""
import json
import os
import time


def _f(data_dir):
    return os.path.join(data_dir, 'provenance.json')


def load(data_dir):
    try:
        with open(_f(data_dir), encoding='utf-8') as fp:
            return json.load(fp)
    except Exception:
        return {'events': []}


def log(data_dir, kind, source, pages=None, detail=''):
    """kind: detect|ocr|translate|embed ; source: 人可读的来源名。"""
    try:
        os.makedirs(data_dir, exist_ok=True)
        d = load(data_dir)
        d.setdefault('events', []).append({
            'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
            'kind': kind, 'source': source,
            'pages': list(pages) if pages else [],
            'detail': detail,
        })
        d['events'] = d['events'][-200:]
        with open(_f(data_dir), 'w', encoding='utf-8') as fp:
            json.dump(d, fp, ensure_ascii=False, indent=1)
    except Exception:
        pass


def last(data_dir, kind):
    for e in reversed(load(data_dir).get('events', [])):
        if e.get('kind') == kind:
            return e
    return None


def summary(data_dir):
    """返回给用户看的来源标注(纯文本行列表)。"""
    ev = load(data_dir).get('events', [])
    rows = []
    for kind, label in (('detect', '标框'), ('ocr', '原文识别'),
                        ('translate', '翻译'), ('embed', '嵌字')):
        e = None
        for x in reversed(ev):
            if x.get('kind') == kind:
                e = x
                break
        if e is None:
            rows.append('%s: 未执行(继承已有数据)' % label)
        else:
            rows.append('%s: %s%s' % (label, e.get('source'),
                                      (' · ' + e['detail']) if e.get('detail') else ''))
    return rows


def markdown(data_dir):
    ev = load(data_dir).get('events', [])
    lines = ['## 本次出图来源标注', '']
    for r in summary(data_dir):
        lines.append('- ' + r)
    if ev:
        lines += ['', '### 事件流水(最近 10 条)', '']
        for e in ev[-10:]:
            lines.append('- `%s` %s → %s%s' % (e.get('ts'), e.get('kind'),
                                              e.get('source'),
                                              (' | ' + e['detail']) if e.get('detail') else ''))
    return '\n'.join(lines)


def write_markdown(data_dir, filename='provenance_report.md'):
    try:
        p = os.path.join(data_dir, 'out')
        os.makedirs(p, exist_ok=True)
        path = os.path.join(p, filename)
        with open(path, 'w', encoding='utf-8') as fp:
            fp.write(markdown(data_dir) + '\n')
        return path
    except Exception:
        return None
