# -*- coding: utf-8 -*-
"""版本号同步工具:一条命令完成发版时要改的所有地方。

用法:
    python tools/bump_version.py 1.6.0 --note "一句话主题"   # 同步版本号 + 生成 CHANGELOG 骨架
    python tools/bump_version.py --check                    # 校验各处版本一致、CHANGELOG 有该版本
    python tools/bump_version.py --pack                     # 打包成 dsh-manga-workflow-<ver>.tgz
    python tools/bump_version.py 1.6.1 --note "..." --dry-run
"""
import datetime
import io
import json
import os
import re
import subprocess
import sys
import tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # dsh-manga-plugin/
REPO = os.path.dirname(ROOT)                                          # 仓库根
PKG = os.path.join(ROOT, 'package.json')
CLIENT = os.path.join(ROOT, 'client.js')
README = os.path.join(ROOT, 'README.md')
CHANGELOG = os.path.join(ROOT, 'CHANGELOG.md')
MARK_TOOL = os.path.join(REPO, 'manga_tool', 'mark_tool.py')

SEMVER = re.compile(r'^(\d+)\.(\d+)\.(\d+)$')


def display(version):
    """1.5.0 -> V1.5; 1.5.1 -> V1.5.1; 2.0.0 -> V2.0"""
    major, minor, patch = version.split('.')
    return 'V%s.%s' % (major, minor) if patch == '0' else 'V%s.%s.%s' % (major, minor, patch)


def read(path):
    return io.open(path, encoding='utf-8').read()


def write(path, text):
    io.open(path, 'w', encoding='utf-8', newline='').write(text)


def current_version():
    return json.loads(read(PKG))['version']


def show(tag, path, ok, detail=''):
    print('%s %-12s %s%s' % ('PASS' if ok else 'FAIL', tag, os.path.relpath(path, REPO),
                             ('  -> ' + detail) if detail else ''))
    return ok


def collect_state():
    """读取 4 处当前版本状态。"""
    st = {}
    st['package'] = json.loads(read(PKG))['version']
    m = re.search(r"const APP_VERSION = '([^']+)'", read(CLIENT))
    st['client'] = m.group(1) if m else None
    m2 = re.search(r"^APP_VERSION = '([^']+)'", read(MARK_TOOL), re.M)
    st['mark_tool'] = m2.group(1) if m2 else None
    m3 = re.search(r'dsh-manga-workflow-(\d+\.\d+\.\d+)\.tgz', read(README))
    st['readme'] = m3.group(1) if m3 else None
    return st


def build_changelog_stub(version, note):
    today = datetime.datetime.now().strftime('%Y-%m-%d')
    return '''## [%s] — %s

%s

### 新增

- 

### 改进

- 

### 修复

- 

### 测试

- 

''' % (version, today, ('**主题:%s**' % note) if note else '')


