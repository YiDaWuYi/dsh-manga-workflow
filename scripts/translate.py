# -*- coding: utf-8 -*-
"""免费在线翻译工具(多引擎并行):把 ocr_text.json 的日文原文翻成中文,写入 trans.json。

用法:
    python translate.py <文件夹> [--page KEY] [--engines google,mymemory] [--proxy URL]

不带 --page 时翻译整本;带 --page 时只翻译该页并合并(不覆盖其它页)。
多条引擎并发查询,取最先返回的成功结果。
"""
import sys, os, json, time, urllib.parse, urllib.request, ssl
from concurrent.futures import ThreadPoolExecutor, as_completed


def _dd(p):
    """工作数据目录:项目库模式由 MANGA_DATA_DIR 指定(源目录只读),否则退回源目录。"""
    return os.environ.get('MANGA_DATA_DIR') or p

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


# ---------------- AI 翻译(OpenAI 兼容接口) ----------------
AI_SYS_PROMPT = (
    '你是资深漫画汉化译员。把给的日文台词逐条翻译成简体中文:'
    '口语自然、符合角色语气,保留感叹号/问号/省略号等情绪标点,人名前后统一。'
    '只输出一个 JSON 数组(字符串数组),长度必须与输入一致,不要任何解释或 Markdown。'
)


def _ai_cfg(src, args=None):
    """读取 AI 翻译配置:显式参数 > 文件夹内 _trans_ai.json > manga_tool/_trans_cfg.json > modlens 视觉配置。"""
    args = args or {}
    cfg = {}
    # 文件夹级
    cfg.update({k: v for k, v in _load(os.path.join(src, '_trans_ai.json')).items() if v})
    # 双端共享设置 ~/.manga-workflow/trans.json 里的 ai 段(桌面设置/网页设置都写这里)
    shared = _load(os.path.join(os.path.expanduser('~'), '.manga-workflow', 'trans.json'))
    cfg.update({k: v for k, v in (shared.get('ai') or {}).items() if v})
    # 工具级(manga_tool/_trans_cfg.json 里的 ai 段)
    here = os.path.dirname(os.path.abspath(__file__))
    tc = _load(os.path.join(here, '_trans_cfg.json'))
    cfg.update({k: v for k, v in (tc.get('ai') or {}).items() if v})
    # 已配置的视觉引擎(OpenAI 兼容)可复用
    if not (cfg.get('baseUrl') and cfg.get('apiKey')):
        ml = _load(os.path.expanduser(r'~\.modlens\config.json'))
        pv = (ml.get('providers') or {}).get('openai') or {}
        for k in ('baseUrl', 'apiKey', 'model'):
            if not cfg.get(k) and pv.get(k):
                cfg[k] = pv[k]
    # 命令行/环境变量
    if args.get('base'):
        cfg['baseUrl'] = args['base']
    if args.get('key'):
        cfg['apiKey'] = args['key']
    if args.get('model'):
        cfg['model'] = args['model']
    os.environ.get('DSH_TRANS_AI_KEY') and cfg.__setitem__('apiKey', os.environ['DSH_TRANS_AI_KEY'])
    return cfg if (cfg.get('baseUrl') and cfg.get('apiKey') and cfg.get('model')) else None


def _post_json(url, payload, api_key, timeout=120):
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST', headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + api_key,
        'User-Agent': UA,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode('utf-8', 'replace')[:300]
        except Exception:
            detail = ''
        raise RuntimeError('HTTP %s %s' % (e.code, detail)) from None


def _parse_json_array(text):
    """从模型输出里抠出 JSON 字符串数组。"""
    if not text:
        return None
    t = text.strip()
    if t.startswith('```'):
        t = t.split('```')[1] if '```' in t[3:] else t.strip('`')
        t = t.strip()
    try:
        v = json.loads(t)
        if isinstance(v, list):
            return [str(x) for x in v]
    except Exception:
        pass
    i, j = t.find('['), t.rfind(']')
    if i >= 0 and j > i:
        try:
            v = json.loads(t[i:j + 1])
            if isinstance(v, list):
                return [str(x) for x in v]
        except Exception:
            pass
    return None


