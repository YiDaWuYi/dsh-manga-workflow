# -*- coding: utf-8 -*-
"""OCR 兜底:把本地 OCR 可疑(空/极短/乱码)的框裁图交给视觉引擎重读,写回 ocr_text.json。

用法:
    python ocr_fallback.py <本子目录> [--dry-run] [--mode empty|short|all] [--min-chars 2]
                           [--max 30] [--lang ja] [--config <modlens配置路径>] [--page <页key>]

阈值来自 _ocr_cfg.json(可用参数覆盖):
    {"mode": "short", "minChars": 2, "maxPerBook": 30}

退出码 0 表示成功(即使没有候选框)。
"""
import base64
import io
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CFG_FILE = os.path.join(HERE, '_ocr_cfg.json')
DEFAULT_CFG = {'mode': 'empty', 'minChars': 1, 'maxPerBook': 30}

PROMPT = {
    'ja': '这是一格漫画里的文字。请只输出图中的日文原文,不要翻译、不要解释、不要加引号。',
    'ko': '这是一格漫画里的文字。请只输出图中的韩文原文,不要翻译、不要解释、不要加引号。',
    'en': 'This is text in a manga panel. Output only the original text, no translation, no explanation.',
}

SUSPICIOUS_CHARS = set('□■▢▣〓')
# 标点/空白不计入「核心字数」:漫画里 "..."/"。" 是合法内容
PUNCT = set('．.…‥・,、。!?！？~～-—「」『』()（）[]【】:：;；"\'’“” 　')


def load_cfg():
    cfg = dict(DEFAULT_CFG)
    try:
        with open(CFG_FILE, encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, dict):
            for k in cfg:
                if k in d:
                    cfg[k] = d[k]
    except Exception:
        pass
    return cfg


def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def modlens_cfg_path(override=None):
    if override:
        return override
    return os.path.join(os.path.expanduser('~'), '.modlens', 'config.json')


def load_vision_cfg(path):
    d = load_json(path, {})
    prov = (d.get('providers') or {}) if isinstance(d, dict) else {}
    v = prov.get('openai') if isinstance(prov.get('openai'), dict) else {}
    return {
        'baseUrl': str(v.get('baseUrl') or ''),
        'apiKey': str(v.get('apiKey') or ''),
        'model': str(v.get('model') or ''),
    }


def core_len(text):
    """去掉标点/空白后的有效字数(漫画里 "..."/"。" 属于合法内容)。"""
    return len([ch for ch in (text or '') if ch not in PUNCT and not ch.isspace()])


def _is_blank(png_bytes, std_thr=2.0, ink_thr=0.003):
    """裁剪是否空白(视觉引擎看了也是空的,不必花钱)。"""
    try:
        from PIL import Image as _I
        g = _I.open(io.BytesIO(png_bytes)).convert('L')
        arr = __import__('numpy').asarray(g, dtype='int16')
    except Exception:
        return False
    if arr.size == 0:
        return True
    if float(arr.std()) >= std_thr:
        return False
    return float((arr < 128).mean()) < ink_thr


def looks_bad(text, min_chars):
    """判断 OCR 结果是否可疑(基于真实数据校准,避免把合法的短句当失败)。"""
    t = (text or '').strip()
    if not t:
        return True, '空'
    if any(ch in SUSPICIOUS_CHARS for ch in t):
        return True, '方框乱码'
    cl = core_len(t)
    if cl < max(1, min_chars):
        return True, '极短(有效 %d 字)' % cl
    return False, ''


def crop_box(img_path, box, pad_ratio=0.12):
    from PIL import Image
    with Image.open(img_path) as im:
        im = im.convert('RGB')
        W, H = im.size
        x, y = int(box.get('x', 0)), int(box.get('y', 0))
        w, h = int(box.get('w', 0)), int(box.get('h', 0))
        px = int(w * pad_ratio)
        py = int(h * pad_ratio)
        l = max(0, x - px)
        t = max(0, y - py)
        r = min(W, x + w + px)
        b = max(0, min(H, y + h + py))
        if r <= l or b <= t:
            return None
        crop = im.crop((l, t, r, b))
        buf = io.BytesIO()
        crop.save(buf, format='PNG')
        return buf.getvalue()


