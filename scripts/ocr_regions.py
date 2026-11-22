# -*- coding: utf-8 -*-
"""本地 OCR:识别每个标注框里的原文(日文/韩文),输出 ocr_text.json
用法: python ocr_regions.py <图片文件夹> [--lang ja|ko]
语言优先从 config.json 的 "lang" 读,默认 ja。
之后把 ocr_text.json 交给 AI 翻译成中文(trans.json),再嵌字。
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageOps


def _dd(p):
    """工作数据目录:项目库模式由 MANGA_DATA_DIR 指定(源目录只读),否则退回源目录。"""
    return os.environ.get('MANGA_DATA_DIR') or p


def _jp_score(t):
    """粗打分：日文字符/数字越多越好；全角点、空串扣分。用于深底浅字取"正/反"较优结果。"""
    if not t:
        return -100
    t = t.strip()
    s = 0
    for ch in t:
        o = ord(ch)
        if 0x3040 <= o <= 0x30FF or 0x4E00 <= o <= 0x9FFF:   # 假名/汉字
            s += 2
        elif ch.isdigit() or ch.isascii() and ch.isalnum():
            s += 1
        elif ch in '．·.、, ':
            s -= 1
    return s - max(0, len(t) - 24)      # 过长扣分


def is_blank_crop(crop, std_thr=2.0, ink_thr=0.003):
    """判断裁剪是否“空白”(几乎没有墨迹)。

    manga-ocr 对纯白/纯色输入会输出语言先验的固定短语(实测:
    纯白 -> 'そういえば、',纯黑 -> 'それでも、'),必须提前拦掉,
    否则空白框会被写上假文字,进而被翻译、被嵌进画面。
    """
    try:
        g = np.asarray(crop.convert('L'), dtype=np.int16)
    except Exception:
        return False
    if g.size == 0:
        return True
    if float(g.std()) >= std_thr:
        return False
    return float((g < 128).mean()) < ink_thr


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "."
    if '--lang' in sys.argv:
        lang = sys.argv[sys.argv.index('--lang') + 1]
    else:
        lang = 'ja'
        try:
            cfg = json.load(open(os.path.join(_dd(src), 'config.json'), encoding='utf-8'))
            lang = cfg.get('lang', 'ja')
        except Exception:
            pass

    regions_file = os.path.join(_dd(src), 'regions.json')
    regions = json.load(open(regions_file, encoding='utf-8'))

    only_page = None
    if '--page' in sys.argv:
        only_page = sys.argv[sys.argv.index('--page') + 1]

    if lang == 'ja':
        # 模型缓存定位:沙箱下 ~/.cache 可能不可写,优先用工作区 _hfcache
        try:
            _cands = []
            if os.environ.get('HF_HOME'):
                _cands.append(os.environ['HF_HOME'])
            _cands.append(os.path.join(os.path.expanduser('~'), '.cache', 'huggingface'))
            _cands.append(os.path.join(os.path.expanduser('~'), '.manga-workflow', 'hf'))
            _ddir = os.environ.get('MANGA_DATA_DIR') or ''
            if _ddir:
                _parts = os.path.abspath(_ddir).split(os.sep)
                for _i in range(len(_parts), 0, -1):
                    _cands.append(os.path.join(os.sep.join(_parts[:_i]), '_hfcache'))
            _cands.append(os.path.join(os.path.dirname(os.path.abspath(src)), '_hfcache'))
            for _c in _cands:
                if _c and os.path.isdir(os.path.join(_c, 'hub', 'models--kha-white--manga-ocr-base')):
                    os.environ['HF_HOME'] = _c
                    os.environ['HF_HUB_OFFLINE'] = '1'
                    os.environ['TRANSFORMERS_OFFLINE'] = '1'
                    break
        except Exception:
            pass
        from manga_ocr import MangaOcr
        try:
            eng = MangaOcr()
        except Exception as _e:
            print('[本地OCR] 模型加载失败：%s' % _e, flush=True)
            print('[本地OCR] 提示：模型缓存在 _hfcache/hub/models--kha-white--manga-ocr-base；'
                  '若缓存缺失需要联网下载(约 400MB)，或改用「视觉引擎兜底」/DSH 翻译。', flush=True)
            sys.exit(2)
        def rec(c):
            return eng(c)
    else:
        try:
            _ed = None
            _md = os.environ.get('MANGA_DATA_DIR') or ''
            if _md:
                _pp = os.path.abspath(_md).split(os.sep)
                for _i in range(len(_pp), 0, -1):
                    _c = os.path.join(os.sep.join(_pp[:_i]), '_easyocr')
                    try:
                        os.makedirs(_c, exist_ok=True); _ed = _c; break
                    except Exception: pass
            if not _ed:
                import tempfile as _tf
                _ed = os.path.join(_tf.gettempdir(), 'manga_easyocr')
                os.makedirs(_ed, exist_ok=True)
            os.environ.setdefault('EASYOCR_MODULE_PATH', _ed)
        except Exception:
            pass
        import easyocr
        code = 'en' if lang == 'en' else 'ko'   # 韩文 / 英文都走 EasyOCR
        r = easyocr.Reader([code], gpu=True)
        def rec(c):
            return ' '.join(r.readtext(np.array(c), detail=0))

    out = os.path.join(_dd(src), 'ocr_text.json')
    # 始终合并已有结果:本次没处理的页(无框/被跳过)不会丢 OCR
    result = {}
    if os.path.exists(out):
        try:
            result = json.load(open(out, encoding='utf-8'))
        except Exception:
            result = {}
    pages = [p for p in sorted(regions) if regions[p]]
    if only_page:
        pages = [p for p in pages if p == only_page]
    total_boxes = 0
    total_filled = 0
    for pi, page in enumerate(pages, 1):
        img = None
        for ext in ('.webp', '.png', '.jpg', '.jpeg', '.bmp'):
            p = os.path.join(src, page + ext)
            if os.path.exists(p):
                img = Image.open(p).convert('RGB')
                break
        if img is None:
            continue
        lst = []
        blanks = 0
        for b in regions[page]:
            m = 6
            crop = img.crop((max(0, b['x'] - m), max(0, b['y'] - m),
                             min(img.width, b['x'] + b['w'] + m),
                             min(img.height, b['y'] + b['h'] + m)))
            # 空白裁剪直接记空:避免模型把语言先验的固定短语写进空框
            if is_blank_crop(crop):
                lst.append('')
                blanks += 1
                continue
            try:
                _g = np.asarray(crop.convert('L'), dtype=np.int16)
                if float(_g.mean()) < 90:
                    # 深底浅字(黑底白字)：先按原图识别；只有识别不出/几乎无日文字时才试反色
                    t_org = rec(crop)
                    if _jp_score(t_org) < 6:
                        try:
                            t_inv = rec(ImageOps.invert(crop))
                        except Exception:
                            t_inv = ''
                        if _jp_score(t_inv) > _jp_score(t_org):
                            t_org = t_inv
                    lst.append(t_org)
                else:
                    lst.append(rec(crop))
            except Exception:
                lst.append('')
        result[page] = lst
        _got = sum(1 for _t in lst if (_t or '').strip())
        total_boxes += len(lst)
        total_filled += _got
        print(f'进度 {pi}/{len(pages)}  第{page}页  识别{len(lst)}框'
              + (f'(跳过空白 {blanks})' if blanks else ''), flush=True)

    # ---- 文本驱动判型:OCR 出来后再修正「台词 vs 拟声」,比像素规则可靠 ----
    if '--no-refine' not in sys.argv:
        try:
            import re as _re
            _rf = os.path.join(_dd(src), 'regions.json')
            _regions = json.load(open(_rf, encoding='utf-8')) if os.path.exists(_rf) else {}
            _n2b = _n2p = 0
            for _pg, _texts in result.items():
                _bs = _regions.get(_pg) or []
                for _i, _t in enumerate(_texts):
                    if _i >= len(_bs):
                        break
                    _b = _bs[_i]
                    _eff = len(_re.sub(r'[\s\u3000·．.、,，。！？!?…―—\-－♪♡♥❤「」『』（）()\[\]【】]', '', _t or ''))
                    _has_phrase = bool(_re.search(r'[ぁ-んァ-ヶ]', _t or ''))
                    _has_punct = bool(_re.search(r'[、。！？…]', _t or ''))
                    if _b.get('kind') == 'plain' and (_eff >= 5 or (_eff >= 3 and _has_punct)) and _has_phrase:
                        _b['kind'] = 'body'; _b['scene'] = 'bubble'
                        _b['sfx'] = False; _b['cover'] = 'erase'
                        _n2b += 1
                    elif _b.get('kind') == 'body' and _eff <= 3:
                        _b['kind'] = 'plain'; _b['scene'] = _b.get('scene') or 'free'
                        _b['sfx'] = True; _b['cover'] = 'overlay'
                        _n2p += 1
            if _n2b or _n2p:
                json.dump(_regions, open(_rf, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
                print('[判型] 按 OCR 文本修正:拟声→台词 %d 框,台词→拟声 %d 框' % (_n2b, _n2p), flush=True)
        except Exception as _e:
            print('[判型] 跳过:', _e, flush=True)

    out = os.path.join(_dd(src), 'ocr_text.json')
    json.dump(result, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'OCR 完成: {len(result)} 页 / {total_boxes} 框(有文字 {total_filled}) -> {out} (语言: {lang})', flush=True)
    if total_boxes and total_filled == 0:
        print('[本地OCR] ⚠ 一框都没识别出文字：可能是模型未加载、字过于艺术化，或框位置为空。'
              '可先「自动标框」确认框内有字，或改用「单页识图/视觉兜底」。', flush=True)
        sys.exit(3)
    try:
        import provenance
        provenance.log(_dd(src), 'ocr', '本地 OCR(manga-ocr/easyocr)', list(result.keys()),
                       '语言 %s · %d 框' % (lang, total_boxes))
    except Exception:
        pass

    # 写出「失败报告」,让 DSH/助手能直接读取并接管(ocr_failure_report.json/.md)
    try:
        import failure_report as _fr
        _rep = _fr.build(src, only_page or '')
        _fr._write(src, _rep)
        print('[失败报告] 失败 %d 框 -> %s' % (_rep['failures_total'], _rep['data_dir']), flush=True)
    except Exception as _e:
        print('[失败报告] 生成失败:', _e, flush=True)


if __name__ == '__main__':
    main()