def ai_batch(texts, cfg, sl='ja', chunk=20, page_hint=''):
    """把一批原文一次性交给 AI 翻译,返回与输入等长的中文数组(失败返回 None)。"""
    out = []
    for start in range(0, len(texts), chunk):
        part = texts[start:start + chunk]
        url = cfg['baseUrl'].rstrip('/') + '/chat/completions'
        payload = {
            'model': cfg.get('model'),
            'messages': [
                {'role': 'system', 'content': AI_SYS_PROMPT},
                {'role': 'user', 'content': json.dumps(
                    {'source_lang': sl, 'page': page_hint, 'texts': part},
                    ensure_ascii=False)},
            ],
        }
        try:
            resp = _post_json(url, payload, cfg['apiKey'])
            content = (((resp.get('choices') or [{}])[0].get('message') or {}).get('content') or '')
        except Exception as e:
            print('  [AI] 请求失败:', str(e)[:160], flush=True)
            return None
        arr = _parse_json_array(content)
        if not arr or len(arr) != len(part):
            print('  [AI] 返回格式异常,条数 %s/%s' % (
                len(arr) if arr else '?', len(part)), flush=True)
            return None
        out.extend(arr)
    return out


ENGINES = {
    'ai': ('外接 AI 接口', None),
    'dsh': ('交给 DSH 会话 AI(桌面端导出请求)', None),
    'google': ('Google', google),
    'mymemory': ('MyMemory', mymemory),
}
FREE_ENGINES = ['google', 'mymemory']
# 优先级:数字小=优先。DSH/外接 API 最高,免费渠道最低(只做兜底/对比)
PRIORITY = {'dsh': 0, 'ai': 0, 'google': 1, 'mymemory': 1}
DEFAULT_ENGINES = ['dsh', 'ai', 'google', 'mymemory']


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


