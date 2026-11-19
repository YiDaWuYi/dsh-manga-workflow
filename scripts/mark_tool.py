# -*- coding: utf-8 -*-
"""漫画汉化 · 标框工具
在图片上框选(或涂抹)每个需要翻译的文字区域,保存坐标供后续翻译、嵌字。

用法:
    python mark_tool.py <图片文件夹> [regions.json]

操作:
    框选模式: 按住左键拖出矩形
    涂抹模式: 按住左键自由涂抹,松开后自动取涂抹范围的包围框
    右键点击已画框 = 删除该框
    [竖排/横排] 决定新框的文字方向
    [保存] 把当前页框保存到 regions.json
    翻页 / 撤销 / 清空 见按钮
"""
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageDraw, ImageTk
import json, os, sys, glob, subprocess, threading
import styles

# 项目根目录(本文件所在 manga_tool 的上一级),所有路径从这里推导,避免写死个人目录
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class MarkTool:
    def __init__(self, root, src_dir, regions_file):
        self.root = root
        try:
            root.protocol('WM_DELETE_WINDOW', lambda: (self._shutdown_job(), root.destroy()))
        except Exception:
            pass
        self.src_dir = src_dir
        self.regions_file = regions_file
        self.pages = self._list_pages(src_dir)
        if not self.pages:
            messagebox.showerror("错误", f"图片文件夹里没有图片: {src_dir}")
            sys.exit(1)
        self.idx = 0
        self.regions = self._load(regions_file)
        self._snapshot()
        self.vertical = tk.BooleanVar(value=True)
        self.mode = tk.StringVar(value="box")  # box / paint
        self.size = tk.StringVar(value="20")   # 字号(新框默认,可选 10/20/30/50/60 或手动输入)
        self.erase = tk.BooleanVar(value=True)        # 抹除原文(不勾=只叠字,不擦原文)
        self.sfx = tk.BooleanVar(value=False)         # 拟声词/艺术字(粗体+外框)
        # 可视化文字样式(见 styles.json):正文 / 拟声词各一组
        self.body_style_id = tk.StringVar(value=styles.DEFAULT_BODY)
        self.sfx_style_id = tk.StringVar(value=styles.DEFAULT_SFX)
        self._style_btns = {'body': {}, 'sfx': {}}
        self.auto_size = tk.BooleanVar(value=True)    # 嵌字时自动检测原文字号
        self.auto_dir = tk.BooleanVar(value=True)     # 嵌字时自动检测横竖
        self.use_lama = tk.BooleanVar(value=self._cfg_lama(regions_file))  # 嵌字时用 GPU(LaMa)去字
        self.lang = tk.StringVar(value=self._cfg_val(regions_file, 'lang', 'ja'))  # 原文语言 ja/ko
        self.scope = tk.StringVar(value="page")   # 处理范围:page=当前页 / book=整本
        self.bubble_only = tk.BooleanVar(value=False)  # 自动标框:只标气泡内文字(默认关:覆盖率高,宁可多标)
        self.proof_mode = tk.StringVar(value="原文+译文")   # 校对模式:原文+译文 / 只校原文
        self.trans_cfg = _load_trans_cfg()             # 翻译设置:引擎列表 + 代理
        self.page_boxes = []       # 当前页已画的框(原始坐标)
        self.cur_key = None        # 当前页的 key(无扩展名),用于正确归属
        self._drag = None          # (x0,y0,x1,y1) 显示坐标
        self._paint_pts = []       # 涂抹模式的点(显示坐标)
        self._scale = 1.0
        self._img = None           # 当前页原始 PIL
        self._tkimg = None
        self.ocr_file = os.path.join(os.path.dirname(regions_file), 'ocr_text.json')
        self.box_text = self._load(self.ocr_file)   # 每框识别/识读的原文
        self._snapshot()
        self.trans_file = os.path.join(os.path.dirname(regions_file), 'trans.json')
        self.trans = self._load(self.trans_file)    # 每框译文
        self._snapshot()

        # 打开时优先跳到第一个有标框的页(封面等无框页直接跳过)
        for i, pg in enumerate(self.pages):
            if self.regions.get(os.path.splitext(pg)[0]):
                self.idx = i
                break

        self._build_ui()
        self._load_page()
        self.root.after(80, self.refresh)   # 窗口真正显示后再适配一次尺寸

    # ---------- 基础 ----------
    @staticmethod
    def _list_pages(d):
        exts = ('.webp', '.png', '.jpg', '.jpeg', '.bmp')
        return sorted(f for f in os.listdir(d) if f.lower().endswith(exts))

    @staticmethod
    def _load(path):
        if os.path.exists(path):
            try:
                return json.load(open(path, encoding='utf-8'))
            except Exception:
                return {}
        return {}

    @staticmethod
    def _cfg_lama(regions_file):
        try:
            cfg_path = os.path.join(os.path.dirname(regions_file), 'config.json')
            return bool(json.load(open(cfg_path, encoding='utf-8')).get('lama', False))
        except Exception:
            return False

    @staticmethod
    def _cfg_val(regions_file, key, default):
        try:
            cfg_path = os.path.join(os.path.dirname(regions_file), 'config.json')
            return json.load(open(cfg_path, encoding='utf-8')).get(key, default)
        except Exception:
            return default

    def _snapshot(self):
        """记下当前内存数据的快照,保存时用来判断"哪些页是本端改过的"。"""
        try:
            self._base_regions = json.loads(json.dumps(self.regions))
        except Exception:
            self._base_regions = {}
        try:
            self._base_text = json.loads(json.dumps(getattr(self, 'box_text', {})))
        except Exception:
            self._base_text = {}
        try:
            self._base_trans = json.loads(json.dumps(getattr(self, 'trans', {})))
        except Exception:
            self._base_trans = {}

    def _merge_save(self, path, mem, base):
        """按页合并:本端改过的页用内存版,其它页以磁盘为准。

        双端同时编辑同一本时,不会因为本端保存把另一端的删除/新增覆盖掉。
        """
        disk = {}
        if os.path.exists(path):
            try:
                disk = json.load(open(path, encoding='utf-8'))
            except Exception:
                disk = {}
        out = dict(disk)
        for k in set(list(mem.keys()) + list(base.keys())):
            if mem.get(k) != base.get(k):
                out[k] = mem.get(k, [])
        return out

    def _save(self):
        # 提交当前页(用 cur_key,无扩展名)
        if self.cur_key:
            self.regions[self.cur_key] = list(self.page_boxes)
        # 按页合并:只覆盖本端改过的页,其它页保留磁盘上的(可能是网页端刚改的)
        merged = self._merge_save(self.regions_file, self.regions,
                                  getattr(self, '_base_regions', self.regions))
        json.dump(merged, open(self.regions_file, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        self.regions = merged
        # 顺便记录设置(GPU去字开关)
        try:
            cfg_path = os.path.join(os.path.dirname(self.regions_file), 'config.json')
            json.dump({'lama': bool(self.use_lama.get()), 'lang': self.lang.get(),
                       'auto_size': bool(self.auto_size.get()), 'auto_dir': bool(self.auto_dir.get())},
                      open(cfg_path, 'w', encoding='utf-8'))
        except Exception:
            pass

    def _page_key(self):
        return os.path.splitext(self.pages[self.idx])[0]

    def _size_val(self):
        try:
            return max(8, int(float(str(self.size.get()).strip())))
        except Exception:
            return 20

    # ---------- UI ----------
    def _build_ui(self):
        # 第一行:导航 + 操作
        top = tk.Frame(self.root)
        top.pack(side=tk.TOP, fill=tk.X, padx=4, pady=(4, 1))
        tk.Button(top, text="◀ 上一页(←)", command=self.prev_page).pack(side=tk.LEFT)
        tk.Button(top, text="下一页 ▶(→)", command=self.next_page).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="撤销", command=self.undo).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="清空本页", command=self.clear_page).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="保存", command=self.save_btn).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="自动识别(OCR)", command=self.run_ocr).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="自动标框", command=self.auto_detect).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="刷新", command=self.refresh).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="一键识别(整本:标框+OCR)", command=self.one_click).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="重标同步", command=self.resync).pack(side=tk.LEFT, padx=(4, 0))
        tk.Button(top, text="校对(嵌字前)", command=self.proofread_pre).pack(side=tk.LEFT, padx=4)
        ttk.Combobox(top, textvariable=self.proof_mode, values=["原文+译文", "只校原文"],
                     width=10, state='readonly').pack(side=tk.LEFT)
        tk.Button(top, text="翻译", command=self.translate_text).pack(side=tk.LEFT, padx=(4, 0))
        tk.Button(top, text="翻译设置", command=self.translate_settings).pack(side=tk.LEFT, padx=(2, 0))
        tk.Button(top, text="帮助", command=self.show_help).pack(side=tk.LEFT, padx=(2, 0))
        tk.Button(top, text="设置", command=lambda: _show_settings(self.root, self.src_dir)).pack(side=tk.LEFT, padx=(2, 0))
        tk.Button(top, text="取消当前任务", command=self.cancel_job).pack(side=tk.LEFT, padx=(6, 0))
        tk.Label(top, text="范围:").pack(side=tk.LEFT, padx=(8, 0))
        tk.Radiobutton(top, text="当前页", variable=self.scope, value="page").pack(side=tk.LEFT)
        tk.Radiobutton(top, text="整本", variable=self.scope, value="book").pack(side=tk.LEFT)
        tk.Checkbutton(top, text="自动标框只标气泡", variable=self.bubble_only).pack(side=tk.LEFT, padx=(10, 0))
        self.status = tk.Label(top, text="")
        self.status.pack(side=tk.RIGHT)

        # 第二行:标注设置
        top2 = tk.Frame(self.root)
        top2.pack(side=tk.TOP, fill=tk.X, padx=4, pady=(0, 4))
        tk.Radiobutton(top2, text="框选(B)", variable=self.mode, value="box").pack(side=tk.LEFT)
        tk.Radiobutton(top2, text="涂抹(P)", variable=self.mode, value="paint").pack(side=tk.LEFT, padx=(0, 8))
        tk.Radiobutton(top2, text="竖排(V)", variable=self.vertical, value=True).pack(side=tk.LEFT)
        tk.Radiobutton(top2, text="横排(H)", variable=self.vertical, value=False).pack(side=tk.LEFT, padx=(0, 8))
        tk.Label(top2, text="字号:").pack(side=tk.LEFT)
        ttk.Combobox(top2, textvariable=self.size, values=[str(i) for i in range(10, 81, 10)],
                     width=4).pack(side=tk.LEFT)
        tk.Checkbutton(top2, text="拟声词(N)", variable=self.sfx).pack(side=tk.LEFT, padx=(8, 0))
        tk.Checkbutton(top2, text="抹除原文(E)", variable=self.erase).pack(side=tk.LEFT, padx=(4, 0))
        tk.Checkbutton(top2, text="自动字号", variable=self.auto_size).pack(side=tk.LEFT, padx=(8,0))
        tk.Checkbutton(top2, text="自动横竖", variable=self.auto_dir).pack(side=tk.LEFT, padx=(4,0))
        tk.Checkbutton(top2, text="GPU去字", variable=self.use_lama).pack(side=tk.LEFT, padx=8)
        tk.Label(top2, text="语言:").pack(side=tk.LEFT)
        tk.Radiobutton(top2, text="日", variable=self.lang, value="ja").pack(side=tk.LEFT)
        tk.Radiobutton(top2, text="韩", variable=self.lang, value="ko").pack(side=tk.LEFT)
        tk.Radiobutton(top2, text="英", variable=self.lang, value="en").pack(side=tk.LEFT)

        # 可视化样式库(一行小图:直接看到渲染效果)
        style_bar = tk.Frame(self.root)
        style_bar.pack(side=tk.TOP, fill=tk.X, padx=6, pady=(2, 0))
        self._build_style_group(style_bar, 'body', '正文')
        self._build_style_group(style_bar, 'sfx', '拟声')
        tk.Button(style_bar, text='应用到本页', width=9, command=self.apply_style_page
                  ).pack(side=tk.LEFT, padx=(4, 0))
        self._refresh_style_buttons()

        tk.Label(self.root, text="操作: 左键拖框/涂抹 · 右键删框 · 双击改原文和译文 · N=拟声词/艺术字 · E=抹除原文 · F5 刷新 · 样式按钮点一下即选中 · 一键识别=整本",
                 fg="#888", anchor="w").pack(side=tk.TOP, fill=tk.X, padx=6)

        self.canvas = tk.Canvas(self.root, bg="#333", cursor="crosshair")
        self.canvas.pack(fill=tk.BOTH, expand=True)
        self.canvas.bind("<ButtonPress-1>", self.on_down)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_up)
        self.canvas.bind("<Button-3>", self.on_right)
        self.canvas.bind("<Double-Button-1>", self.on_double)
        self.canvas.bind("<Configure>", self._on_configure)
        self.root.bind("<F5>", lambda e: self.refresh())
        # 快捷键
        self.root.bind("<Left>", lambda e: self.prev_page())
        self.root.bind("<Right>", lambda e: self.next_page())
        self.root.bind("<Control-z>", lambda e: self.undo())
        self.root.bind("<Control-s>", lambda e: self.save_btn())
        self.root.bind("b", lambda e: self.mode.set("box"))
        self.root.bind("p", lambda e: self.mode.set("paint"))
        self.root.bind("v", lambda e: self.vertical.set(True))
        self.root.bind("h", lambda e: self.vertical.set(False))
        self.root.bind("n", lambda e: self.sfx.set(not self.sfx.get()))      # N=切换拟声词/艺术字
        self.root.bind("e", lambda e: self.erase.set(not self.erase.get()))  # E=切换抹除原文

    # ---------- 页面 ----------
    def _load_page(self):
        self.cur_key = self._page_key()
        self.page_boxes = [_norm_box(b) for b in self.regions.get(self.cur_key, [])]
        self._img = Image.open(os.path.join(self.src_dir, self.pages[self.idx])).convert("RGB")
        self._fit()
        self._redraw()

    def _goto(self, new_idx):
        self._save()          # 先提交旧页(用旧 cur_key)
        self.idx = new_idx
        self._load_page()     # 再载新页

    def _fit(self):
        cw = max(self.canvas.winfo_width(), 300)
        ch = max(self.canvas.winfo_height(), 300)
        w, h = self._img.size
        self._scale = min(cw / w, ch / h)
        disp = self._img.resize((int(w * self._scale), int(h * self._scale)), Image.LANCZOS)
        self._tkimg = ImageTk.PhotoImage(disp)

    def _redraw(self):
        if not self._tkimg:
            # 图片还没生成(首次布局前),尝试补做一次适配,避免标框不显示
            try:
                if self._img is not None:
                    self._fit()
            except Exception:
                pass
            if not self._tkimg:
                return
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor=tk.NW, image=self._tkimg)
        texts = self.box_text.get(self._page_key(), [])
        trans = self.trans.get(self._page_key(), [])
        for idx, b in enumerate(self.page_boxes):
            is_sfx = bool(b.get('sfx'))
            box_color = "#ff4d4d" if is_sfx else "#00ff00"   # 拟声词=红,正文=绿
            self._draw_box(b, outline=box_color, width=2 if not is_sfx else 3)
            # 框内左上角:类型标签
            bx0 = b['x'] * self._scale
            by0 = b['y'] * self._scale
            label = "拟声" if is_sfx else "正文"
            bg = "#5a1a1a" if is_sfx else "#0f3d0f"
            _t = self.canvas.create_text(bx0 + 3, by0 + 2, anchor=tk.NW, text=label,
                                         fill=box_color, font=("Microsoft YaHei", 9, "bold"))
            _bb = self.canvas.bbox(_t)
            if _bb:
                _r = self.canvas.create_rectangle(_bb[0] - 1, _bb[1] - 1, _bb[2] + 1, _bb[3] + 1,
                                                  fill=bg, outline="")
                self.canvas.tag_lower(_r, _t)
            orig = texts[idx] if idx < len(texts) else ''
            tl = trans[idx] if idx < len(trans) else ''
            x1 = (b['x'] + b['w']) * self._scale
            y0 = b['y'] * self._scale
            if orig:
                short = orig if len(orig) <= 14 else orig[:14] + '…'
                self.canvas.create_text(x1 + 3, y0 - 2, anchor=tk.NW, text=short,
                                        fill="#ff9900", font=("Microsoft YaHei", 9))
            if tl:
                short2 = tl if len(tl) <= 14 else tl[:14] + '…'
                self.canvas.create_text(x1 + 3, y0 + 12, anchor=tk.NW, text='译:' + short2,
                                        fill="#00e5ff", font=("Microsoft YaHei", 9))
        if self._drag:
            self.canvas.create_rectangle(*self._drag, outline="#ffff00", width=2)
        if self._paint_pts:
            for x, y in self._paint_pts:
                r = 4
                self.canvas.create_oval(x-r, y-r, x+r, y+r, fill="#ffff00", outline="")
        n = len(self.page_boxes)
        extra = "  ⚠本页无标框,按 → 翻页" if n == 0 else ""
        self.status.config(
            text=f"{self.idx+1}/{len(self.pages)}  {self.pages[self.idx]}  框数:{n}{extra}")

    def _draw_box(self, b, outline, width=2):
        x0, y0 = b["x"] * self._scale, b["y"] * self._scale
        x1, y1 = (b["x"] + b["w"]) * self._scale, (b["y"] + b["h"]) * self._scale
        self.canvas.create_rectangle(x0, y0, x1, y1, outline=outline, width=width)

    # ---------- 刷新 ----------
    def refresh(self):
        """重新适配画布尺寸并重画(标框不显示时用)。"""
        try:
            if self._img is not None:
                self._fit()
        except Exception:
            pass
        self._redraw()

    def _on_configure(self, e):
        """画布尺寸变化时重新适配(绑在 canvas 上,布局完成后才会触发)。"""
        if e.widget is not self.canvas:
            return
        size = (e.width, e.height)
        if size == getattr(self, '_last_size', None):
            return
        self._last_size = size
        self.refresh()

    # ---------- 鼠标 ----------
    def on_down(self, e):
        if self.mode.get() == "box":
            self._drag = (e.x, e.y, e.x, e.y)
        else:
            self._paint_pts = [(e.x, e.y)]

    def on_drag(self, e):
        if self.mode.get() == "box":
            if self._drag:
                x0, y0, _, _ = self._drag
                self._drag = (x0, y0, e.x, e.y)
        else:
            self._paint_pts.append((e.x, e.y))
        self._redraw()

    def on_up(self, e):
        if self.mode.get() == "box":
            if self._drag:
                x0, y0, x1, y1 = self._drag
                self._drag = None
                if abs(x1 - x0) > 3 and abs(y1 - y0) > 3:
                    self._add_box(min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0))
        else:
            pts = self._paint_pts
            self._paint_pts = []
            if pts:
                xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                _sid = self._box_style()
                _sf = self._style_fields(_sid)
                b = {
                    "x": round(min(xs) / self._scale),
                    "y": round(min(ys) / self._scale),
                    "w": round((max(xs) - min(xs)) / self._scale),
                    "h": round((max(ys) - min(ys)) / self._scale),
                    "vertical": bool(self.vertical.get()),
                    "size": self._size_val(),
                    "erase": bool(self.erase.get()),
                    "sfx": bool(self.sfx.get()),
                    "style": _sf['style'], "color": _sf['color'], "outline": _sf['outline'],
                    # 涂抹模式:存原始笔画点,擦除时用自由形状遮罩
                    "points": [[round(x / self._scale), round(y / self._scale)] for x, y in pts],
                }
                self.page_boxes.append(b)
        self._redraw()

    def on_right(self, e):
        # 删除命中的框
        for i, b in enumerate(self.page_boxes):
            x0, y0 = b["x"] * self._scale, b["y"] * self._scale
            x1, y1 = (b["x"] + b["w"]) * self._scale, (b["y"] + b["h"]) * self._scale
            if x0 <= e.x <= x1 and y0 <= e.y <= y1:
                self.page_boxes.pop(i)
                break
        self._redraw()

    def _box_style(self):
        """新框的样式 id:勾选拟声词时用拟声词样式,否则用正文样式。"""
        if self.sfx.get():
            return self.sfx_style_id.get() or styles.DEFAULT_SFX
        return self.body_style_id.get() or styles.DEFAULT_BODY

    def _style_fields(self, sid):
        """样式 id → 同时写入新字段 style 和旧字段(color/outline),保证旧版本也能读。"""
        st = styles.resolve({'style': sid})
        fill = st.get('fill') or (0, 0, 0)
        white = sum(fill) > 384
        return {
            'style': sid,
            'color': 'white' if white else 'black',
            'outline': bool(st.get('stroke')),
        }

    def _add_box(self, dx0, dy0, dw, dh):
        _sf = self._style_fields(self._box_style())
        b = {
            "x": round(dx0 / self._scale),
            "y": round(dy0 / self._scale),
            "w": round(dw / self._scale),
            "h": round(dh / self._scale),
            "vertical": bool(self.vertical.get()),
            "size": self._size_val(),
            "erase": bool(self.erase.get()),
            "sfx": bool(self.sfx.get()),
            "style": _sf['style'], "color": _sf['color'], "outline": _sf['outline'],
        }
        self.page_boxes.append(b)

    # ---------- 可视化样式库 ----------
    def _build_style_group(self, parent, kind, title):
        frame = tk.Frame(parent)
        frame.pack(side=tk.LEFT, padx=(0, 10))
        ids = styles.BODY_IDS if kind == 'body' else styles.SFX_IDS
        lbl = tk.Label(frame, text=title, fg='#2a5d8f', width=9, anchor='w',
                       font=('Microsoft YaHei', 8, 'bold'))
        lbl.pack(side=tk.LEFT)
        setattr(self, '_style_lbl_' + kind, lbl)
        for sid in ids:
            photo = _style_preview_photo(sid)
            btn = tk.Button(frame, image=photo, relief='ridge', bd=1, padx=0, pady=0,
                            cursor='hand2', command=lambda s=sid: self._pick_style(kind, s))
            btn.pack(side=tk.LEFT, padx=1)
            self._style_btns[kind][sid] = btn

    def _pick_style(self, kind, sid):
        var = self.body_style_id if kind == 'body' else self.sfx_style_id
        var.set(sid)
        self._refresh_style_buttons()
        p = styles.preset(sid) or {}
        self.status.config(text='已选%s样式:%s(%s)' % (
            '拟声词' if kind == 'sfx' else '正文', p.get('label', sid), p.get('desc', '')))

    def _refresh_style_buttons(self):
        for kind, var, name in (('body', self.body_style_id, '正文'),
                                ('sfx', self.sfx_style_id, '拟声')):
            cur = var.get()
            for sid, btn in self._style_btns.get(kind, {}).items():
                on = (sid == cur)
                btn.config(relief='sunken' if on else 'ridge', bd=2 if on else 1)
            lbl = getattr(self, '_style_lbl_' + kind, None)
            if lbl is not None:
                p = styles.preset(cur) or {}
                lbl.config(text='%s:%s' % (name, p.get('label', '') or '—'))

    def apply_style_page(self):
        """把当前选中的正文 / 拟声词样式应用到本页所有对应框。"""
        body_sid = self.body_style_id.get()
        sfx_sid = self.sfx_style_id.get()
        nb = ns = 0
        for b in self.page_boxes:
            if bool(b.get('sfx')):
                b.update(self._style_fields(sfx_sid))
                ns += 1
            else:
                b.update(self._style_fields(body_sid))
                nb += 1
        self._redraw()
        self.status.config(text='已把样式应用到本页:正文 %d 框 / 拟声 %d 框(记得保存)' % (nb, ns))

    # ---------- 按钮 ----------
    def prev_page(self):
        if self.idx > 0:
            self._goto(self.idx - 1)

    def next_page(self):
        if self.idx < len(self.pages) - 1:
            self._goto(self.idx + 1)

    def undo(self):
        if self.page_boxes:
            self.page_boxes.pop()
        self._redraw()

    def clear_page(self):
        self.page_boxes = []
        self._redraw()

    def save_btn(self):
        try:
            self._save()
            n = len(self.page_boxes)
            messagebox.showinfo("已保存",
                f"本页 {n} 个框已保存到:\n{self.regions_file}\n\n(翻页时会自动保存,可放心切换页面)")
        except Exception as e:
            messagebox.showerror("保存失败", f"写入文件出错:\n{e}")

    # ---------- 帮助 ----------
    def show_help(self):
        _show_help_window(self.root)

    # ---------- 翻译 ----------
    def translate_settings(self):
        """翻译引擎多选 + 代理设置。"""
        dlg = tk.Toplevel(self.root)
        dlg.title('翻译设置')
        dlg.geometry('720x400')
        dlg.transient(self.root)

        tk.Label(dlg, text='翻译引擎(可多选,并行查询,取最快返回):',
                 anchor='w').pack(fill=tk.X, padx=14, pady=(14, 6))
        eng_vars = {}
        frm = tk.Frame(dlg)
        frm.pack(fill=tk.X, padx=14)
        for key, name in (('google', 'Google 免费(需机场/代理)'),
                          ('mymemory', 'MyMemory 免费(免机场)'),
                          ('ai', '交给 DSH 里的 AI 翻译(免机场)')):
            v = tk.BooleanVar(value=key in self.trans_cfg.get('engines', []))
            eng_vars[key] = v
            tk.Checkbutton(frm, text=name, variable=v).pack(side=tk.LEFT, padx=(0, 12))

        tk.Label(dlg, text='代理(可选;Google 在国内需要先开机场/代理):',
                 anchor='w').pack(fill=tk.X, padx=14, pady=(16, 6))
        proxy_var = tk.StringVar(value=self.trans_cfg.get('proxy', ''))
        tk.Entry(dlg, textvariable=proxy_var, width=60).pack(fill=tk.X, padx=14)

        tip = ('提示:\n'
               '· 【免机场】MyMemory、交给 DSH 的 AI 翻译 —— 国内可直连\n'
               '· 【需机场】Google —— 国内需先打开机场软件,把代理地址填到上面(如 http://127.0.0.1:1080)\n'
               '· 同时勾选多个在线引擎会并行查询,取最先返回的成功结果\n'
               '· 勾选「交给 AI」后,点「翻译」会导出请求,由 DSH 会话里的 AI 翻译')
        tk.Label(dlg, text=tip, fg='#555', justify='left', anchor='w').pack(fill=tk.X, padx=14, pady=(10, 0))

        def ok():
            chosen = [k for k, v in eng_vars.items() if v.get()]
            self.trans_cfg['engines'] = chosen or ['mymemory']
            self.trans_cfg['proxy'] = proxy_var.get().strip()
            _save_trans_cfg(self.trans_cfg)
            dlg.destroy()

        bf = tk.Frame(dlg)
        bf.pack(pady=16)
        tk.Button(bf, text='保存', command=ok, width=10).pack(side=tk.LEFT, padx=8)
        tk.Button(bf, text='取消', command=dlg.destroy, width=10).pack(side=tk.LEFT, padx=8)

    def translate_text(self):
        """免费在线翻译:按范围翻译 OCR 原文,写入 trans.json。后台线程 + 流式日志。"""
        if self._any_task_running():
            self._job_busy_msg()
            return
        self._save()
        here, vpy, env = self._job_env()
        env['PYTHONIOENCODING'] = 'utf-8'
        scope = self.scope.get()
        key = self._page_key()
        engines = self.trans_cfg.get('engines') or ['google', 'mymemory']
        if 'ai' in engines:
            self._export_ai_request()
            return
        online = [e for e in engines if e in ('google', 'mymemory')] or ['mymemory']
        cmd = [vpy, os.path.join(here, 'translate.py'), self.src_dir]
        cmd += ['--engines', ','.join(online), '--from', self.lang.get()]
        proxy = (self.trans_cfg.get('proxy') or '').strip()
        if proxy:
            cmd += ['--proxy', proxy]
        if scope == 'page':
            cmd += ['--page', key]
        self._run_job('翻译', cmd, env,
                      on_line=lambda l: self.status.config(text='翻译中: ' + l),
                      on_done=self._trans_done)

    def _trans_done(self, err, code, lines):
        if err:
            self.status.config(text='翻译失败')
            messagebox.showerror('翻译失败', err)
            return
        self.trans = self._load(self.trans_file)
        self._snapshot()
        self.refresh()
        info = lines[-1] if lines else ''
        messagebox.showinfo('翻译完成', info or '翻译完成')

    def _export_ai_request(self):
        """把待翻译的页/框导出为请求文件,交给 DSH 会话里的 AI 处理。"""
        pages = []
        for p, texts in self.box_text.items():
            trans = self.trans.get(p, [])
            need = [i for i in range(len(texts))
                    if str(texts[i]).strip() and not (i < len(trans) and str(trans[i]).strip())]
            if need:
                pages.append({'page': p, 'boxes': need})
        req = {'folder': self.src_dir, 'pages': pages}
        path = os.path.join(self.src_dir, '_ai_translate_request.json')
        try:
            json.dump(req, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        except Exception as e:
            messagebox.showerror('导出失败', str(e))
            return
        messagebox.showinfo(
            '已导出 AI 翻译请求',
            f'请求已写入:\n{path}\n\n'
            f'待翻译页数:{len(pages)}\n\n'
            '请切到 DSH 会话,对 AI 说:\n「处理翻译请求」或「翻译这个文件夹」')

    # ---------- 重标后同步 ----------
    def resync(self):
        """重新标注后同步:整本重跑 OCR → 翻译 → 校对,避免译文与框顺序错位。"""
        if any(getattr(self, a, False) for a in
               ('_ocr_running', '_detect_running', '_trans_running', '_sync_running')):
            messagebox.showinfo('提示', '正在处理中,请稍候...')
            return
        if not messagebox.askyesno(
                '重标后同步',
                '将整本重跑:\n1. 自动识别(OCR)\n2. 翻译\n3. 校对(原文+译文)\n\n'
                '会覆盖 ocr_text.json / trans.json 中对应页的旧内容。\n继续吗?'):
            return
        import threading, queue, subprocess
        here, vpy, env = self._job_env()
        env['PYTHONIOENCODING'] = 'utf-8'
        self._save()
        engines = self.trans_cfg.get('engines') or ['google', 'mymemory']
        online = [e for e in engines if e in ('google', 'mymemory')]
        proxy = (self.trans_cfg.get('proxy') or '').strip()
        self._sync_running = True
        self._sync_queue = queue.Queue()
        self.status.config(text='重标同步 1/3:整本 OCR...')
        self.root.configure(cursor='watch')
        q = self._sync_queue

        def run(cmd, label, timeout=7200):
            r = subprocess.run(cmd, env=env, capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=timeout)
            if r.returncode != 0:
                raise RuntimeError(label + ' 失败:' + ((r.stderr or '')[-500:] or ('退出码 %d' % r.returncode)))

        def worker():
            err = None
            note = ''
            try:
                # 1) OCR 整本
                run([vpy, os.path.join(here, 'ocr_regions.py'), self.src_dir,
                     '--lang', self.lang.get()], 'OCR')
                # 2) 翻译整本(有在线引擎才跑;只有 AI 则稍后导出请求)
                if online:
                    q.put(('status', '重标同步 2/3:整本翻译...'))
                    cmd = [vpy, os.path.join(here, 'translate.py'), self.src_dir,
                           '--engines', ','.join(online), '--from', self.lang.get()]
                    if proxy:
                        cmd += ['--proxy', proxy]
                    run(cmd, '翻译')
                else:
                    note = '已选 AI 翻译,请点「翻译」导出请求'
                # 3) 校对
                q.put(('status', '重标同步 3/3:校对...'))
                run([vpy, os.path.join(here, 'proofread.py'), self.src_dir,
                     '--stage', 'pre', '--mode', 'both'], '校对')
            except Exception as e:
                err = str(e)
            q.put(('done', (err, note)))

        threading.Thread(target=worker, daemon=True).start()
        self.root.after(300, self._poll_resync)

    def _poll_resync(self):
        import queue
        try:
            kind, payload = self._sync_queue.get_nowait()
        except queue.Empty:
            if getattr(self, '_sync_running', False):
                self.root.after(300, self._poll_resync)
            return
        if kind == 'status':
            self.status.config(text=payload)
            self.root.after(200, self._poll_resync)
            return
        err, note = payload
        self._sync_running = False
        self.root.configure(cursor='')
        if err:
            self.status.config(text='重标同步失败')
            messagebox.showerror('重标同步失败', err)
            return
        self.box_text = self._load(self.ocr_file)
        self._snapshot()
        self.trans = self._load(self.trans_file)
        self.refresh()
        self.status.config(text='重标同步完成')
        messagebox.showinfo('重标同步完成',
                            '整本 OCR → 翻译 → 校对 已完成。\n\n'
                            + (note + '\n\n' if note else '')
                            + '下一步:点「校对(嵌字前)」看报告,确认后嵌字。')

    # ---------- 校对(嵌字前) ----------
    def proofread_pre(self):
        """嵌字前校对:后台跑 proofread.py,结果弹窗展示(不再卡界面)。"""
        if self._any_task_running():
            self._job_busy_msg()
            return
        self._save()
        here, vpy, env = self._job_env()
        env['PYTHONIOENCODING'] = 'utf-8'
        mode = 'orig' if self.proof_mode.get() == '只校原文' else 'both'
        cmd = [vpy, os.path.join(here, 'proofread.py'), self.src_dir, '--stage', 'pre', '--mode', mode]
        self._run_job('校对', cmd, env,
                      on_line=lambda l: self.status.config(text='校对中: ' + l),
                      on_done=self._proof_done)

    def _proof_done(self, err, code, lines):
        report = ('\n'.join(lines)).strip()
        if err:
            self.status.config(text='校对失败')
            messagebox.showerror('校对失败', err)
            return
        self.status.config(text='校对完成')
        dlg = tk.Toplevel(self.root)
        dlg.title('嵌字前校对')
        dlg.geometry('780x540')
        dlg.transient(self.root)
        txt = tk.Text(dlg, wrap='word', font=('Microsoft YaHei', 10))
        txt.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)
        txt.insert('1.0', report or '(无输出)')
        txt.config(state='disabled')
        tk.Button(dlg, text='关闭', command=dlg.destroy, width=10).pack(pady=6)

    # ---------- OCR 识别 / 修改 ----------
    def run_ocr(self):
        """整本/当前页 OCR:后台线程 + 逐行进度。"""
        if self._any_task_running():
            self._job_busy_msg()
            return
        here, vpy, env = self._job_env()
        env['PYTHONIOENCODING'] = 'utf-8'
        cmd = [vpy, os.path.join(here, 'ocr_regions.py'), self.src_dir, '--lang', self.lang.get()]
        if self.scope.get() == 'page':
            cmd += ['--page', self._page_key()]
        self._run_job('识别', cmd, env,
                      on_line=lambda l: self.status.config(text='识别中: ' + l),
                      on_done=self._ocr_done)

    def _ocr_done(self, err, code, lines):
        if err:
            self.status.config(text='识别失败')
            messagebox.showerror('OCR 失败', err)
            return
        self.box_text = self._load(self.ocr_file)
        self._snapshot()
        self.refresh()
        # 按配置接「视觉引擎兜底」(空/极短框重读)
        cfg = _load_ocr_cfg()
        if cfg.get('mode') and cfg['mode'] != 'off':
            here, vpy, env = self._job_env()
            fb = os.path.join(here, 'ocr_fallback.py')
            if os.path.exists(fb):
                cmd = [vpy, fb, self.src_dir, '--mode', str(cfg['mode']),
                       '--min-chars', str(int(cfg['minChars'])),
                       '--max', str(int(cfg['maxPerBook']))]
                if self.lang.get():
                    cmd += ['--lang', self.lang.get()]
                self._run_job('OCR兜底', cmd, env,
                              on_line=lambda l: self.status.config(text='OCR兜底: ' + l),
                              on_done=self._fallback_done)
                return
        messagebox.showinfo('识别完成', '识别结果已标在框旁(橙=原文,青=译文),双击框可分别修改')

    def _fallback_done(self, err, code, lines):
        """兜底结束:重新加载原文并汇报结果。"""
        self.box_text = self._load(self.ocr_file)
        self._snapshot()
        self.refresh()
        if err:
            self.status.config(text='OCR 兜底失败(本地 OCR 结果已保留)')
            messagebox.showwarning('OCR 兜底失败',
                                   '本地 OCR 已成功,但视觉引擎兜底失败:\n' + str(err)[:400])
            return
        summary = {}
        for ln in reversed(lines or []):
            ln = ln.strip()
            if ln.startswith('{') and 'candidates' in ln:
                try:
                    summary = json.loads(ln)
                except Exception:
                    pass
                break
        cand = summary.get('candidates', 0)
        fixed = summary.get('fixed', 0)
        failed = summary.get('failed', 0)
        if cand == 0:
            self.status.config(text='OCR 兜底:没有需要重读的框')
            return
        msg = ('视觉引擎兜底完成:\n候选 %d 框,修正 %d 框,失败 %d 框\n'
               'tokens: 输入 %s / 输出 %s' % (
                   cand, fixed, failed, summary.get('tokens_in', '?'), summary.get('tokens_out', '?')))
        if summary.get('truncated'):
            msg += '\n(已达每本上限,剩余框未处理,可在设置里调高)'
        self.status.config(text='OCR 兜底:修正 %d / 候选 %d' % (fixed, cand))
        messagebox.showinfo('OCR 兜底完成', msg)

    # ---------- 自动标框 ----------
    # ---------- 通用后台任务:线程 + 流式输出 + 可取消 ----------
    def _job_state(self):
        if not hasattr(self, '_job'):
            self._job = {'running': False, 'proc': None, 'name': '', 'cancelled': False}
        return self._job

    def _job_running(self):
        return bool(self._job_state().get('running'))

    def _any_task_running(self):
        """统一判断:新任务器在跑,或旧的多步任务(一键识别/重标同步)在跑。"""
        if self._job_running():
            return True
        return any(getattr(self, a, False) for a in
                   ('_ocr_running', '_detect_running', '_trans_running', '_sync_running', '_one_running'))

    def _job_busy_msg(self):
        st = self._job_state()
        messagebox.showinfo('提示', '正在执行「%s」,请先等它完成或点「取消当前任务」' % (st.get('name') or '任务'))

    def _run_job(self, name, cmd, env, on_line=None, on_done=None):
        """后台跑子进程:stdout 逐行回调 on_line(主线程),结束后回调 on_done(err, code, lines)。
        同一时间只允许一个任务。返回是否成功启动。"""
        st = self._job_state()
        if st['running']:
            self._job_busy_msg()
            return False
        st.update(running=True, name=name, proc=None, cancelled=False)
        self.status.config(text='%s:启动中...' % name)
        self.root.configure(cursor='watch')
        collected = []
        holder = {'proc': None}

        def worker():
            err = None
            code = 0
            try:
                proc = subprocess.Popen(
                    cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding='utf-8', errors='replace', bufsize=1,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                holder['proc'] = proc
                st['proc'] = proc
                for line in proc.stdout:
                    line = line.rstrip()
                    if not line:
                        continue
                    collected.append(line)
                    if on_line is not None:
                        self.root.after(0, lambda l=line: on_line(l))
                code = proc.wait()
                if code != 0 and not st.get('cancelled'):
                    tail = collected[-1] if collected else ''
                    err = '%s 失败(退出码 %d)%s' % (name, code, (': ' + tail) if tail else '')
                elif st.get('cancelled'):
                    err = None
            except Exception as e:
                err = str(e)
            self.root.after(0, lambda: self._job_finish(err, code, collected, on_done))

        threading.Thread(target=worker, daemon=True).start()
        return True

    def _job_finish(self, err, code, collected, on_done):
        st = self._job_state()
        cancelled = bool(st.get('cancelled'))
        st.update(running=False, proc=None, name='', cancelled=False)
        self.root.configure(cursor='')
        if cancelled:
            self.status.config(text='已取消当前任务')
            return
        if on_done is not None:
            try:
                on_done(err, code, collected)
            except Exception as e:
                self.status.config(text='任务收尾出错')
                messagebox.showerror('任务出错', str(e))

    def cancel_job(self):
        """取消当前任务:杀掉子进程树(Windows 用 taskkill /T /F)。"""
        st = self._job_state()
        proc = st.get('proc')
        if not st.get('running'):
            self.status.config(text='当前没有正在运行的任务')
            return
        st['cancelled'] = True
        if proc is None:
            self.status.config(text='已请求取消(进程还没起来)')
            return
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)],
                               capture_output=True, timeout=10)
            else:
                proc.terminate()
            self.status.config(text='已请求取消「%s」...' % (st.get('name') or '任务'))
        except Exception as e:
            messagebox.showerror('取消失败', str(e))

    def _shutdown_job(self):
        """窗口关闭前调用:终止还在跑的子进程,避免留下孤儿。"""
        st = self._job_state()
        proc = st.get('proc')
        st['cancelled'] = True
        if proc is not None:
            try:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)],
                                   capture_output=True, timeout=5)
                else:
                    proc.terminate()
            except Exception:
                pass

    def _job_env(self):
        here = os.path.dirname(os.path.abspath(__file__))
        vpy = os.path.join(BASE, '_venv', 'Scripts', 'python.exe')
        env = dict(os.environ)
        env['TORCH_HOME'] = os.path.join(BASE, '_torchcache')
        env['HF_HOME'] = os.path.join(BASE, '_hfcache')
        env['EASYOCR_MODULE_PATH'] = os.path.join(BASE, '_easyocr')
        env['PYTHONIOENCODING'] = 'utf-8'
        return here, vpy, env

    def auto_detect(self):
        """自动标框:按范围(当前页/整本)检测气泡内文字。"""
        if self._job_running() or getattr(self, '_detect_running', False) or getattr(self, '_ocr_running', False):
            messagebox.showinfo('提示', '正在处理中,请稍候...')
            return
        if self.scope.get() == 'book':
            self._detect_book()
        else:
            self._detect_page()

    def _detect_page(self):
        """当前页自动标框:后台线程 + 流式日志。"""
        if self._job_running():
            self._job_busy_msg()
            return
        here, vpy, env = self._job_env()
        img_path = os.path.join(self.src_dir, self.pages[self.idx])
        dflag = [] if self.bubble_only.get() else ['--all']
        cmd = [vpy, os.path.join(here, 'detect_boxes.py'), img_path] + dflag
        self._run_job('自动标框(本页)', cmd, env,
                      on_line=lambda l: self.status.config(text='自动标框中: ' + l),
                      on_done=self._detect_page_done)

    def _detect_page_done(self, err, code, lines):
        if err:
            self.status.config(text='自动标框失败')
            messagebox.showerror('自动标框失败', err)
            return
        boxes = []
        dropped = 0
        try:
            data = json.loads(lines[-1]) if lines else {}
            if isinstance(data, dict):
                boxes = data.get('boxes', [])
                dropped = data.get('dropped', 0)
            else:
                boxes = data
        except Exception as e:
            self.status.config(text='自动标框失败')
            messagebox.showerror('自动标框失败', '解析结果失败: %s' % e)
            return
        _sf = self._style_fields(self._box_style())
        for b in boxes:
            self.page_boxes.append({
                'x': b['x'], 'y': b['y'], 'w': b['w'], 'h': b['h'],
                'vertical': bool(self.vertical.get()),
                'size': self._size_val(),
                'erase': bool(self.erase.get()),
                'sfx': bool(self.sfx.get()),
                'style': _sf['style'], 'color': _sf['color'], 'outline': _sf['outline'],
                'auto': True,          # 自动标框的框:不参与嵌字(除非人工改过字)
            })
        self.refresh()
        self.status.config(text='自动标框:本页新增 %d 个框,排除 %d 个拟声词/无框文字' % (len(boxes), dropped))

    def _detect_book(self):
        """整本自动标框:后台线程 + 流式日志。"""
        if self._job_running():
            self._job_busy_msg()
            return
        here, vpy, env = self._job_env()
        self._save()
        bflag = [] if self.bubble_only.get() else ['--all']
        cmd = [vpy, os.path.join(here, 'detect_book.py'), self.src_dir] + bflag
        self._run_job('自动标框(整本)', cmd, env,
                      on_line=lambda l: self.status.config(text='整本自动标框中: ' + l),
                      on_done=self._detect_book_done)

    def _detect_book_done(self, err, code, lines):
        if err:
            self.status.config(text='整本自动标框失败')
            messagebox.showerror('整本自动标框失败', err)
            return
        summary = {}
        try:
            summary = json.loads(lines[-1]) if lines else {}
        except Exception:
            summary = {}
        self.regions = self._load(self.regions_file)
        self._snapshot()
        self._load_page()
        self.status.config(text='整本自动标框完成:新增 %s 个框,排除 %s 个' % (
            summary.get('boxes', 0), summary.get('dropped', 0)))
        messagebox.showinfo('整本自动标框完成',
                            '处理 %s 页\n新增 %s 个框\n排除 %s 个拟声词/无框文字' % (
                                summary.get('pages', 0), summary.get('boxes', 0), summary.get('dropped', 0)))

    # ---------- 一键识别(标框 → OCR) ----------
    def one_click(self):
        """一键识别:整本自动标框 → 整本 OCR(与「范围」无关,始终处理整本)。

        状态栏实时显示两个脚本的进度行。处理完自动重载当前页数据。
        """
        if self._job_running() or getattr(self, '_ocr_running', False):
            messagebox.showinfo('提示', '正在处理中,请稍候...')
            return
        import threading, queue
        here, vpy, env = self._job_env()
        self._save()
        self._ocr_running = True
        self._one_queue = queue.Queue()
        self.status.config(text='一键识别:整本自动标框中...')
        self.root.configure(cursor='watch')
        q = self._one_queue

        def stream(cmd, timeout):
            """跑子进程,逐行把进度推到状态栏,返回 (退出码, 全部行, 错误尾巴)。

            关键:stderr 合并进 stdout —— 否则子进程把日志写满 stderr 管道会卡死;
            另起看门狗线程,超时直接杀进程,避免永久卡住。
            """
            import subprocess as sp
            lines = []
            p = sp.Popen(cmd, env=env, stdout=sp.PIPE, stderr=sp.STDOUT,
                         text=True, encoding='utf-8', errors='replace', bufsize=1,
                         creationflags=getattr(sp, 'CREATE_NO_WINDOW', 0))
            killed = {'timeout': False}

            def watchdog():
                try:
                    p.wait(timeout=timeout)
                except Exception:
                    killed['timeout'] = True
                    try:
                        p.kill()
                    except Exception:
                        pass

            threading.Thread(target=watchdog, daemon=True).start()
            for raw in iter(p.stdout.readline, ''):
                ln = raw.rstrip()
                if not ln:
                    continue
                lines.append(ln)
                # 只把「进度/关键」行推到状态栏,避免 INFO 日志刷屏
                if ('进度' in ln) or ('完成' in ln) or ('新增' in ln):
                    self.root.after(0, lambda l=ln: self.status.config(text='一键识别: ' + l))
            code = p.wait()
            if killed['timeout']:
                raise RuntimeError('处理超时(%d 秒),已终止。可改用「自动标框」+「自动识别」分步执行' % timeout)
            return code, lines, ''

        def worker():
            err_msg = None
            info = ''
            try:
                # ---- 1) 整本自动标框 ----
                bflag = [] if self.bubble_only.get() else ['--all']
                code, lines, serr = stream(
                    [vpy, os.path.join(here, 'detect_book.py'), self.src_dir] + bflag, 7200)
                if code != 0:
                    raise RuntimeError((serr or '')[-600:] or '自动标框失败')
                meta = {}
                for ln in reversed(lines):
                    if ln.strip().startswith('{'):
                        try:
                            meta = json.loads(ln)
                        except Exception:
                            meta = {}
                        break
                n_pages = meta.get('pages', 0)
                n_boxes = meta.get('boxes', 0)
                # ---- 2) 整本 OCR(不带 --page)----
                code2, lines2, serr2 = stream(
                    [vpy, os.path.join(here, 'ocr_regions.py'), self.src_dir, '--lang', self.lang.get()], 7200)
                if code2 != 0:
                    raise RuntimeError((serr2 or '')[-600:] or 'OCR 失败')
                ocr_pages = 0
                for ln in reversed(lines2):
                    if 'OCR 完成' in ln:
                        try:
                            ocr_pages = int(ln.split('OCR 完成:')[1].strip().split(' ')[0])
                        except Exception:
                            pass
                        break
                info = '整本 %d 页,新增框 %d 个,OCR %d 页' % (n_pages, n_boxes, ocr_pages)
            except Exception as e:
                err_msg = str(e)
            q.put((err_msg, info))

        threading.Thread(target=worker, daemon=True).start()
        self.root.after(200, self._poll_one)

    def _poll_one(self):
        import queue
        try:
            err, info = self._one_queue.get_nowait()
        except queue.Empty:
            if getattr(self, '_ocr_running', False):
                self.root.after(200, self._poll_one)
            return
        self._ocr_running = False
        self.root.configure(cursor='')
        if err:
            self.status.config(text='一键识别失败')
            messagebox.showerror('一键识别失败', err)
            return
        self.regions = self._load(self.regions_file)
        self._snapshot()
        self.box_text = self._load(self.ocr_file)
        self.trans = self._load(self.trans_file)
        self._snapshot()
        self._load_page()
        messagebox.showinfo('一键识别完成', f"{info}。\n橙色为原文,青色为译文,双击可修改。\n(一键识别始终处理整本;只做当前页请用「自动识别(OCR)」)")

    def _box_at(self, e):
        for i, b in enumerate(self.page_boxes):
            x0, y0 = b['x'] * self._scale, b['y'] * self._scale
            x1, y1 = (b['x'] + b['w']) * self._scale, (b['y'] + b['h']) * self._scale
            if x0 <= e.x <= x1 and y0 <= e.y <= y1:
                return i
        return -1

    def on_double(self, e):
        i = self._box_at(e)
        if i < 0:
            return
        self._edit_texts(i)

    def _save_texts(self):
        try:
            merged = self._merge_save(self.ocr_file, self.box_text,
                                      getattr(self, '_base_text', self.box_text))
            json.dump(merged, open(self.ocr_file, 'w', encoding='utf-8'),
                      ensure_ascii=False, indent=1)
            self.box_text = merged
        except Exception:
            pass
        try:
            merged = self._merge_save(self.trans_file, self.trans,
                                      getattr(self, '_base_trans', self.trans))
            json.dump(merged, open(self.trans_file, 'w', encoding='utf-8'),
                      ensure_ascii=False, indent=1)
            self.trans = merged
        except Exception:
            pass
        self._snapshot()

    def _edit_texts(self, i):
        key = self._page_key()
        texts = self.box_text.setdefault(key, [])
        trans = self.trans.setdefault(key, [])
        while len(texts) < len(self.page_boxes):
            texts.append('')
        while len(trans) < len(self.page_boxes):
            trans.append('')
        dlg = tk.Toplevel(self.root)
        dlg.title(f'框[{i}] 原文 / 译文')
        dlg.geometry('620x230')
        dlg.transient(self.root)
        tk.Label(dlg, text='原文(OCR识别,可改):').pack(anchor='w', padx=10, pady=(10, 2))
        e1 = tk.Entry(dlg, width=80)
        e1.pack(padx=10, fill=tk.X)
        e1.insert(0, texts[i])
        tk.Label(dlg, text='译文(中文,可改):').pack(anchor='w', padx=10, pady=(10, 2))
        e2 = tk.Entry(dlg, width=80)
        e2.pack(padx=10, fill=tk.X)
        e2.insert(0, trans[i])

        def ok():
            texts[i] = e1.get()
            trans[i] = e2.get()
            self.box_text[key] = texts
            self.trans[key] = trans
            # 人工改过字 → 该框标记为"已确认",参与后续嵌字
            if i < len(self.page_boxes):
                self.page_boxes[i]['auto'] = False
            self._save_texts()
            self._save()
            dlg.destroy()
            self.refresh()

        bf = tk.Frame(dlg)
        bf.pack(pady=10)
        tk.Button(bf, text='保存', command=ok, width=10).pack(side=tk.LEFT, padx=6)
        tk.Button(bf, text='取消', command=dlg.destroy, width=10).pack(side=tk.LEFT, padx=6)
        e1.focus_set()
        dlg.bind('<Return>', lambda ev: ok())
        dlg.bind('<Escape>', lambda ev: dlg.destroy())