def call_vision(vcfg, png_bytes, lang, timeout=60):
    """调 OpenAI 兼容视觉接口,返回 (text, usage_dict, error)。"""
    if not vcfg['baseUrl'] or not vcfg['model']:
        return '', {}, '视觉引擎未配置(baseUrl/model 为空)'
    url = vcfg['baseUrl'].rstrip('/') + '/chat/completions'
    data_url = 'data:image/png;base64,' + base64.b64encode(png_bytes).decode('ascii')
    payload = json.dumps({
        'model': vcfg['model'],
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': PROMPT.get(lang, PROMPT['ja'])},
                {'type': 'image_url', 'image_url': {'url': data_url}},
            ],
        }],
        'max_tokens': 300,
        'stream': False,
    }).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    if vcfg['apiKey']:
        headers['Authorization'] = 'Bearer ' + vcfg['apiKey']
    req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode('utf-8', 'replace')
        d = json.loads(body)
        content = ((d.get('choices') or [{}])[0].get('message') or {}).get('content') or ''
        if isinstance(content, list):   # 少数实现返回分段
            content = ''.join(str(c.get('text', '')) for c in content if isinstance(c, dict))
        usage = d.get('usage') or {}
        return str(content).strip(), usage, None
    except Exception as e:
        detail = ''
        try:
            detail = e.read().decode('utf-8', 'replace')[:200]
        except Exception:
            pass
        return '', {}, ('%s %s' % (e, detail)).strip()


