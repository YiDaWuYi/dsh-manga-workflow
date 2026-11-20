# -*- coding: utf-8 -*-
"""在多个本子上跑自动标框并统计覆盖率。用法: python run_auto_bench.py"""
import os, shutil, subprocess, sys, json

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

shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(WORK, exist_ok=True)

for bi, book in enumerate(BOOKS, 1):
    src = os.path.join(BASE, book)
    if not os.path.isdir(src):
        print(f'[跳过] {book}')
        continue
    tdir = os.path.join(WORK, f'book{bi}')
    os.makedirs(tdir, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(src)):
        if f.lower().endswith(('.webp', '.png', '.jpg', '.jpeg')):
            shutil.copy2(os.path.join(src, f), os.path.join(tdir, f))
            n += 1
    print(f'\n===== 本子 {bi}: {book[:40]}... ({n} 张图) =====', flush=True)
    r = subprocess.run([PY, os.path.join(TOOL, 'detect_book.py'), tdir],
                       env=env, capture_output=True, text=True, encoding='utf-8',
                       errors='replace', timeout=3600)
    tail = (r.stdout or '').strip().splitlines()[-1:]
    print('检测:', tail, flush=True)
    m = subprocess.run([PY, os.path.join(TOOL, 'measure_detect.py'), src,
                        os.path.join(tdir, 'regions.json')],
                       env=env, capture_output=True, text=True, encoding='utf-8',
                       errors='replace', timeout=300)
    print((m.stdout or '').strip(), flush=True)
    print((m.stderr or '')[-300:], flush=True)