def _engine_status():
    """检测本地引擎是否齐全。返回 [(标签, 是否可用, 缺失说明)]。"""
    base = BASE
    vpy = os.path.join(base, '_venv', 'Scripts', 'python.exe')
    site = os.path.join(base, '_venv', 'Lib', 'site-packages')
    items = []
    items.append(('Python 环境(_venv)', os.path.exists(vpy), '缺少 _venv,无法运行 OCR/去字'))
    items.append(('PyTorch(CUDA)', os.path.isdir(os.path.join(site, 'torch')), '缺少 torch'))
    items.append(('日文 OCR(manga-ocr)', os.path.isdir(os.path.join(site, 'manga_ocr')), '缺少 manga-ocr'))
    items.append(('韩文 OCR(easyocr)', os.path.isdir(os.path.join(site, 'easyocr')), '缺少 easyocr'))
    items.append(('GPU 去字(iopaint)', os.path.isdir(os.path.join(site, 'iopaint')), '缺少 iopaint'))
    items.append(('LaMa 模型', os.path.exists(os.path.join(base, '_torchcache', 'hub', 'checkpoints', 'big-lama.pt')),
                  '缺少 big-lama.pt'))
    items.append(('manga-ocr 模型', os.path.isdir(os.path.join(base, '_hfcache', 'hub', 'models--kha-white--manga-ocr-base')),
                  '缺少 manga-ocr 模型缓存'))
    items.append(('EasyOCR 模型', os.path.isdir(os.path.join(base, '_easyocr', 'model')), '缺少 EasyOCR 模型'))
    return items