def apply_version(version, note, dry):
    tag = display(version)
    stub = build_changelog_stub(version, note)

    # 1) package.json
    d = json.loads(read(PKG))
    old = d['version']
    d['version'] = version
    if not dry:
        write(PKG, json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    print('  package.json : %s -> %s' % (old, version))

    # 2) client.js
    c = read(CLIENT)
    c2, n1 = re.subn(r"const APP_VERSION = '[^']+';", "const APP_VERSION = '%s';" % tag, c, count=1)
    assert n1 == 1, 'client.js 里没找到 APP_VERSION'
    if not dry:
        write(CLIENT, c2)
    print('  client.js    : APP_VERSION -> %s' % tag)

    # 3) mark_tool.py
    t = read(MARK_TOOL)
    t2, n2 = re.subn(r"^APP_VERSION = '[^']+'.*$", "APP_VERSION = '%s'" % tag, t, count=1, flags=re.M)
    assert n2 == 1, 'mark_tool.py 里没找到 APP_VERSION'
    if not dry:
        write(MARK_TOOL, t2)
    print('  mark_tool.py : APP_VERSION -> %s' % tag)

    # 4) README Release 链接
    r = read(README)
    r2 = re.sub(r'releases/download/v\d+\.\d+\.\d+/dsh-manga-workflow-\d+\.\d+\.\d+\.tgz',
                'releases/download/v%s/dsh-manga-workflow-%s.tgz' % (version, version), r)
    if not dry:
        write(README, r2)
    print('  README.md    : 下载链接 -> v%s' % version)

    # 5) CHANGELOG 顶部插入骨架
    ch = read(CHANGELOG)
    marker = '## ['
    idx = ch.find(marker)
    assert idx > 0, 'CHANGELOG 结构异常(找不到 "## [")'
    ch2 = ch[:idx] + stub + ch[idx:]
    if not dry:
        write(CHANGELOG, ch2)
    print('  CHANGELOG.md : 已插入 [%s] 骨架(待补内容)' % version)
    print()
    print('版本号已同步为 %s(界面显示 %s)%s' % (version, tag, '(dry-run,未写盘)' if dry else ''))
    if not dry:
        print('下一步:')
        print('  1. 补完 CHANGELOG.md 的新节内容')
        print('  2. python tools/bump_version.py --check')
        print('  3. python tools/bump_version.py --pack')


def do_check():
    ok = True
    ver = current_version()
    tag = display(ver)
    st = collect_state()
    print('当前版本:%s(界面 %s)\n' % (ver, tag))
    ok &= show('package.json', PKG, st['package'] == ver, st['package'])
    ok &= show('client.js', CLIENT, st['client'] == tag, st['client'])
    ok &= show('mark_tool.py', MARK_TOOL, st['mark_tool'] == tag, st['mark_tool'])
    ok &= show('README 链接', README, st['readme'] == ver, st['readme'])

    ch = read(CHANGELOG)
    has_section = ('## [%s]' % ver) in ch
    ok &= show('CHANGELOG 有该版本', CHANGELOG, has_section, ver if has_section else '缺 [%s] 小节' % ver)
    stub_markers = ch[ch.find('## ['):]
    if has_section:
        sec = stub_markers.split('## [', 2)[1]
        if '- \n' in sec or sec.rstrip().endswith('-'):
            print('WARN CHANGELOG 该版本小节还有空条目(- ),记得补内容')

    if not ok:
        print('\n有问题:版本号未对齐或日志缺节,发版前必须修好。')
        return 1
    print('\n一致性检查通过 ✅')
    return 0


def do_pack():
    ver = current_version()
    tgz = os.path.join(ROOT, 'dsh-manga-workflow-%s.tgz' % ver)
    for old in os.listdir(ROOT):
        if old.startswith('dsh-manga-workflow-') and old.endswith('.tgz'):
            os.remove(os.path.join(ROOT, old))
            print('删除旧包:', old)
    items = ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'README.md',
             'CHANGELOG.md', 'RELEASING.md', 'LICENSE', 'icon.svg', 'locale', 'docs',
             'scripts', 'src']
    with tarfile.open(tgz, 'w:gz') as tf:
        for name in items:
            p = os.path.join(ROOT, name)
            if not os.path.exists(p):
                print('WARN 缺少:', name)
                continue
            src = p
            if os.path.isdir(p):
                for base, _dirs, files in os.walk(p):
                    for f in files:
                        if '__pycache__' in base:
                            continue
                        full = os.path.join(base, f)
                        rel = os.path.relpath(full, ROOT)
                        tf.add(full, arcname='package/' + rel.replace('\\', '/'))
            else:
                tf.add(src, arcname='package/' + name)
    size = os.path.getsize(tgz)
    print('打包完成:%s(%d 字节)' % (os.path.basename(tgz), size))
    print('下一步:插件管理里「移除 → 安装」这个 tarball,然后实机验证。')
    return 0


def main():
    args = sys.argv[1:]
    if '--check' in args:
        return do_check()
    if '--pack' in args:
        return do_pack()
    if not args or args[0].startswith('-'):
        print(__doc__)
        return 2
    version = args[0]
    if not SEMVER.match(version):
        print('版本号格式错误:%r,应为 x.y.z(例如 1.6.0)' % version)
        return 2
    note = ''
    if '--note' in args:
        i = args.index('--note')
        if i + 1 < len(args):
            note = args[i + 1]
    dry = '--dry-run' in args
    apply_version(version, note, dry)
    return 0


if __name__ == '__main__':
    sys.exit(main())