def translate_all_engines(text, engines, opener, sl='ja', workers=4):
    """免费渠道并行翻译,返回 {engine: 译文}(用于对比)。"""
    out = {}
    fns = {}
    for e in engines:
        name, fn = ENGINES.get(e, (e, None))
        if fn is None:
            continue
        fns[e] = fn
    if not fns:
        return out
    with ThreadPoolExecutor(max_workers=min(workers, len(fns))) as ex2:
        futs = {ex2.submit(fn, text, opener, sl): e for e, fn in fns.items()}
        for fut, e in futs.items():
            try:
                out[e] = (fut.result() or '').strip()
            except Exception:
                out[e] = ''
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '.'
    only_page = None
    if '--page' in sys.argv:
        only_page = sys.argv[sys.argv.index('--page') + 1]
    proxy = None
    if '--proxy' in sys.argv:
        proxy = sys.argv[sys.argv.index('--proxy') + 1] or None
    ai_base = ai_key = ai_model = None
    for flag, key in (('--ai-base', 'base'), ('--ai-key', 'key'), ('--ai-model', 'model')):
        if flag in sys.argv:
            val = sys.argv[sys.argv.index(flag) + 1]
            if key == 'base':
                ai_base = val
            elif key == 'key':
                ai_key = val
            else:
                ai_model = val
    engines = DEFAULT_ENGINES
    if '--engines' in sys.argv:
        picked = sys.argv[sys.argv.index('--engines') + 1].split(',')
        engines = [e.strip() for e in picked if e.strip() in ENGINES] or DEFAULT_ENGINES
    free_engines = [e for e in engines if e in FREE_ENGINES]

    sl = 'ja'
    if '--from' in sys.argv:
        sl = sys.argv[sys.argv.index('--from') + 1]
    else:
        try:
            sl = _load(os.path.join(_dd(src), 'config.json')).get('lang', 'ja')
        except Exception:
            sl = 'ja'

    overwrite = '--overwrite' in sys.argv
    ocr = _load(os.path.join(_dd(src), 'ocr_text.json'))
    if not ocr:
        print('缺少 ocr_text.json,请先运行自动识别')
        return 2
    trans_file = os.path.join(_dd(src), 'trans.json')
    trans = _load(trans_file)
    regions = _load(os.path.join(_dd(src), 'regions.json')) or {}
    try:
        from boxtools import is_noise_box
    except Exception:
        def is_noise_box(*a, **k):
            return False
    pages = [only_page] if (only_page and only_page in ocr) else (
        [] if only_page else sorted(ocr.keys()))

    opener = _opener(proxy)
    ex = ThreadPoolExecutor(max_workers=max(4, max(1, len(free_engines)) * 3))
    total = 0
    fail = 0
    alt_page = {}
    ai_cfg = _ai_cfg(src, {'base': ai_base, 'key': ai_key, 'model': ai_model}) if 'ai' in engines else None
    if 'ai' in engines:
        print('AI 翻译引擎:', (ai_cfg or {}).get('model', '未配置'), flush=True)
        if not ai_cfg:
            print('  [提示] 未找到 AI 配置(可用 _trans_ai.json 或设置里的视觉引擎),改用免费引擎', flush=True)

    for pi, page in enumerate(pages, 1):
        texts = ocr.get(page, [])
        old = trans.get(page, [])
        out = ([] if overwrite else (list(old) if old else [])) or ['' for _ in texts]
        if overwrite:
            out = ['' for _ in texts]
        while len(out) < len(texts):
            out.append('')
        todo = [i for i, t in enumerate(texts) if str(t).strip() and not str(out[i]).strip()]
        # 噪音框(页码/水印/UI/小碎框)不翻译,省额度也避免嵌到画面上
        _bs = regions.get(page) or []
        _skip = [i for i in todo if i < len(_bs) and is_noise_box(_bs[i], texts[i])]
        if _skip:
            todo = [i for i in todo if i not in _skip]
            print('  [跳过噪音] %s 页 %d 框(页码/UI/小碎框)' % (page, len(_skip)), flush=True)
        if todo and ai_cfg:
            zh_list = ai_batch([str(texts[i]) for i in todo], ai_cfg, sl, page_hint=page)
            if zh_list:
                for k, i in enumerate(todo):
                    out[i] = zh_list[k]
                    total += 1
            else:
                print('  [AI] 本页失败,改用免费引擎', flush=True)
        # 免费渠道:只补 AI 没翻出来的;若选了多个免费渠道,额外记录各渠道译文供对比
        need_free = [i for i in todo if not str(out[i]).strip()]
        if need_free and free_engines:
            collect_alt = len(free_engines) >= 2
            for i in need_free:
                zh = translate_one(texts[i], free_engines, opener, ex, sl)
                out[i] = zh
                if zh:
                    total += 1
                elif str(texts[i]).strip():
                    fail += 1
                if collect_alt:
                    alts = translate_all_engines(str(texts[i]), free_engines, opener, sl)
                    alt_page.setdefault(page, []).append({'i': i, 'src': str(texts[i]), 'alts': alts})
        trans[page] = out
        print(f'进度 {pi}/{len(pages)} 第{page}页 翻译{len(out)}条', flush=True)
        json.dump(trans, open(trans_file, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    if alt_page:
        try:
            json.dump(alt_page, open(os.path.join(_dd(src), 'trans_alt.json'), 'w', encoding='utf-8'),
                      ensure_ascii=False, indent=1)
            print('免费渠道对比已写入 trans_alt.json', flush=True)
        except Exception:
            pass
    ex.shutdown(wait=False)
    dead = [e for e in engines if _fail.get(e, 0) >= _FAIL_LIMIT]
    if dead:
        print('引擎跳过(连续失败):', ','.join(dead), flush=True)
    try:
        import provenance
        provenance.log(_dd(src), 'translate', '翻译引擎: ' + ','.join(engines),
                       list(pages), '译 %d 框 / 失败 %d' % (total, fail))
    except Exception:
        pass
    print(json.dumps({'pages': len(pages), 'translated': total, 'failed': fail,
                      'engines': engines, 'proxy': bool(proxy),
                      'skipped': dead}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