def main():
    args = sys.argv[1:]
    if not args:
        print('用法: python ocr_fallback.py <本子目录> [--dry-run] [--mode empty|short|all] '
              '[--min-chars 2] [--max 30] [--lang ja] [--config path] [--page key]')
        return 2
    folder = args[0]
    if not os.path.isdir(folder):
        print('文件夹不存在:', folder)
        return 2

    dry = '--dry-run' in args
    cfg = load_cfg()
    mode = cfg['mode']
    min_chars = int(cfg['minChars'])
    max_boxes = int(cfg['maxPerBook'])
    lang = 'ja'
    page_only = None
    cfg_override = None

    def arg(name, cast=str, default=None):
        if name in args:
            i = args.index(name)
            if i + 1 < len(args):
                return cast(args[i + 1])
        return default

    mode = arg('--mode', str, mode)
    min_chars = arg('--min-chars', int, min_chars)
    max_boxes = arg('--max', int, max_boxes)
    lang = arg('--lang', str, lang)
    cfg_override = arg('--config', str, None)
    page_only = arg('--page', str, None)

    if '--dry-run' in args:
        dry = True

    regions = load_json(os.path.join(folder, 'regions.json'), {})
    ocr = load_json(os.path.join(folder, 'ocr_text.json'), {})
    book_cfg = load_json(os.path.join(folder, 'config.json'), {})
    if isinstance(book_cfg, dict) and book_cfg.get('lang'):
        lang = book_cfg['lang']

    pages = sorted(regions.keys())
    if page_only:
        pages = [p for p in pages if p == page_only]

    # 候选框
    cands = []
    for p in pages:
        boxes = regions.get(p) or []
        texts = ocr.get(p) or []
        while len(texts) < len(boxes):
            texts.append('')
        for i, b in enumerate(boxes):
            t = texts[i] if i < len(texts) else ''
            if mode == 'all':
                bad, why = (True, '全部') if str(t).strip() else (True, '空')
            else:
                bad, why = looks_bad(t, min_chars)
                if bad and mode == 'empty' and why != '空':
                    bad = False
            if bad:
                cands.append({'page': p, 'idx': i, 'reason': why, 'old': t, 'box': b})
    truncated = len(cands) > max_boxes
    cands = cands[:max_boxes]

    print('模式=%s 最小字数=%d 上限=%d 页数=%d 候选框=%d%s' % (
        mode, min_chars, max_boxes, len(pages), len(cands), '(已截断)' if truncated else ''))

    if not cands:
        print(json.dumps({'ok': True, 'mode': mode, 'candidates': 0, 'fixed': 0, 'failed': 0,
                          'tokens_in': 0, 'tokens_out': 0}, ensure_ascii=False))
        return 0

    if mode == 'off':
        print(json.dumps({'ok': True, 'mode': 'off', 'candidates': 0, 'fixed': 0}, ensure_ascii=False))
        return 0

    if dry:
        for c in cands[:20]:
            print('  [%s#%d] %s | 原:%r' % (c['page'], c['idx'], c['reason'], c['old']))
        print(json.dumps({'ok': True, 'dry_run': True, 'mode': mode, 'candidates': len(cands),
                          'truncated': truncated}, ensure_ascii=False))
        return 0

    vcfg = load_vision_cfg(modlens_cfg_path(cfg_override))
    if not vcfg['baseUrl'] or not vcfg['model']:
        print('视觉引擎未配置,无法兜底(baseUrl/model 为空)')
        print(json.dumps({'ok': False, 'error': 'vision-not-configured'}, ensure_ascii=False))
        return 1

    pages_map = {}
    for f in os.listdir(folder):
        if f.lower().endswith(('.webp', '.png', '.jpg', '.jpeg', '.bmp')):
            pages_map[os.path.splitext(f)[0]] = os.path.join(folder, f)

    fixed = failed = unchanged = 0
    tin = tout = 0
    changed_pages = set()
    t0 = time.time()

    for n, c in enumerate(cands, 1):
        img = pages_map.get(c['page'])
        if not img:
            failed += 1
            print('进度 %d/%d %s#%d 跳过(找不到图片)' % (n, len(cands), c['page'], c['idx']))
            continue
        png = crop_box(img, c['box'])
        if png is None:
            failed += 1
            print('进度 %d/%d %s#%d 跳过(框无效)' % (n, len(cands), c['page'], c['idx']))
            continue
        if _is_blank(png):
            unchanged += 1
            print('进度 %d/%d %s#%d 空白,跳过(不调用视觉引擎)' % (n, len(cands), c['page'], c['idx']))
            continue
        text, usage, err = call_vision(vcfg, png, lang)
        tin += int(usage.get('prompt_tokens') or usage.get('input_tokens') or 0)
        tout += int(usage.get('completion_tokens') or usage.get('output_tokens') or 0)
        if err:
            failed += 1
            print('进度 %d/%d %s#%d 失败: %s' % (n, len(cands), c['page'], c['idx'], err[:120]))
            continue
        new = text.replace('\n', ' ').strip()
        if not new:
            unchanged += 1
            print('进度 %d/%d %s#%d 模型无输出,保留原值' % (n, len(cands), c['page'], c['idx']))
            continue
        rows = ocr.setdefault(c['page'], [])
        while len(rows) <= c['idx']:
            rows.append('')
        if new == rows[c['idx']]:
            unchanged += 1
            print('进度 %d/%d %s#%d 结果相同' % (n, len(cands), c['page'], c['idx']))
        else:
            rows[c['idx']] = new
            changed_pages.add(c['page'])
            fixed += 1
            print('进度 %d/%d %s#%d %r → %r' % (n, len(cands), c['page'], c['idx'],
                                              (c['old'] or '')[:14], new[:24]))

    if fixed:
        # 先备份原始 OCR,便于回滚
        src = os.path.join(folder, 'ocr_text.json')
        if os.path.exists(src):
            try:
                with open(src, 'rb') as f:
                    original = f.read()
                with open(src + '.bak', 'wb') as f:
                    f.write(original)
            except Exception:
                pass
        save_json(src, ocr)

    print(json.dumps({'ok': True, 'mode': mode, 'candidates': len(cands), 'fixed': fixed,
                      'unchanged': unchanged, 'failed': failed, 'truncated': truncated,
                      'tokens_in': tin, 'tokens_out': tout,
                      'seconds': round(time.time() - t0, 1)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