def _repair_keyword(missing):
    """生成交给 DSH AI 的修复关键词。"""
    lines = [
        f'请帮我在 {BASE} 修复漫画汉化工具缺失的本地引擎。',
        '',
        '当前缺失:' + '、'.join(missing),
        '',
        '要求:',
        '1. 检查 _venv(虚拟环境)是否存在,没有就创建;',
        '2. 用 _venv 的 pip 安装缺失的包:',
        '   - torch / torchvision(CUDA 版,匹配本机显卡)',
        '   - manga-ocr(Manga OCR,日文)',
        '   - easyocr(韩文)',
        '   - iopaint(LaMa GPU 去字)',
        '3. 下载模型缓存到:',
        '   - _torchcache/hub/checkpoints/big-lama.pt(LaMa 模型)',
        '   - _hfcache(manga-ocr 模型)',
        '   - _easyocr/model(EasyOCR 检测/韩文模型)',
        '4. 装好后运行 mark_tool.py 的引擎检测,确认全部可用;',
        '5. 全部装到 E 盘,不要占 C 盘。',
    ]
    return '\n'.join(lines)


def _show_engine_help(parent, statuses):
    """引擎检测结果 + 修复帮助窗口。"""
    dlg = tk.Toplevel(parent)
    dlg.title('引擎检测与修复帮助')
    dlg.geometry('760x560')
    dlg.transient(parent)

    frame = tk.Frame(dlg)
    frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=8)
    sb = tk.Scrollbar(frame)
    sb.pack(side=tk.RIGHT, fill=tk.Y)
    txt = tk.Text(frame, wrap='word', font=('Microsoft YaHei', 10), yscrollcommand=sb.set)
    txt.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    sb.config(command=txt.yview)

    missing = [label for label, ok, _ in statuses if not ok]
    txt.insert('end', '【引擎检测结果】\n')
    for label, ok, hint in statuses:
        txt.insert('end', f'  {"✅" if ok else "❌"} {label}   {"" if ok else "(" + hint + ")"}\n')

    txt.insert('end', '\n【缺失时怎么修复】\n')
    if not missing:
        txt.insert('end', '  所有引擎齐全,无需修复。\n')
    else:
        txt.insert('end', '  1. 点下方「复制修复关键词」\n')
        txt.insert('end', '  2. 打开 DSH(DeepSeek Harness)\n')
        txt.insert('end', '  3. 新建一个工作区/会话,把关键词粘贴发送\n')
        txt.insert('end', '  4. 交给 DSH 里的 AI 自动完成安装与修复\n')
        txt.insert('end', '  5. 修复完成后重新打开本工具即可\n')

    txt.insert('end', '\n【需要安装什么】\n')
    for label, ok, hint in statuses:
        if not ok:
            txt.insert('end', f'  · {label}:{hint}\n')

    txt.insert('end', '\n提示:安装体积较大(约 5-6 GB),请确保 E 盘有足够空间,'
                      '并全程装到 E 盘不要占 C 盘。\n')
    txt.config(state='disabled')

    kw = _repair_keyword(missing) if missing else '引擎已齐全,无需修复。'

    def copy_kw():
        try:
            dlg.clipboard_clear()
            dlg.clipboard_append(kw)
            messagebox.showinfo('已复制', '修复关键词已复制到剪贴板,\n请粘贴到 DSH 新建的工作区里。')
        except Exception as e:
            messagebox.showerror('复制失败', str(e))

    bf = tk.Frame(dlg)
    bf.pack(pady=8)
    tk.Button(bf, text='复制修复关键词', command=copy_kw, width=16).pack(side=tk.LEFT, padx=8)
    tk.Button(bf, text='关闭', command=dlg.destroy, width=10).pack(side=tk.LEFT, padx=8)


