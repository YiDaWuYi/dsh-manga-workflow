# -*- coding: utf-8 -*-
"""本地 OCR:识别每个标注框里的原文(日文/韩文),输出 ocr_text.json
用法: python ocr_regions.py <图片文件夹> [--lang ja|ko]
语言优先从 config.json 的 "lang" 读,默认 ja。
之后把 ocr_text.json 交给 AI 翻译成中文(trans.json),再嵌字。
"""
import json, os, sys
import numpy as np
from PIL import Image


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
            cfg = json.load(open(os.path.join(src, 'config.json'), encoding='utf-8'))
            lang = cfg.get('lang', 'ja')
        except Exception:
            pass

    regions_file = os.path.join(src, 'regions.json')
    regions = json.load(open(regions_file, encoding='utf-8'))

    only_page = None
    if '--page' in sys.argv:
        only_page = sys.argv[sys.argv.index('--page') + 1]

    if lang == 'ja':
        from manga_ocr import MangaOcr
        eng = MangaOcr()
        def rec(c):
            return eng(c)
    else:
        import easyocr
        code = 'en' if lang == 'en' else 'ko'   # 韩文 / 英文都走 EasyOCR
        r = easyocr.Reader([code], gpu=True)
        def rec(c):
            return ' '.join(r.readtext(np.array(c), detail=0))

    out = os.path.join(src, 'ocr_text.json')
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
                lst.append(rec(crop))
            except Exception:
                lst.append('')
        result[page] = lst
        total_boxes += len(lst)
        print(f'进度 {pi}/{len(pages)}  第{page}页  识别{len(lst)}框'
              + (f'(跳过空白 {blanks})' if blanks else ''), flush=True)

    out = os.path.join(src, 'ocr_text.json')
    json.dump(result, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'OCR 完成: {len(result)} 页 / {total_boxes} 框 -> {out} (语言: {lang})', flush=True)


if __name__ == '__main__':
    main()
