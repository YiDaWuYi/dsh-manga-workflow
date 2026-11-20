# -*- coding: utf-8 -*-
"""对比「只标气泡」和「--all」两种模式在多个本子上的覆盖率。"""
import os, shutil, subprocess

BASE = r'E:\dph hanhhua gonzuoqu'
WORK = os.path.join(BASE, '_bench')
PY = os.path.join(BASE, '_venv', 'Scripts', 'python.exe')
TOOL = os.path.join(BASE, 'manga_tool')
BOOKS = [
    '4252703-(Kemoket 13) [Lomelette (Lassie)] Tsuyu to kage no shichihenge',
    '4252736-(COMITIA150) [Lomelette (Lassie)] Toraware Meiken Wo Teniire Tai',
]
env = dict(os.environ)
env['TORCH_HOME'] = os.path.join(BASE, '_torchcache')
env['HF_HOME'] = os.path.join(BASE, '_hfcache')
env['EASYOCR_MODULE_PATH'] = os.path.join(BASE, '_easyocr')
env['PYTHONIOENCODING'] = 'utf-8'

for bi, book in enumerate(BOOKS, 1):
    src = os.path.join(BASE, book)
    tdir = os.path.join(WORK, f'book{bi}')
    if not (os.path.isdir(src) and os.path.isdir(tdir)):
        continue
    print(f'\n===== 本子 {bi}: {book[:36]}... =====', flush=True)
    for mode, args in (('只标气泡', []), ('--all', ['--all'])):
        rf = os.path.join(tdir, 'regions.json')
        if os.path.exists(rf):
            os.remove(rf)
        r = subprocess.run([PY, os.path.join(TOOL, 'detect_book.py'), tdir] + args,
                           env=env, capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=3600)
        tail = (r.stdout or '').strip().splitlines()[-1:]
        print(f'\n[{mode}] 检测: {tail}', flush=True)
        m = subprocess.run([PY, os.path.join(TOOL, 'measure_detect.py'), src, rf],
                           env=env, capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=300)
        for ln in (m.stdout or '').strip().splitlines():
            print('  ' + ln, flush=True)
