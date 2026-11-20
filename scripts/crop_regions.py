# -*- coding: utf-8 -*-
"""把 regions.json 里每个框裁成小图,供 AI 翻译。
输出 crops/<页面>_<序号>.png(带 8px 外边距,便于看清完整文字)。
"""
import json, os, sys
from PIL import Image

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "."
    regions_file = sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, "regions.json")
    out_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(src, "crops")
    os.makedirs(out_dir, exist_ok=True)
    regions = json.load(open(regions_file, encoding='utf-8'))
    total = 0
    for page in sorted(regions):
        # 找源图
        img = None
        for ext in ('.webp', '.png', '.jpg', '.jpeg', '.bmp'):
            p = os.path.join(src, page + ext)
            if os.path.exists(p):
                img = Image.open(p).convert('RGB')
                break
        if img is None:
            print(f"[跳过] 找不到源图 {page}")
            continue
        for i, r in enumerate(regions[page]):
            x, y, w, h = r['x'], r['y'], r['w'], r['h']
            m = 8
            box = (max(0, x-m), max(0, y-m), min(img.width, x+w+m), min(img.height, y+h+m))
            crop = img.crop(box)
            out = os.path.join(out_dir, f"{page}_{i}.png")
            crop.save(out)
            total += 1
    print(f"已裁剪 {total} 张到 {out_dir}")

if __name__ == "__main__":
    main()
