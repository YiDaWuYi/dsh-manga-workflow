# -*- coding: utf-8 -*-
"""框过滤共用规则:识别「非台词」噪音框(页码/水印/UI/小碎框)。

用法:
    from boxtools import is_noise_box
    is_noise_box({'x':..,'y':..,'w':..,'h':..}, '原文', img_w, img_h)  -> bool
规则与 failure_report.py 的 cls=noise 保持一致(纯数字/拉丁、宽<40 或高<25)。
"""
import re

_RE_DIGIT = re.compile(r'^[0-9０-９\s\W_]+$')
_RE_LATIN = re.compile(r'^[A-Za-zＡ-Ｚａ-ｚ0-9０-９\s\W_]+$')


def is_noise_box(box, text, img_w=None, img_h=None):
    try:
        x = float(box.get('x') or 0); y = float(box.get('y') or 0)
        w = float(box.get('w') or 0); h = float(box.get('h') or 0)
    except Exception:
        return False
    t = (text or '').strip()
    if not t:
        return False
    if w < 40 or h < 25:
        return True
    if _RE_DIGIT.match(t) or _RE_LATIN.match(t):
        return True
    if img_h and y + h > 0.985 * float(img_h) and len(t) <= 8:
        # 页面底部极边缘的短文本,多为页码
        return True
    return False