def _norm_box(b):
    """兼容旧字段:无文本框标注(nobox) → 抹除原文(erase)。"""
    if 'erase' not in b:
        b = dict(b)
        b['erase'] = not b.pop('nobox', False)
    b.setdefault('sfx', bool(b.get('points')))
    return b


def _last_file():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), '_last_folder.txt')


def _trans_cfg_file():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), '_translate_cfg.json')


def _load_trans_cfg():
    d = {'engines': ['google', 'mymemory'], 'proxy': ''}
    try:
        d.update(json.load(open(_trans_cfg_file(), encoding='utf-8')))
    except Exception:
        pass
    if not isinstance(d.get('engines'), list) or not d['engines']:
        d['engines'] = ['google', 'mymemory']
    return d


def _save_trans_cfg(d):
    try:
        json.dump(d, open(_trans_cfg_file(), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    except Exception:
        pass


# ---------- 双端共享的界面设置(~/.manga-workflow/settings.json) ----------
# sidebarEnabled      : 是否在 DSH 侧边栏显示「漫画工作台」(双端共享)
# rememberPathWeb     : 网页端是否记住上次路径(网页端改)
# rememberPathDesktop : 桌面端是否记住上次路径(桌面端改)
_UI_DEFAULTS = {'sidebarEnabled': True, 'bannerEnabled': True, 'rememberPathWeb': True, 'rememberPathDesktop': True}


def _ui_cfg_file():
    return os.path.join(os.path.expanduser('~'), '.manga-workflow', 'settings.json')


def _load_ui_cfg():
    out = dict(_UI_DEFAULTS)
    try:
        with open(_ui_cfg_file(), encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, dict):
            for k in _UI_DEFAULTS:
                if isinstance(d.get(k), bool):
                    out[k] = d[k]
    except Exception:
        pass
    return out


def _save_ui_cfg(patch):
    raw = {}
    try:
        with open(_ui_cfg_file(), encoding='utf-8') as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            raw = loaded          # 保留未知键,避免回写时被抹掉
    except Exception:
        raw = {}
    cur = _load_ui_cfg()
    for k in _UI_DEFAULTS:
        if k in patch and isinstance(patch[k], bool):
            cur[k] = patch[k]
    merged = dict(raw)
    merged.update(cur)
    p = _ui_cfg_file()
    d = os.path.dirname(p)
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    return cur


def _load_last():
    if not _load_ui_cfg().get('rememberPathDesktop', True):
        return ''
    try:
        p = open(_last_file(), encoding='utf-8').read().strip()
        return p if os.path.isdir(p) else ''
    except Exception:
        return ''


def _save_last(d):
    if not _load_ui_cfg().get('rememberPathDesktop', True):
        return
    try:
        open(_last_file(), 'w', encoding='utf-8').write(d)
    except Exception:
        pass


def _open_editor(src, regions):
    _save_last(src)          # 记住本次工作目录
    root = tk.Tk()
    root.title("漫画汉化 · 标框工具 " + APP_VERSION)
    root.geometry("1200x1000")
    try:
        root.state('zoomed')   # Windows 下最大化,保证整页可见
    except Exception:
        pass
    MarkTool(root, src, regions)
    root.mainloop()


# ---------------- 设置:视觉模型 / API(与网页端共用 settings.json) ----------------

def _settings_path():
    # modlens(DSH 识图桥)的配置:providers.openai 就是它的 OpenAI 兼容视觉后端
    return os.path.join(os.path.expanduser('~'), '.modlens', 'config.json')


def _load_settings():
    default = {
        'model': 'kimi-k3',
        'apiBase': 'https://api.moonshot.cn/v1',
        'apiKey': '',
    }
    try:
        with open(_settings_path(), encoding='utf-8') as f:
            d = json.load(f)
    except Exception:
        return dict(default)
    prov = (d or {}).get('providers') if isinstance(d, dict) else None
    if not isinstance(prov, dict):
        prov = {}
    v = prov.get('openai') if isinstance(prov.get('openai'), dict) else {}
    return {
        'model': str(v.get('model') or default['model']),
        'apiBase': str(v.get('baseUrl') or default['apiBase']),
        'apiKey': str(v.get('apiKey') or ''),
    }


def _save_settings(v):
    path = _settings_path()
    try:
        with open(path, encoding='utf-8') as f:
            base = json.load(f) or {}
    except Exception:
        base = {}
    if not isinstance(base, dict):
        base = {}
    prov = base.get('providers')
    if not isinstance(prov, dict):
        prov = {}
    cur = prov.get('openai') if isinstance(prov.get('openai'), dict) else {}
    entry = dict(cur)
    entry['baseUrl'] = v.get('apiBase', '')
    entry['apiKey'] = v.get('apiKey', '')
    entry['model'] = v.get('model', '')
    entry.setdefault('structuredOutput', True)
    entry.setdefault('extraBody', {'thinking': {'type': 'disabled'}})
    prov['openai'] = entry
    base['providers'] = prov
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(base, f, ensure_ascii=False, indent=2)


def _mask_key(k):
    if not k:
        return ''
    if len(k) <= 8:
        return '****'
    return k[:4] + '****' + k[-4:]


def _test_vision_api(model, api_base, api_key):
    """POST {apiBase}/chat/completions,返回 (ok, 说明)。"""
    import time as _time
    import urllib.request
    url = api_base.rstrip('/') + '/chat/completions'
    payload = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': 'ping'}],
        'max_tokens': 8,
        'stream': False,
    }).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = 'Bearer ' + api_key
    req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
    t0 = _time.time()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode('utf-8', 'replace')
        ms = int((_time.time() - t0) * 1000)
        reply = ''
        try:
            data = json.loads(body)
            reply = ((data.get('choices') or [{}])[0].get('message') or {}).get('content') or ''
        except Exception:
            pass
        tail = '  返回「%s」' % str(reply)[:60] if reply else ''
        return True, '连接成功 ✅  延迟 %dms%s' % (ms, tail)
    except Exception as e:
        ms = int((_time.time() - t0) * 1000)
        detail = ''
        try:
            detail = e.read().decode('utf-8', 'replace')[:300]
        except Exception:
            pass
        return False, ('连接失败 ❌  %s %s' % (e, detail)).strip() + '  (%dms)' % ms


