# -*- coding: utf-8 -*-
"""清理自动标框产生的碎片框/重复框(被大框包含或高度重叠的小框)。

用法:
    python clean_regions.py <文件夹>            # 只预览,不改
    python clean_regions.py <文件夹> --apply    # 实际写回 regions.json
"""
import sys, os, json

EXTS = ('.webp', '.png', '.jpg', '.jpeg', '.bmp')


def area(b):
    return max(1, int(b.get('w', 0))) * max(1, int(b.get('h', 0)))


def inter(a, b):
    ax0, ay0 = a.get('x', 0), a.get('y', 0)
    ax1, ay1 = ax0 + a.get('w', 0), ay0 + a.get('h', 0)
    bx0, by0 = b.get('x', 0), b.get('y', 0)
    bx1, by1 = bx0 + b.get('w', 0), by0 + b.get('h', 0)
    iw = max(0, min(ax1, bx1) - max(ax0, bx0))
    ih = max(0, min(ay1, by1) - max(ay0, by0))
    return iw * ih


def main():
    src = sys.argv[1]
    apply = '--apply' in sys.argv
    rf = os.path.join(src, 'regions.json')
    regions = json.load(open(rf, encoding='utf-8'))

    removed_total = 0
    for page in sorted(regions):
        boxes = regions[page]
        if not boxes:
            continue
        # 只处理普通文本框(不动 nobox/points 拟声词)
        keep = []
        drop = []
        # 按面积从大到小处理,大框优先保留
        order = sorted(range(len(boxes)), key=lambda i: area(boxes[i]), reverse=True)
        kept_idx = set()
        for i in order:
            b = boxes[i]
            if b.get('nobox') or b.get('points'):
                kept_idx.add(i)      # 拟声词一律保留
                continue
            ab = area(b)
            contained = False
            for j in kept_idx:
                big = boxes[j]
                if big.get('nobox') or big.get('points'):
                    continue
                abig = area(big)
                if ab >= abig * 0.6:
                    continue
                ov = inter(b, big)
                if ov >= ab * 0.75:          # 大部分被大框包含 → 碎片
                    contained = True
                    break
            if contained:
                drop.append(i)
            else:
                kept_idx.add(i)
        if drop:
            removed_total += len(drop)
            print(f'{page}: 去掉 {len(drop)} 个碎片框 {sorted(drop)} (保留 {len(kept_idx)})')
            new = [boxes[i] for i in sorted(kept_idx)]
            regions[page] = new

    print(f'共去掉 {removed_total} 个碎片框')
    if apply and removed_total:
        json.dump(regions, open(rf, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('已写回 regions.json')
    elif removed_total:
        print('(预览模式,未修改;加 --apply 才写回)')


if __name__ == '__main__':
    main()
