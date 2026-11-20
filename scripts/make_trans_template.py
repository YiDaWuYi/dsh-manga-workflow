# -*- coding: utf-8 -*-
"""根据 regions.json 生成 trans.json 模板(每框一个空串,按顺序对应)。
之后把中文填进每个空串即可;竖排多列用 | 分隔。
"""
import json, os, sys

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "."
    regions_file = sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, "regions.json")
    trans_file = sys.argv[3] if len(sys.argv) > 3 else os.path.join(src, "trans.json")
    regions = json.load(open(regions_file, encoding='utf-8'))
    trans = {}
    for page in sorted(regions):
        trans[page] = ["" for _ in regions[page]]
    json.dump(trans, open(trans_file, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    n = sum(len(v) for v in trans.values())
    print(f"已生成 {trans_file} : {len(trans)} 页 / {n} 框")

if __name__ == "__main__":
    main()