def _test_vision_chat(model, api_base, api_key):
    """发一张"白底绿三角"的图给模型,验证它真会看图。返回 (ok, 说明)。"""
    import base64
    import io as _io
    import time as _time
    import urllib.request
    try:
        from PIL import Image, ImageDraw
    except Exception as e:
        return False, '缺少 Pillow,无法生成测试图:' + str(e)

    size = 128
    im = Image.new('RGB', (size, size), (255, 255, 255))
    ImageDraw.Draw(im).polygon(
        [(size // 2, 12), (12, size - 12), (size - 12, size - 12)], fill=(0, 170, 60))
    buf = _io.BytesIO()
    im.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')

    url = api_base.rstrip('/') + '/chat/completions'
    payload = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': '这张图里是什么形状、什么颜色?只回答"形状,颜色",例如:三角形,绿色'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + b64}},
        ]}],
        'max_tokens': 40,
        'stream': False,
    }).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = 'Bearer ' + api_key
    req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
    t0 = _time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode('utf-8', 'replace')
    except Exception as e:
        ms = int((_time.time() - t0) * 1000)
        detail = ''
        try:
            detail = e.read().decode('utf-8', 'replace')[:220]
        except Exception:
            pass
        low = (str(e) + detail).lower()
        hint = '\n提示:这个模型/接口可能不支持图片输入' if any(
            k in low for k in ('image', 'vision', 'multimodal', 'content')) else ''
        return False, ('识图测试失败 ❌  %s %s' % (e, detail)).strip() + '  (%dms)%s' % (ms, hint)

    ms = int((_time.time() - t0) * 1000)
    reply = ''
    try:
        data = json.loads(body)
        reply = ((data.get('choices') or [{}])[0].get('message') or {}).get('content') or ''
    except Exception:
        pass
    reply = str(reply)[:120]
    low = reply.lower()
    if ('绿' in reply or 'green' in low) and ('三角' in reply or 'triangle' in low):
        return True, '识图成功 ✅  延迟 %dms  模型回答「%s」' % (ms, reply)
    return False, ('接口通了但没看懂图 ⚠️  延迟 %dms  模型回答「%s」\n'
                   '期望「三角形,绿色」——该模型可能不支持视觉,或图片输入被忽略。') % (ms, reply)


