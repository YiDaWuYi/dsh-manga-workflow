# -*- coding: utf-8 -*-
"""免费在线翻译工具(多引擎并行):把 ocr_text.json 的日文原文翻成中文,写入 trans.json。

用法:
    python translate.py <文件夹> [--page KEY] [--engines google,mymemory] [--proxy URL]

不带 --page 时翻译整本;带 --page 时只翻译该页并合并(不覆盖其它页)。
多条引擎并发查询,取最先返回的成功结果。
"""
import sys, os, json, time, urllib.parse, urllib.request, ssl
from concurrent.futures import ThreadPoolExecutor, as_completed

EXTS = ('.webp', '.png', '.jpg', '.jpeg', '.bmp')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'


def _load(path):
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding='utf-8'))
        except Exception:
            return {}
    return {}


def _opener(proxy):
    handlers = []
    if proxy:
        handlers.append(urllib.request.ProxyHandler({'http': proxy, 'https': proxy}))
    handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    return urllib.request.build_opener(*handlers)


def _fetch_json(url, opener, timeout=8):
    req = urllib.request.Request(url, headers={'User-Agent': UA,
                                               'Accept': 'application/json,text/plain,*/*'})
    with opener.open(req, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw.decode('utf-8', 'replace'))


def google(text, opener, sl='ja'):
    url = ('https://translate.googleapis.com/translate_a/single?client=gtx'
           f'&sl={sl}&tl=zh-CN&dt=t&q=' + urllib.parse.quote(text))
    data = _fetch_json(url, opener)
    segs = data[0] if data and isinstance(data[0], list) else []
    return ''.join(s[0] for s in segs if s and s[0]).strip()


def mymemory(text, opener, sl='ja'):
    url = ('https://api.mymemory.translated.net/get?q=' + urllib.parse.quote(text)
           + f'&langpair={sl}|zh-CN')
    data = _fetch_json(url, opener)
    return (data.get('responseData') or {}).get('translatedText', '').strip()


ENGINES = {
    'google': ('Google', google),
    'mymemory': ('MyMemory', mymemory),
}
DEFAULT_ENGINES = ['google', 'mymemory']


_fail = {}          # 引擎连续失败计数
_FAIL_LIMIT = 2     # 连续失败多少次后跳过该引擎


def _alive(e):
    return _fail.get(e, 0) < _FAIL_LIMIT


def translate_one(text, engines, opener, ex, sl='ja'):
    text = (text or '').strip()
    if not text:
        return ''
    if not engines:
        return ''
    usable = [e for e in engines if _alive(e)]
    if not usable:
        usable = engines[:1]        # 全熔断了再试一次,避免永久跳过
    futs = {}
    for e in usable:
        name, fn = ENGINES[e]
        futs[ex.submit(fn, text, opener, sl)] = e
    # 取最先返回的成功结果(多引擎并行)
    for fut in as_completed(futs):
        e = futs[fut]
        try:
            r = fut.result()
        except Exception:
            _fail[e] = _fail.get(e, 0) + 1
            continue
        if r and r.strip():
            _fail[e] = 0
            return r.strip()
        _fail[e] = _fail.get(e, 0) + 1
    return ''


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '.'
    only_page = None
    if '--page' in sys.argv:
        only_page = sys.argv[sys.argv.index('--page') + 1]
    proxy = None
    if '--proxy' in sys.argv:
        proxy = sys.argv[sys.argv.index('--proxy') + 1] or None
    engines = DEFAULT_ENGINES
    if '--engines' in sys.argv:
        picked = sys.argv[sys.argv.index('--engines') + 1].split(',')
        engines = [e.strip() for e in picked if e.strip() in ENGINES] or DEFAULT_ENGINES

    sl = 'ja'
    if '--from' in sys.argv:
        sl = sys.argv[sys.argv.index('--from') + 1]
    else:
        try:
            sl = _load(os.path.join(src, 'config.json')).get('lang', 'ja')
        except Exception:
            sl = 'ja'

    ocr = _load(os.path.join(src, 'ocr_text.json'))
    if not ocr:
        print('缺少 ocr_text.json,请先运行自动识别')
        return 2
    trans_file = os.path.join(src, 'trans.json')
    trans = _load(trans_file)
    pages = [only_page] if (only_page and only_page in ocr) else (
        [] if only_page else sorted(ocr.keys()))

    opener = _opener(proxy)
    ex = ThreadPoolExecutor(max_workers=max(4, len(engines) * 3))
    total = 0
    fail = 0
    for pi, page in enumerate(pages, 1):
        texts = ocr.get(page, [])
        old = trans.get(page, [])
        out = []
        for i, t in enumerate(texts):
            if i < len(old) and str(old[i]).strip():
                out.append(old[i])
                continue
            zh = translate_one(t, engines, opener, ex, sl)
            out.append(zh)
            if zh:
                total += 1
            elif str(t).strip():
                fail += 1
        trans[page] = out
        print(f'进度 {pi}/{len(pages)} 第{page}页 翻译{len(out)}条', flush=True)
        json.dump(trans, open(trans_file, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    ex.shutdown(wait=False)
    dead = [e for e in engines if _fail.get(e, 0) >= _FAIL_LIMIT]
    if dead:
        print('引擎跳过(连续失败):', ','.join(dead), flush=True)
    print(json.dumps({'pages': len(pages), 'translated': total, 'failed': fail,
                      'engines': engines, 'proxy': bool(proxy),
                      'skipped': dead}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
