# -*- coding: utf-8 -*-
"""自动标框基准测试:把人工标注 regions.json 当标准答案,对比自动标框的召回/精确率。

用法:
    python bench.py <本子目录> [--all]

流程:
    1. 把本子的图片复制到临时目录
    2. 跑 detect_book.py 自动标框
    3. 和本子已有的 regions.json 对比
    4. 输出召回率、精确率、噪声率
"""
import sys, os, json, shutil, subprocess, tempfile

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOL_DIR not in sys.path:
    sys.path.insert(0, TOOL_DIR)

EXTS = ('.webp', '.png', '.jpg', '.jpeg', '.bmp')


def inter(a, b):
    ax0, ay0 = a['x'], a['y']
    ax1, ay1 = ax0 + a['w'], ay0 + a['h']
    bx0, by0 = b['x'], b['y']
    bx1, by1 = bx0 + b['w'], by0 + b['h']
    iw = max(0, min(ax1, bx1) - max(ax0, bx0))
    ih = max(0, min(ay1, by1) - max(ay0, by0))
    return iw * ih


def area(b):
    return max(1, b['w'] * b['h'])


def measure(book, auto):
    manual = json.load(open(os.path.join(book, 'regions.json'), encoding='utf-8'))
    dial = full = partial = miss = 0
    cov_sum = area_sum = 0
    tp = fp = 0
    for p in sorted(set(auto) | set(manual)):
        ab = auto.get(p, [])
        mb = manual.get(p, [])
        for a in ab:
            if any(inter(a, m) >= area(a) * 0.5 for m in mb):
                tp += 1
            else:
                fp += 1
        for m in mb:
            if m.get('sfx') or m.get('points'):
                continue
            ma = area(m)
            cov = sum(inter(a, m) for a in ab) / ma
            dial += 1
            area_sum += ma
            cov_sum += cov * ma
            if cov >= 0.8:
                full += 1
            elif cov >= 0.3:
                partial += 1
            else:
                miss += 1
    n = tp + fp
    return {
        'auto_boxes': sum(len(v) for v in auto.values()),
        'dialogue': dial,
        'full': full,
        'partial': partial,
        'missing': miss,
        'recall_area': cov_sum / max(1, area_sum) * 100,
        'precision': tp / max(1, n) * 100,
        'noise': fp / max(1, n) * 100,
    }


def main():
    if len(sys.argv) < 2:
        print('用法: python bench.py <已标好的本子目录> [--all]')
        print('说明: 本子必须已有人工标注的 regions.json 作为标准答案。')
        return 2
    book = sys.argv[1]
    mode = '--all' in sys.argv
    # --tools <目录>: 指定 detect_book.py 所在目录(默认本脚本同级)
    tools_dir = TOOL_DIR
    if '--tools' in sys.argv:
        tools_dir = sys.argv[sys.argv.index('--tools') + 1]
    # 系统临时目录可能不可用(C 盘满),改用本子目录下的 .bench_tmp
    work = os.path.join(book, '.bench_tmp')
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    try:
        nt = 0
        for f in sorted(os.listdir(book)):
            if f.lower().endswith(EXTS):
                shutil.copy2(os.path.join(book, f), os.path.join(work, f))
                nt += 1
        print(f'图片 {nt} 张,模式: {"不过滤" if mode else "只标气泡"}', flush=True)
        py = sys.executable
        cmd = [py, os.path.join(tools_dir, 'detect_book.py'), work]
        if mode:
            cmd.append('--all')
        env = dict(os.environ)
        env['PYTHONIOENCODING'] = 'utf-8'
        r = subprocess.run(cmd, env=env, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=7200)
        if r.returncode != 0:
            print('自动标框失败:', (r.stderr or '')[-800:])
            return 1
        auto = json.load(open(os.path.join(work, 'regions.json'), encoding='utf-8'))
        m = measure(book, auto)
        print()
        print('===== 自动标框基准结果 =====')
        print(f'人工正文框: {m["dialogue"]}')
        print(f'自动框数  : {m["auto_boxes"]}')
        print(f'完全覆盖  : {m["full"]} ({m["full"] / max(1, m["dialogue"]) * 100:.0f}%)')
        print(f'部分覆盖  : {m["partial"]} ({m["partial"] / max(1, m["dialogue"]) * 100:.0f}%)')
        print(f'漏检      : {m["missing"]} ({m["missing"] / max(1, m["dialogue"]) * 100:.0f}%)')
        print(f'面积召回  : {m["recall_area"]:.1f}%')
        print(f'精确率    : {m["precision"]:.0f}%   噪声率: {m["noise"]:.0f}%')
        print()
        print('提示:人工框越准,基准越可信;建议用已标好的本子做对照。')
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