# ---------------- 样式预览(和最终嵌字用同一套渲染) ----------------
_STYLE_PHOTO = {}          # (id,w,h) -> PhotoImage(防止被回收)


def _style_preview_photo(style_id, w=54, h=30):
    """用与嵌字完全相同的渲染器,画一张小样式缩略图(工具栏用)。"""
    key = (style_id, w, h)
    if key in _STYLE_PHOTO:
        return _STYLE_PHOTO[key]
    preset = styles.preset(style_id)
    bg = (250, 250, 252)
    if style_id in ('body_white', 'sfx_white'):
        bg = (64, 68, 78)          # 反白样式用深底,才看得出白字
    img = Image.new('RGB', (w, h), bg)
    d = ImageDraw.Draw(img)
    st = styles.resolve({'style': style_id})
    glyph = '音' if (preset or {}).get('kind') == 'sfx' else '正'
    size = 19
    font = styles.load_font(size, bool(st.get('bold')), bool(st.get('art')))
    bb = d.textbbox((0, 0), glyph, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    x = (w - tw) // 2 - bb[0]
    y = (h - th) // 2 - bb[1] - 2
    styles.draw_styled(d, (x, y), glyph, font, st, size)
    photo = ImageTk.PhotoImage(img)
    _STYLE_PHOTO[key] = photo
    return photo


# ---------------- 版本 ----------------
APP_VERSION = 'V1.8.2'

# ---------------- 帮助窗口(程序内渲染,不依赖 .md 文件关联)----------------

def _help_file():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'HELP.md')


def _render_markdown(txt, text):
    """轻量 Markdown 渲染:标题 / 代码块 / 列表 / 表格 / 粗体(不引入第三方依赖)。"""
    import re
    txt.tag_configure('h1', font=('Microsoft YaHei', 15, 'bold'), spacing1=6, spacing3=4)
    txt.tag_configure('h2', font=('Microsoft YaHei', 12, 'bold'), spacing1=10, spacing3=3)
    txt.tag_configure('h3', font=('Microsoft YaHei', 11, 'bold'), spacing1=8, spacing3=2)
    txt.tag_configure('code', font=('Consolas', 10), background='#f2f2f2', lmargin1=14, lmargin2=14)
    txt.tag_configure('table', font=('Consolas', 10), lmargin1=14, lmargin2=14)
    txt.tag_configure('thead', font=('Consolas', 10, 'bold'), lmargin1=14, lmargin2=14)
    txt.tag_configure('list', lmargin1=10, lmargin2=24)
    txt.tag_configure('quote', lmargin1=14, lmargin2=14, foreground='#555555')
    txt.tag_configure('bold', font=('Microsoft YaHei', 10, 'bold'))
    txt.tag_configure('body', font=('Microsoft YaHei', 10))

    lines = text.split('\n')
    i = 0
    in_code = False
    while i < len(lines):
        line = lines[i]

        # 代码块
        if line.strip().startswith('```'):
            in_code = not in_code
            i += 1
            continue
        if in_code:
            txt.insert('end', line + '\n', 'code')
            i += 1
            continue

        # 表格:连续以 | 开头的行
        if line.strip().startswith('|'):
            block = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                block.append(lines[i].strip())
                i += 1
            rows = []
            for b in block:
                if re.match(r'^\|[\s:\-|]+\|$', b):
                    continue          # 分隔行
                rows.append([c.strip() for c in b.strip('|').split('|')])
            if rows:
                import unicodedata

                def dw(text):
                    return sum(2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1 for ch in text)

                ncol = max(len(r) for r in rows)
                widths = []
                for j in range(ncol):
                    widths.append(max(dw(r[j]) if j < len(r) else 0 for r in rows))
                for ri, r in enumerate(rows):
                    cells = []
                    for j in range(ncol):
                        c = r[j] if j < len(r) else ''
                        cells.append(c + ' ' * max(0, widths[j] - dw(c)))
                    tag = 'thead' if ri == 0 else 'table'
                    txt.insert('end', ('  '.join(cells)).rstrip() + '\n', tag)
                txt.insert('end', '\n')
            continue

        # 标题
        if line.startswith('# '):
            txt.insert('end', line[2:].strip() + '\n', 'h1')
        elif line.startswith('## '):
            txt.insert('end', line[3:].strip() + '\n', 'h2')
        elif line.startswith('### '):
            txt.insert('end', line[4:].strip() + '\n', 'h3')
        elif line.startswith('> '):
            _insert_with_bold(txt, line[2:] + '\n', 'quote')
        elif re.match(r'^\s*([-*]|\d+\.)\s+', line):
            _insert_with_bold(txt, line + '\n', 'list')
        else:
            _insert_with_bold(txt, line + '\n', 'body')
        i += 1


def _insert_with_bold(txt, line, tag):
    """按 **粗体** 切段插入,自动去掉 ** 标记。"""
    import re
    pos = 0
    for m in re.finditer(r'\*\*(.+?)\*\*', line):
        if m.start() > pos:
            txt.insert('end', line[pos:m.start()], tag)
        txt.insert('end', m.group(1), (tag, 'bold') if tag else 'bold')
        pos = m.end()
    if pos < len(line):
        txt.insert('end', line[pos:], tag)


