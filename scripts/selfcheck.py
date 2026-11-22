# -*- coding: utf-8 -*-
"""运行环境自检:一条命令检查「汉化工作流」需要的 Python / 模型 / 程序 / DSH 桥 / 字体 / 工作区。

用法:
    python manga_tool/selfcheck.py            # 只看结果
    python manga_tool/selfcheck.py --json     # 输出 JSON(给面板/脚本用)

退出码:0=全部通过(允许有警告);1=有关键项失败。
"""
import json
import os
import shutil
import socket
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~')

# 先把缓存目录指到程序目录,避免 huggingface 往 C:\Users\...\.cache 探测(网络不通会卡/报警告)
os.environ.setdefault('HF_HOME', os.path.join(BASE, '_hfcache'))
os.environ.setdefault('TORCH_HOME', os.path.join(BASE, '_torchcache'))
os.environ.setdefault('EASYOCR_MODULE_PATH', os.path.join(BASE, '_easyocr'))
os.environ.setdefault('TRANSFORMERS_VERBOSITY', 'error')

ROWS = []          # (级别, 名称, 详情)
CRITICAL_FAIL = [] # 关键失败项


def add(level, name, detail):
    ROWS.append((level, name, detail))
    if level == 'FAIL':
        CRITICAL_FAIL.append(name)


def ok(name, detail=''):
    add('OK', name, detail)


def warn(name, detail=''):
    add('WARN', name, detail)


def fail(name, detail=''):
    add('FAIL', name, detail)


def dir_mb(path):
    if not os.path.isdir(path):
        return None
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return round(total / 1024.0 / 1024.0, 1)


def check_python():
    v = sys.version.split()[0]
    ok('Python', '%s (%s)' % (v, sys.executable))
    if sys.version_info < (3, 9):
        warn('Python 版本', '建议 3.10+，当前 %s' % v)

    for mod, label, critical in (
        ('PIL', 'Pillow(PIL)', True),
        ('numpy', 'numpy', True),
        ('cv2', 'opencv(cv2)', True),
        ('torch', 'torch', True),
        ('easyocr', 'easyocr', False),
        ('manga_ocr', 'manga-ocr', False),
    ):
        try:
            __import__(mod)
            ok(label, '已安装')
        except Exception as e:
            (fail if critical else warn)(label, '未安装/导入失败: %s' % e)

    try:
        import torch
        if torch.cuda.is_available():
            ok('GPU(CUDA)', torch.cuda.get_device_name(0))
        else:
            warn('GPU(CUDA)', '不可用 → LaMa 去字会退回 CPU/普通抹除，速度会慢')
    except Exception:
        pass


def check_models():
    hf = os.environ.get('HF_HOME') or os.path.join(BASE, '_hfcache')
    hub = os.path.join(hf, 'hub')
    manga_dir = os.path.join(hub, 'models--kha-white--manga-ocr-base')
    if os.path.isdir(manga_dir):
        ok('本地 OCR 模型(manga-ocr)', '%s MB · %s' % (dir_mb(manga_dir), manga_dir))
    else:
        warn('本地 OCR 模型(manga-ocr)',
             '未找到 → 需要联网下载(约 400MB)；也可改用「视觉引擎兜底」')

    easy = os.environ.get('EASYOCR_MODULE_PATH') or os.path.join(BASE, '_easyocr')
    craft = os.path.join(easy, 'model', 'craft_mlt_25k.pth')
    if os.path.exists(craft):
        ok('标框/检测模型(easyocr CRAFT)', '%s MB' % round(os.path.getsize(craft) / 1048576.0, 1))
    else:
        warn('标框/检测模型(easyocr CRAFT)', '未找到 %s → 自动标框不可用' % craft)

    torch_cache = os.environ.get('TORCH_HOME') or os.path.join(BASE, '_torchcache')
    mb = dir_mb(torch_cache)
    if mb:
        ok('torch 缓存', '%s MB' % mb)
    else:
        warn('torch 缓存', '为空(首次用 LaMa 会自动下载)')


def check_iopaint():
    exe = os.path.join(BASE, '_venv', 'Scripts', 'iopaint.exe')
    if os.path.exists(exe):
        ok('GPU 去字(io-paint)', exe)
    else:
        warn('GPU 去字(io-paint)', '未找到 → 「抹除+GPU」不可用，会退回普通抹除')