def _show_help_window(parent):
    """在程序内打开帮助(纯 Tk 渲染)。任何异常都只弹提示,绝不让程序退出。"""
    path = _help_file()
    try:
        text = open(path, encoding='utf-8').read()
    except Exception as e:
        text = '读取帮助文件失败:\n%s\n\n文件位置:%s' % (e, path)

    dlg = tk.Toplevel(parent)
    dlg.title('使用说明')
    dlg.geometry('900x700')
    try:
        dlg.transient(parent)
    except Exception:
        pass

    bar = tk.Frame(dlg)
    bar.pack(fill=tk.X, padx=8, pady=(8, 0))
    tk.Button(bar, text='关闭', command=dlg.destroy, width=8).pack(side=tk.RIGHT)
    tk.Label(bar, text='使用说明(流程 / 快捷键 / 双端差异 / 设置 / OCR 兜底)',
             font=('Microsoft YaHei', 9), fg='#666').pack(side=tk.LEFT)

    frame = tk.Frame(dlg)
    frame.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)
    sb = tk.Scrollbar(frame)
    sb.pack(side=tk.RIGHT, fill=tk.Y)
    txt = tk.Text(frame, wrap='word', font=('Microsoft YaHei', 10), yscrollcommand=sb.set)
    txt.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    sb.config(command=txt.yview)

    main_text, _, footer = text.partition('<!--FOOTER-->')
    _render_markdown(txt, main_text)
    txt.config(state='disabled')
    if footer.strip():
        tk.Label(dlg, text=footer.strip(), fg='#999999',
                 font=('Microsoft YaHei', 8), justify='center').pack(pady=(0, 8))
    return dlg


# ---------------- OCR 兜底(视觉引擎)----------------
# mode: off | empty(只补空框) | short(空+极短) | all(全部重读)
_OCR_DEFAULTS = {'mode': 'empty', 'minChars': 1, 'maxPerBook': 30}
_OCR_MODES = ('off', 'empty', 'short', 'all')
_OCR_MODE_LABELS = [
    ('off', '关闭'),
    ('empty', '仅空框'),
    ('short', '空框 + 极短'),
    ('all', '全部重读'),
]


def _ocr_cfg_file():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), '_ocr_cfg.json')


def _load_ocr_cfg():
    d = dict(_OCR_DEFAULTS)
    try:
        with open(_ocr_cfg_file(), encoding='utf-8') as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            if loaded.get('mode') in _OCR_MODES:
                d['mode'] = loaded['mode']
            for k in ('minChars', 'maxPerBook'):
                if isinstance(loaded.get(k), (int, float)):
                    d[k] = int(loaded[k])
    except Exception:
        pass
    d['minChars'] = max(0, min(20, d['minChars']))
    d['maxPerBook'] = max(1, min(500, d['maxPerBook']))
    return d


def _save_ocr_cfg(patch):
    cur = _load_ocr_cfg()
    if patch.get('mode') in _OCR_MODES:
        cur['mode'] = patch['mode']
    for k in ('minChars', 'maxPerBook'):
        try:
            cur[k] = int(patch.get(k, cur[k]))
        except Exception:
            pass
    cur['minChars'] = max(0, min(20, cur['minChars']))
    cur['maxPerBook'] = max(1, min(500, cur['maxPerBook']))
    try:
        with open(_ocr_cfg_file(), 'w', encoding='utf-8') as f:
            json.dump(cur, f, ensure_ascii=False, indent=1)
    except Exception:
        pass
    return cur


# ---------------- 成本预估 ----------------

# 官方参考价(元 / 百万 tokens;以 platform.kimi.com/docs/pricing/chat 为准)
_PRICE_PRESETS = {
    'kimi-k3': (20, 100),
    'kimi-k3.1-pro': (13, 52),
}

def _cost_cfg_file():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), '_cost_cfg.json')


def _load_cost_cfg():
    d = {'priceIn': '', 'priceOut': ''}
    try:
        with open(_cost_cfg_file(), encoding='utf-8') as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            d.update({k: loaded.get(k, d[k]) for k in d})
    except Exception:
        pass
    return d


def _save_cost_cfg(d):
    try:
        with open(_cost_cfg_file(), 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
    except Exception:
        pass


def _img_tokens(path_img, long_side=2048):
    """按 28px patch 估算单页输入 token;失败返回 0。"""
    try:
        from PIL import Image
        with Image.open(path_img) as im:
            w, hh = im.size
        sc = min(1.0, long_side / max(w, hh))
        fw, fh = max(1, round(w * sc)), max(1, round(hh * sc))
        return -(-fw // 28) * -(-fh // 28)
    except Exception:
        return 0


def _cost_estimate(book_dir, price_in, price_out, out_tokens=400):
    """返回 dict:pages / inTok / inTokMax / w / h / perPage / total / secPerPage。"""
    pages = 0
    sizes = []
    if book_dir and os.path.isdir(book_dir):
        try:
            files = sorted(f for f in os.listdir(book_dir)
                           if f.lower().endswith(('.webp', '.png', '.jpg', '.jpeg', '.bmp')))
            pages = len(files)
            if files:
                picks = files if len(files) <= 3 else [files[0], files[len(files) // 2], files[-1]]
                from PIL import Image
                for f in picks:
                    try:
                        with Image.open(os.path.join(book_dir, f)) as im:
                            sizes.append(im.size)
                    except Exception:
                        pass
        except Exception:
            pass
    if not sizes:
        sizes = [(1280, 1830)]
    toks = [_img_tokens(os.path.join(book_dir, f)) if False else None for f in []]  # 占位
    toks = []
    for (w, hh) in sizes:
        sc = min(1.0, 2048 / max(w, hh))
        fw, fh = max(1, round(w * sc)), max(1, round(hh * sc))
        toks.append(-(-fw // 28) * -(-fh // 28))
    in_avg = round(sum(toks) / len(toks))
    in_max = max(toks)
    def _num(x):
        try:
            return float(str(x).strip() or 0)
        except Exception:
            return 0.0

    pi = _num(price_in)
    po = _num(price_out)
    per_page = (in_avg * pi + out_tokens * po) / 1e6
    used_pages = pages if pages > 0 else 1
    return {
        'pages': pages,
        'inTok': in_avg,
        'inTokMax': in_max,
        'perPage': per_page,
        'total': per_page * used_pages,
        'usedPages': used_pages,
        'secPerPage': 0.4,
    }


def _cost_text(est, pages_label=True):
    money = (lambda x: '¥%.4f' % x) if est['perPage'] > 0 else (lambda x: '¥0')
    head = ('识图 每页 ≈ %d 输入 tokens(最大 %d)+ 400 输出 → %s/页' %
            (est['inTok'], est['inTokMax'], money(est['perPage'])))
    if pages_label:
        head += ';整本 %d 页 ≈ %s' % (est['usedPages'], money(est['total']))
    tail = ('\n嵌字 本地 GPU ¥0/页 · 约 %.1f 秒/页 · 整本 ≈ %.1f 秒(不花钱)' %
            (est['secPerPage'], est['secPerPage'] * est['usedPages']))
    if est['pages'] == 0:
        head = '(未读取本子,按 1 页 / 1280×1830 估算) ' + head
    return head + tail


def _show_settings(parent, book_dir=None):
    cur = _load_settings()
    dlg = tk.Toplevel(parent)
    dlg.title('设置 · 视觉模型 / API  ' + APP_VERSION)
    dlg.geometry('680x560')
    dlg.transient(parent)
    tk.Label(dlg, text='视觉模型 / API(识图后端 · OpenAI 兼容)', font=('Microsoft YaHei', 11, 'bold')).pack(anchor='w', padx=12, pady=(12, 2))
    tk.Label(dlg, text='这里控制 DSH 识图用的视觉模型(modlens),改完即替换当前在用的那一家的 API。',
             fg='#666', font=('Microsoft YaHei', 8)).pack(anchor='w', padx=12, pady=(0, 6))
    frm = tk.Frame(dlg)
    frm.pack(fill=tk.X, padx=12)

    def add_row(label, value, show=None):
        fr = tk.Frame(frm)
        fr.pack(fill=tk.X, pady=3)
        tk.Label(fr, text=label, width=10, anchor='w').pack(side=tk.LEFT)
        e = tk.Entry(fr, show=show) if show else tk.Entry(fr)
        e.pack(side=tk.LEFT, fill=tk.X, expand=True)
        e.insert(0, value)
        return e

    e_model = add_row('模型名', cur['model'])
    e_base = add_row('API Base', cur['apiBase'])
    e_key = add_row('API Key', '', show='*')
    hint = ('已设置:' + _mask_key(cur['apiKey']) + ',留空表示不修改') if cur['apiKey'] else '尚未设置 API Key'
    tk.Label(frm, text=hint, fg='#777', font=('Microsoft YaHei', 8), anchor='w').pack(fill=tk.X, pady=(0, 4))

    # 界面选项
    _ui = _load_ui_cfg()
    v_remember = tk.BooleanVar(value=bool(_ui.get('rememberPathDesktop', True)))
    v_sidebar = tk.BooleanVar(value=bool(_ui.get('sidebarEnabled', True)))
    v_banner = tk.BooleanVar(value=bool(_ui.get('bannerEnabled', True)))
    uf = tk.Frame(frm)
    uf.pack(fill=tk.X, pady=(4, 0))
    tk.Label(uf, text='界面选项', width=10, anchor='w').pack(side=tk.LEFT)
    tk.Checkbutton(uf, text='记住上次路径(本端)', variable=v_remember).pack(side=tk.LEFT)
    tk.Checkbutton(uf, text='显示 DSH 侧边栏(双端共享)', variable=v_sidebar).pack(side=tk.LEFT, padx=(12, 0))
    uf2 = tk.Frame(frm)
    uf2.pack(fill=tk.X, pady=(2, 0))
    tk.Label(uf2, text='', width=10).pack(side=tk.LEFT)
    tk.Checkbutton(uf2, text='启动提示弹窗(双端共享,仅网页端显示)', variable=v_banner).pack(side=tk.LEFT)

    out = tk.Label(dlg, text='', fg='#333', font=('Microsoft YaHei', 9), wraplength=600, justify='left', anchor='w')
    out.pack(fill=tk.X, padx=12, pady=(8, 0))

    PRESETS = [
        ('月之暗面', 'https://api.moonshot.cn/v1', 'kimi-k3'),
        ('通义千问VL', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-vl-max'),
        ('智谱GLM-4V', 'https://open.bigmodel.cn/api/paas/v4', 'glm-4v-plus'),
        ('OpenAI', 'https://api.openai.com/v1', 'gpt-4o-mini'),
    ]

    def apply_preset(base, model):
        e_model.delete(0, tk.END)
        e_model.insert(0, model)
        e_base.delete(0, tk.END)
        e_base.insert(0, base)
        out.config(text='已填入预设,记得粘贴对应的 API Key 再保存', fg='#333')

    pf = tk.Frame(frm)
    pf.pack(fill=tk.X, pady=(2, 2))
    tk.Label(pf, text='快速预设', width=10, anchor='w').pack(side=tk.LEFT)
    for name, base, model in PRESETS:
        tk.Button(pf, text=name, command=lambda b=base, m=model: apply_preset(b, m)).pack(side=tk.LEFT, padx=3)

    def collect():
        return {
            'model': e_model.get().strip(),
            'apiBase': e_base.get().strip(),
            'apiKey': e_key.get().strip() or cur['apiKey'],
        }

    def do_save():
        # 界面选项先存(不依赖视觉字段)
        try:
            _save_ui_cfg({
                'rememberPathDesktop': bool(v_remember.get()),
                'sidebarEnabled': bool(v_sidebar.get()),
                'bannerEnabled': bool(v_banner.get()),
            })
            _save_cost_cfg({'priceIn': e_pin.get().strip(), 'priceOut': e_pout.get().strip()})
            _save_ocr_cfg({
                'mode': v_ocmode.get(),
                'minChars': e_minchars.get().strip(),
                'maxPerBook': e_maxboxes.get().strip(),
            })
        except Exception as e:
            out.config(text='界面选项保存失败:' + str(e), fg='#cc0000')
            return
        v = collect()
        if not v['model'] or not v['apiBase']:
            out.config(text='界面选项已保存;模型名和 API Base 不能为空', fg='#cc0000')
            return
        try:
            _save_settings(v)
        except Exception as e:
            out.config(text='界面选项已保存;视觉模型保存失败:' + str(e), fg='#cc0000')
            return
        cur['apiKey'] = v['apiKey']
        e_key.delete(0, tk.END)
        out.config(text='已保存 ✅(界面选项 + 视觉模型)  配置文件:' + _ui_cfg_file(), fg='#2a7a2a')

    def do_test():
        v = collect()
        out.config(text='正在测试连接…', fg='#333')
        dlg.update_idletasks()
        ok, msg = _test_vision_api(v['model'], v['apiBase'], v['apiKey'])
        out.config(text=msg, fg='#2a7a2a' if ok else '#cc0000')

    def do_vision_test():
        v = collect()
        out.config(text='正在发一张测试图给模型识别…', fg='#333')
        dlg.update_idletasks()
        ok, msg = _test_vision_chat(v['model'], v['apiBase'], v['apiKey'])
        out.config(text=msg, fg='#2a7a2a' if ok else '#cc0000')

    # OCR 兜底
    _oc = _load_ocr_cfg()
    v_ocmode = tk.StringVar(value=_oc['mode'])
    of = tk.Frame(frm)
    of.pack(fill=tk.X, pady=(6, 0))
    tk.Label(of, text='OCR 兜底', width=10, anchor='w').pack(side=tk.LEFT)
    tk.Label(of, text='空/极短时用视觉引擎重读:', font=('Microsoft YaHei', 8)).pack(side=tk.LEFT)
    for val, lab in _OCR_MODE_LABELS:
        tk.Radiobutton(of, text=lab, variable=v_ocmode, value=val,
                       font=('Microsoft YaHei', 8)).pack(side=tk.LEFT, padx=(4, 0))
    of2 = tk.Frame(frm)
    of2.pack(fill=tk.X, pady=(2, 0))
    tk.Label(of2, text='', width=10).pack(side=tk.LEFT)
    tk.Label(of2, text='极短阈值(有效字数<)', font=('Microsoft YaHei', 8)).pack(side=tk.LEFT)
    e_minchars = tk.Entry(of2, width=4)
    e_minchars.pack(side=tk.LEFT)
    e_minchars.insert(0, str(_oc['minChars']))
    tk.Label(of2, text='每本最多兜底', font=('Microsoft YaHei', 8)).pack(side=tk.LEFT, padx=(8, 0))
    e_maxboxes = tk.Entry(of2, width=5)
    e_maxboxes.pack(side=tk.LEFT)
    e_maxboxes.insert(0, str(_oc['maxPerBook']))
    tk.Label(of2, text='框(控制花费;每框约 ¥0.01~0.09)', fg='#777',
             font=('Microsoft YaHei', 8)).pack(side=tk.LEFT, padx=(4, 0))

    # 成本预估
    cf = tk.Frame(frm)
    cf.pack(fill=tk.X, pady=(8, 0))
    tk.Label(cf, text='成本预估', width=10, anchor='w').pack(side=tk.LEFT)
    _cc = _load_cost_cfg()
    tk.Label(cf, text='输入单价', font=('Microsoft YaHei', 8)).pack(side=tk.LEFT)
    e_pin = tk.Entry(cf, width=8)
    e_pin.pack(side=tk.LEFT)
    e_pin.insert(0, str(_cc.get('priceIn') or ''))
    tk.Label(cf, text='输出单价', font=('Microsoft YaHei', 8)).pack(side=tk.LEFT, padx=(8, 0))
    e_pout = tk.Entry(cf, width=8)
    e_pout.pack(side=tk.LEFT)
    e_pout.insert(0, str(_cc.get('priceOut') or ''))
    tk.Label(cf, text='元/百万 tokens(留空=免费)', fg='#777',
             font=('Microsoft YaHei', 8)).pack(side=tk.LEFT, padx=(6, 0))

    def fill_official_price():
        pm = _PRICE_PRESETS.get(e_model.get().strip())
        if not pm:
            out.config(text='当前模型没有内置参考价,请到官网查询后手填', fg='#cc0000')
            return
        e_pin.delete(0, tk.END); e_pin.insert(0, str(pm[0]))
        e_pout.delete(0, tk.END); e_pout.insert(0, str(pm[1]))
        recalc_cost()
        out.config(text='已填入 %s 官方参考价:%d / %d 元每百万 tokens' % (e_model.get().strip(), pm[0], pm[1]),
                   fg='#2a7a2a')

    tk.Button(cf, text='填入官方价', command=fill_official_price).pack(side=tk.LEFT, padx=(6, 0))

    cost_lbl = tk.Label(dlg, text='', fg='#333', font=('Microsoft YaHei', 8),
                        anchor='w', justify='left', wraplength=640)
    cost_lbl.pack(fill=tk.X, padx=12, pady=(2, 0))

    def recalc_cost(*_a):
        try:
            est = _cost_estimate(book_dir, e_pin.get().strip(), e_pout.get().strip())
            cost_lbl.config(text=_cost_text(est))
        except Exception as e:
            cost_lbl.config(text='成本估算失败: %s' % e)

    e_pin.bind('<KeyRelease>', recalc_cost)
    e_pout.bind('<KeyRelease>', recalc_cost)
    recalc_cost()

    bf = tk.Frame(dlg)
    bf.pack(pady=10)
    tk.Button(bf, text='保存', command=do_save, width=10).pack(side=tk.LEFT, padx=6)
    tk.Button(bf, text='测试连接', command=do_test, width=10).pack(side=tk.LEFT, padx=6)
    tk.Button(bf, text='测试识图', command=lambda: do_vision_test(), width=10).pack(side=tk.LEFT, padx=6)
    tk.Button(bf, text='关闭', command=dlg.destroy, width=10).pack(side=tk.LEFT, padx=6)
    tk.Label(dlg, text='侧边栏开关双端共享(网页端刷新后生效);记忆路径开关两端各自独立。',
             fg='#888', font=('Microsoft YaHei', 8)).pack(anchor='w', padx=12)
    tk.Label(dlg, text='「测试连接」只验证 API 通不通;「测试识图」会真发一张图,验证模型会不会看图。',
             fg='#888', font=('Microsoft YaHei', 8)).pack(anchor='w', padx=12)
    tk.Label(dlg, text='写入 ~/.modlens/config.json 的 providers.openai;桌面版与网页版改的是同一个文件。',
             fg='#888', font=('Microsoft YaHei', 8)).pack(anchor='w', padx=12)
    tk.Label(dlg, text=APP_VERSION + ' · 本软件完全由 AI(DeepSeek Harness Agent)生成与编写。作者:YiDaWuYi',
             fg='#999999', font=('Microsoft YaHei', 8)).pack(side=tk.BOTTOM, pady=(0, 10))
    e_model.focus_set()
    dlg.bind('<Escape>', lambda e: dlg.destroy())


def show_home():
    """启动主页:拖入文件夹 / 粘贴路径 / 浏览选择。"""
    has_dnd = False
    try:
        from tkinterdnd2 import TkinterDnD, DND_FILES
        root = TkinterDnD.Tk()
        has_dnd = True
    except Exception:
        root = tk.Tk()
    root.title("漫画汉化工具 · 主页 " + APP_VERSION)
    root.geometry("680x430")
    root.resizable(False, False)

    tk.Label(root, text="漫画汉化工具", font=("Microsoft YaHei", 20, "bold")).pack(pady=(30, 8))
    tip = "把漫画文件夹直接拖进本窗口,或粘贴路径 / 点「浏览」"
    tk.Label(root, text=tip, font=("Microsoft YaHei", 10), fg="#555").pack()
    tk.Label(root, text="⚠ 首次使用建议先看完《帮助》手册(点下方「帮助」)—— 流程 / 快捷键 / OCR 兜底 都在里面",
             font=("Microsoft YaHei", 9), fg="#b26a00").pack(pady=(6, 0))
    var = tk.StringVar(value=_load_last())   # 自动填入上次工作目录
    entry = tk.Entry(root, textvariable=var, width=66, font=("Microsoft YaHei", 11))
    entry.pack(pady=14)
    entry.focus_set()

    if has_dnd:
        def on_drop(e):
            p = e.data.strip()
            # 处理 {C:\path with spaces} 或 {"C:\..."}
            if p.startswith('{') and p.endswith('}'):
                p = p[1:-1]
            p = p.strip().strip('"').strip("'")
            # 如果拖进来的是图片文件,取所在文件夹
            if os.path.isfile(p):
                p = os.path.dirname(p)
            var.set(p)
        try:
            root.drop_target_register(DND_FILES)
            root.dnd_bind('<<Drop>>', on_drop)
        except Exception:
            pass

    def browse():
        d = filedialog.askdirectory(title="选择漫画图片文件夹")
        if d:
            var.set(d)

    def start():
        d = var.get().strip().strip('"').strip("'")
        if not d:
            messagebox.showwarning("提示", "请先拖入、粘贴或选择文件夹路径")
            return
        if not os.path.isdir(d):
            messagebox.showerror("错误", f"文件夹不存在:\n{d}")
            return
        regions = os.path.join(d, "regions.json")
        root.destroy()
        _open_editor(d, regions)

    bf = tk.Frame(root)
    bf.pack()
    tk.Button(bf, text="浏览...", command=browse, width=12).pack(side=tk.LEFT, padx=8)
    tk.Button(bf, text="开始标框", command=start, width=12).pack(side=tk.LEFT, padx=8)
    tk.Button(bf, text="设置", command=lambda: _show_settings(root, _load_last()), width=10).pack(side=tk.LEFT, padx=8)
    def open_help():
        # 不依赖 .md 文件关联:直接在程序内渲染帮助
        try:
            _show_help_window(root)
        except Exception as e:
            messagebox.showinfo('帮助', '打开帮助失败:%s\n\n帮助文件位置:%s' % (e, _help_file()))

    tk.Button(bf, text="帮助", command=open_help, width=8).pack(side=tk.LEFT, padx=8)
    root.bind("<Return>", lambda e: start())
    # 引擎检测 + 帮助
    eng = _engine_status()
    missing = [x[0] for x in eng if not x[1]]
    sf = tk.Frame(root)
    sf.pack(pady=(10, 0))
    if missing:
        tk.Label(sf, text="⚠ 引擎缺失: " + "、".join(missing[:3]) + ("…" if len(missing) > 3 else ""),
                 fg="#cc0000", font=("Microsoft YaHei", 9)).pack(side=tk.LEFT)
    else:
        tk.Label(sf, text="✅ 引擎齐全(OCR / GPU去字 / 韩文)",
                 fg="#2a7a2a", font=("Microsoft YaHei", 9)).pack(side=tk.LEFT)
    tk.Button(sf, text="引擎帮助", command=lambda: _show_engine_help(root, eng)).pack(side=tk.LEFT, padx=(10, 0))
    # 视觉引擎(识图)状态 + 配置入口:让 AI 看图必须先配好
    vf = tk.Frame(root)
    vf.pack(pady=(8, 0))
    _v = _load_settings()
    _v_ok = bool(_v.get('apiKey'))
    tk.Label(vf, text=('✅ 视觉引擎:' + str(_v.get('model') or '')) if _v_ok else '⚠ 识图需配置视觉引擎',
             fg='#2a7a2a' if _v_ok else '#cc0000',
             font=("Microsoft YaHei", 9)).pack(side=tk.LEFT)
    tk.Button(vf, text="视觉设置", command=lambda: _show_settings(root, _load_last())).pack(side=tk.LEFT, padx=(8, 0))
    tk.Label(root, text="免费可用:智谱 GLM-4V-Flash · 硅基流动 Qwen2.5-VL · Gemini 2.0 Flash(详见「帮助」)",
             fg="#888", font=("Microsoft YaHei", 8)).pack(pady=(2, 0))
    # 底部页脚:AI 生成声明 + 署名(小字灰色,固定在窗口最底部)
    tk.Label(root, text=APP_VERSION + " · 本软件完全由 AI(DeepSeek Harness Agent)生成与编写。作者:YiDaWuYi",
             fg="#999999", font=("Microsoft YaHei", 8)).pack(side=tk.BOTTOM, pady=(0, 10))
    hint = "支持拖拽" if has_dnd else "提示:标完框点「自动识别」可本地 OCR,双击框可改原文"
    tk.Label(root, text=hint, font=("Microsoft YaHei", 9), fg="#888").pack(side=tk.BOTTOM, pady=(0, 4))
    root.mainloop()


def main():
    if len(sys.argv) >= 2 and os.path.isdir(sys.argv[1]):
        src = sys.argv[1]
        regions = sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, "regions.json")
        _open_editor(src, regions)
    else:
        show_home()

if __name__ == "__main__":
    main()