def check_fonts():
    need = [r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simsun.ttc']
    missing = [p for p in need if not os.path.exists(p)]
    if missing:
        warn('中文字体', '缺少: %s（会影响嵌字字体）' % ', '.join(missing))
    else:
        ok('中文字体', '微软雅黑 / 宋体 可用')
    sym = r'C:\Windows\Fonts\seguisym.ttf'
    if os.path.exists(sym):
        ok('符号字体(Segoe UI Symbol)', '可用(♡♪ 等)')
    else:
        warn('符号字体', '缺少 seguisym.ttf → ♡♪ 等会显示成方块')


def check_bridge():
    cfg = os.path.join(HOME, '.manga-workflow', 'host.json')
    if not os.path.exists(cfg):
        warn('DSH 桥(host.json)', '未找到 %s → DSH 翻译/网页联动不可用' % cfg)
        return
    try:
        d = json.load(open(cfg, encoding='utf-8'))
        port = int(d.get('port') or 0)
        token = d.get('token') or ''
        if not port:
            warn('DSH 桥(host.json)', '文件存在但没有 port')
            return
        s = socket.create_connection(('127.0.0.1', port), timeout=2)
        s.close()
        ok('DSH 桥', '127.0.0.1:%d 可连接%s' % (port, '' if token else '（无 token）'))
    except Exception as e:
        warn('DSH 桥', '连接失败: %s (DSH 是否在运行？)' % e)


def check_workspace():
    settings = os.path.join(HOME, '.manga-workflow', 'settings.json')
    ws = ''
    if os.path.exists(settings):
        try:
            ws = str(json.load(open(settings, encoding='utf-8')).get('workspaceDir') or '')
        except Exception:
            pass
    if ws and os.path.isdir(ws):
        ok('嵌字工作区', ws)
        for sub in ('projects', '已完成'):
            p = os.path.join(ws, sub)
            if os.path.isdir(p):
                ok('工作区子目录', p)
            else:
                warn('工作区子目录', '未创建: %s（首次运行会自动建）' % p)
    elif ws:
        fail('嵌字工作区', '设置里写的是 %s，但目录不存在' % ws)
    else:
        warn('嵌字工作区', '还没有设置 → 打开「设置 → 嵌字工作区」指定一个目录')


def check_tools():
    node = shutil.which('node')
    if not node:
        for cand in ('E:/deepseek/resources/runtime/bin/node',
                     'E:/deepseek/resources/runtime/bin/node.cmd',
                     os.environ.get('DSH_DESKTOP_NODE_EXECUTABLE') or ''):
            if cand and os.path.exists(cand):
                node = cand
                break
    if node:
        ok('Node.js', node)
    else:
        warn('Node.js', '不在 PATH（仅发布/打包相关功能需要，不影响日常汉化）')
    g = shutil.which('git')
    if g:
        ok('Git', g)
    else:
        warn('Git', '不在 PATH（仅发布相关功能需要）')

def render_text():
    icon = {'OK': '[ OK ]', 'WARN': '[WARN]', 'FAIL': '[FAIL]'}
    lines = []
    for level, name, detail in ROWS:
        line = '%s %-26s %s' % (icon[level], name, detail)
        lines.append(line.rstrip())
    bad = [r for r in ROWS if r[0] == 'FAIL']
    wrn = [r for r in ROWS if r[0] == 'WARN']
    lines.append('')
    lines.append('汇总: %d 项通过 / %d 警告 / %d 失败' % (
        len([r for r in ROWS if r[0] == 'OK']), len(wrn), len(bad)))
    if wrn:
        lines.append('警告: ' + '、'.join(r[1] for r in wrn))
    if bad:
        lines.append('失败: ' + '、'.join(r[1] for r in bad))
    return '\n'.join(lines)


def main():
    check_python()
    check_models()
    check_iopaint()
    check_fonts()
    check_bridge()
    check_workspace()
    check_tools()

    if '--json' in sys.argv:
        print(json.dumps({
            'ok': not CRITICAL_FAIL,
            'items': [{'level': l, 'name': n, 'detail': d} for l, n, d in ROWS],
        }, ensure_ascii=False, indent=1))
    else:
        print(render_text())
    sys.exit(1 if CRITICAL_FAIL else 0)


if __name__ == '__main__':
    main()
