/**
 * Client half of the manga-workflow bundle.
 *
 * - A transient readiness banner in the conversation composer dock.
 * - A sidebar workbench ("漫画工作台") with folder status, workflow buttons,
 *   and a web box marker that mirrors the desktop tool's modes and hotkeys.
 */
window.__ModuleLoader__.load({
  id: 'dsh-manga-workflow',
  factory(require) {
  // 版本号(发布时同步 package.json / 桌面端 mark_tool.py)
  const APP_VERSION = 'V1.16';

    const React = require('react');
    const h = React.createElement;
    // 工具栏分组分隔线
    const SEP = () => h('span', {
      style: { display: 'inline-block', width: '1px', height: '16px',
               background: 'rgba(255,255,255,0.18)', margin: '0 6px', verticalAlign: 'middle' },
    });

    const PANEL_ID = 'manga-desk';
    const API = '/manga-desk';

    /* ---------------- 通用 ---------------- */

    async function api(pathname, body) {
      const opt = body === undefined
        ? { headers: {} }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
      const res = await fetch(API + pathname, opt);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `请求失败(${res.status})`);
      return data;
    }

    const S = {
      root: { padding: '10px 16px 24px', fontSize: '12px', lineHeight: '1.5', height: '100%', overflow: 'auto', boxSizing: 'border-box', width: '100%', maxWidth: '980px', margin: '0 auto' },
      row: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' },
      input: { flex: 1, minWidth: '160px', padding: '4px 6px', borderRadius: '5px', border: '1px solid rgba(128,128,128,0.4)', background: 'transparent', color: 'inherit', fontSize: '12px' },
      btn: { padding: '3px 9px', borderRadius: '5px', border: '1px solid rgba(128,128,128,0.45)', background: 'rgba(128,128,128,0.12)', color: 'inherit', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' },
      btnOn: { padding: '3px 9px', borderRadius: '5px', border: '1px solid rgba(255,190,0,0.8)', background: 'rgba(255,190,0,0.25)', color: 'inherit', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' },
      btnDanger: { padding: '3px 9px', borderRadius: '5px', border: '1px solid rgba(255,77,77,0.7)', background: 'rgba(255,77,77,0.16)', color: 'inherit', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' },
      chip: { padding: '1px 6px', borderRadius: '10px', border: '1px solid rgba(128,128,128,0.35)', fontSize: '11px', opacity: 0.85 },
      box: { border: '1px solid rgba(128,128,128,0.28)', borderRadius: '6px', padding: '6px 8px', marginBottom: '8px' },
      muted: { opacity: 0.7 },
      log: { whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '11px', maxHeight: '160px', overflow: 'auto', background: 'rgba(0,0,0,0.16)', borderRadius: '5px', padding: '6px' },
      stage: { position: 'relative', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.28)', padding: '6px', textAlign: 'center', background: 'rgba(0,0,0,0.10)', minHeight: '46vh' },
      stageInner: { position: 'relative', display: 'inline-block', maxWidth: '100%' },
      img: { display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 380px)', width: 'auto', height: 'auto', userSelect: 'none', margin: '0 auto' },
      dlg: { position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
      dlgBox: { background: '#2a2a2e', color: '#eee', borderRadius: '8px', padding: '14px 16px', width: 'min(520px, 92vw)', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' },
    };

    /* ---------------- 启动提示 ---------------- */

    const BANNER_STYLE = `
@keyframes md-ready-flash {
  0%   { background: rgba(128,128,128,0.12); border-color: rgba(128,128,128,0.28); }
  45%  { background: rgba(255,200,0,0.78);  border-color: rgba(255,200,0,0.95); }
  100% { background: rgba(128,128,128,0.12); border-color: rgba(128,128,128,0.28); }
}
`;

    function Banner() {
      const [fading, setFading] = React.useState(false);
      const [hidden, setHidden] = React.useState(false);
      React.useEffect(() => {
        const a = setTimeout(() => setFading(true), 4300);
        const b = setTimeout(() => setHidden(true), 4800);
        return () => { clearTimeout(a); clearTimeout(b); };
      }, []);
      if (hidden) return null;
      return h(
        React.Fragment,
        null,
        h('style', { key: 'kw' }, BANNER_STYLE),
        h('div', {
          role: 'status',
          style: {
            margin: '4px 8px 0', padding: '4px 10px', borderRadius: '6px',
            fontSize: '12px', lineHeight: '1.4', whiteSpace: 'nowrap', textAlign: 'center',
            background: 'rgba(128,128,128,0.12)', border: '1px solid rgba(128,128,128,0.28)',
            animation: 'md-ready-flash 0.55s ease-in-out 1',
            opacity: fading ? 0 : 1,
            transition: 'opacity 0.5s ease-out',
            pointerEvents: fading ? 'none' : 'auto',
          },
        }, '漫画汉化工作流已就绪'),
      );
    }

    /* ---------------- 文本编辑对话框 ---------------- */

    function TextDialog({ idx, orig, trans, onClose, onSave }) {
      const [a, setA] = React.useState(orig || '');
      const [b, setB] = React.useState(trans || '');
      return h('div', { style: S.dlg, onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
        h('div', { style: S.dlgBox },
          h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, `编辑框 ${idx + 1}`),
          h('div', { style: { ...S.muted, marginBottom: '2px' } }, '原文'),
          h('textarea', {
            value: a, rows: 3,
            style: { ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '8px', resize: 'vertical' },
            onChange: (e) => setA(e.target.value),
          }),
          h('div', { style: { ...S.muted, marginBottom: '2px' } }, '译文'),
          h('textarea', {
            value: b, rows: 3,
            style: { ...S.input, width: '100%', boxSizing: 'border-box', marginBottom: '10px', resize: 'vertical' },
            onChange: (e) => setB(e.target.value),
          }),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
            h('button', { type: 'button', style: S.btn, onClick: onClose }, '取消'),
            h('button', { type: 'button', style: S.btnOn, onClick: () => onSave(a, b) }, '保存'),
          ),
        ),
      );
    }

    /* ---------------- 网页标框 ---------------- */

    // ---------------- 文字样式(可视化预览) ----------------
    function styleCss(p, px) {
      const fill = Array.isArray(p.fill) ? 'rgb(' + p.fill.join(',') + ')' : '#000';
      const sf = Array.isArray(p.strokeFill) ? 'rgb(' + p.strokeFill.join(',') + ')' : 'transparent';
      const w = Math.max(1, Math.round((p.stroke || 0) / 2));
      const sh = Array.isArray(p.shadow) ? p.shadow : null;
      const shadows = [];
      if (sh) shadows.push(`${sh[0]}px ${sh[1]}px 0 rgb(${sh[2]},${sh[3]},${sh[4]})`);
      if (p.art && (p.stroke || 0) > 0) {
        // 艺术字:用多层描边阴影模拟「外粗内细」
        for (const d of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          shadows.push(`${d[0]}px ${d[1]}px 0 ${sf}`);
        }
      }
      return {
        color: fill,
        fontWeight: p.bold ? 800 : 500,
        WebkitTextStroke: (p.stroke || 0) > 0 ? `${w}px ${sf}` : undefined,
        paintOrder: 'stroke fill',
        textShadow: shadows.length ? shadows.join(', ') : undefined,
        fontSize: (px || 20) + 'px',
        lineHeight: '1.1',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      };
    }

    const WEB_FONT_CSS = {
      '微软雅黑': '"Microsoft YaHei"', '宋体': 'SimSun', '黑体': 'SimHei', '楷体': 'KaiTi',
      '仿宋': 'FangSong', '华文仿宋': 'STFangsong', '华文楷体': 'STKaiti',
      '华文琥珀': 'STHupo', '瘦金体': 'STXingkai', '隶书': 'LiSu', '幼圆': 'YouYuan',
    };
    const WEB_FONT_FALLBACK = ['微软雅黑', '宋体', '黑体', '楷体', '仿宋', '华文仿宋',
      '华文楷体', '华文琥珀', '瘦金体', '隶书', '幼圆'];
    const WEB_FONT_NAMES = (() => {
      const ks = Object.keys(WEB_FONT_CSS || {});
      return ks.length ? ks : WEB_FONT_FALLBACK;
    })();
    const cssFont = (name) => (name && WEB_FONT_CSS[name])
      ? (WEB_FONT_CSS[name] + ', "Microsoft YaHei", sans-serif') : undefined;

    function StyleChips({ presets, value, onChange, glyph, font }) {
      if (!presets || !presets.length) return h('span', { style: { ...S.muted, fontSize: '11px' } }, '样式加载中…');
      return h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' } },
        presets.map((p) => {
          const on = value === p.id;
          return h('button', {
            key: p.id,
            type: 'button',
            title: `${p.label} · ${p.desc}`,
            onClick: () => onChange(p.id),
            style: {
              ...S.btn,
              padding: '2px 5px',
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px',
              minWidth: '44px',
              border: on ? '2px solid #ffd24d' : undefined,
              background: on ? 'rgba(255,210,77,0.16)' : undefined,
            },
          },
            h('span', { style: { ...styleCss(p, 19), fontFamily: cssFont(font) } }, glyph),
            h('span', { style: { fontSize: '9px', opacity: 0.75 } }, p.label),
          );
        }),
      );
    }

    const KIND_LABEL = { body: '正文', plain: '拟声', title: '标题' };
    const COVER_LABEL = { overlay: '直盖', erase: '抹除', cover: '覆盖' };
    const kindOfBox = (b) => {
      const k = b && b.kind;
      if (k === 'body' || k === 'plain' || k === 'title') return k;
      if (b && (b.sfx || b.nobox || (b.points && b.points.length))) return 'plain';
      return 'body';
    };
    const coverOfBox = (b) => {
      if (kindOfBox(b) === 'plain') return 'overlay';   // 拟声词:不使用色块覆盖
      const m = b && b.cover;
      if (m === 'keep') return 'overlay';
      if (m === 'overlay' || m === 'erase' || m === 'cover') return m;
      if (b && 'erase' in b) return b.erase ? 'erase' : 'overlay';
      return kindOfBox(b) === 'plain' ? 'overlay' : 'cover';
    };
    const gpuOfBox = (b) => !!(b && (b.gpu !== undefined ? b.gpu : b.lama));

    function Marker({ folder, page, data, mode, setMode, kind, cover, gpu, dirMode, align, alignTouched,
                       size, autoSize, bodyStyle, sfxStyle, titleStyle, fontByKind,
                       onBoxesChange, onTextEdit, onRefresh, reloadTick, onSelect }) {
      const [boxes, setBoxes] = React.useState([]);
      const [sel, setSel] = React.useState(null);
      const [downAt, setDownAt] = React.useState(null);
      const selRef = React.useRef(null);
      React.useEffect(() => { selRef.current = sel; }, [sel]);
      const [imgUrl, setImgUrl] = React.useState('');
      const [natural, setNatural] = React.useState({ w: 1280, h: 1800 });
      const [drag, setDrag] = React.useState(null);       // 框选拖拽
      const [paint, setPaint] = React.useState(null);     // 涂抹点
      const [edit, setEdit] = React.useState(null);       // 双击编辑
      const [imgError, setImgError] = React.useState('');
      const [undo, setUndo] = React.useState([]);
      const [showTrans, setShowTrans] = React.useState(false);  // 画布上直接显示译文(默认关,需要时勾选)
      const [showOrig, setShowOrig] = React.useState(false);    // 画布上直接显示 OCR 原文
      const wrapRef = React.useRef(null);

      // 页数据变化(换页 / 自动标框后重读 / 刷新本页)时同步到画布;用「页 + 框几何」做指纹,避免无意义重置
      const dataKeyRef = React.useRef('');
      React.useEffect(() => {
        const _d = data || {};
        const _bs = Array.isArray(_d.boxes) ? _d.boxes : [];
        const _k = String(_d.page || '') + '|'
          + _bs.map((b) => [b.x | 0, b.y | 0, b.w | 0, b.h | 0, b.kind || '', b.auto ? 1 : 0].join(',')).join(';');
        if (_k === dataKeyRef.current) return;
        dataKeyRef.current = _k;
        setBoxes(_bs.map((b) => ({ ...b })));
        setUndo([]);
        setEdit(null);
      }, [data, reloadTick]);

      // 选中框后,工具栏参数变化 → 实时写回该框(修复「点框改参数不生效」)
      const toolSigRef = React.useRef('');
      React.useEffect(() => {
        if (sel === null || sel === undefined) { toolSigRef.current = ''; return; }
        const sig = JSON.stringify([kind, cover, gpu, dirMode, size, autoSize, align, alignTouched,
                                    bodyStyle, sfxStyle, titleStyle, fontByKind]);
        if (toolSigRef.current === '') { toolSigRef.current = sig; return; }   // 刚选中:只记录,不改框
        if (toolSigRef.current === sig) return;
        toolSigRef.current = sig;
        setBoxes((prev) => prev.map((b, i) => {
          if (i !== sel) return b;
          const nb = { ...b };
          const k = kind;
          nb.kind = k;
          nb.cover = (k === 'plain' && cover === 'cover') ? 'overlay' : cover;
          nb.sfx = (k === 'plain');
          nb.erase = (nb.cover === 'erase');
          nb.vertical = dirMode === 'auto' ? 'auto' : (dirMode === 'v');
          const sz = parseInt(size, 10);
          if (!Number.isNaN(sz) && sz > 0) nb.size = sz;
          if (autoSize) { delete nb.size_fixed; } else { nb.size_fixed = true; }
          if (alignTouched) { nb.align = align; delete nb.align_auto; }
          if (nb.cover === 'erase') nb.gpu = !!gpu; else delete nb.gpu;
          nb.style = k === 'title' ? titleStyle : (k === 'plain' ? sfxStyle : bodyStyle);
          if (fontByKind[k]) nb.font = fontByKind[k]; else delete nb.font;
          return nb;
        }));
      }, [sel, kind, cover, gpu, dirMode, size, autoSize, align, alignTouched,
          bodyStyle, sfxStyle, titleStyle, fontByKind]);

      React.useEffect(() => {
        if (!folder || !page) { setImgUrl(''); return; }
        const url = `${API}/image?folder=${encodeURIComponent(folder)}&page=${encodeURIComponent(page)}&t=${Date.now()}`;
        // 先预加载新图,加载完再替换 src:切页期间旧图一直显示,不会塌陷/闪烁
        let cancelled = false;
        const im = new Image();
        im.onload = () => { if (!cancelled) { setImgError(''); setImgUrl(url); } };
        im.onerror = () => { if (!cancelled) setImgError('图片加载失败,请重试或换页'); };
        im.src = url;
        return () => { cancelled = true; };
      }, [folder, page, reloadTick]);

      React.useEffect(() => { onBoxesChange && onBoxesChange(boxes); }, [boxes]);

      // Ctrl+Z 撤销(自己在 Marker 内处理,因为需要 undoLast)
      React.useEffect(() => {
        const onKey = (e) => {
          const tag = (e.target && e.target.tagName) || '';
          if (tag === 'INPUT' || tag === 'TEXTAREA') return;
          if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            e.stopPropagation();
            undoLast();
          }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
      }, [undo]);

      const pushUndo = (cur) => setUndo((u) => [...u.slice(-40), cur]);

      const newBoxFields = () => {
        const k = kind || 'body';
        const cov = cover || (k === 'plain' ? 'overlay' : 'cover');
        const dir = dirMode || 'auto';
        const f = {
          kind: k,
          cover: cov,
          vertical: dir === 'auto' ? 'auto' : (dir === 'v'),
          size: Number(size) || 20,
          size_fixed: !autoSize,
          erase: cov === 'erase',
          sfx: k === 'plain',
          style: k === 'title' ? titleStyle : (k === 'plain' ? sfxStyle : bodyStyle),
          color: 'black', outline: true,
        };
        if (cov === 'erase') f.gpu = !!gpu;
        const fonts = fontByKind || {};
        if (fonts[k]) f.font = fonts[k];
        return f;
      };

      // 选中框后,工具栏设置变化 → 立即写回该框
      React.useEffect(() => {
        const i = selRef.current;
        if (i === null || !(i >= 0 && i < boxes.length)) return;
        setBoxes((prev) => {
          if (!(i >= 0 && i < prev.length)) return prev;
          const cur = prev[i];
          const k = kind || 'body';
          const cov = cover || (k === 'plain' ? 'overlay' : 'cover');
          const dir = dirMode || 'auto';
          const next = {
            ...cur,
            kind: k, cover: cov,
            vertical: dir === 'auto' ? 'auto' : (dir === 'v'),
            align: alignTouched ? (align || 'auto') : (cur.align || 'auto'),
            size: Number(size) || 20,
            size_fixed: !autoSize,
            erase: cov === 'erase', sfx: k === 'plain',
            style: k === 'title' ? titleStyle : (k === 'plain' ? sfxStyle : bodyStyle),
          };
          if (cov === 'erase') next.gpu = !!gpu; else delete next.gpu;
          const fonts = fontByKind || {};
          if (fonts[k]) next.font = fonts[k]; else delete next.font;
          const same = JSON.stringify(cur) === JSON.stringify(next);
          if (same) return prev;
          const copy = prev.slice();
          copy[i] = next;
          return copy;
        });
      }, [kind, cover, gpu, dirMode, align, alignTouched, size, autoSize, bodyStyle, sfxStyle, titleStyle, fontByKind]);

      const pos = (e) => {
        const el = wrapRef.current;
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        const s = r.width / natural.w;
        return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
      };

      const onDown = (e) => {
        if (e.button !== 0) return;
        const p = pos(e);
        setDownAt({ x: p.x, y: p.y });
        if (mode === 'paint') {
          setPaint([{ x: Math.round(p.x), y: Math.round(p.y) }]);
        } else {
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }
      };

      const onMove = (e) => {
        const p = pos(e);
        if (paint) {
          setPaint((prev) => {
            if (!prev) return prev;
            const last = prev[prev.length - 1];
            if (Math.abs(last.x - p.x) < 3 && Math.abs(last.y - p.y) < 3) return prev;
            return [...prev, { x: Math.round(p.x), y: Math.round(p.y) }];
          });
          return;
        }
        if (!drag) return;
        setDrag({ ...drag, x1: p.x, y1: p.y });
      };

      const onUp = () => {
        // 几乎没移动 → 视为「点选」
        const d0 = downAt;
        const moved = paint && paint.length > 1
          ? Math.hypot(paint[paint.length - 1].x - d0.x, paint[paint.length - 1].y - d0.y)
          : (drag ? Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) : 0);
        if (d0 && moved <= 4 && !(paint && paint.length > 1)) {
          const i = hit(d0, hitPad());
          setSel(i >= 0 ? i : null);
          if (onSelect) { try { onSelect(i >= 0 ? boxes[i] : null); } catch (e) { /* ignore */ } }
          setPaint(null);
          setDrag(null);
          setDownAt(null);
          return;
        }
        setDownAt(null);
        if (paint && paint.length) {
          const xs = paint.map((p) => p.x);
          const ys = paint.map((p) => p.y);
          const x0 = Math.min(...xs), y0 = Math.min(...ys);
          const w = Math.max(...xs) - x0, hh = Math.max(...ys) - y0;
          pushUndo(boxes);
          if (w >= 4 && hh >= 4) {
            setBoxes((prev) => [...prev, {
              ...newBoxFields(),
              x: x0, y: y0, w, h: hh,
              points: paint.map((p) => [p.x, p.y]),
            }]);
          }
          setPaint(null);
          return;
        }
        if (!drag) return;
        const x = Math.min(drag.x0, drag.x1);
        const y = Math.min(drag.y0, drag.y1);
        const w = Math.abs(drag.x1 - drag.x0);
        const hh = Math.abs(drag.y1 - drag.y0);
        setDrag(null);
        if (w < 8 || hh < 8) return;
        pushUndo(boxes);
        setBoxes((prev) => [...prev, {
          ...newBoxFields(),
          x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh),
        }]);
      };

      // 命中测试:带容差(小框/点边角也能选中),避免"明明点在框上却没反应"
      const hit = (p, pad) => {
        const d = pad || 0;
        for (let i = boxes.length - 1; i >= 0; i--) {
          const b = boxes[i];
          if (p.x >= b.x - d && p.x <= b.x + b.w + d && p.y >= b.y - d && p.y <= b.y + b.h + d) return i;
        }
        return -1;
      };

      const hitPad = () => {
        const el = wrapRef.current;
        const scale = el && natural.w ? el.getBoundingClientRect().width / natural.w : 1;
        return Math.max(6, 12 / (scale || 1));   // ≈12 CSS 像素容差
      };

      const onRight = (e) => {
        e.preventDefault();
        const i = hit(pos(e), hitPad());
        if (i >= 0) {
          pushUndo(boxes);
          setBoxes((prev) => prev.filter((_, k) => k !== i));
        }
      };

      const onDouble = (e) => {
        const i = hit(pos(e), hitPad());
        if (i < 0) return;
        setEdit({ idx: i, orig: (data.texts || [])[i] || '', trans: (data.trans || [])[i] || '' });
      };

      const undoLast = () => {
        if (!undo.length) return;
        const prev = undo[undo.length - 1];
        setUndo((u) => u.slice(0, -1));
        setBoxes(prev);
      };

      const pct = (v, total) => `${(v / (total || 1)) * 100}%`;
      const bx = drag ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : null;
      const paintPath = paint && paint.length > 1
        ? paint.slice(1).map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
        : '';

      const _srcBoxes = boxes.length ? boxes : (Array.isArray(data && data.boxes) ? data.boxes : []);
      return h('div', null,
        h('div', { style: S.row },
          h('span', { style: S.muted }, `共 ${_srcBoxes.length} 框`),
          h('label', { style: { ...S.muted, fontSize: '11px', marginLeft: '6px' }, title: '在画布上直接显示每个框的译文,用来确认翻译是否成功' },
            h('input', { type: 'checkbox', checked: showTrans, onChange: (e) => setShowTrans(!!e.target.checked) }),
            '显示译文'),
          h('label', { style: { ...S.muted, fontSize: '11px', marginLeft: '6px' }, title: '在画布上直接显示每个框的 OCR 原文,用来核对识别结果' },
            h('input', { type: 'checkbox', checked: showOrig, onChange: (e) => setShowOrig(!!e.target.checked) }),
            '显示原文'),
          h('span', { style: { flex: 1 } }),
          h('button', {
            type: 'button', style: S.btn,
            title: '只重新读取当前页的框/译文/图片(不重载面板)',
            onClick: () => { if (onRefresh) onRefresh(); },
          }, '⟳ 刷新本页'),
          h('button', { type: 'button', style: S.btn, onClick: undoLast, title: 'Ctrl+Z' }, '撤销'),
          h('button', { type: 'button', style: S.btnDanger, onClick: () => { pushUndo(boxes); setBoxes([]); } }, '清空本页'),
        ),
        h('div', { style: S.stage },
          h('div', {
            ref: wrapRef,
            style: { ...S.stageInner, cursor: mode === 'paint' ? 'cell' : 'crosshair' },
            onMouseDown: onDown, onMouseMove: onMove, onMouseUp: onUp, onMouseLeave: onUp,
            onContextMenu: onRight, onDoubleClick: onDouble,
          },
            imgUrl
              ? h('img', {
                  src: imgUrl, style: S.img, draggable: false,
                  onLoad: (e) => { setImgError(''); setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight }); },
                  onError: () => setImgError('图片加载失败,请重试或换页'),
                })
              : h('div', { style: { ...S.muted, padding: '40px', textAlign: 'center' } }, '图片加载中…'),
            imgError ? h('div', { style: { position: 'absolute', left: 0, right: 0, top: '40%', textAlign: 'center', color: '#ff8080', fontSize: '12px' } }, imgError) : null,
            _srcBoxes.map((b, i) => {
              const k = kindOfBox(b);
              const cm = coverOfBox(b);
              const col = k === 'title' ? '#4da6ff' : (k === 'plain' ? '#ff4d4d' : '#00d000');
              const bg = k === 'title' ? 'rgba(77,166,255,0.12)'
                : (k === 'plain' ? 'rgba(255,77,77,0.10)' : 'rgba(0,208,0,0.08)');
              const proc = COVER_LABEL[cm] + (cm === 'erase' ? (gpuOfBox(b) ? '·GPU' : '·普通') : '');
              const pcol = cm === 'overlay' ? '#00e5ff' : (cm === 'cover' ? '#ffb020' : '#ff8080');
              return h('div', {
                key: `b${i}`,
                style: {
                  position: 'absolute',
                  left: pct(b.x, natural.w), top: pct(b.y, natural.h),
                  width: pct(b.w, natural.w), height: pct(b.h, natural.h),
                  border: (sel === i ? '3px solid #ffff00' : '2px solid ' + col),
                  background: bg,
                  boxSizing: 'border-box', pointerEvents: 'none',
                },
              },
                h('span', {
                  style: {
                    position: 'absolute', left: 0, top: '-14px', fontSize: '10px',
                    padding: '0 2px', color: col, background: 'rgba(0,0,0,0.55)',
                    whiteSpace: 'nowrap',
                  },
                }, KIND_LABEL[k]),
                h('span', {
                  style: {
                    position: 'absolute', right: 0, top: '-14px', fontSize: '10px',
                    padding: '0 2px', color: pcol, background: 'rgba(0,0,0,0.55)',
                    whiteSpace: 'nowrap',
                  },
                }, proc),
                (showOrig && data && Array.isArray(data.texts) && String(data.texts[i] || '').trim())
                  ? h('span', {
                      style: {
                        position: 'absolute', left: 0, top: 0, maxWidth: '100%',
                        fontSize: '11px', lineHeight: '1.25', padding: '1px 3px',
                        color: '#9fe6ff', background: 'rgba(0,0,0,0.62)', borderRadius: '3px',
                        whiteSpace: 'normal', wordBreak: 'break-all', pointerEvents: 'none',
                      },
                    }, String(data.texts[i]))
                  : null,
                (showTrans && data && Array.isArray(data.trans) && String(data.trans[i] || '').trim())
                  ? h('span', {
                      style: {
                        position: 'absolute', left: 0, bottom: 0, maxWidth: '100%',
                        fontSize: '11px', lineHeight: '1.25', padding: '1px 3px',
                        color: '#fff', background: 'rgba(0,0,0,0.62)', borderRadius: '3px',
                        whiteSpace: 'normal', wordBreak: 'break-all', pointerEvents: 'none',
                      },
                    }, String(data.trans[i]))
                  : null,
              );
            }),
            bx ? h('div', {
              style: {
                position: 'absolute', left: pct(bx.x, natural.w), top: pct(bx.y, natural.h),
                width: pct(bx.w, natural.w), height: pct(bx.h, natural.h),
                border: '2px dashed #ffcc00', boxSizing: 'border-box', pointerEvents: 'none',
              },
            }) : null,
            paintPath ? h('svg', {
              viewBox: `0 0 ${natural.w} ${natural.h}`,
              style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' },
            }, h('path', { d: paintPath, fill: 'none', stroke: '#ffcc00', strokeWidth: 8, strokeLinecap: 'round' })) : null,
          ),
        ),
        edit ? h(TextDialog, {
          idx: edit.idx, orig: edit.orig, trans: edit.trans,
          onClose: () => setEdit(null),
          onSave: (a, b) => {
            const i = edit.idx;
            if (data.texts) data.texts[i] = a;
            if (data.trans) data.trans[i] = b;
            if (onTextEdit) onTextEdit(i, a, b);
            setEdit(null);
          },
        }) : null,
      );
    }

    /* ---------------- 帮助页 ---------------- */

    const HELP_ROWS = [
      ['差异点', '网页工作台', '桌面版 mark.bat'],
      ['平台', '浏览器内(DSH 侧边栏)', '独立窗口(tkinter)'],
      ['标框', '框选 / 自由框选', '框选 / 自由框选'],
      ['撤销', '多步(最多 40 步,Ctrl+Z)', '完整栈(Ctrl+Z)'],
      ['双击改字', '弹窗改原文/译文', '弹窗改原文/译文'],
      ['自动标框', '✅ 支持(工具栏「自动标框」,auto 框需人工确认)', '✅ 支持(自动检测气泡)'],
      ['一键识别', '❌ 不支持', '✅ 支持(标框+OCR)'],
      ['同步(配对)', '❌ 不支持', '✅ 只对齐原文↔译文配对'],
      ['引擎帮助/修复', '❌ 不支持', '✅ 检测 + 复制修复关键词'],
      ['翻译设置', '✅ 设置→文字翻译引擎(含 DSH 模型/免Key)', '✅ 引擎多选 + AI 接口 + 代理'],
      ['校对模式', '固定「原文+译文」', '✅ 可切「只校原文」'],
      ['自动字号/方向', '✅ 自动字号 + 方向三选(自动/竖/横)', '✅ 可开关'],
      ['类型(正文/拟声/标题)', '✅ 三选,框色区分(绿/红虚线/蓝)', '✅ 三选'],
      ['原文处理', '✅ 直盖 / 抹除 / 色块覆盖', '✅ 同'],
      ['GPU去字', '✅ 按框设置(原文处理=抹除时勾选)', '✅ 按框设置'],
      ['点选编辑', '✅ 单击选中后改设置实时写回', '✅ 同'],
      ['框外标注', '✅ 左上类型 / 右上处理', '✅ 同'],
      ['软件内记忆', '✅ 按类型记住处理/GPU', '✅ 同'],
      ['应用到全部', '✅ 按类型刷全书', '✅ 同'],
      ['全自动流程', '❌ 不支持(用按钮分步)', '✅ OCR→翻译→校对→嵌字'],
      ['缩放/拖动画面', '❌ 自适应铺满', '✅ 适配窗口'],
      ['文件选择', '✅「浏览…」系统对话框 / 粘贴路径', '✅ 系统浏览对话框'],
      ['视觉引擎(设置)', '✅ 两端共用同一份配置', '✅ 同一份配置'],
      ['侧边栏/提示开关', '✅ 设置里可开关(共享)', '✅ 改同一份共享配置'],
      ['互相启动', '✅ 一键「启动桌面版」', '—'],
      ['确认嵌字', '✅ 体检 → 校对 → 页面内确认 → 嵌字 → 表单+预览', '✅ 两种:本机嵌字(体检→校对→嵌字,成品自动进 已完成/);网页嵌字(交网页执行)'],
      ['DSH 接管模式', '✅ 拟声词识别填词 / DSH汉化模式(整本) / 单页识图翻译', '✅ 单页识图翻译 / 拟声识别填词(本页);整本「DSH汉化模式」仅网页端'],
      ['预计消耗', '✅ 点击前显示 ¥ 区间与框数', '⚠ 无预估:点「单页识图/拟声填词」会直接调用付费视觉引擎'],
      ['页码直达', '✅ [页码]跳/回车', '✅ ◀ [页码] 跳 ▶'],
      ['版本检测', '✅ 启动页每天自动 + 检查更新', '✅ 启动页每天自动 + 检查更新'],
      ['长任务', '异步任务 + 日志轮询', '后台线程 + 状态栏流式进度'],
      ['中断任务', '✅「取消当前任务」杀进程树(OCR/翻译/校对/嵌字/DSH)', '✅「取消当前任务」杀进程树'],
      ['项目库(数据/成品)', '✅ 数据在 <工作区>\\projects\\<书名>;成品自动进 <工作区>\\已完成\\<书名>', '✅ 同(设置里显示数据/成品路径)'],
      ['缓存/模型管理', '✅ 设置页:清理缓存 / 删除模型(按项勾选)', '✅ 设置弹窗:清理缓存(删除模型仅网页端)'],
      ['首次使用帮助门禁', '✅ 第一次必须把帮助滚到最底才能用', '✅ 同(ack 写工作区或 ~/.manga-workflow)'],
      ['拟声词默认处理', '✅ 默认「译文直盖」+样式跟随,不抹除原字', '✅ 同'],
    ];

    // 逐行渲染帮助文本(不依赖 CSS white-space,换行稳定)
    function HelpLines({ lines, style }) {
      return h('div', { style },
        lines.map((t, i) => (t === ''
          ? h('div', { key: i, style: { height: '7px' } })
          : h('div', { key: i, style: t.startsWith('【') ? { fontWeight: 600, marginTop: '4px' } : undefined }, t))),
      );
    }

    function HelpView({ onBack }) {
      const th = { textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid rgba(128,128,128,0.3)', fontWeight: 600 };
      const td = { padding: '5px 8px', borderBottom: '1px solid rgba(128,128,128,0.15)', verticalAlign: 'top' };
      const boxTitle = { fontWeight: 600, marginBottom: '6px' };

      const FLOW = [
        '0. (可选)先到「设置」配好视觉引擎 —— 想让 AI 帮你看图才需要',
        '1. 启动页点「浏览…」选文件夹,或直接粘贴路径 → 开始',
        '2. 工作台里画框(框选/自由框选),选好类型(正文/拟声/标题)、原文处理、方向、字号',
        '3. 点 OCR 识别原文 → 4. 点 翻译',
        '· 自动汉化问题多时,直接用「DSH汉化模式」(整本视觉识别+DSH翻译+校对)',
        '· 只有拟声词读错时,用「拟声词识别填词」(本页拟声词交给 DSH)',
        '· 只补当前页,用「单页识图翻译」',
        '5. 点「确认嵌字」:自动体检(数组对齐/无效译文/艺术字) → 校对 → 页面内确认 → 嵌字 → 表单+预览',
        '7. 改动后点「保存」(Ctrl+S);换页会丢掉未保存的改动',
        '8. 需要精细标注时点「启动桌面版」切到桌面工具(桌面端可「取消当前任务」)',
      ];
      const MOUSE = [
        '左键拖动:画框 / 自由框选(按住画一圈)',
        '单击框 = 选中(黄框),之后改工具栏设置会立即写回该框',
        '右键:删除点中的框',
        '双击框:编辑原文/译文(不会误建新框)',
        'B 框选 · P 自由框选 · V 竖排 · H 横排 · A 自动检测',
        '1/2/3 或 N 切换类型(正文→拟声词→标题) · E 切换原文处理(直盖→抹除→覆盖)',
        'Ctrl+Z 撤销(最多 40 步) · Ctrl+S 保存 · ←/→ 翻页',
      ];
      const SETTINGS_LINES = [
        '入口:启动页「设置」按钮 / 工作台顶部「设置」按钮。',
        '',
        '【视觉模型 / API】',
        '· 控制 DSH 识图用的视觉模型(modlens),写入 ~/.modlens/config.json',
        '· 快速预设:月之暗面 / 通义千问VL / 智谱 GLM-4V / OpenAI',
        '· 「测试连接」只发一条文本,验证地址 / Key / 模型名通不通',
        '· 「测试识图」真发一张绿色三角形图,验证模型会不会看图 —— 纯文本模型会在这步露馅',
        '',
        '【界面选项】(写入 ~/.manga-workflow/settings.json)',
        '· DSH 侧边栏:是否显示「漫画工作台」入口(双端共享)',
        '  · 关闭后侧边栏隐藏;之后若要启动嵌字流程(确认嵌字),需在 DSH 对话里手动请求启动嵌字,',
        '    或重新打开侧边栏;关闭状态下桌面端「确认嵌字」也会提示面板不可用。',
        '· 启动提示弹窗:输入框下方那条「已就绪」提示(双端共享,默认开)',
        '· 记忆上次路径:网页端与桌面端各自独立控制',
        '',
        '【运行环境】',
        '· 显示自动探测到的 Python(路径/版本/来源)与插件自带工具链目录',
        '· 三档依赖可一键安装:基础(标框/翻译/嵌字)、本地 OCR(含 torch)、GPU 去字',
        '· 依赖装在插件目录的 _venv 里,不影响系统 Python;装完点「重新检测」',
      ];
      const OCRFB = [
        '本地 OCR(manga_ocr / easyocr)读不出来、明显漏字时,可以让视觉引擎重读那几个框。',
        '入口:设置 → OCR 兜底(网页端与桌面端改的是同一份配置)。',
        '',
        '【四档阈值】',
        '· 关闭 —— 只用本地 OCR,不花钱',
        '· 仅空框(默认)—— 只补完全没认出来的框,当安全网用,几乎不花钱',
        '· 空框 + 极短 —— 有效字数 < 阈值也重读(标点、省略号不计入字数)',
        '· 全部重读 —— 每个有字的框都重读一遍,最贵',
        '',
        '【短句自动兜底】(默认开)',
        '· 有效字数 ≤5(不含标点)的框也会自动重读;漫画短句最容易被漏字',
        '· 设置里可改字数或取消勾选关闭',
        '',
        '【已兜底标记】(不重复花钱)',
        '· 处理过的框记在书的 ocr_fallback_done.json(按 页+序号+框坐标)',
        '· 重复跑 OCR 时同位置直接跳过;框移动/重标才会重跑',
        '· 想强制重跑:命令行加 --force',
        '',
        '【建议用法】',
        '1. 平时保持「仅空框」;',
        '2. 发现某本 OCR 明显漏字,(临时)切到「空框 + 极短」,把极短阈值设为 2,再跑一次 OCR;',
        '3. 补完记得切回「仅空框」,避免后续本子多花钱。',
        '',
        '【花费与安全】',
        '· 每框约 ¥0.01~0.09(kimi-k3 官方价;图越小越便宜)',
        '· 「每本上限」默认 30 框,超出的不处理(可在设置里调)',
        '· 原 ocr_text.json 会先备份成 ocr_text.json.bak',
        '· 兜底失败不会覆盖已成功的本地 OCR 结果',
      ];

      const TIPS = [
        '【强烈建议】',
        '1. 拟声词不要用「抹除+GPU」:拟声词大多压在画面、网点、线条上,LaMa 修复会把画面糊成一片,',
        '   效果普遍很差;拟声词固定用「译文直盖」(色块覆盖对拟声不可选)。',
        '2. 翻译请接入 API(设置 → 视觉引擎里配的 Kimi / DeepSeek 等会自动优先用于翻译);',
        '   免费渠道(Google / MyMemory)质量明显差,常出现错译、音译乱翻、标点错乱。',
      ];

      const FAQ = [
        'Q: 点 OCR/翻译后很久没反应?',
        'A: 任务是异步的,看下方日志滚动;整本 OCR 通常 1-3 分钟。',
        '',
        'Q: 翻译很慢或失败?',
        'A: 默认优先用 AI(已配置的视觉引擎 API),失败才回退免费引擎;免费引擎质量差,建议接 API。',
        '',
        'Q: 保存后 OCR 结果变了?',
        'A: 不会。保存只应用你改过的文本,不会用旧快照覆盖新 OCR。',
        '',
        'Q: OCR 漏字 / 认不出来怎么办?',
        'A: 设置 → OCR 兜底,临时切「空框 + 极短」并把阈值设为 2,再跑一次 OCR(详见「六、OCR 兜底」);',
        '   也可以双击框手动改原文,桌面版改起来更顺手。',
        '',
        'Q: 自动标框的框为什么默认不参与嵌字?',
        'A: 自动框标了 auto 标记,确认无误后勾选「auto 参与」(或逐个改类型/删错框)才会嵌字。',
        '',
        'Q: 输入框下方那条「已就绪」提示能关掉吗?',
        'A: 能。设置 → 界面选项 → 启动提示弹窗。',
        '',
        'Q: 侧边栏的「漫画工作台」不见了 / 想隐藏?',
        'A: 设置 → 界面选项 → DSH 侧边栏。这一项双端共享,桌面端改的也是它。',
        '',
        'Q: 不想让它记住上次的文件夹?',
        'A: 设置 → 界面选项 → 记忆上次路径(网页端);桌面版在它自己的「设置」里。',
        '',
        'Q: 自动区分的类型不准(拟声词被判成正文)?',
        'A: 单击该框 → 按 2(或点「类型 → 无框正文/拟声词」)改成拟声词即可;网页端没有自动标框,类型由你标注。',
        '',
        'Q: 换成免费模型后 AI 还是看不到图?',
        'A: 先点「测试识图」看是否通过;通过后重开一次对话,识图才会用上新配置。',
        '',
        'Q: 失败报告里的「未翻译 / 噪音 / 装饰字 / 疑似误判」是什么意思?',
        'A: 未翻译 = 跑一次「整本 翻译」即可;噪音 = 页码 / 水印 / 界面文字,建议排除不用管;',
        '   装饰字 = 艺术字 / 目录页,OCR 不可靠,建议手填原文;疑似误判 = 可忽略,不用逐条改。',
        '',
        'Q: 噪音框(页码/水印/界面文字)不删,会影响嵌字吗?',
        'A: 平时不影响(自动框默认 auto、不参与嵌字);但如果点「全书auto参与」,旧版会把噪音也设为参与,',
        '   中文就会盖到画面上。15.57 起已在「翻译 / 嵌字 / 三个参与按钮」三处自动跳过噪音框;',
        '   只有想让标框画面干净时才需要右键删掉这些框。',
        '',
        'Q: 「本页auto→参与」「仅补有译文的」「全书auto参与」有什么区别?',
        'A: 三者都是把 auto 框变成「参与嵌字」,防止未确认的自动框被直接嵌:',
        '   · 本页auto→参与:本页所有框都参与(含没译文的,译文空就不嵌);',
        '   · 仅补有译文的(推荐):只让「已有译文」的框参与,没译文的保持不动,避免空框误嵌;',
        '   · 全书auto参与:遍历全书,把所有有译文的 auto 框设为参与(最慢,建议先保存/校对)。',
        '   三者都会自动跳过页码/UI/小碎框等噪音。',
        '',
        'Q: 译文乱了/错位,想重新翻译一遍怎么办?',
        'A: 勾选工具栏「强制重译」,再点「翻译」即可覆盖已有译文重翻(按「范围」作用于此页或整本)。',
        '   若仍乱,先删掉该页的框重新自动标框,再 OCR + 强制重译。',
        '',
        'Q: 怎么确认翻译有没有成功?',
        'A: 画布上方有「显示译文」勾选(默认关),勾上后每个框底部直接显示中文译文;',
        '   旁边「显示原文」勾选可同时显示 OCR 原文(核对识别结果)。右上角「译 N」是全书已翻译框数。',
        '',
        'Q: 任务跑完了,但画面没有变化?',
        'A: 点画布上方「⟳ 刷新本页」即可重新加载本页的框/译文/图片(不重载整个面板);',
        '   嵌字后想看新图也用它。任务结束时状态条会提醒这一点。',
        '',
        'Q: 上面办法都解决不了,或者程序反复报错怎么办?',
        'A: 到 B 站视频评论区反馈 BUG(附现象与截图):https://www.bilibili.com/video/BV15Zs86GEz7',
      ];

      return h('div', { style: S.root },
        h('div', { style: S.row },
          h('button', { type: 'button', style: S.btn, onClick: onBack }, '← 返回'),
          h('span', { style: { fontWeight: 600, fontSize: '14px' } }, '使用说明'),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '⚠ 使用提示(重要)'),
          h(HelpLines, { lines: TIPS, style: S.muted }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '一、基本流程'),
          h(HelpLines, { lines: FLOW, style: S.muted }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '二、鼠标与快捷键'),
          h(HelpLines, { lines: MOUSE, style: S.muted }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '三、网页版与桌面版的区别'),
          h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '11px' } },
            h('thead', null, h('tr', null, HELP_ROWS[0].map((c, i) => h('th', { key: i, style: th }, c)))),
            h('tbody', null, HELP_ROWS.slice(1).map((row, ri) =>
              h('tr', { key: ri }, row.map((c, ci) => h('td', { key: ci, style: td }, c))),
            )),
          ),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '四、设置页说明'),
          h(HelpLines, { lines: SETTINGS_LINES, style: S.muted }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '五、视觉引擎(识图)与免费模型'),
          h(HelpLines, {
            lines: [
              '想让 AI「看图 / 读图」——比如检查嵌字效果、读图上的文字、核对气泡位置——必须先配好视觉引擎。',
              '本地 OCR 不需要它,但「让 AI 帮你看图」完全依赖它。',
              '配置入口:启动页或工作台顶部「设置」→ 视觉模型 / API(详见「四、设置页说明」)。',
            ],
            style: { ...S.muted, marginBottom: '6px' },
          }),
          h('div', { style: { fontWeight: 600, margin: '8px 0 4px' } }, '免费 / 低门槛的视觉模型'),
          h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '11px' } },
            h('thead', null, h('tr', null,
              ['模型', 'API Base', '模型名', '说明'].map((c, i) =>
                h('th', { key: i, style: { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid rgba(128,128,128,0.3)' } }, c)),
            )),
            h('tbody', null, FREE_VISION.map((v, ri) =>
              h('tr', { key: ri },
                h('td', { style: { padding: '4px 6px', borderBottom: '1px solid rgba(128,128,128,0.15)' } }, v.name),
                h('td', { style: { padding: '4px 6px', borderBottom: '1px solid rgba(128,128,128,0.15)', wordBreak: 'break-all' } }, v.base),
                h('td', { style: { padding: '4px 6px', borderBottom: '1px solid rgba(128,128,128,0.15)', wordBreak: 'break-all' } }, v.model),
                h('td', { style: { padding: '4px 6px', borderBottom: '1px solid rgba(128,128,128,0.15)' } }, v.note),
              )),
            ),
          ),
          h('div', { style: { ...S.muted, fontSize: '10px', marginTop: '4px' } },
            '免费额度、模型名与可用性随时可能调整,请以各厂商官网为准。'),
          h('div', { style: { fontWeight: 600, margin: '8px 0 4px' } }, '使用提示'),
          h(HelpLines, {
            lines: VISION_TIPS.map((t, i) => (i + 1) + '. ' + t),
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '六、OCR 兜底(漏字时怎么办)'),
          h(HelpLines, { lines: OCRFB, style: S.muted }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '七、常见问题'),
          h(HelpLines, { lines: FAQ, style: S.muted }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '八、标注体系(类型 / 原文处理 / 方向)'),
          h(HelpLines, {
            lines: [
              '【类型】正文(绿框) / 无框正文·拟声词(红虚线框) / 标题(蓝框,嵌字居中加粗)',
              '【原文处理】译文直盖 / 抹除 / 色块覆盖(拟声词无「色块覆盖」,固定直盖或抹除);选「抹除」时下方出现「GPU去字」勾选(按框记录)',
              '【框外标注】左上角=类型,右上角=原文处理(直盖/覆盖/抹除·GPU/抹除·普通)',
              '【点选编辑】单击框=选中(黄框),改类型/处理/GPU/方向/字号/样式会立即写回该框',
              '【记忆】每种类型各自记住上次的原文处理/GPU,切换类型自动恢复(仅本次页面会话)',
              '【方向】自动检测 / 竖排 / 横排;【字号】手动 + 自动字号(拟声放大、正文缩到框内)',
              '【拟声词】固定「译文直盖」,不记忆、不可选色块覆盖;确实要擦原字请改成「抹除」',
              '【拟声样式跟随】自动采样原图字色/描边色/描边粗细,♡♪♥ 等符号保留并跟随样式;默认不抹除(避免浅块),要擦在 config.json 设 sfx_erase: true',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '九、标准操作流程(照按键顺序做)'),
          h(HelpLines, {
            lines: [
              '【0】鼠标放到任意按键上,会显示该按键的具体说明(title 提示)。',
              '',
              '【1】标注文字框',
              '   · 手动:框选工具逐框画;',
              '   · 自动:点「自动标框」→ 自动结果**必须人工更正**(单击=改属性,双击=改文字,右键=删框),',
              '     确认无误再进入下一步;未确认的自动框(auto)默认不参与嵌字。',
              '',
              '【2】OCR 识别原文',
              '   · 本地 OCR(日/韩/英),不联网;',
              '   · 个别框识别失败/拟声词读错时,可开启 **OCR 兜底**:会调用**外部视觉引擎**(按框计费,约 ¥0.004~0.02/框)。',
              '',
              '【3】翻译',
              '   · 免费引擎或 DSH 模型翻译(整本/本页);',
              '   · 复杂单页可以用「单页识图翻译」或「拟声词识别填词」(本页)——',
              '     这两个会调用**付费外部视觉引擎**(单价同上),点击前会显示预估金额。',
              '',
              '【4】自动校对:点「校对」;嵌字前还会自动跑一遍体检(数组对齐/无效译文/艺术字/同源拟声统一)。',
              '',
              '【5】人工校对:看校对报告(缺译文/结构疑点/溢出提示),双击可疑框改文字或重标。',
              '',
              '【6】出图(三选一):',
              '   · 「确认嵌字」:体检 → 校对 → 页面内确认 → 嵌字 → 结果表单+预览;',
              '   · 「DSH汉化模式」:整本视觉识别 + DSH 翻译 + 参与嵌字 + 校对(付费,先看预估);',
              '   · 「交给对话」:提交后请在对话里**手动填写你的需求**(如“执行嵌字并汇报问题”)。',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '十、DSH 接管模式与花费'),
          h(HelpLines, {
            lines: [
              '【提示】所有按键鼠标悬停会显示具体描述。',
              '【确认嵌字】(默认,面板内完成)',
              '· 自动体检:数组对齐、缺译文清单、数字/拉丁无效译文拦截、艺术字排除(标题豁免)',
              '· 再跑嵌字前校对 → 页面内黄色卡片确认 → 嵌字(脚本内自动再校对) → 表单 + 可切换预览',
              '【交给对话】',
              '· 写请求到工作区,回对话里说「执行嵌字」,由 DSH 在对话里执行并汇报',
              '【单页识图翻译】',
              '· 当前页所有框:视觉引擎读原文 → DSH 模型翻译(覆盖)',
              '【拟声词识别填词】',
              '· 本页拟声词:视觉识别 → DSH 翻译 → 自动设为参与嵌字',
              '【DSH汉化模式】(整本接管)',
              '· 整本视觉识别 → DSH 翻译 → 设为参与嵌字 → 校对;耗时与花费较高,点击前会显示预计消耗',
              '',
              '【预计消耗怎么算】',
              '· 视觉识别按框计费:约 ¥0.01~0.09/框(取决于裁剪大小与模型)',
              '· DSH 翻译走 DSH 额度,不额外计费;本地嵌字免费',
              '· 三个入口(拟声词识别填词 / DSH汉化模式 / 交给对话)都会先弹确认卡片显示框数与 ¥ 区间',
              '',
              '【取消当前任务】工作台新增按钮:终止正在运行的 OCR / 翻译 / 校对 / 嵌字 / DSH 接管任务',
        '(会杀进程树,任务状态变为「已取消」;任务结束后按钮会提示没有运行中的任务)。',
        '【auto 框与三个参与选项】(网页端专属)',
              '· auto 框 = 自动标框/自动检测产生的框,默认不参与嵌字(防止误标上屏);',
              '  「本页auto→参与」:把**当前页所有框**设为参与(不管有没有译文,建议整页都确认过再用);',
              '  「仅补有译文的」:只把当前页**已有译文**的 auto 框设为参与(最安全,推荐);',
              '  「全书auto参与」:遍历全书,把**所有有译文的** auto 框设为参与(最慢,建议先保存/校对);',
              '  「体检时auto参与」:勾选后,点「确认嵌字」时体检阶段自动执行「仅补有译文的」(全书范围),',
              '  不用手动点按钮;三个按钮改完都要点「保存」才生效。',
              '【项目库 / 嵌字工作区】先到「设置」指定嵌字工作区,然后选任意一本漫画文件夹开始:',
              '  · 程序在工作区 projects/<书名>/ 里存框、译文、原文、配置(源漫画文件夹只读,不会被改动);',
              '  · 旧书第一次打开会自动把书里已有的数据导入项目库,书里原文件保留;',
              '  · 嵌字完成后成品自动输出到 <工作区>/已完成/<书名>/,目录会自动创建;',
              '  · 同一本书再次打开会复用同一个项目;不同路径的同名书会自动加 __2/__3;',
              '  · 没设置工作区时不允许开始,会提示先去设置。',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '十一、文字样式(正文 / 拟声 / 标题 三组)'),
          h(HelpLines, {
            lines: [
              '工作台里有三排样式按钮,按钮上直接画出渲染效果(和最终嵌字一致):',
              '',
              '【正文样式】经典(黑字白边)· 极简(纯黑)· 细边 · 加粗 · 反白(白字黑边)· 投影',
              '【拟声样式】漫画(黑字白边+影)· 反白 · 燃红 · 亮黄 · 热橙 · 冷蓝',
              '【标题样式】粗黑 · 反白 · 纯黑 · 亮黄 · 艺术(标题嵌字自动居中加粗)',
              '每组右侧有字体下拉(宋体/黑体/楷体/仿宋/华文仿宋/瘦金体…),选完预览立即同步',
              '',
              '· 点一下选中(高亮),之后新画的框使用它;',
              '· 改已有框:「应用到本页」按类型套用本页;「应用到全部」按类型刷全书;',
              '· 「样式 ▾」可收起样式栏,再展开回到原位置;',
              '· 样式表在 manga_tool/styles.json,网页端与桌面端共用同一份。',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '十二、1.12–1.15 新功能速查'),
          h(HelpLines, {
            lines: [
              '【拟声词】固定「译文直盖」:色块覆盖已移除;需要擦原字就把原文处理改成「抹除」。',
              '【确认嵌字】体检 → 校对 → 页面内确认 → 嵌字 → 表单+预览;全程显示分阶段进度。',
              '  · 旁边「范围」选「此页」只处理当前页(推荐先单页试),选「整本」处理全书已标框的页;体检/校对/嵌字都按该范围执行。',
              '【auto 参与】本页auto→参与 / 仅补有译文的(推荐) / 全书auto参与 / 体检时auto参与。',
              '【单页识图翻译】当前页:视觉引擎读原文 → DSH 翻译(付费,按页计费)。',
              '【拟声词识别填词】本页拟声词:视觉识别 → DSH 翻译 → 自动设为参与嵌字。',
              '【刷新本页】只重读当前页框与译文并重载图片,不重载 DSH。',
              '【缓存/模型】设置 → 缓存/模型:查看占用、清理缓存、删除指定模型。',
              '【版本更新】启动页显示 当前/稳定版/测试版;最新 Release=测试版,前一个=稳定版。',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '十三、项目库与成品目录'),
          h(HelpLines, {
            lines: [
              '【先设工作区】设置 → 嵌字工作区;然后选任意漫画文件夹开始工作。',
              '【数据位置】<工作区>/projects/<书名>/ 存 regions.json、trans.json、ocr_text.json、config.json 与 out/out_lama/preview;源目录只读。',
              '【旧书导入】第一次打开旧书会把书里已有数据导入项目库,书里原文件保留。',
              '【成品输出】嵌字成功后自动复制 PNG 到 <工作区>/已完成/<书名>/(目录自动创建)。',
              '【同名书】不同路径的同名书自动加 __2 / __3 区分;再次打开同一本会复用同一项目。',
              '【DSH 接管说明】设置好工作区后,插件自动在 <工作区>/DSH-接管说明.md 生成说明书(随插件更新刷新);设置页会显示该路径。',
              '【新对话怎么开头】新开 DSH 对话处理漫画时,第一句说「先读工作区根目录的 DSH-接管说明.md,然后 …」,DSH 就会按里面的流程/目录/规则接手。',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '十四、缓存与模型管理'),
          h(HelpLines, {
            lines: [
              '设置 → 缓存/模型:显示缓存(_lama_io、preview、projects)与模型(torch/hf/easyocr)占用。',
              '「清理缓存」只删临时文件,不动模型与项目数据。',
              '「删除模型…」可勾选删除指定模型;删除后下次使用会自动重新下载。',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '十五、版本更新(稳定版 / 测试版)'),
          h(HelpLines, {
            lines: [
              '启动页右下显示当前版本与「检查更新」。',
              '规则:GitHub 最新 Release = 测试版;前一个 Release = 稳定版。',
              '有新版时出现「更新稳定版」「更新测试版」:下载 .tgz 到 <工作区>/dist/。',
              '检查结果按天缓存;想立刻重查可在启动页点「检查更新」强制刷新。',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: { textAlign: 'center', marginTop: '20px', fontSize: '10px', color: '#888' } },
          '· ' + APP_VERSION + ' · 本软件完全由 AI(DeepSeek Harness Agent)生成与编写。作者:YiDaWuYi',
        ),
      );
    }

    /* ---------------- 设置页(视觉模型 / API) ---------------- */

    // 常见 OpenAI 兼容视觉后端(点一下填 Base + 常用模型名)
    const VISION_PRESETS = [
      { name: '月之暗面', base: 'https://api.moonshot.cn/v1', model: 'kimi-k3' },
      { name: '通义千问VL', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
      { name: '智谱 GLM-4V', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-plus' },
      { name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    ];

    // OCR 兜底模式
    const OCR_MODES = [
      ['off', '关闭'],
      ['empty', '仅空框'],
      ['short', '空框 + 极短'],
      ['all', '全部重读'],
    ];

    // 官方参考价(元 / 百万 tokens,抓取于 2026-11;以官网为准)
    const PRICE_PRESETS = {
      'kimi-k3': { in: 20, out: 100, note: '缓存命中输入约 ¥2/MTok' },
      'kimi-k3.1-pro': { in: 13, out: 52, note: '' },
      'gemini-2.0-flash': { in: 1, out: 4, note: '按 $0.10/$0.40 约合' },
    };

    // 免费/低门槛视觉模型(名称与额度以各厂商官网为准)
    const FREE_VISION = [
      { name: '智谱 GLM-4V-Flash', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash', note: '官方免费' },
      { name: '硅基流动 Qwen2.5-VL', base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-VL-7B-Instruct', note: '有免费模型,以站内为准' },
      { name: 'Google Gemini 2.0 Flash', base: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.0-flash', note: 'AI Studio 免费额度' },
      { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: '选带 :free 的视觉模型', note: '免费模型随时变' },
    ];

    const VISION_TIPS = [
      '识图(让 AI 看图/读图)必须有视觉引擎;本地 OCR 不依赖它,但"让 AI 检查嵌字效果"要靠它。',
      '换厂商要连 API Key 一起换,只改 API Base 会鉴权失败。',
      '填的模型必须有视觉能力,填纯文本模型(如 deepseek-chat)会报错。',
      '保存后先点「测试连接」,再在对话里让 AI 读一张图验证。',
      '免费模型通常有速率限制,整本批量识图建议用付费或分批进行。',
      '保存后如果当前对话里的识图工具还用旧配置,重开一次对话最稳。',
    ];

    /* ---------- 缓存 / 模型管理 ---------- */
    function CachePanel() {
      const [items, setItems] = React.useState([]);
      const [pick, setPick] = React.useState({});
      const [msg, setMsg] = React.useState('');
      const [busy, setBusy] = React.useState(false);

      const load = async () => {
        try {
          const d = await api('/cache/info');
          setItems((d && d.items) || []);
        } catch (e) {
          setMsg('读取失败:' + String(e.message || e));
        }
      };
      React.useEffect(() => { load(); }, []);

      const caches = items.filter((it) => it.kind === 'cache');
      const models = items.filter((it) => it.kind === 'model');
      const totalMB = Math.round(items.reduce((a, b) => a + (b.sizeMB || 0), 0) * 10) / 10;

      const clearCaches = async () => {
        if (!caches.length) return;
        setBusy(true);
        try {
          const r = await api('/cache/clear', { keys: caches.map((it) => it.key) });
          setMsg(`已清理缓存,释放 ${r.freedMB} MB`);
          await load();
        } catch (e) { setMsg('清理失败:' + String(e.message || e)); }
        setBusy(false);
      };
      const delModels = async () => {
        const keys = models.filter((it) => pick[it.key]).map((it) => it.key);
        if (!keys.length) { setMsg('请先勾选要删除的模型'); return; }
        if (!window.confirm('确定删除选中的模型?下次使用会自动重新下载(可能很慢/需要网络)。')) return;
        setBusy(true);
        try {
          const r = await api('/cache/clear-models', { keys });
          setMsg(`已删除模型,释放 ${r.freedMB} MB`);
          setPick({});
          await load();
        } catch (e) { setMsg('删除失败:' + String(e.message || e)); }
        setBusy(false);
      };

      const rowOf = (it) => h('div', { key: it.key, style: { ...S.row, marginBottom: '2px' } },
        it.kind === 'model'
          ? h('input', { type: 'checkbox', checked: !!pick[it.key], onChange: (e) => setPick((p) => ({ ...p, [it.key]: e.target.checked })) })
          : h('span', { style: { width: '13px' } }),
        h('span', { style: { fontSize: '11px' } }, it.label),
        h('span', { style: { ...S.muted, fontSize: '11px' } }, ` ${it.sizeMB} MB`),
        h('span', { style: { ...S.muted, fontSize: '10px', opacity: 0.7, marginLeft: 'auto', maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: it.dir }, it.dir),
      );

      return h('div', { style: { ...S.box, marginTop: '10px' } },
        h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, `缓存与模型(共 ${totalMB} MB)`),
        h('div', { style: { ...S.muted, fontSize: '11px', marginBottom: '6px' } },
          '「清理缓存」只删临时文件,不动模型;/「删除模型」会删掉选中模型,下次使用会自动重新下载。'),
        h('div', { style: { fontWeight: 600, fontSize: '11px', marginTop: '4px' } }, '缓存(可安全清理)'),
        caches.length ? caches.map(rowOf) : h('div', { style: { ...S.muted, fontSize: '11px' } }, '(暂无可清理缓存)'),
        h('div', { style: S.row },
          h('button', { type: 'button', style: S.btn, disabled: busy || !caches.length, onClick: clearCaches }, '清理缓存'),
        ),
        h('div', { style: { fontWeight: 600, fontSize: '11px', marginTop: '6px' } }, '模型(勾选后可删除)'),
        models.length ? models.map(rowOf) : h('div', { style: { ...S.muted, fontSize: '11px' } }, '(未检测到模型)'),
        h('div', { style: S.row },
          h('button', { type: 'button', style: S.btnDanger, disabled: busy || !models.length, onClick: delModels }, '删除选中模型'),
          h('button', { type: 'button', style: S.btn, disabled: busy, onClick: load }, '刷新'),
        ),
        msg ? h('div', { style: { fontSize: '11px', marginTop: '2px' } }, msg) : null,
      );
    }

    function SettingsView({ onBack, folder }) {
      const [model, setModel] = React.useState('');
      const [apiBase, setApiBase] = React.useState('');
      const [apiKey, setApiKey] = React.useState('');
      const [keyHint, setKeyHint] = React.useState('');
      const [keySet, setKeySet] = React.useState(false);
      const [file, setFile] = React.useState('');
      const [msg, setMsg] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [saved, setSaved] = React.useState(false);
      const [uiCfg, setUiCfg] = React.useState(null);
      const [wsDir, setWsDir] = React.useState('');
      const [wsExists, setWsExists] = React.useState(false);
      const [wsGuide, setWsGuide] = React.useState('');
      const saveUi = async (patch) => {
        try {
          const r = await api('/settings/ui', patch);
          if (r) setUiCfg(r);
          const w = await api('/workspace/status');
          setWsExists(!!(w && w.exists));
          setWsGuide((w && w.guide) || '');
          setMsg('界面设置已保存');
        } catch (e) {
          setMsg('保存失败:' + String(e.message || e));
        }
      };
      const [setup, setSetup] = React.useState(null);
      const [setupLog, setSetupLog] = React.useState('');
      const [setupBusy, setSetupBusy] = React.useState('');
      const [cost, setCost] = React.useState(null);
      const [ocrCfg, setOcrCfg] = React.useState(null);
      const [trans, setTrans] = React.useState(null);
      const [transForm, setTransForm] = React.useState({ engines: [], proxy: '', baseUrl: '', model: '', key: '' });
      const [transMsg, setTransMsg] = React.useState('');
      const [ocrMin, setOcrMin] = React.useState('1');
      const [ocrShortAuto, setOcrShortAuto] = React.useState(true);
      const [ocrShortMax, setOcrShortMax] = React.useState('5');
      const [ocrMax, setOcrMax] = React.useState('30');
      const [priceIn, setPriceIn] = React.useState(() => {
        try { const p = JSON.parse(localStorage.getItem('manga-desk-prices') || '{}'); return p.in == null ? '' : String(p.in); } catch (e) { return ''; }
      });
      const [priceOut, setPriceOut] = React.useState(() => {
        try { const p = JSON.parse(localStorage.getItem('manga-desk-prices') || '{}'); return p.out == null ? '' : String(p.out); } catch (e) { return ''; }
      });

      async function refreshTrans() {
        try {
          const d = await api('/trans');
          setTrans(d);
          setTransForm((f) => ({
            ...f,
            engines: Array.isArray(d.engines) && d.engines.length ? d.engines : ['ai'],
            proxy: d.proxy || '',
            baseUrl: (d.ai && d.ai.baseUrl) || '',
            model: (d.ai && d.ai.model) || '',
            key: '',
          }));
        } catch (e) {
          setTransMsg('读取翻译配置失败:' + String(e.message || e));
        }
      }

      async function saveTrans() {
        setTransMsg('保存中…');
        try {
          const ai = { baseUrl: transForm.baseUrl.trim(), model: transForm.model.trim() };
          if (transForm.key.trim()) ai.apiKey = transForm.key.trim();
          const d = await api('/trans', {
            engines: transForm.engines.length ? transForm.engines : ['ai'],
            proxy: transForm.proxy.trim(),
            ai,
          });
          setTrans((prev) => ({ ...(prev || {}), engines: d.engines, proxy: d.proxy, ai: d.ai }));
          setTransForm((f) => ({ ...f, key: '' }));
          setTransMsg('已保存(双端共享)✅');
        } catch (e) {
          setTransMsg('保存失败:' + String(e.message || e));
        }
      }

      async function testTrans() {
        setTransMsg('测试中…(大模型可能要几秒)');
        try {
          const d = await api('/trans-test', {
            baseUrl: transForm.baseUrl.trim(),
            model: transForm.model.trim(),
            apiKey: transForm.key.trim() || undefined,
          });
          setTransMsg((d.ok ? '✅ ' : '❌ ') + (d.message || ''));
        } catch (e) {
          setTransMsg('测试失败:' + String(e.message || e));
        }
      }

      async function refreshSetup() {
        try {
          const d = await api('/setup/status');
          setSetup(d);
        } catch (e) {
          setSetup({ error: String(e.message || e) });
        }
      }

      async function installDeps(tier) {
        if (setupBusy) return;
        setSetupBusy(tier);
        setSetupLog('准备安装 ' + tier + ' 依赖…\n');
        try {
          const { jobId } = await api('/setup/install', { tier });
          let last = '';
          for (;;) {
            await new Promise((r) => setTimeout(r, 1200));
            const j = await api('/job?id=' + encodeURIComponent(jobId));
            if (j.log && j.log !== last) {
              last = j.log;
              setSetupLog(j.log);
            }
            if (j.status !== 'running') {
              setSetupLog((j.log || '') + (j.code === 0 ? '\n[完成]' : '\n[失败] 退出码 ' + j.code));
              break;
            }
          }
          await refreshSetup();
        } catch (e) {
          setSetupLog('安装失败:' + String(e.message || e));
        } finally {
          setSetupBusy('');
        }
      }

      React.useEffect(() => {
        refreshSetup();
        refreshTrans();
      }, []);

      React.useEffect(() => {
        const q = folder ? ('?folder=' + encodeURIComponent(folder)) : '';
        api('/cost' + q).then(setCost).catch(() => setCost(null));
        api('/settings/ocr').then((d) => {
          setOcrCfg(d);
          setOcrMin(String(d.minChars));
          setOcrMax(String(d.maxPerBook));
          setOcrShortAuto(d.shortAuto !== false);
          setOcrShortMax(String(d.shortMax || 5));
        }).catch(() => setOcrCfg(null));
      }, [folder]);

      async function saveOcrCfg(patch) {
        try {
          const r = await api('/settings/ocr', patch);
          if (r && r.settings) {
            setOcrCfg(r.settings);
            setOcrMin(String(r.settings.minChars));
            setOcrMax(String(r.settings.maxPerBook));
            setOcrShortAuto(r.settings.shortAuto !== false);
            setOcrShortMax(String(r.settings.shortMax || 5));
          }
          setMsg('OCR 兜底设置已保存:'
            + (OCR_MODES.find(([v]) => v === (r.settings || {}).mode) || ['', '?'])[1]
            + ` (极短阈值 ${r.settings.minChars} / 每本上限 ${r.settings.maxPerBook})`);
        } catch (e) {
          setMsg('保存失败:' + String(e.message || e));
        }
      }

      function savePrice(k, v) {
        if (k === 'in') setPriceIn(v); else setPriceOut(v);
        try {
          const cur = JSON.parse(localStorage.getItem('manga-desk-prices') || '{}');
          cur[k] = v === '' ? null : Number(v);
          localStorage.setItem('manga-desk-prices', JSON.stringify(cur));
        } catch (e) { /* ignore */ }
      }

      React.useEffect(() => {
        api('/settings/ui').then((d) => {
          setUiCfg(d);
          setWsDir(String((d && d.workspaceDir) || ''));
          api('/workspace/status').then((w) => { setWsExists(!!(w && w.exists)); setWsGuide((w && w.guide) || ''); }).catch(() => setWsExists(false));
        }).catch(() => setUiCfg(null));
        api('/settings')
          .then((d) => {
            setModel(d.model || '');
            setApiBase(d.apiBase || '');
            setKeySet(!!d.apiKeySet);
            setKeyHint(d.apiKeyHint || '');
            setFile(d.file || '');
          })
          .catch((e) => setMsg(String(e.message || e)));
      }, []);

      async function toggleUi(key) {
        if (!uiCfg) return;
        const next = { ...uiCfg, [key]: !uiCfg[key] };
        setUiCfg(next);
        try {
          const r = await api('/settings/ui', { [key]: next[key] });
          if (r && r.settings) setUiCfg(r.settings);
          if (key === 'sidebarEnabled') { applySidebarEntry(next[key]); writeUiCache({ sidebarEnabled: !!next[key] }); }
          if (key === 'bannerEnabled') { applyBannerEntry(next[key]); writeUiCache({ bannerEnabled: !!next[key] }); }
          if (key === 'rememberPathWeb') {
            shell.rememberPathWeb = !!next[key];
            writeUiCache({ rememberPathWeb: !!next[key] });
            // 关掉时立即清掉已缓存的路径(之前这里只改了提示文案,BUG)
            if (!next[key]) {
              try { localStorage.removeItem('manga-desk-folder'); } catch {}
            }
          }
          if (key === 'sidebarEnabled') {
            // 关掉后网页端就无法再打开本面板,只能回桌面版改回来 —— 提示要说清楚
            setMsg(next[key]
              ? '已开启侧边栏入口'
              : '已关闭侧边栏入口。注意:关掉后网页端将无法再打开本设置页,需到桌面版「设置」里勾回');
          } else if (key === 'bannerEnabled') {
            setMsg(next[key] ? '已开启启动提示弹窗(下次加载时出现)' : '已关闭启动提示弹窗');
          } else {
            setMsg(next[key] ? '网页端已开启记忆上次路径' : '网页端已关闭记忆上次路径,已清除记住的路径');
          }
        } catch (e) {
          setMsg('切换失败:' + String(e.message || e));
          api('/settings/ui').then(setUiCfg).catch(() => {});
        }
      }

      async function save() {
        setBusy(true);
        setMsg('');
        try {
          const d = await api('/settings', {
            model, apiBase, apiKey,
          });
          setApiKey('');
          setKeySet(!!d.settings.apiKeySet);
          setKeyHint(d.settings.apiKeyHint || '');
          setSaved(true);
          setMsg('已保存');
          setTimeout(() => setSaved(false), 2000);
        } catch (e) {
          setMsg('保存失败:' + String(e.message || e));
        } finally {
          setBusy(false);
        }
      }

      async function testVision() {
        setBusy(true);
        setMsg('正在发一张测试图给模型识别…');
        try {
          const r = await api('/settings/vision-test', { model, apiBase, apiKey });
          if (!r.ok) {
            setMsg(`识图测试失败 ❌  ${r.error || ''}` + (r.hint ? `\n提示:${r.hint}` : ''));
          } else if (r.visionOk) {
            setMsg(`识图成功 ✅  延迟 ${r.latencyMs}ms  模型回答「${r.reply}」(期望:${r.expected})`);
          } else {
            setMsg(`接口通了,但没看懂图 ⚠️  延迟 ${r.latencyMs}ms  模型回答「${r.reply || '(空)'}」\n` +
              `期望「${r.expected}」—— 该模型可能不支持视觉,或图片被忽略了。`);
          }
        } catch (e) {
          setMsg('识图测试失败:' + String(e.message || e));
        } finally {
          setBusy(false);
        }
      }

      async function test() {
        setBusy(true);
        setMsg('正在测试连接…');
        try {
          const r = await api('/settings/test', { model, apiBase, apiKey });
          if (r.ok) {
            setMsg(`连接成功 ✅  延迟 ${r.latencyMs}ms  模型 ${r.model}` + (r.reply ? `  返回「${r.reply}」` : ''));
          } else {
            setMsg(`连接失败 ❌  ${r.error || ('HTTP ' + (r.status || '?'))}` + (r.latencyMs ? `  (${r.latencyMs}ms)` : ''));
          }
        } catch (e) {
          setMsg('测试失败:' + String(e.message || e));
        } finally {
          setBusy(false);
        }
      }

      const label = { width: '92px', flex: '0 0 92px', ...S.muted };
      return h('div', { style: S.root },
        h('div', { style: S.row },
          h('button', { type: 'button', style: S.btn, onClick: onBack }, '← 返回'),
          h('span', { style: { fontWeight: 600, fontSize: '14px' } }, '设置'),
        ),
        h('div', { style: S.box },
          h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '视觉模型 / API(识图后端 · OpenAI 兼容)'),
          h('div', { style: { ...S.muted, fontSize: '11px', marginBottom: '8px' } },
            '这里控制 DSH 识图用的视觉模型(modlens),改完即替换当前在用的那一家的 API。'),
          h('div', { style: { ...S.row, marginBottom: '8px' } },
            h('span', { style: label }, '快速预设'),
            VISION_PRESETS.map((ps) => h('button', {
              key: ps.name,
              type: 'button',
              style: { ...S.btn, padding: '3px 8px' },
              title: ps.base + '  ·  ' + ps.model,
              onClick: () => { setModel(ps.model); setApiBase(ps.base); setMsg(`已填入预设:${ps.name},别忘了粘贴对应的 API Key 再保存`); },
            }, ps.name)),
          ),
          h('div', { style: S.row },
            h('span', { style: label }, '模型名'),
            h('input', {
              style: { ...S.input, fontSize: '13px' },
              value: model,
              placeholder: '例如 kimi-k3 / qwen-vl-max / glm-4v-plus / gpt-4o-mini',
              onChange: (e) => setModel(e.target.value),
            }),
          ),
          h('div', { style: S.row },
            h('span', { style: label }, 'API Base'),
            h('input', {
              style: { ...S.input, fontSize: '13px' },
              value: apiBase,
              placeholder: 'https://…/compatible-mode/v1',
              onChange: (e) => setApiBase(e.target.value),
            }),
          ),
          h('div', { style: S.row },
            h('span', { style: label }, 'API Key'),
            h('input', {
              style: { ...S.input, fontSize: '13px' },
              type: 'password',
              value: apiKey,
              placeholder: keySet ? `已设置(${keyHint}),留空表示不修改` : '未设置,粘贴你的 API Key',
              onChange: (e) => setApiKey(e.target.value),
            }),
          ),
          h('div', { style: { ...S.row, marginTop: '2px' } },
            h('span', { style: { ...label, opacity: 0 } }, 'x'),
            h('button', { type: 'button', style: S.btnOn, disabled: busy, onClick: save }, saved ? '已保存 ✓' : '保存'),
            h('button', { type: 'button', style: S.btn, disabled: busy, onClick: test }, busy ? '请稍候…' : '测试连接'),
            h('button', { type: 'button', style: S.btn, disabled: busy, onClick: testVision, title: '发一张绿色三角形给模型识别,验证它真会看图' }, '测试识图'),
            keySet
              ? h('button', {
                  type: 'button',
                  style: S.btnDanger,
                  disabled: busy,
                  onClick: async () => {
                    setBusy(true);
                    try {
                      const d = await api('/settings', { model, apiBase, clearKey: true });
                      setKeySet(!!d.settings.apiKeySet);
                      setKeyHint('');
                      setMsg('已清空 API Key');
                    } catch (e) {
                      setMsg('清空失败:' + String(e.message || e));
                    } finally {
                      setBusy(false);
                    }
                  },
                }, '清空 Key')
              : null,
          ),
          msg ? h('div', { style: { ...S.muted, marginTop: '6px', whiteSpace: 'pre-wrap' } }, msg) : null,
          file ? h('div', { style: { ...S.muted, marginTop: '6px', fontSize: '11px' } }, `配置文件:${file}`) : null,
        ),
        h('div', { style: { ...S.box, marginTop: '10px' } },
          h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '文字翻译引擎(双端共享)'),
          h('div', { style: { ...S.muted, fontSize: '11px', marginBottom: '6px' } },
            '优先级:DSH 模型 / 外接 AI 接口最高;免费渠道最低(多选会并行对比)。'
            + ' 网页端点「翻译」时:勾了 DSH 模型→直接调用 DSH 已配置模型自动翻译(免 Key);'
            + ' 桌面端的「DSH」= 导出请求交给会话翻译。'),
          h('div', { style: S.row },
            h('span', { style: { ...S.muted, width: '64px' } }, '引擎'),
            [['dsh', 'DSH 模型(免Key·网页自动)'], ['ai', '外接 AI 接口'], ['google', 'Google 免费'], ['mymemory', 'MyMemory 免费']].map(([k, name]) =>
              h('button', {
                key: k, type: 'button',
                style: transForm.engines.includes(k) ? S.btnOn : S.btn,
                onClick: () => setTransForm((f) => ({
                  ...f,
                  engines: f.engines.includes(k)
                    ? f.engines.filter((x) => x !== k)
                    : f.engines.concat([k]),
                })),
              }, (transForm.engines.includes(k) ? '✓ ' : '') + name)),
          ),
          h('div', { style: S.row },
            h('span', { style: { ...S.muted, width: '64px' } }, '代理'),
            h('input', {
              style: S.input, value: transForm.proxy, placeholder: '可选,如 http://127.0.0.1:7897',
              onChange: (e) => setTransForm((f) => ({ ...f, proxy: e.target.value })),
            }),
          ),
          h('div', { style: S.row },
            h('span', { style: { ...S.muted, width: '64px' } }, 'AI 地址'),
            h('input', {
              style: S.input, value: transForm.baseUrl,
              placeholder: '如 https://api.moonshot.cn/v1',
              onChange: (e) => setTransForm((f) => ({ ...f, baseUrl: e.target.value })),
            }),
            h('span', { style: { ...S.muted, width: '36px', textAlign: 'right' } }, '模型'),
            h('input', {
              style: { ...S.input, maxWidth: '160px' }, value: transForm.model,
              placeholder: '如 kimi-k3',
              onChange: (e) => setTransForm((f) => ({ ...f, model: e.target.value })),
            }),
          ),
          h('div', { style: S.row },
            h('span', { style: { ...S.muted, width: '64px' } }, 'API Key'),
            h('input', {
              style: S.input, type: 'password', value: transForm.key,
              placeholder: trans && trans.ai && trans.ai.hasKey
                ? ('已配置 ' + (trans.ai.keyMask || '****') + ' —— 留空表示不修改')
                : '未配置,请填写',
              onChange: (e) => setTransForm((f) => ({ ...f, key: e.target.value })),
            }),
          ),
          h('div', { style: { ...S.row, marginTop: '6px' } },
            h('button', { type: 'button', style: S.btnOn, onClick: saveTrans }, '保存'),
            h('button', { type: 'button', style: S.btn, onClick: testTrans }, '测试接口'),
            h('button', { type: 'button', style: S.btn, onClick: refreshTrans }, '重新读取'),
            h('span', { style: { ...S.muted, fontSize: '11px', whiteSpace: 'pre-wrap' } }, transMsg),
          ),
          trans && trans.file
            ? h('div', { style: { ...S.muted, marginTop: '4px', fontSize: '11px' } },
                '配置文件:' + trans.file)
            : null,
        ),
        h('div', { style: { ...S.box, marginTop: '10px' } },
          h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '界面选项'),
          h('div', { style: S.row },
            h('span', { style: label, title: '关闭后侧边栏面板隐藏,嵌字流程需在 DSH 手动请求' }, 'DSH 侧边栏'),

            h('button', {
              type: 'button',
              style: uiCfg && uiCfg.sidebarEnabled ? S.btnOn : S.btn,
              disabled: !uiCfg,
              onClick: () => toggleUi('sidebarEnabled'),
              title: '是否在 DSH 左侧边栏显示「漫画工作台」入口',
            }, uiCfg ? (uiCfg.sidebarEnabled ? '已显示(点击关闭)' : '已隐藏(点击开启)') : '读取中…'),
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '双端共享,桌面版的设置改的是同一项'),
          ),
                    h('div', { style: { ...S.muted, fontSize: '10px', color: '#ffb020', marginBottom: '6px' } },
            '⚠ 关闭侧边栏后漫画面板会隐藏;之后若要启动嵌字流程(确认嵌字),'
            + '需在 DSH 对话里手动请求启动,或重新打开侧边栏。'),
h('div', { style: S.row },
            h('span', { style: label }, '启动提示弹窗'),
            h('button', {
              type: 'button',
              style: uiCfg && uiCfg.bannerEnabled ? S.btnOn : S.btn,
              disabled: !uiCfg,
              onClick: () => toggleUi('bannerEnabled'),
              title: '输入框上方那条「漫画汉化工作流已就绪」的高亮提示',
            }, uiCfg ? (uiCfg.bannerEnabled ? '已开启(点击关闭)' : '已关闭(点击开启)') : '读取中…'),
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '双端共享,仅网页端显示'),
          ),
          h('div', { style: S.row },
            h('span', { style: label }, '记忆上次路径'),
            h('button', {
              type: 'button',
              style: uiCfg && uiCfg.rememberPathWeb ? S.btnOn : S.btn,
              disabled: !uiCfg,
              onClick: () => toggleUi('rememberPathWeb'),
              title: '网页端是否自动记住上次打开的漫画文件夹',
            }, uiCfg ? (uiCfg.rememberPathWeb ? '已开启(点击关闭)' : '已关闭(点击开启)') : '读取中…'),
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '仅网页端,与桌面端各自独立'),
          ),
          h('div', { style: S.row },
            h('span', { style: label }, '气泡内正文擦除'),
            h('button', {
              type: 'button',
              style: uiCfg && uiCfg.bubbleErase !== false ? S.btnOn : S.btn,
              disabled: !uiCfg,
              onClick: () => toggleUi('bubbleErase'),
              title: '白气泡内正文用气泡底色平涂原日文(推荐开启)',
            }, uiCfg ? (uiCfg.bubbleErase !== false ? '已开启(点击关闭)' : '已关闭(点击开启)') : '读取中…'),
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '默认开;关掉则正文只剩直盖/普通inpaint'),
          ),
          h('div', { style: S.row },
            h('span', { style: label }, '拟声词也擦除'),
            h('button', {
              type: 'button',
              style: uiCfg && uiCfg.sfxErase === true ? S.btnOn : S.btn,
              disabled: !uiCfg,
              onClick: () => toggleUi('sfxErase'),
              title: '拟声词先擦原字再写中文;复杂背景(网点/线条)会留下涂抹痕',
            }, uiCfg ? (uiCfg.sfxErase === true ? '已开启(点击关闭)' : '已关闭(点击开启)') : '读取中…'),
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '默认关;复杂背景建议保持关闭'),
          ),
          uiCfg && uiCfg.file
            ? h('div', { style: { ...S.muted, marginTop: '6px', fontSize: '11px' } }, `共享配置:${uiCfg.file}`)
            : null,
        ),
        h('div', { style: { ...S.box, marginTop: '10px' } },
          h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '嵌字工作区(嵌字报告 / 对话汇报)'),
          h('div', { style: { ...S.muted, fontSize: '11px', marginBottom: '6px' } },
            '项目库根目录:每本书的框/译文/原文/配置存到 projects/<书名>/,成品输出到 已完成/<书名>/;'
            + '源漫画文件夹只读。未设置时不允许开始工作。'),
          h('details', { style: { ...S.muted, fontSize: '11px', marginBottom: '6px' } },
            h('summary', { style: { cursor: 'pointer' } }, '📌 建议(点开查看)'),
            h('div', { style: { marginTop: '4px', lineHeight: 1.6 } },
              '在 DSH 里给漫画插件单独开一个工作区和一个会话,这里选你创建的那个工作区;'
              + '后续把「在对话里让 DSH 更正错误」也放在这个工作区的同一个会话里进行,报告与对话记录就能集中在一处。'),
          ),
          h('div', { style: { ...S.row, flexWrap: 'wrap' } },
            h('input', {
              style: { ...S.input, flex: '1 1 240px', minWidth: 0 },
              placeholder: '例如 E:\\manga-workspace',
              title: wsDir,
              value: wsDir,
              onChange: (e) => setWsDir(e.target.value),
              onBlur: () => saveUi({ workspaceDir: wsDir.trim() }),
            }),
            h('button', {
              type: 'button', style: S.btn,
              onClick: async () => {
                try {
                  const r = await api('/workspace/ensure', { dir: wsDir.trim() });
                  setWsExists(!!(r && r.ok));
                  setWsGuide((r && r.guide) || '');
                  setMsg(r && r.ok ? ('工作区可用:' + r.dir + (r.existed ? '(已存在)' : '(已创建)')) : ('失败:' + ((r && r.error) || '未知')));
                } catch (e) { setMsg('检查失败:' + String(e.message || e)); }
              },
            }, '检查 / 创建'),
          ),
          h('div', { style: { ...S.muted, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: wsDir },
            (wsExists ? '● 已就绪 · ' : '○ 未就绪 · ') + (wsDir || '(未设置)')),
          wsGuide ? h('div', { style: { ...S.muted, fontSize: '11px', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: wsGuide },
            '📄 已生成「DSH-接管说明.md」(新对话第一句让 DSH 先读它; 含「运行环境自检」: python manga_tool/selfcheck.py):' + wsGuide) : null,
        ),
        h(CachePanel, null),
        h('div', { style: { ...S.box, marginTop: '10px' } },
          h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'OCR 兜底(视觉引擎)'),
          h('div', { style: { ...S.muted, fontSize: '11px', marginBottom: '6px', whiteSpace: 'pre-wrap' } },
            '本地 OCR 识别为空 / 极短时,把框内图裁下来交给视觉引擎重读,写回 ocr_text.json(原文件留 .bak)。\n'
            + '不做 OCR 就不会触发;只有命中的那几个框才花钱。'),
          h('div', { style: S.row },
            h('span', { style: label }, '启用阈值'),
            OCR_MODES.map(([val, lab]) => h('button', {
              key: val,
              type: 'button',
              style: ocrCfg && ocrCfg.mode === val ? S.btnOn : S.btn,
              disabled: !ocrCfg,
              onClick: () => saveOcrCfg({ mode: val }),
            }, lab)),
          ),
          h('div', { style: S.row },
            h('span', { style: label }, '极短阈值'),
            h('input', {
              style: { ...S.input, flex: '0 0 60px', minWidth: 0 },
              value: ocrMin,
              onChange: (e) => setOcrMin(e.target.value),
              onBlur: () => saveOcrCfg({ minChars: Number(ocrMin) }),
            }),
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '有效字数 < 该值视为极短(标点/省略号不计)'),
          ),
          h('div', { style: S.row },
            h('span', { style: label }, '每本上限'),
            h('input', {
              style: { ...S.input, flex: '0 0 60px', minWidth: 0 },
              value: ocrMax,
              onChange: (e) => setOcrMax(e.target.value),
              onBlur: () => saveOcrCfg({ maxPerBook: Number(ocrMax) }),
            }),
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '框 —— 控制花费;每框约 ¥0.01~0.09(kimi-k3 官方价)'),
          ),
          h('div', { style: S.row },
            h('label', { style: { ...S.muted, fontSize: '11px' } },
              h('input', {
                type: 'checkbox', checked: ocrShortAuto, disabled: !ocrCfg,
                onChange: (e) => saveOcrCfg({ shortAuto: e.target.checked }),
              }), ' ≤'),
            h('input', {
              style: { ...S.input, flex: '0 0 52px', minWidth: 0 },
              value: ocrShortMax,
              onChange: (e) => setOcrShortMax(e.target.value),
              onBlur: () => saveOcrCfg({ shortMax: Number(ocrShortMax) }),
            }),
            h('span', { style: { ...S.muted, fontSize: '11px' } },
              '字的短句也自动兜底(默认开;短句常被 OCR 漏字,关掉可省钱)'),
          ),
          h('div', { style: { ...S.muted, fontSize: '10px', marginTop: '2px' } },
            '已兜底过的框会记录在书的 ocr_fallback_done.json,重复跑 OCR 不再重复花钱。'),
          ocrCfg && ocrCfg.file
            ? h('div', { style: { ...S.muted, marginTop: '4px', fontSize: '11px' } }, `配置:${ocrCfg.file}`)
            : null,
        ),
        h('div', { style: { ...S.box, marginTop: '10px' } },
          h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '运行环境'),
          !setup
            ? h('div', { style: S.muted }, '检测中…')
            : setup.error
              ? h('div', { style: { color: '#ff8080' } }, '检测失败:' + setup.error)
              : h(React.Fragment, null,
                  (function renderEnvDir() {
                    const env = setup.env || {};
                    const valid = !!env.valid;
                    return h(React.Fragment, null,
                      h('div', { style: S.row },
                        h('span', { style: { ...S.muted, width: '64px' } }, '安装位置'),
                        h('span', {
                          style: { fontSize: '11px', wordBreak: 'break-all',
                                   color: valid ? 'inherit' : '#ff8080' },
                        }, env.dir || '(未选择)'),
                        h('button', {
                          type: 'button', style: S.btn,
                          onClick: async () => {
                            try {
                              const p = await api('/pick', {});
                              if (p && p.path) {
                                await api('/setup/env', { dir: p.path });
                                await refreshSetup();
                                setSetupLog('安装位置已设为:' + p.path);
                              } else if (p && p.error) {
                                setSetupLog('未选择目录:' + p.error);
                              }
                            } catch (e) {
                              setSetupLog('选择目录失败:' + String(e.message || e));
                            }
                          },
                        }, '选择目录…'),
                        (env.suggestions || []).slice(0, 2).map((sug) => h('button', {
                          key: sug, type: 'button', style: S.btn,
                          onClick: async () => {
                            try {
                              await api('/setup/env', { dir: sug });
                              await refreshSetup();
                              setSetupLog('安装位置已设为:' + sug);
                            } catch (e) {
                              setSetupLog('设置失败:' + String(e.message || e));
                            }
                          },
                        }, '用 ' + sug)),
                      ),
                      h('div', {
                        style: { ...S.muted, fontSize: '10px', marginTop: '-2px',
                                 marginBottom: '4px', color: valid ? '#888' : '#ff8080' },
                      }, valid
                        ? '依赖会装到这里(禁止写 C 盘);已存在的环境请用「选择目录…」指定'
                        : (env.reason || '请先选择非 C 盘的安装位置')),
                    );
                  })(),
                  h('div', { style: S.row },
                    h('span', { style: { ...S.muted, width: '64px' } }, 'Python'),
                    h('span', { style: { fontSize: '11px', wordBreak: 'break-all' } },
                      (setup.python && setup.python.path) || '(未找到)'),
                    setup.python && setup.python.version
                      ? h('span', { style: { ...S.muted, fontSize: '11px' } },
                          `v${setup.python.version} · ${setup.python.source}`)
                      : h('span', { style: { color: '#ff8080', fontSize: '11px' } },
                          '未检测到 Python 3.9+ —— 请先安装 Python(安装时勾选 Add to PATH),或装好后点「重新检测」'),
                  ),
                  h('div', { style: S.row },
                    h('span', { style: { ...S.muted, width: '64px' } }, '工具链'),
                    h('span', { style: { fontSize: '11px' } }, setup.scripts.source),
                    h('span', { style: { ...S.muted, fontSize: '11px', wordBreak: 'break-all' } }, setup.scripts.dir),
                    setup.scripts.missing.length
                      ? h('span', { style: { color: '#ff8080', fontSize: '11px' } },
                          '缺少 ' + setup.scripts.missing.join('、'))
                      : h('span', { style: { color: '#4caf50', fontSize: '11px' } }, '齐全'),
                  ),
                  h('div', { style: { ...S.row, marginTop: '4px' } },
                    h('span', { style: { ...S.muted, width: '64px' } }, '依赖'),
                    (function () {
                      const tiers = [
                        ['base', '基础(标框/翻译/嵌字)'],
                        ['ocr', '本地 OCR'],
                        ['gpu', 'GPU 去字'],
                      ];
                      return tiers.map(([t, name]) => {
                        const list = (setup.deps || []).filter((d) => d.tier === t);
                        const ok = list.filter((d) => d.ok).length;
                        const all = list.length;
                        return h('span', {
                          key: t,
                          title: list.map((d) => (d.ok ? '✅ ' : '❌ ') + d.label).join('\n'),
                          style: { fontSize: '11px', padding: '1px 6px', borderRadius: '10px',
                                   border: '1px solid rgba(128,128,128,0.35)',
                                   color: ok === all ? '#4caf50' : '#ffb020' },
                        }, `${name} ${ok}/${all}`);
                      });
                    })(),
                  ),
                  h('div', { style: { ...S.row, marginTop: '6px' } },
                    h('button', { type: 'button', style: S.btn, onClick: refreshSetup }, '重新检测'),
                    (function () {
                      const ok = !!(setup.env && setup.env.valid);
                      const hint = ok ? undefined : '请先在「安装位置」选择非 C 盘目录';
                      return h(React.Fragment, null,
                        h('button', {
                          type: 'button', style: S.btn, disabled: !!setupBusy || !ok, title: hint,
                          onClick: () => installDeps('base'),
                        }, setupBusy === 'base' ? '安装中…' : '装基础依赖'),
                        h('button', {
                          type: 'button', style: S.btn, disabled: !!setupBusy || !ok, title: hint,
                          onClick: () => installDeps('ocr'),
                        }, setupBusy === 'ocr' ? '安装中…' : '装 OCR 依赖(含 torch,大)'),
                        h('button', {
                          type: 'button', style: S.btn, disabled: !!setupBusy || !ok, title: hint,
                          onClick: () => installDeps('gpu'),
                        }, setupBusy === 'gpu' ? '安装中…' : '装 GPU 去字(可选)'),
                      );
                    })(),
                  ),
                  h('div', { style: { ...S.muted, fontSize: '10px', marginTop: '2px' } },
                    '首次使用:先选「安装位置」(禁止 C 盘)→ 点「装基础依赖」;要本地 OCR 再装 OCR 依赖(约 2GB)。'
                    + ' 依赖全部装到你选的位置,不影响系统 Python 和 C 盘。'),
                  setupLog
                    ? h('pre', {
                        style: { marginTop: '6px', maxHeight: '180px', overflow: 'auto',
                                 fontSize: '10px', lineHeight: '1.35', background: 'rgba(0,0,0,0.25)',
                                 padding: '6px', borderRadius: '6px', whiteSpace: 'pre-wrap' },
                      }, setupLog)
                    : null,
                ),
        ),
        (function renderCost() {
          const pi = Number(priceIn) || 0;
          const po = Number(priceOut) || 0;
          const inTok = cost ? cost.tokens.input : 0;
          const outTok = cost ? cost.tokens.output : 0;
          const perPage = (inTok * pi + outTok * po) / 1e6;
          const pages = cost && cost.pageCount > 0 ? cost.pageCount : 1;
          const total = perPage * pages;
          const money = (x) => (x > 0 ? '¥' + x.toFixed(4) : '¥0');
          const secPerPage = cost ? cost.embed.secondsPerPage : 0.4;
          const preset = cost && cost.model ? PRICE_PRESETS[cost.model] : null;
          return h('div', { style: { ...S.box, marginTop: '10px' } },
            h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '成本预估'),
            cost
              ? h(React.Fragment, null,
                  h('div', { style: { ...S.row, marginBottom: '2px' } },
                    h('span', { style: label }, '识图模型'),
                    h('span', null, cost.model || '(未配置)'),
                    h('span', { style: { ...S.muted, fontSize: '11px' } }, '外接视觉引擎,按 token 计费'),
                  ),
                  h('div', { style: { ...S.muted, fontSize: '11px', marginBottom: '4px' } },
                    cost.pageCount > 0
                      ? `本子 ${cost.pageCount} 页 · 采样 ${cost.image.sampled} 页 · 代表尺寸 ${cost.image.width}×${cost.image.height}(长边限 ${cost.image.longSide})`
                      : `未读取本子,按 1 页 / 1280×1830 估算(长边限 ${cost.image.longSide})`),
                  h('div', { style: { ...S.muted, fontSize: '11px', marginBottom: '6px' } },
                    `识图每页 ≈ ${inTok} 输入 tokens(最大 ${cost.tokens.inputMax}) + ${outTok} 输出 tokens`),
                  h('div', { style: S.row },
                    h('span', { style: label }, '单价'),
                    h('span', { style: { ...S.muted, fontSize: '11px' } }, '输入'),
                    h('input', {
                      style: { ...S.input, flex: '0 0 90px', minWidth: 0 },
                      value: priceIn, placeholder: '元/百万',
                      onChange: (e) => savePrice('in', e.target.value),
                    }),
                    h('span', { style: { ...S.muted, fontSize: '11px' } }, '输出'),
                    h('input', {
                      style: { ...S.input, flex: '0 0 90px', minWidth: 0 },
                      value: priceOut, placeholder: '元/百万',
                      onChange: (e) => savePrice('out', e.target.value),
                    }),
                    h('span', { style: { ...S.muted, fontSize: '11px' } }, '留空=免费;请按厂商官网填写'),
                  ),
                  preset
                    ? h('div', { style: { ...S.row, marginTop: '2px' } },
                        h('span', { style: label }, '官方价'),
                        h('button', {
                          type: 'button',
                          style: S.btn,
                          onClick: () => { savePrice('in', String(preset.in)); savePrice('out', String(preset.out)); },
                        }, `填入官方参考价(${preset.in} / ${preset.out})`),
                        h('span', { style: { ...S.muted, fontSize: '11px' } },
                          (preset.note ? preset.note + ';' : '') + '以 platform.kimi.com/docs/pricing/chat 为准'),
                      )
                    : null,
                  h('div', { style: { ...S.row, marginTop: '4px' } },
                    h('span', { style: label }, '识图成本'),
                    h('span', { style: { fontWeight: 600 } }, `${money(perPage)} / 页`),
                    h('span', { style: S.muted }, `整本 ${pages} 页 ≈ ${money(total)}`),
                  ),
                  h('div', { style: S.row },
                    h('span', { style: label }, '嵌字成本'),
                    h('span', { style: { fontWeight: 600 } }, '¥0 / 页'),
                    h('span', { style: S.muted },
                      `本地 GPU · 约 ${secPerPage} 秒/页 · 整本 ≈ ${(secPerPage * pages).toFixed(1)} 秒(不花钱)`),
                  ),
                  h('div', { style: { ...S.muted, fontSize: '10px', marginTop: '6px' } },
                    'token 为按 28px patch 的估算值,实际以各厂商计费口径为准;' +
                    '识图只在你让 AI 看图时才发生,不做图就不产生费用。'),
                )
              : h('div', { style: S.muted }, '读取中…'),
          );
        })(),
        h('div', { style: { ...S.muted, fontSize: '11px', lineHeight: '1.7', whiteSpace: 'pre-wrap' } },
          '说明(当前版本 ' + APP_VERSION + ')\n' +
          '· 写入 modlens 的配置:~/.modlens/config.json 的 providers.openai。\n' +
          '· 桌面版的「设置」改的是同一个文件,改完两端都生效。\n' +
          '· 换了厂商要记得连 API Key 一起换,否则识图会鉴权失败。\n' +
          '· 「测试连接」只验证 API 通不通;「测试识图」会真发一张图,验证模型会不会看图。\n' +
          '· 保存后如果当前对话里的识图工具还在用旧配置,重开一次对话即可。\n' +
          '· API Key 只存在本机文件里,不会上传。'),
        h('div', { style: { textAlign: 'center', marginTop: '24px', fontSize: '10px', color: '#888' } },
          '· ' + APP_VERSION + ' · 本软件完全由 AI(DeepSeek Harness Agent)生成与编写。作者:YiDaWuYi',
        ),
      );
    }

    /* ---------------- 工作台 ---------------- */

    /* ---------- 首次使用:必须先读完帮助(拉到最底部) ---------- */
    const HELP_ACK_KEY = 'manga-help-ack-v1';

    function HelpGate({ children }) {
      const [ack, setAck] = React.useState(() => {
        try { return localStorage.getItem(HELP_ACK_KEY) === '1'; } catch (e) { return false; }
      });
      const [ready, setReady] = React.useState(false);
      const scrollRef = React.useRef(null);
      React.useEffect(() => {
        if (ack) return undefined;
        const timer = setInterval(() => {
          const root = scrollRef.current;
          if (!root) return;
          const nodes = [root, ...root.querySelectorAll('*')];
          let ok = false;
          for (const n of nodes) {
            if (n.scrollHeight > n.clientHeight + 40 && n.clientHeight > 120) {
              if (n.scrollTop + n.clientHeight >= n.scrollHeight - 10) { ok = true; break; }
            }
          }
          setReady(ok);
        }, 400);
        return () => clearInterval(timer);
      }, [ack]);

      if (ack) return children;
      return h(React.Fragment, null,
        h('div', { style: { filter: 'grayscale(0.5) opacity(0.3)', pointerEvents: 'none' } }, children),
        h('div', {
          style: {
            position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.78)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          },
        },
          h('div', {
            style: {
              width: 'min(980px, 94vw)', height: '92vh', background: '#1b1b1b', color: '#eee',
              borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
              boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
            },
          },
            h('div', {
              style: { padding: '10px 16px', fontWeight: 600, fontSize: '14px',
                borderBottom: '1px solid rgba(255,255,255,0.12)', color: '#ffb26b' },
            }, '👋 第一次使用:请把下面的帮助拉到最底部,才能开始使用'),
            h('div', { ref: scrollRef, style: { flex: 1, overflow: 'auto', padding: '4px 14px 10px' } },
              h(HelpView, { onBack: () => {} }),
            ),
            h('div', {
              style: { padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.12)',
                display: 'flex', alignItems: 'center', gap: '12px' },
            },
              h('span', { style: { fontSize: '12px', color: ready ? '#7fd88a' : '#aaa' } },
                ready ? '✅ 已读到最底部,可以开始使用' : '⬇ 请继续向下滚动到最底部…'),
              h('span', { style: { flex: 1 } }),
              h('button', {
                type: 'button',
                disabled: !ready,
                style: { ...S.btn, opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'not-allowed' },
                onClick: () => {
                  try { localStorage.setItem(HELP_ACK_KEY, '1'); } catch (e) { /* ignore */ }
                  setAck(true);
                },
              }, '我已读完,开始使用'),
            ),
          ),
        ),
      );
    }

    function Workbench() {
      const [view, setView] = React.useState(() => {
        try {
          const v = localStorage.getItem('manga-desk-view');
          return ['home', 'work', 'help', 'settings'].includes(v) ? v : 'home';
        } catch (e) { return 'home'; }
      });   // home | work | help | settings
      const [folder, setFolder] = React.useState(() => {
        try { return localStorage.getItem('manga-desk-folder') || ''; } catch { return ''; }
      });
      const [infra, setInfra] = React.useState(null);
      const [vision, setVision] = React.useState(null);
      const [proj, setProj] = React.useState(null);   // 项目库:项目名/数据目录/成品目录

      const [info, setInfo] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [wsExists, setWsExists] = React.useState(true);
      const [verInfo, setVerInfo] = React.useState(null);
      const [confirmDlg, setConfirmDlg] = React.useState(null);
      const [previewPg, setPreviewPg] = React.useState('');
      const [pfAuto, setPfAuto] = React.useState(false);   // 体检时让有译文的 auto 框参与
      const [embedScope, setEmbedScope] = React.useState('page');  // 确认嵌字范围:page=此页 / book=整本
      const [activeJobId, setActiveJobId] = React.useState('');   // 当前任务(用于取消)
      const [estInfo, setEstInfo] = React.useState(null);          // DSH 接管预估(常驻显示)
      const [log, setLog] = React.useState('');
      const [jumpNo, setJumpNo] = React.useState('');
      const jumpPage = () => {
        const pages = (info && info.pages) || [];
        const n = parseInt(String(jumpNo).trim(), 10);
        if (!pages.length) return;
        if (!Number.isFinite(n)) { setMsg('请输入页码(1~' + pages.length + ')'); return; }
        const k = Math.max(1, Math.min(pages.length, n));
        loadPage(pages[k - 1].page);
        setJumpNo('');
      };
      const [page, setPage] = React.useState(() => {
        try { return localStorage.getItem('manga-desk-page') || ''; } catch (e) { return ''; }
      });
      const [pageData, setPageData] = React.useState(null);
      const [reloadTick, setReloadTick] = React.useState(0);   // 「刷新」按钮:同时重载图片
      // 切换会话/重载时保留界面(view + 当前页)
      React.useEffect(() => {
        try { localStorage.setItem('manga-desk-view', view); } catch (e) { /* ignore */ }
      }, [view]);
      React.useEffect(() => {
        try { if (page) localStorage.setItem('manga-desk-page', page); } catch (e) { /* ignore */ }
      }, [page]);
      const [boxes, setBoxes] = React.useState([]);
      // 项目库:选中书后询问 host 该项目的数据目录(没设置工作区会返回错误)
      React.useEffect(() => {
        if (!folder) { setProj(null); return undefined; }
        let alive = true;
        (async () => {
          try {
            const p = await api('/project?folder=' + encodeURIComponent(folder));
            if (alive) setProj(p);
          } catch (e) {
            // 后台还是旧版本(没有 /project 接口)时不要拦住用户,退回旧行为
            if (alive) setProj({ ok: false, code: 'NETWORK', error: String((e && e.message) || e) });
          }
        })();
        return () => { alive = false; };
      }, [folder]);
      const [msg, setMsg] = React.useState('');
      // 样式自动识别(跟随原文样式):项目级开关,读/写项目 config.json 的 follow_style
      const [followStyle, setFollowStyle] = React.useState(true);
      const [forceTrans, setForceTrans] = React.useState(false);   // 强制重译(覆盖现有译文)
      React.useEffect(() => {
        if (!folder) return undefined;
        let alive = true;
        (async () => {
          try {
            const r = await api('/project-config?folder=' + encodeURIComponent(folder));
            if (alive && r && typeof r.follow_style === 'boolean') setFollowStyle(r.follow_style);
          } catch (e) { /* 旧后台无此接口时保持默认开 */ }
        })();
        return () => { alive = false; };
      }, [folder]);
      const toggleFollowStyle = async (v) => {
        setFollowStyle(v);
        try {
          await api('/project-config?folder=' + encodeURIComponent(folder), { follow_style: v });
          setMsg(v ? '已开启:嵌字时跟随原文样式(字色/描边/空心/字距)' : '已关闭:使用样式库里选的样式');
        } catch (e) {
          setMsg('保存失败:' + String((e && e.message) || e));
        }
      };
      const showFailures = async () => {
        if (!folder) { setMsg('先选一本书'); return; }
        const _fsp = (embedScope === 'page') ? (page || '') : '';
        setMsg('⏳ 正在汇总失败报告…(' + (_fsp ? '此页 ' + _fsp : '整本') + ')');
        try {
          const r = await api('/failure-report?folder=' + encodeURIComponent(folder)
            + (_fsp ? ('&page=' + encodeURIComponent(_fsp)) : ''));
          if (!r || !r.ok) { setMsg('⚠ ' + ((r && r.error) || '还没有失败报告')); return; }
          // (服务端 ok:false 会由 api() 抛错,这里只处理正常返回)
          const rep = r.report || {};
          const c = rep.failure_counts || {};
          const n = rep.failures_total || 0;
          const _scope = _fsp ? ('此页(' + _fsp + ')') : '整本';
          const cc = rep.class_counts || {};
          const _cls = (cc.untranslated || cc.noise || cc.decorative || cc.suspect)
            ? (';细分:未翻译 ' + (cc.untranslated || 0) + ' / 噪音(建议排除) ' + (cc.noise || 0)
               + ' / 装饰字 ' + (cc.decorative || 0) + ' / 疑似误判 ' + (cc.suspect || 0))
            : '';
          setMsg(n
            ? ('⚠ ' + _scope + ' 失败 ' + n + ' 框(OCR空 ' + (c.ocr_empty || 0) + ' / 兜底失败 ' + (c.fallback_failed || 0)
               + ' / 疑似错 ' + (c.ocr_suspect || 0) + ' / 缺译文 ' + (c.trans_missing || 0) + ')' + _cls
               + (_fsp ? ' → 要让 DSH 读整本报告请把范围切「整本」' : ' → 已写 ocr_failure_report.json,可让 DSH 读'))
            : ('✅ ' + _scope + ' 没有失败框'));
        } catch (e) {
          const _es = String((e && e.message) || e);
          setMsg(_es.indexOf('还没有') >= 0 || _es.indexOf('先跑一次') >= 0
            ? ('ℹ ' + _es)
            : ('⚠ 读取失败报告出错:' + _es));
        }
      };
      const textEdits = React.useRef(new Map());
      // 自动保存
      const dirtyRef = React.useRef(false);        // 有未保存修改
      const savingRef = React.useRef(false);       // 正在保存
      const [editTick, setEditTick] = React.useState(0);
      const [autoSavedAt, setAutoSavedAt] = React.useState('');
      const markDirty = () => { dirtyRef.current = true; setEditTick((t) => t + 1); };

      // 与桌面版一致的操作状态
      const [mode, setMode] = React.useState('box');
      const [kind, setKind] = React.useState('body');
      const [cover, setCover] = React.useState('cover');
      const [gpu, setGpu] = React.useState(false);
      // 每种类型各自记住「原文处理/GPU」(仅本次页面会话内)
      const KIND_DEFAULT_COVER = { body: 'cover', plain: 'overlay', title: 'cover' };
      const kindMemRef = React.useRef({
        body: { cover: 'cover', gpu: false },
        plain: { cover: 'overlay', gpu: false },
        title: { cover: 'cover', gpu: false },
      });
      const pickKind = (k) => {
        const m = kindMemRef.current[k] || {};
        setKind(k);
        // 拟声词:默认直盖,不记忆/不恢复覆盖方式
        setCover(k === 'plain' ? 'overlay' : (m.cover || KIND_DEFAULT_COVER[k] || 'cover'));
        setGpu(!!m.gpu);
      };
      const pickCover = (c) => {
        if (kind === 'plain' && c === 'cover') return;   // 拟声词色块覆盖不可选
        setCover(c);
        if (kind !== 'plain') {
          kindMemRef.current[kind] = { ...(kindMemRef.current[kind] || {}), cover: c, gpu };
        }
      };
      const pickGpu = (v) => {
        setGpu(v);
        kindMemRef.current[kind] = { ...(kindMemRef.current[kind] || {}), cover, gpu: v };
      };
      const [dirMode, setDirMode] = React.useState('auto');
      const [alignMode, setAlignMode] = React.useState('auto');   // 标题对齐:auto/left/center/right
      const [alignTouched, setAlignTouched] = React.useState(false);
      const [size, setSize] = React.useState('20');
      const [autoSize, setAutoSize] = React.useState(true);
      const [bodyStyle, setBodyStyle] = React.useState('body_classic');
      const [sfxStyle, setSfxStyle] = React.useState('sfx_classic');
      const [titleStyle, setTitleStyle] = React.useState('title_bold');
      const [fontByKind, setFontByKind] = React.useState({ body: '', sfx: '', title: '' });
      const [styleOpen, setStyleOpen] = React.useState(false);   // 文字样式栏默认收起
      const [stylePresets, setStylePresets] = React.useState(null);

      // 文字样式预设
      React.useEffect(() => {
        api('/styles').then((d) => {
          const ps = (d && d.presets) || [];
          setStylePresets(ps);
          const body = ps.filter((p) => p.kind === 'body');
          const sfxList = ps.filter((p) => p.kind === 'sfx');
          const title = ps.filter((p) => p.kind === 'title');
          if (body.length && !body.some((p) => p.id === bodyStyle)) setBodyStyle(body[0].id);
          if (sfxList.length && !sfxList.some((p) => p.id === sfxStyle)) setSfxStyle(sfxList[0].id);
          if (title.length && !title.some((p) => p.id === titleStyle)) setTitleStyle(title[0].id);
        }).catch(() => setStylePresets([]));
      }, []);

      // 启动页:引擎检测 + 视觉引擎状态
      React.useEffect(() => {
        api('/infra').then(setInfra).catch(() => setInfra(null));
        api('/workspace/status').then((w) => { setWsExists(!!(w && w.exists)); setWsGuide((w && w.guide) || ''); }).catch(() => setWsExists(true));
        api('/version-check').then(setVerInfo).catch(() => setVerInfo({ ok: false }));
        api('/settings')
          .then((d) => setVision({ model: d.model, apiBase: d.apiBase, apiKeySet: !!d.apiKeySet }))
          .catch(() => setVision(null));
        // 网页端「记忆上次路径」开关(与桌面端各自独立)
        api('/settings/ui')
          .then((d) => {
            const on = !(d && d.rememberPathWeb === false);
            shell.rememberPathWeb = on;
            if (!on) {
              try { localStorage.removeItem('manga-desk-folder'); } catch {}
              setFolder('');
            }
          })
          .catch(() => {});
      }, []);

      async function browseFolder() {
        setMsg('请在弹出的系统窗口里选择文件夹…');
        try {
          const r = await api('/pick');
          if (r && r.ok && r.path) {
            setFolder(r.path);
            setMsg('');
          } else {
            setMsg((r && r.error) || '未选择文件夹');
          }
        } catch (e) {
          setMsg('打开选择器失败:' + String(e.message || e));
        }
      }

      async function launchDesktop() {
        try {
          const r = await api('/launch', { folder });
          setMsg(r && r.ok ? '已启动桌面版标框工具(新窗口)' : ('启动失败:' + ((r && r.error) || '未知')));
        } catch (e) {
          setMsg('启动失败:' + String(e.message || e));
        }
      }

      // 「⟳ 刷新本页」:只重读当前页的框/译文/图片,不重载整个面板
      async function reloadPage() {
        if (!folder) { setMsg('刷新本页:还没选书'); return; }
        if (!page) { setMsg('刷新本页:还没选中页(先在下面点一张页或翻页)'); return; }
        try {
          const pg = await api(`/regions?folder=${encodeURIComponent(folder)}&page=${encodeURIComponent(page)}`);
          setPageData({ ...pg, page });
          textEdits.current.clear();
          dirtyRef.current = false;
          setReloadTick((n) => n + 1);   // 让图片也重新加载
          setMsg('已刷新本页:' + page + ' · 框 ' + ((pg.boxes || []).length) + ' 个');
          setLog('[刷新本页] ' + page + ' 框=' + ((pg.boxes || []).length) + ' 译=' + ((pg.trans || []).length));
        } catch (e) {
          setMsg('刷新失败:' + String(e.message || e));
        }
      }

      // fromUser=true 表示用户主动点「开始」/回车;自动恢复时不要弹提示、不要跳设置页
      async function refresh(fromUser) {
        if (!folder) return;
        setLoading(true);
        try {
          // 强制先设置「嵌字工作区」:没有工作区就不让开始(项目数据要存到工作区里)
          let pj = null;
          try {
            pj = await api('/project?folder=' + encodeURIComponent(folder));
          } catch (e) {
            pj = { ok: false, code: 'NETWORK', error: String((e && e.message) || e) };
          }
          setProj(pj);
          // 只有后台明确回报「没有工作区」才拦截;接口不存在(旧后台)/网络错误 → 放行
          const needWs = !!(pj && pj.ok === false && pj.code === 'PROJECT_NO_WORKSPACE');
          if (needWs) {
            if (fromUser) {
              setMsg('请先在「设置」里指定嵌字工作区,再开始处理这本书');
              setView('settings');
            } else if (view === 'work') {
              setView('home');
            }
            return;
          }
          const d = await api(`/status?folder=${encodeURIComponent(folder)}`);
          // 关键:先拿到第一页数据再切视图,避免工作台先空一帧(图片区塌陷导致跳动)
          const first = page && d.pages.some((x) => x.page === page) ? page : (d.pages[0] && d.pages[0].page);
          let pg = null;
          if (first) {
            pg = await api(`/regions?folder=${encodeURIComponent(folder)}&page=${encodeURIComponent(first)}`);
          }
          setInfo(d);
          if (first && pg) {
            setPage(first);
            setPageData({ ...pg, page: first });
          }
          setView('work');
          if (shell.rememberPathWeb) { try { localStorage.setItem('manga-desk-folder', folder); } catch {} }
        } catch (e) {
          setMsg(String(e.message || e));
          setInfo(null);
        } finally {
          setLoading(false);
          setReloadTick((n) => n + 1);   // 让本页图片也强制重载(外部重嵌后能看到新图)
        }
      }

      // 恢复上次界面:回到 work 视图且记住页时,自动加载该页(只做一次)
      // 桌面端点了「确认嵌字」:轮询请求 → 切到该书并自动进入确认嵌字
      const embedReqRef = React.useRef(false);
      React.useEffect(() => {
        let stop = false;
        const tick = async () => {
          if (stop || embedReqRef.current) return;
          try {
            const r = await api('/embed-request');
            if (r && r.pending && r.folder) {
              embedReqRef.current = true;
              setFolder(r.folder);
              try { localStorage.setItem('manga-desk-folder', r.folder); } catch (e) { /* ignore */ }
              setView('work');
              await refresh();
            }
          } catch (e) { /* 忽略 */ }
        };
        const t = setInterval(tick, 4000);
        tick();
        return () => { stop = true; clearInterval(t); };
      }, []);
      // 自动进入确认嵌字(等页面数据加载完成)
      const autoConfirmRef = React.useRef(false);
      React.useEffect(() => {
        if (!embedReqRef.current || autoConfirmRef.current) return;
        if (!pageData || loading) return;
        autoConfirmRef.current = true;
        setTimeout(() => { try { confirmEmbed(); } catch (e) { console.warn(e); } }, 300);
      }, [pageData, loading]);

      // 恢复成工作台视图但还没数据时,主动加载一次(修复「只剩顶部按钮」)
      React.useEffect(() => {
        try {
          if (view !== 'work') return;
          if (!folder) { setView('home'); return; }
          if (!info && !loading) refresh();
        } catch (e) { console.warn('[manga-workflow] 恢复工作台失败:', e); }
      }, [view, folder]);

      const restoredRef = React.useRef(false);
      React.useEffect(() => {
        try {
          if (restoredRef.current || !info || !folder) return;
          if (view !== 'work') return;
          restoredRef.current = true;
          const pages = (info && info.pages) || [];
          if (!pageData && page && pages.some((r) => r && r.page === page)) {
            const t = setTimeout(() => { try { loadPage(page); } catch (e) { /* ignore */ } }, 60);
            return () => clearTimeout(t);
          }
        } catch (e) {
          console.warn('[manga-workflow] 恢复界面失败:', e);
        }
      }, [info, folder, view]);

      async function loadPage(p) {
        if (dirtyRef.current) { try { await savePage({ auto: true }); } catch (e) { /* ignore */ } }
        setPage(p);
        try {
          const d = await api(`/regions?folder=${encodeURIComponent(folder)}&page=${encodeURIComponent(p)}`);
          setPageData({ ...d, page: p });
        } catch (e) {
          setMsg(String(e.message || e));
        }
      }

      // 噪音框判定(与 python boxtools.is_noise_box 一致):页码/水印/UI/小碎框 → 不翻译、不嵌字
      const isNoiseBox = (b, txt) => {
        const t = String(txt || '').trim();
        if (!t) return false;
        const w = Number(b && b.w) || 0, h = Number(b && b.h) || 0;
        if (w < 40 || h < 25) return true;
        if (/^[0-9０-９\s\W_]+$/.test(t)) return true;
        if (/^[A-Za-zＡ-Ｚａ-ｚ0-9０-９\s\W_]+$/.test(t)) return true;
        return false;
      };

      async function autoParticipateAll() {
        if (!folder || loading) return;
        setLoading(true);
        setMsg('全书 auto 框参与中…');
        try {
          const d = await api('/status?folder=' + encodeURIComponent(folder));
          let n = 0;
          for (const p of (d.pages || [])) {
            if (!p.boxes) continue;
            const r = await api('/regions?folder=' + encodeURIComponent(folder)
              + '&page=' + encodeURIComponent(p.page));
            const boxes = r.boxes || [];
            const tr = r.trans || [];
            const ot = r.texts || [];
            const nb = boxes.map((b, i) => {
              if (!(b.auto && tr[i] && String(tr[i]).trim())) return b;
              if (isNoiseBox(b, ot[i])) return b;      // 页码/UI 噪音不参与
              return { ...b, auto: false };
            });
            const changed = nb.filter((b, i) => b.auto !== boxes[i].auto).length;
            if (changed) {
              await api('/save', { folder, page: p.page, boxes: nb, edits: [] });
              n += changed;
            }
          }
          await refresh();
          if (page) await loadPage(page);
          setMsg('已让 ' + n + ' 个有译文的 auto 框参与嵌字');
        } catch (e) {
          setMsg('操作失败:' + String(e.message || e));
        } finally {
          setLoading(false);
        }
      }

      async function applyStyleAll() {
        setMsg('正在应用到全部…');
        try {
          const d = await api('/status?folder=' + encodeURIComponent(folder));
          const pages = (d.pages || []).filter((p) => p.boxes);
          let n = 0;
          for (const p of pages) {
            const r = await api('/regions?folder=' + encodeURIComponent(folder)
              + '&page=' + encodeURIComponent(p.page));
            const boxes = (r.boxes || []).map((b) => {
              const k = kindOfBox(b);
              const nb = { ...b, style: k === 'title' ? titleStyle : (k === 'plain' ? sfxStyle : bodyStyle) };
              if (fontByKind[k]) nb.font = fontByKind[k]; else delete nb.font;
              return nb;
            });
            await api('/save', { folder, page: p.page, boxes, edits: [] });
            n += boxes.length;
          }
          if (page) await loadPage(page);
          setMsg(`已把样式应用到全部 ${pages.length} 页 / ${n} 个框 ✅`);
        } catch (e) {
          setMsg('应用到全部失败:' + String(e.message || e));
        }
      }

      async function runJob(step, opts) {
        const _body = { folder, step };
        if (opts && opts.page) _body.page = opts.page;
        if (step === 'translate' && forceTrans) _body.overwrite = true;
        const _names = { detect: '自动标框', ocr: 'OCR', translate: '翻译', proofread: '校对', embed: '嵌字', bench: '检测' };
        const _label = _names[step] || step;
        const { jobId } = await api('/run', _body);
        setActiveJobId(jobId);
        let lastLog = '';
        const _t0 = Date.now();
        setMsg('⏳ ' + _label + ' 已启动…' + (_body.page ? '(此页)' : '(整本)'));
        for (;;) {
          if (Date.now() - _t0 > 30 * 60 * 1000) {
            setMsg('⚠ ' + _label + ' 超时(>30 分钟),已停止等待;请点「⟳ 刷新本页」查看结果,或重试');
            setActiveJobId(null);
            return { code: -1, status: 'timeout', log: lastLog };
          }
          await new Promise((r) => setTimeout(r, 1200));
          const j = await api(`/job?id=${encodeURIComponent(jobId)}`);
          if (j.log && j.log !== lastLog) {
            lastLog = j.log;
            setLog(j.log);
            const _lines = String(j.log).split('\n').map((x) => x.trim()).filter(Boolean);
            const _last = _lines.length ? _lines[_lines.length - 1] : '';
            if (_last) setMsg('⏳ ' + _label + ' 运行中 · ' + _last.slice(-60));
          }
          if (j.status !== 'running') {
            setLog(`[${step}] exit=${j.code}\n${j.log || ''}`);
            const _needReload = ['detect', 'ocr', 'translate', 'proofread', 'embed'].indexOf(step) >= 0;
            setMsg((j.code === 0 ? '✅ ' : '⚠ ') + _label + (j.status === 'cancelled' ? ' 已取消' : ' 结束') + '(exit=' + j.code + ')'
              + (_needReload ? ' · 若画面没有变化,请点「⟳ 刷新本页」' : ''));
            if (_needReload) {
              setLog(String(j.log || '') + '\n[提示] 进程已结束。若画布/图片没有变化,点上方「⟳ 刷新本页」重新加载本页(框、译文、图片)。');
            }
            return j;
          }
        }
      }

      // 自愈:若 loading 卡住但没有活动任务,自动复位(否则按钮永久变灰 → 表现为“点了没反应”)
      React.useEffect(() => {
        if (!loading || activeJobId) return;
        const t = setTimeout(() => {
          try { setLoading(false); setMsg('⚠ 刚才的任务可能异常结束,已自动复位;若画面没变化请点「⟳ 刷新本页」'); } catch (e) { /* ignore */ }
        }, 6000);
        return () => clearTimeout(t);
      }, [loading, activeJobId]);

      async function run(step) {
        if (!folder) { setMsg('⚠ 请先选择/打开一本漫画,再点「' + (step || '') + '」'); return; }
        if (loading) { setMsg('⚠ 已有任务在运行,请等它结束或点「取消当前任务」'); return; }
        if (embedScope === 'page' && page && pageData && !(pageData.boxes || []).length
            && ['ocr', 'translate', 'proofread', 'embed'].indexOf(step) >= 0) {
          setMsg('⚠ 本页还没有标框(' + page + '),先点「自动标框」再执行 ' + step);
          return;
        }
        const _sp = (embedScope === 'page') ? (page || '') : '';
        // 已经全部有译文时直接提示,不发任务(否则点了像“没反应”)
        if (step === 'translate' && !forceTrans) {
          try {
            if (_sp && pageData) {
              const _T = pageData.trans || [];
              const _miss = (pageData.boxes || []).filter((b, i) => !String(_T[i] || '').trim()).length;
              if (!_miss) { setMsg('✅ 本页所有框都已有译文,无需再翻译(想重译请先清空译文或勾选覆盖)'); return; }
            } else if (info) {
              const _b = Number(info.boxes) || 0, _t = Number(info.translated) || 0;
              if (_b && _t >= _b) { setMsg('✅ 全书所有框都已有译文,无需再翻译'); return; }
            }
          } catch (e) { /* ignore */ }
        }
        setLoading(true);
        setLog(`正在执行 ${step}…` + (_sp ? `(此页 ${_sp})` : '(整本)'));
        try {
          const j = await runJob(step, { page: _sp });
          await refresh();
          if (step === 'detect') {
            const _m = String((j && j.log) || '').match(/\{[^{}]*"pages"[^{}]*\}/);
            if (_m) { try { const _o = JSON.parse(_m[0]); setMsg((_o.boxes ? '✅ ' : '⚠ ') + '自动标框完成:' + _o.pages + ' 页 / ' + _o.boxes + ' 框' + (_o.dropped ? '(排除 ' + _o.dropped + ')' : '') + (_o.boxes ? '' : ' — 本页可能已无文字或全是纯画面;换一页再试')); } catch (e2) { /* ignore */ } }
            setLog('[自动标框] 当前页=' + (page || '(空)') + ' · ' + String((j && j.log) || '').split('\n').filter(Boolean).slice(-1)[0]);
            if (page) {
              await loadPage(page);          // 始终留在当前页,不要跳走
            } else {
              const _st = await api('/status?folder=' + encodeURIComponent(folder));
              const _first = ((_st && _st.pages) || []).find((x) => (x.boxes || 0) > 0);
              if (_first) await loadPage(_first.page);
            }
          } else if (page) {
            await loadPage(page);
          }
        } catch (e) {
          setLog(String(e.message || e));
        } finally {
          setActiveJobId(null);
          setLoading(false);
        }
      }

      async function costEstimate(scope, pageOnly) {
        try {
          return await api('/cost-estimate', {
            folder, page: pageOnly ? page : null, scope,
          });
        } catch (e) { return null; }
      }
      const money = (e) => (e && Number.isFinite(e.yuanMin)
        ? ('¥' + e.yuanMin.toFixed(2) + ' ~ ¥' + e.yuanMax.toFixed(2))
        : '未知');

      async function runDshJob(pathUrl, body, label) {
        if (!folder || loading) return;
        setLoading(true);
        try {
          const { jobId } = await api(pathUrl, body);
          setActiveJobId(jobId);
          let lastLog = '';
          for (;;) {
            await new Promise((r) => setTimeout(r, 1200));
            const j = await api(`/job?id=${encodeURIComponent(jobId)}`);
            if (j.log && j.log !== lastLog) { lastLog = j.log; setLog(j.log); }
            if (j.progress) {
              setMsg(`${label}:${j.progress.pct}% · ${j.progress.label}`);
            }
            if (j.status !== 'running') {
              setLog(`[${label}] exit=${j.code}\n${j.log || ''}`);
              setMsg(`${label}:${j.code === 0 ? '完成' : (j.status === 'cancelled' ? '已取消' : '失败')}`);
              setActiveJobId('');
              break;
            }
          }
          await refresh();
          if (page) await loadPage(page);
          setMsg(label + '完成');
        } catch (e) {
          setMsg(label + '失败:' + String(e.message || e));
        } finally {
          setLoading(false);
        }
      }

      async function dshSfx() {
        if (!folder || loading) return;
        const est = await costEstimate('sfx', true);
        setConfirmDlg({
          title: '拟声词识别填词(DSH 接管)',
          body: `本页拟声词框:${est ? est.boxes : '?'} 个(其中未翻译 ${est ? est.todo : '?'})\n`
            + `预计消耗:${money(est)}\n`
            + `  · 视觉识别 ¥${est ? est.visionMin : '?'}~¥${est ? est.visionMax : '?'}`
            + `  · DSH 翻译 ¥${est ? est.transCost : '?'}(实测 ¥0.00058/框)`
            + `  · 本地嵌字 ¥0\n`
            + '流程:视觉引擎识别 → DSH 翻译 → 自动设为参与嵌字\n\n开始吗?',
          okText: '开始',
          onOk: async () => {
            setConfirmDlg(null);
            await runDshJob('/dsh-sfx', { folder, page }, '拟声词识别填词');
          },
        });
      }

      async function dshFull() {
        if (!folder || loading) return;
        const est = await costEstimate('all', false);
        setConfirmDlg({
          title: 'DSH 汉化模式(整本接管)',
          body: `整本框数:${est ? est.boxes : '?'} 个(未翻译 ${est ? est.todo : '?'})\n`
            + `预计消耗:${money(est)}\n`
            + `  · 视觉识别 ¥${est ? est.visionMin : '?'}~¥${est ? est.visionMax : '?'}`
            + `  · DSH 翻译 ¥${est ? est.transCost : '?'}(实测 ¥0.00058/框)`
            + `  · 本地嵌字 ¥0\n`
            + '分 4 阶段(会显示百分比进度):\n'
            + '  1) 视觉识别整本(0~58%)  2) DSH 翻译(58~87%)\n'
            + '  3) 设为参与嵌字(87~92%)  4) 校对(92~100%)\n'
            + '⚠ 整本识别耗时与花费都较高\n\n开始吗?',
          okText: '开始',
          onOk: async () => {
            setConfirmDlg(null);
            await runDshJob('/dsh-full', { folder }, 'DSH 汉化');
          },
        });
      }

      // 页面/文件夹变化时:拉取 DSH 接管预估,常驻显示在按钮旁
      React.useEffect(() => {
        if (!folder) { setEstInfo(null); return; }
        let alive = true;
        (async () => {
          try {
            const sfx = await api('/cost-estimate', { folder, page: page || null, scope: 'sfx' });
            const all = await api('/cost-estimate', { folder, scope: 'all' });
            if (alive) setEstInfo({ sfx, all });
          } catch (e) { if (alive) setEstInfo(null); }
        })();
        return () => { alive = false; };
      }, [folder, page]);

      // 单页识图翻译:当前页所有框交给视觉引擎读原文,再交 DSH 模型翻译
      async function visionPage() {
        if (!folder || !page || loading) return;
        setLoading(true);
        try {
          if (dirtyRef.current) await savePage({ auto: true });
          setLog('单页识图翻译:0% · 视觉识别');
          setMsg('单页识图翻译:0% · 视觉识别');
          const { jobId } = await api('/vision-page', { folder, page });
          setActiveJobId(jobId);
          let lastLog = '';
          for (;;) {
            await new Promise((r) => setTimeout(r, 1200));
            const j = await api(`/job?id=${encodeURIComponent(jobId)}`);
            if (j.log && j.log !== lastLog) { lastLog = j.log; setLog(j.log); }
            if (j.status !== 'running') {
              setLog(`[单页识图翻译] exit=${j.code}\n${j.log || ''}`);
              break;
            }
          }
          await refresh();
          if (page) await loadPage(page);
          setMsg('单页识图翻译完成:' + page);
        } catch (e) {
          setMsg('单页识图翻译失败:' + String(e.message || e));
        } finally {
          setLoading(false);
        }
      }

      // 确认嵌字:先跑一遍校对 → 弹窗确认 → 嵌字(脚本内自动做嵌字后校对)→ 结果
      async function confirmEmbed() {
        // 默认:在面板内执行(校对 → 确认 → 嵌字 → 表单+预览)
        return _confirmEmbedPanel();
      }

      // 交给当前 DSH 对话执行(写工作区请求;在对话里说「执行嵌字」)
      async function embedToChat() {
        try {
          const est = await costEstimate('all', false);
          setConfirmDlg({
            title: '交给对话执行嵌字',
            body: `整本:${(info && info.pageCount) || '?'} 页 / ${est ? est.boxes : '?'} 框\n`
              + `预计消耗:${money(est)}\n`
            + `  · 视觉识别 ¥${est ? est.visionMin : '?'}~¥${est ? est.visionMax : '?'}`
            + `  · DSH 翻译 ¥${est ? est.transCost : '?'}(实测 ¥0.00058/框)`
            + `  · 本地嵌字 ¥0\n`
              + '提交后请在本对话里说「执行嵌字」。\n\n提交吗?',
            okText: '提交',
            onOk: async () => {
              setConfirmDlg(null);
              await submitEmbedToChat();
            },
          });
        } catch (e) { setMsg('估算失败:' + String(e.message || e)); }
      }

      async function submitEmbedToChat() {
        try {
          if (dirtyRef.current) await savePage({ auto: true });
          const r = await api('/embed-agent-request', { folder });
          if (r && r.ok) {
            setMsg('已写入嵌字请求:' + r.ws + '\n请在本对话里说「执行嵌字」');
            setLog('嵌字请求 → ' + r.ws + '\\pending_embed_request.json');
            return;
          }
          setMsg('提交失败:' + ((r && r.error) || '未知'));
        } catch (e) {
          setMsg('提交失败:' + String(e.message || e));
        }
      }

      async function _confirmEmbedPanel() {
        // 先给明确反馈,避免"点了没反应"
        setMsg('确认嵌字:开始…');
        setLog('确认嵌字:开始…');
        console.log('[manga-workflow] confirmEmbed clicked');
        if (!folder) { setMsg('确认嵌字:请先选择/打开一本漫画'); return; }
        if (loading) { setMsg('确认嵌字:有任务正在运行,请等它结束再点'); return; }
        setLoading(true);
        const scopePage = (embedScope === 'page') ? (page || '') : '';
        try {
          if (dirtyRef.current) await savePage({ auto: true });
          setMsg('确认嵌字:0% · 嵌字前体检(' + (scopePage ? '此页' : '整本') + ')');
          setLog('确认嵌字:0% · 嵌字前体检(对齐/无效译文/艺术字)');
          let pf = {};
          try { pf = await api('/preflight', { folder, page: scopePage || null, autoParticipate: pfAuto }); } catch (e) { pf = {}; }
          setMsg('确认嵌字:10% · 嵌字前校对');
          setLog('[进度] 10% · 嵌字前体检完成,开始校对');
          const r = await runJob('proofread', { page: scopePage });
          const log = (r && r.log) || '';
          const lines = log.split('\n').filter((l) => l.trim());
          const issues = lines.filter((l) => l.startsWith('[问题]')).length;
          const warns = lines.filter((l) => l.startsWith('[提示]')).length;
          const summaryLine = lines.filter((l) => l.trim().startsWith('{')).slice(-1)[0] || '';
          setMsg(`嵌字前校对完成:问题 ${issues} 条 / 提示 ${warns} 条`);
          setConfirmDlg({
            title: '确认嵌字',
            body: `范围:${scopePage ? ('此页 ' + scopePage) : '整本'}\n嵌字前体检:对齐 ${pf.aligned || 0} 处 · 缺译文 ${pf.missing_total || 0} 框 · `
              + `无效译文 ${pf.invalid_total || 0} 框 · 艺术字 ${pf.art_total || 0} 框(已自动排除)\n`
              + `嵌字前校对:问题 ${issues} 条 / 提示 ${warns} 条`
              + (summaryLine ? '\n' + summaryLine : '')
              + '\n\n' + lines.slice(-10).join('\n')
              + '\n\n确认后开始嵌字(嵌字结束会自动再校对一遍输出)。',
            okText: '确认嵌字',
            onOk: async () => { setConfirmDlg(null); await doEmbed(); },
          });
        } catch (e) {
          setMsg('嵌字前校对失败:' + String(e.message || e));
        } finally {
          setLoading(false);
        }
      }

      async function doEmbed() {
        if (!folder) return;
        const scopePage = (embedScope === 'page') ? (page || '') : '';
        setLoading(true);
        try {
          // 核实嵌字工作区(缺失则创建)
          try {
            const st = await api('/workspace/status');
            if (!st || !st.exists) {
              const r2 = await api('/workspace/ensure', {});
              if (r2 && r2.ok) { setWsExists(true); setMsg('已创建工作区:' + r2.dir); }
            }
          } catch (e) { /* 工作区不影响嵌字 */ }
          setMsg('嵌字中…(' + (scopePage ? '此页' : '整本') + ')');
          const r = await runJob('embed', { page: scopePage });
          await refresh();
          if (page) await loadPage(page);
          const ok = r && r.code === 0;
          const log = (r && r.log) || '';
          const lines = log.split('\n').filter((l) => l.trim());
          setMsg(ok ? '确认嵌字:100% · 完成(已自动校对输出)' : '确认嵌字:失败,请看日志');
          setLog('[进度] 100% · 嵌字结束');
          // 嵌字完成:提交结果表单 + 预览给用户
          const repLine = lines.filter((l) => l.includes('[报告]') || l.includes('[工作区]') || l.includes('[来源]')).join('\n');
          const form = [
            '书:' + folder,
            '当前页:' + (page || '-'),
            '退出码:' + (r && r.code),
            '嵌字后校对:' + (lines.some((l) => l.includes('问题 0 条')) ? '通过(0 问题)' : '见日志'),
            repLine || '报告:out/embed_report.md',
            '',
            '— 日志末段 —',
            lines.slice(-10).join('\n'),
          ].join('\n');
          setPreviewPg(page || '');
          setMsg('确认嵌字:30% · 嵌字中');
          setLog('[进度] 30% · 校对完成,开始嵌字');
          setConfirmDlg({
            title: ok ? '嵌字完成 ✔ 请确认结果' : '嵌字失败',
            body: form,
            okText: '确认完成',
            preview: ok ? 'yes' : '',
            previewPages: ok ? ((info && info.pages) || []).map((x) => x.page) : [],
            onOk: () => setConfirmDlg(null),
          });
        } catch (e) {
          setMsg('嵌字失败:' + String(e.message || e));
        } finally {
          setLoading(false);
        }
      }

      async function savePage(opts) {
        if (!folder || !page) return;
        if (savingRef.current) return;
        savingRef.current = true;
        try {
          const edits = [...textEdits.current.entries()].map(([i, v]) => ({ i, orig: v.orig, trans: v.trans }));
          await api('/save', { folder, page, boxes, edits });
          textEdits.current.clear();
          dirtyRef.current = false;
          if (opts && opts.auto) {
            const t = new Date();
            setAutoSavedAt(t.toTimeString().slice(0, 8));
          } else {
            setMsg(edits.length ? `已保存(含 ${edits.length} 处文本修改)` : '已保存');
            await refresh();
          }
        } catch (e) {
          dirtyRef.current = true;
          setMsg('保存失败:' + String(e.message || e));
        } finally {
          savingRef.current = false;
          if (dirtyRef.current) setTimeout(() => { if (dirtyRef.current) savePage({ auto: true }); }, 400);
        }
      }

      // 防抖自动保存(约 0.9 秒无操作后写入)
      React.useEffect(() => {
        if (!folder || !page || !dirtyRef.current) return;
        const t = setTimeout(() => { if (dirtyRef.current) savePage({ auto: true }); }, 900);
        return () => clearTimeout(t);
      }, [editTick, page, folder, boxes]);

      // 关闭/刷新页面前尽力保存一次
      React.useEffect(() => {
        const onUnload = () => {
          if (!dirtyRef.current || !folder || !page) return;
          try {
            const edits = [...textEdits.current.entries()].map(([i, v]) => ({ i, orig: v.orig, trans: v.trans }));
            const blob = new Blob([JSON.stringify({ folder, page, boxes, edits })],
              { type: 'application/json' });
            navigator.sendBeacon(API + '/save', blob);
          } catch (e) { /* 尽力而为 */ }
        };
        window.addEventListener('beforeunload', onUnload);
        return () => window.removeEventListener('beforeunload', onUnload);
      }, [folder, page, boxes]);

      // 快捷键(与桌面版一致)
      React.useEffect(() => {
        if (view !== 'work') return;
        const onKey = (e) => {
          const tag = (e.target && e.target.tagName) || '';
          if (tag === 'INPUT' || tag === 'TEXTAREA') return;
          const k = e.key;
          if (e.ctrlKey && (k === 'z' || k === 'Z')) { e.preventDefault(); return; }
          if (e.ctrlKey && (k === 's' || k === 'S')) { e.preventDefault(); savePage(); return; }
          if (k === 'b' || k === 'B') { setMode('box'); return; }
          if (k === 'p' || k === 'P') { setMode('paint'); return; }
          if (k === 'v' || k === 'V') { setDirMode('v'); return; }
          if (k === 'h' || k === 'H') { setDirMode('h'); return; }
          if (k === 'a' || k === 'A') { setDirMode('auto'); return; }
          if (k === 'n' || k === 'N') {
            const order = ['body', 'plain', 'title'];
            pickKind(order[(order.indexOf(kind) + 1) % 3]);
            return;
          }
          if (k === '1') { pickKind('body'); return; }
          if (k === '2') { pickKind('plain'); return; }
          if (k === '3') { pickKind('title'); return; }
          if (k === 'e' || k === 'E') {
            if (kind === 'plain') {
              pickCover(cover === 'overlay' ? 'erase' : 'overlay');   // 拟声无「覆盖」
            } else {
              pickCover(cover === 'overlay' ? 'erase' : (cover === 'erase' ? 'cover' : 'overlay'));
            }
            return;
          }
          if (k === 'g' || k === 'G') { setGpu(!gpu); return; }        // GPU 去字(仅抹除时有效)
          if (k === 't' || k === 'T') { run('translate'); return; }    // 翻译
          if (k === 'o' || k === 'O') { run('ocr'); return; }          // 识别原文
          if (k === 'F5') { reloadPage(); return; }                    // 刷新本页
          const pages = info ? info.pages : [];
          const idx = pages.findIndex((p) => p.page === page);
          if (k === 'ArrowLeft' && idx > 0) { loadPage(pages[idx - 1].page); }
          if (k === 'ArrowRight' && idx >= 0 && idx < pages.length - 1) { loadPage(pages[idx + 1].page); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [view, folder, page, info, boxes, pageData]);

      const pages = info ? info.pages : [];
      const idx = pages.findIndex((p) => p.page === page);

      /* ---------- 启动页 ---------- */
      if (view === 'home') {
        const missing = infra ? infra.missing : [];
        return h('div', { style: S.root },
          h('div', { style: { textAlign: 'center', padding: '28px 0 18px' } },
            h('div', { style: { fontSize: '22px', fontWeight: 700, letterSpacing: '2px' } }, '漫画汉化工具'),
            h('div', { style: { ...S.muted, marginTop: '8px' } }, '把漫画文件夹路径粘贴到下面,点「开始」'),
            h('div', {
              style: {
                marginTop: '10px', fontSize: '11px', color: '#ffb020',
                border: '1px dashed rgba(255,176,32,0.55)', borderRadius: '6px',
                padding: '6px 10px', display: 'inline-block',
              },
            }, '⚠ 首次使用建议先看完「帮助」手册 —— 流程 / 快捷键 / 双端差异 / OCR 兜底都在里面'),
            h('div', { style: { marginTop: '8px', fontSize: '11px' } },
              verInfo
                ? (verInfo.ok
                  ? ((verInfo.hasStableUpdate || verInfo.hasBetaUpdate)
                    ? h('span', { style: { color: '#ffb020' } },
                        '版本 v' + verInfo.current + ' · '
                        + (verInfo.hasStableUpdate
                          ? '稳定版 v' + (verInfo.stable || '?') + ' 可更新 ✅'
                          : '稳定版已是最新')
                        + (verInfo.hasBetaUpdate
                          ? ' · 测试版 v' + (verInfo.beta || verInfo.latest || '?') + ' 可选(测试)'
                          : ''))
                    : h('span', { style: { color: '#7ac97a' } },
                        '版本 v' + (verInfo.current || '?') + ' · 已是最新'))
                  : h('span', { style: S.muted }, '版本检测失败(可手动再试)'))
                : h('span', { style: S.muted }, '版本检测中…'),
              h('button', {
                type: 'button', style: { ...S.btn, marginLeft: '8px', fontSize: '10px', padding: '2px 6px' },
                onClick: async () => {
                  setVerInfo(null);
                  try { setVerInfo(await api('/version-check?force=1')); }
                  catch (e) { setVerInfo({ ok: false }); }
                },
              }, '检查更新'),
              verInfo && verInfo.ok && verInfo.hasStableUpdate
                ? h('button', {
                    type: 'button', style: { ...S.btn, marginLeft: '6px', fontSize: '10px', padding: '2px 6px' },
                    title: '下载稳定版安装包到工作区 dist/(然后在插件管理里更新)',
                    onClick: async () => {
                      try {
                        const r = await api('/update-download', { channel: 'stable' });
                        setMsg(r && r.ok ? '已下载稳定版 v' + r.version + ' → ' + r.path : '下载失败:' + (r && r.error));
                      } catch (e) { setMsg('下载失败:' + String(e.message || e)); }
                    },
                  }, '更新稳定版')
                : null,
              verInfo && verInfo.ok && verInfo.hasBetaUpdate
                ? h('button', {
                    type: 'button', style: { ...S.btn, marginLeft: '6px', fontSize: '10px', padding: '2px 6px' },
                    title: '下载测试版安装包到工作区 dist/(然后在插件管理里更新)',
                    onClick: async () => {
                      try {
                        const r = await api('/update-download', { channel: 'beta' });
                        setMsg(r && r.ok ? '已下载测试版 v' + r.version + ' → ' + r.path : '下载失败:' + (r && r.error));
                      } catch (e) { setMsg('下载失败:' + String(e.message || e)); }
                    },
                  }, '更新测试版')
                : null,
            ),
          ),
          h('div', { style: S.row },
            h('input', {
              style: { ...S.input, padding: '8px 10px', fontSize: '13px' },
              value: folder,
              placeholder: '漫画文件夹绝对路径(可粘贴,或点「浏览」选择)',
              onChange: (e) => setFolder(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') refresh(true); },
            }),
            h('button', {
              type: 'button',
              style: { ...S.btn, padding: '7px 14px', fontSize: '13px' },
              title: '打开系统文件夹选择框',
              onClick: browseFolder,
            }, '浏览…'),
          ),
          h('div', { style: S.row },
            h('button', {
              type: 'button',
              style: { ...S.btnOn, padding: '7px 18px', fontSize: '13px' },
              disabled: loading || !folder,
              onClick: () => refresh(true),
            }, loading ? '读取中…' : '开始'),
            h('button', {
              type: 'button',
              style: { ...S.btn, padding: '7px 14px', fontSize: '13px' },
              title: '打开桌面版标框工具(带涂抹、字号编辑等完整功能)',
              onClick: launchDesktop,
            }, '启动桌面版'),
            h('button', {
              type: 'button',
              style: { ...S.btn, padding: '7px 14px', fontSize: '13px' },
              onClick: () => setView('settings'),
            }, '设置'),
            h('button', {
              type: 'button',
              style: { ...S.btn, padding: '7px 14px', fontSize: '13px' },
              onClick: () => setView('help'),
            }, '帮助'),
            h('button', {
              type: 'button',
              style: { ...S.btn, padding: '7px 14px', fontSize: '13px' },
              title: '重新加载整个网页面板(安装/更新插件后用它,等同按 F5)',
              onClick: () => { try { location.reload(); } catch (e) {} },
            }, '⟳ 刷新面板'),
          ),
          msg ? h('div', { style: { color: '#ff8080', marginTop: '6px' } }, msg) : null,
          h('div', { style: { ...S.box, marginTop: '18px' } },
            h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '引擎检测'),
            infra ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '4px 12px' } },
              infra.items.map((it) => h('div', { key: it.label, style: { display: 'flex', gap: '6px' } },
                h('span', null, it.ok ? '✅' : '⚠️'),
                h('span', { style: it.ok ? {} : { color: '#ff8080' } }, it.label),
              )),
            ) : h('div', { style: S.muted }, '检测中…'),
            infra && missing.length
              ? h('div', { style: { color: '#ff8080', marginTop: '6px' } }, `缺失:${missing.join('、')}`)
              : null,
            infra ? h('div', { style: { ...S.muted, marginTop: '6px', fontSize: '11px' } }, `工作根目录:${infra.workRoot}`) : null,
          ),
          h('div', { style: { ...S.box, marginTop: '10px' } },
            h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '视觉引擎(识图)'),
            h('div', { style: S.row },
              h('span', null, vision && vision.apiKeySet ? '✅ 已配置' : '⚠️ 未配置'),
              vision
                ? h('span', { style: S.muted }, `${vision.model} · ${vision.apiBase}`)
                : h('span', { style: S.muted }, '读取中…'),
              vision && !vision.apiKeySet
                ? h('span', { style: { color: '#ff8080' } }, '缺少 API Key')
                : null,
              h('span', { style: { flex: 1 } }),
              h('button', {
                type: 'button',
                style: S.btn,
                onClick: () => setView('settings'),
              }, '去设置'),
            ),
            h('div', { style: { ...S.muted, fontSize: '11px', marginTop: '4px', whiteSpace: 'pre-wrap' } },
              '让 AI 看图/读图必须配好视觉引擎(本地 OCR 不需要)。\n' +
              '免费可用:智谱 GLM-4V-Flash · 硅基流动 Qwen2.5-VL · Gemini 2.0 Flash(详见「帮助」)。'),
          ),
          h('div', { style: { textAlign: 'center', marginTop: '30px', fontSize: '10px', color: '#888' } },
            '· ' + APP_VERSION + ' · 本软件完全由 AI(DeepSeek Harness Agent)生成与编写。作者:YiDaWuYi',
          ),
        );
      }

      /* ---------- 帮助页 ---------- */
      if (view === 'help') {
        return h(HelpView, { onBack: () => setView('home') });
      }

      /* ---------- 设置页 ---------- */
      if (view === 'settings') {
        return h(SettingsView, { onBack: () => setView('home'), folder });
      }

      /* ---------- 工作台 ---------- */
      return h('div', { style: S.root },
        h('div', { style: S.row },
          h('button', {
            type: 'button', style: S.btn,
            onClick: async () => {
              if (dirtyRef.current) { try { await savePage({ auto: true }); } catch (e) { /* ignore */ } }
              setView('home');
            },
          }, '← 主页'),
          h('button', { type: 'button', style: S.btn, onClick: () => setView('settings') }, '设置'),
          h('button', { type: 'button', style: S.btn, onClick: () => setView('help') }, '帮助'),
          h('span', { style: { fontWeight: 600, fontSize: '13px' } }, '漫画工作台'),
          h('span', { style: { flex: 1 } }),
          proj && proj.ok ? h('span', { style: S.chip, title: proj.dir || '' }, '项目 ' + (proj.name || '')) : null,
          h('span', { style: { ...S.muted, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, folder),
        ),
        (proj && proj.ok === false && proj.code === 'PROJECT_NO_WORKSPACE') ? h('div', { style: { ...S.box, borderColor: 'rgba(255,120,0,0.55)' } },
          h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '⚠ 还没有设置「嵌字工作区」'),
          h('div', { style: { ...S.muted, fontSize: '11px' } },
            '标框/译文等数据会存到工作区的项目目录里(源漫画文件夹保持不动),成品输出到工作区的「已完成」文件夹。'),
          h('div', { style: { ...S.row, marginTop: '6px' } },
            h('button', { type: 'button', style: S.btn, onClick: () => setView('settings') }, '去设置'),
            h('span', { style: { ...S.muted, fontSize: '11px' } }, String((proj && (proj.error || proj.code)) || '')),
          ),
        ) : null,
        (proj && proj.ok === false && proj.code === 'NETWORK')
          ? h('div', { style: { ...S.muted, fontSize: '11px', marginTop: '2px' } },
              '⚠ 后台还是旧版本(没有项目库接口):重开 DSH(关掉再启动,不是刷新面板)后自动改用项目库。')
          : null,
        (proj && proj.ok) ? h('div', { style: { ...S.muted, fontSize: '11px', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
          '数据目录:' + (proj.dir || '') + ' · 成品输出:' + (proj.doneDir || '')) : null,
        (!wsExists) ? h('div', { style: { ...S.box, borderColor: 'rgba(255,180,0,0.5)' } },
          h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '⚠ 嵌字工作区未就绪'),
          h('div', { style: { ...S.muted, fontSize: '11px' } },
            '嵌字报告与对话汇报需要工作区目录。请到「设置 → 嵌字工作区」指定并点「检查 / 创建」;'
            + '确认嵌字时会再核实一次,缺失会自动创建。'),
        ) : null,
        info ? h('div', { style: S.box },
          h('div', { style: S.row },
            h('span', { style: S.chip }, `页数 ${info.pageCount}`),
            h('span', { style: S.chip }, `框 ${info.boxes}`),
            h('span', { style: S.chip }, `译 ${info.translated}`),
            h('span', { style: { ...S.chip, opacity: 0.75 }, title: '面板前端代码版本;更新插件后若这里没变,说明面板仍在跑旧 bundle,需要完全退出 DSH 再打开' }, APP_VERSION),
          ),
          h('div', { style: S.row },
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '自动检测文字并加框(按右侧「范围」:此页或整本);新框标 auto,需人工更正后才参与嵌字',
              onClick: () => run('detect'),
            }, '自动标框'),
            h('button', { type: 'button', style: S.btn, disabled: loading, title: 'OCR 识别原文(按右侧「范围」:此页或整本)', onClick: () => run('ocr') }, 'OCR'),
            h('button', { type: 'button', style: S.btn, disabled: loading, title: '翻译(按右侧「范围」:此页或整本);已有译文默认跳过', onClick: () => run('translate') }, '翻译'),
            h('label', { style: { ...S.muted, fontSize: '11px', marginLeft: '4px' }, title: '勾选后,翻译会覆盖已有译文重新翻(用于修「译文乱了/错位」)' },
              h('input', { type: 'checkbox', checked: forceTrans, onChange: (e) => setForceTrans(!!e.target.checked) }),
              '强制重译'),
            SEP(),
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '当前页所有框:视觉引擎读原文 → DSH 模型翻译(兜底用)',
              onClick: () => visionPage(),
            }, '单页识图翻译'),
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '本页拟声词:视觉引擎识别 → DSH 翻译 → 自动参与嵌字',
              onClick: () => dshSfx(),
            }, '拟声词识别填词'),
            h('button', {
              type: 'button',
              style: loading ? S.btn : S.btnOn,
              disabled: loading,
              title: '整本:视觉识别 + DSH 翻译 + 校对',
              onClick: () => dshFull(),
            }, 'DSH汉化模式'),
            estInfo && estInfo.all
              ? h('span', { style: { ...S.muted, fontSize: '11px', marginLeft: '6px' },
                  title: '视觉 ¥0.004~0.02/框 + DSH 翻译 ¥0.00058/框(实测) + 本地嵌字 ¥0' },
                  '预估:本页拟声词 ' + (estInfo.sfx ? estInfo.sfx.boxes : 0) + ' 框 ¥'
                  + (estInfo.sfx ? estInfo.sfx.yuanMin : '?') + '~¥' + (estInfo.sfx ? estInfo.sfx.yuanMax : '?')
                  + ' · 整本 ' + estInfo.all.boxes + ' 框 ¥' + estInfo.all.yuanMin + '~¥' + estInfo.all.yuanMax)
              : null,
            SEP(),
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '汇总「没认出字 / 兜底也失败 / 疑似识别错 / 缺译文」的框;按右侧「范围」:此页只统计当前页,整本生成 ocr_failure_report.json(DSH 可直接读取)',
              onClick: () => showFailures(),
            }, '失败报告'),
            h('button', { type: 'button', style: S.btn, disabled: loading, title: '校对(按右侧「范围」:此页或整本)', onClick: () => run('proofread') }, '校对'),
            SEP(),
            h('button', { type: 'button', style: S.btn, disabled: loading, title: '嵌字(按右侧「范围」:此页或整本)', onClick: () => run('embed') }, '嵌字'),
            h('button', {
              type: 'button',
              style: loading ? S.btn : S.btnOn,
              title: '先自动校对 → 确认 → 嵌字(嵌字后自动校对输出)',
              onClick: () => { try { confirmEmbed(); } catch (e) { setMsg('确认嵌字异常:' + String(e)); } },
            }, '确认嵌字'),
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '把请求写到工作区,在本对话里说「执行嵌字」后由 DSH 执行',
              onClick: () => { try { embedToChat(); } catch (e) { setMsg('提交异常:' + String(e)); } },
            }, '交给对话'),
            h('span', { style: { ...S.muted, fontSize: '11px', marginLeft: '8px' } }, '范围(标框/OCR/翻译/校对/嵌字):'),
            h('button', {
              type: 'button',
              style: embedScope === 'page' ? S.btnOn : S.btn,
              title: '只处理当前页(推荐:先单页试,确认没问题再整本)',
              onClick: () => { setEmbedScope('page'); setMsg('确认嵌字范围:此页(第 ' + (page || '-') + ' 页)'); },
            }, '此页'),
            h('button', {
              type: 'button',
              style: embedScope === 'book' ? S.btnOn : S.btn,
              title: '处理整本所有已标框的页',
              onClick: () => { setEmbedScope('book'); setMsg('确认嵌字范围:整本'); },
            }, '整本'),
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button', style: S.btnDanger || S.btn,
              title: '终止正在运行的 OCR / 翻译 / 校对 / 嵌字 / DSH 任务',
              onClick: async () => {
                try {
                  const r = await api('/cancel', { jobId: activeJobId || null });
                  if (r && r.ok) {
                    setMsg('已请求取消任务' + (r.killed ? '(终止 ' + r.killed + ' 个进程)' : ''));
                    setLog((l) => l + '\n[取消] 已请求取消:' + r.jobId);
                  } else {
                    setMsg('当前没有正在运行的任务');
                  }
                  setActiveJobId('');
                } catch (e) {
                  setMsg('取消失败:' + String(e.message || e));
                }
              },
            }, '取消当前任务'),
          ),
        ) : null,
        msg ? h('div', { style: { ...S.muted, marginBottom: '6px' } }, msg) : null,
        info && pages.length ? h('div', null,
          h('div', { style: S.row },
            h('button', { type: 'button', style: S.btn, onClick: () => idx > 0 && loadPage(pages[idx - 1].page) }, '◀'),
            h('input', {
              style: { ...S.input, flex: '0 0 64px', minWidth: 0, textAlign: 'center' },
              placeholder: '页码',
              title: '输入页码直达(回车也可)',
              value: jumpNo,
              onChange: (e) => setJumpNo(e.target.value.replace(/[^0-9]/g, '')),
              onKeyDown: (e) => { if (e.key === 'Enter') jumpPage(); },
            }),
            h('button', { type: 'button', style: S.btn, onClick: () => jumpPage() }, '跳'),
            h('span', { style: { flex: 1, textAlign: 'center', ...S.muted, fontSize: '11px' } },
              (idx >= 0 ? (idx + 1) : '-') + ' / ' + pages.length + ' · ' + (page || '-')),
            h('button', { type: 'button', style: S.btn, onClick: () => idx >= 0 && idx < pages.length - 1 && loadPage(pages[idx + 1].page) }, '▶'),
            h('button', { type: 'button', style: S.btn, onClick: () => savePage() }, '保存'),
            autoSavedAt
              ? h('span', { style: { ...S.muted, fontSize: '10px', marginLeft: '6px' } },
                  '已自动保存 ' + autoSavedAt)
              : null,
          ),
          h('div', { style: S.row },
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '本页所有框设为参与嵌字(含无译文的框;页码/UI 噪音自动跳过)',
              onClick: () => {
                const ot = (pageData && pageData.texts) || [];
                setBoxes((prev) => prev.map((b, i) => (
                  isNoiseBox(b, ot[i]) ? b : { ...b, auto: false }
                )));
                markDirty();
                setMsg('本页框已设为参与嵌字(页码/UI 噪音自动跳过),点「保存」生效');
              },
            }, '本页auto→参与'),
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '只把本页「已有译文」的 auto 框设为参与(推荐):没译文的保持不参与,避免空框误嵌;噪音自动跳过',
              onClick: () => {
                const tr = (pageData && pageData.trans) || [];
                const ot = (pageData && pageData.texts) || [];
                setBoxes((prev) => prev.map((b, i) => {
                  const has = !!(tr[i] && String(tr[i]).trim());
                  if (!has || isNoiseBox(b, ot[i])) return b;
                  return { ...b, auto: false };
                }));
                markDirty();
                setMsg('本页有译文的 auto 框已设为参与,点「保存」生效');
              },
            }, '仅补有译文的'),
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '遍历全书,把所有「有译文」的 auto 框设为参与嵌字(最慢;建议先保存/校对;噪音自动跳过)',
              onClick: () => autoParticipateAll(),
            }, '全书auto参与'),
            h('label', { style: { ...S.muted, fontSize: '11px', marginLeft: '4px' } },
              h('input', {
                type: 'checkbox', checked: pfAuto,
                onChange: (e) => setPfAuto(e.target.checked),
                title: '嵌字前体检时,把有译文的 auto 框自动设为参与',
              }), ' 体检时auto参与'),
          ),
          h('div', { style: S.row },
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '模式:'),
            h('button', { type: 'button', style: mode === 'box' ? S.btnOn : S.btn, title: 'B', onClick: () => setMode('box') }, '框选(B)'),
            h('button', { type: 'button', style: mode === 'paint' ? S.btnOn : S.btn, title: 'P', onClick: () => setMode('paint') }, '自由框选(P)'),
            h('span', { style: { ...S.muted, fontSize: '11px', marginLeft: '6px' } }, '类型:'),
            [['body', '正文'], ['plain', '无框正文/拟声词'], ['title', '标题']].map(([k, name]) =>
              h('button', {
                key: k, type: 'button',
                style: kind === k ? S.btnOn : S.btn,
                onClick: () => pickKind(k),
              }, name)),
          ),
          h('div', { style: S.row },
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '原文处理:'),
            [['overlay', '译文直盖'], ['erase', '抹除'], ['cover', '色块覆盖']].map(([c, name]) =>
              h('button', {
                key: c, type: 'button',
                style: (kind === 'plain' && c === 'cover')
                  ? { ...S.btn, opacity: 0.35, cursor: 'not-allowed' }
                  : (cover === c ? S.btnOn : S.btn),
                disabled: kind === 'plain' && c === 'cover',
                title: (kind === 'plain' && c === 'cover')
                  ? '拟声词不允许色块覆盖(固定直盖,可改抹除)'
                  : undefined,
                onClick: () => pickCover(c),
              }, name)),
            cover === 'erase'
              ? h('label', { style: { ...S.muted, fontSize: '11px', marginLeft: '4px' } },
                  h('input', {
                    type: 'checkbox', checked: gpu,
                    onChange: (e) => pickGpu(e.target.checked),
                  }), ' GPU去字')
              : null,
            h('span', { style: { ...S.muted, fontSize: '11px', marginLeft: '10px' } }, '字号'),
            h('input', { style: { ...S.input, flex: '0 0 52px', minWidth: 0 }, value: size, onChange: (e) => setSize(e.target.value) }),
            h('label', { style: { ...S.muted, fontSize: '11px', marginLeft: '4px' } },
              h('input', { type: 'checkbox', checked: autoSize, onChange: (e) => setAutoSize(e.target.checked) }), ' 自动字号'),
            h('span', { style: { ...S.muted, fontSize: '11px', marginLeft: '10px' } }, '方向:'),
            [['auto', '自动检测'], ['v', '竖排'], ['h', '横排']].map(([d, name]) =>
              h('button', {
                key: d, type: 'button', style: dirMode === d ? S.btnOn : S.btn,
                onClick: () => setDirMode(d),
              }, name)),
            h('span', { style: { ...S.muted, fontSize: '11px', marginLeft: '10px' } }, '对齐:'),
            [['auto', '自动'], ['left', '左'], ['center', '中'], ['right', '右']].map(([a, name]) =>
              h('button', {
                key: a, type: 'button',
                style: alignMode === a ? S.btnOn : S.btn,
                title: a === 'auto' ? '自动检测文字位置(墨迹重心)' : '',
                onClick: () => { setAlignMode(a); setAlignTouched(true); },
              }, name)),
          ),
          h('div', { style: S.row },
            h('button', {
              type: 'button', style: S.btn, title: '收起/展开文字样式栏',
              onClick: () => setStyleOpen((v) => !v),
            }, styleOpen ? '样式 ▾' : '样式 ▸'),
            styleOpen ? null : h('span', { style: { ...S.muted, fontSize: '11px' } }, '(样式栏已收起)'),
          ),
          styleOpen ? h(React.Fragment, null,
            [['body', '正文样式', '正', bodyStyle, setBodyStyle],
             ['sfx', '拟声样式', '音', sfxStyle, setSfxStyle],
             ['title', '标题样式', '标', titleStyle, setTitleStyle]].map(([k, label, glyph, val, setter]) =>
              h('div', { key: k, style: { ...S.row, alignItems: 'center' } },
                h('span', { style: { fontSize: '11px', color: '#888', width: '54px' } }, label),
                h(StyleChips, {
                  presets: (stylePresets || []).filter((p) => p.kind === k),
                  value: val, onChange: setter, glyph, font: fontByKind[k],
                }),
                h('span', { style: { fontSize: '11px', color: '#888', marginLeft: '2px' } }, '字体'),
                h('select', {
                  style: {
                    flex: '0 0 108px', minWidth: '108px', padding: '2px',
                    borderRadius: '5px', border: '1px solid rgba(128,128,128,0.45)',
                    background: '#ffffff', color: '#111111', fontSize: '12px',
                  },
                  value: fontByKind[k] || '',
                  onChange: (e) => setFontByKind((f) => ({ ...f, [k]: e.target.value })),
                  title: '该组字体(共 ' + WEB_FONT_NAMES.length + ' 项,选中后预览同步)',
                }, [''].concat(WEB_FONT_NAMES).map((n) =>
                  h('option', {
                    key: n || '__default',
                    value: n,
                    style: { fontFamily: cssFont(n) || 'inherit', background: '#ffffff', color: '#111111' },
                  }, n || '默认字体'))),
              )),
            h('div', { style: S.row },
              h('label', {
                style: { display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '54px',
                  fontSize: '12px', cursor: 'pointer', userSelect: 'none' },
                title: '开启后嵌字时按原图采样字色/描边/空心字/字距,与原文风格一致(需重新嵌字生效)',
              },
                h('input', {
                  type: 'checkbox', checked: followStyle,
                  onChange: (e) => toggleFollowStyle(!!e.target.checked),
                }),
                '样式自动识别(跟随原文)'),
              h('button', {
                type: 'button', style: S.btn, marginLeft: '10px',
                title: '把三类样式分别应用到本页同类型框',
                onClick: () => {
                  setBoxes((prev) => prev.map((b) => {
                    const k = kindOfBox(b);
                    const nb = { ...b, style: k === 'title' ? titleStyle : (k === 'plain' ? sfxStyle : bodyStyle) };
                    if (fontByKind[k]) nb.font = fontByKind[k]; else delete nb.font;
                    return nb;
                  }));
                  setMsg('已把样式应用到本页(同类型),点「保存」生效');
                },
              }, '应用到本页'),
              h('button', {
                type: 'button', style: S.btn,
                title: '把三类样式分别应用到全书同类型框(可能较慢)',
                onClick: () => applyStyleAll(),
              }, '应用到全部'),
            ),
          ) : null,
          pageData ? h(Marker, {
            folder, page, data: pageData,
            mode, setMode, kind, cover, gpu, dirMode, align: alignMode, alignTouched, size, autoSize,
            bodyStyle, sfxStyle, titleStyle, fontByKind,
            onBoxesChange: (bs) => {
              setBoxes(bs);
              const same = pageData && JSON.stringify(bs) === JSON.stringify(pageData.boxes || []);
              if (!same) markDirty();
            },
            onTextEdit: (i, orig, trans) => {
              textEdits.current.set(i, { orig, trans });
              markDirty();
            },
            onSelect: (b) => {
              if (!b) return;
              try {
                setKind(kindOfBox(b));
                setCover(coverOfBox(b));
                setGpu(!!(b.gpu !== undefined ? b.gpu : b.lama));
                setDirMode(b.vertical === 'auto' || b.vertical === undefined ? 'auto' : (b.vertical ? 'v' : 'h'));
                setSize(String(b.size || 20));
                setAutoSize(!b.size_fixed);
                const _al = String(b.align || 'auto');
                setAlignMode(_al === 'auto' ? 'auto' : _al); setAlignTouched(false);
                const _k = kindOfBox(b);
                if (b.style) { if (_k === 'title') setTitleStyle(b.style); else if (_k === 'plain') setSfxStyle(b.style); else setBodyStyle(b.style); }
                setFontByKind((prev) => ({ ...prev, [_k]: b.font || '' }));
              } catch (e) { /* ignore */ }
            },
            onRefresh: () => reloadPage(),
            reloadTick,
          }) : null,
          h('div', { style: { ...S.muted, marginTop: '4px' } },
            '单击框 = 编辑属性(选中后改设置实时写回) · 双击框 = 编辑文字(原文/译文) · 左键拖框/自由框选 · 右键删框 · '
            + 'B/P=框选/自由框选 · 1/2/3=类型 · N=切类型 · E=切原文处理 · V/H=竖/横 · A=自动 · G=GPU · T=翻译 · O=识别 · Ctrl+Z 撤销 · Ctrl+S 保存 · ←/→ 翻页 · F5 刷新'),
        ) : null,
        log ? h('div', { style: S.log }, log) : null,
        // 底部常驻提示:固定在最下面、黄色纯文字、无背景,不挡点击
        h('div', {
          style: {
            position: 'sticky', bottom: 0, marginTop: '6px',
            background: 'transparent', borderTop: 'none',
            padding: '1px 10px 2px', fontSize: '11px', color: '#ffd24d',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            zIndex: 50, pointerEvents: 'none',
            textShadow: '0 1px 2px rgba(0,0,0,0.95)',
          },
          title: msg || '',
        }, (loading ? '⏳ ' : '') + (msg || '就绪')),

        confirmDlg ? h('div', {
          style: { marginTop: '8px' },   // 在当前工作台界面内联显示,不弹窗
        },
          h('div', {
            style: {
              background: 'rgba(255,190,0,0.08)', color: 'inherit',
              border: '1px solid rgba(255,190,0,0.5)', borderRadius: '8px',
              padding: '12px 14px',
            },
          },
            h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, confirmDlg.title || '确认'),
            h('pre', {
              style: {
                whiteSpace: 'pre-wrap', fontSize: '11px', lineHeight: '1.5',
                maxHeight: '320px', overflow: 'auto', margin: '0 0 12px',
                background: 'rgba(0,0,0,0.25)', padding: '8px', borderRadius: '6px',
              },
            }, confirmDlg.body || ''),
            confirmDlg.preview
              ? (function renderPreview() {
                  const pgs = confirmDlg.previewPages || [];
                  const cur = previewPg || page || '';
                  const i = pgs.indexOf(cur);
                  const url = API + '/preview?folder=' + encodeURIComponent(folder)
                    + '&page=' + encodeURIComponent(cur) + '&t=' + Date.now();
                  return h('div', { style: { marginBottom: '10px' } },
                    h('div', { style: { ...S.row, marginBottom: '4px' } },
                      h('button', {
                        type: 'button', style: S.btn,
                        onClick: () => { if (i > 0) setPreviewPg(pgs[i - 1]); },
                      }, '◀'),
                      h('span', { style: { ...S.muted, fontSize: '11px', minWidth: '120px', textAlign: 'center' } },
                        '预览 ' + (i >= 0 ? (i + 1) + '/' + pgs.length : '-') + ' · ' + cur),
                      h('button', {
                        type: 'button', style: S.btn,
                        onClick: () => { if (i >= 0 && i < pgs.length - 1) setPreviewPg(pgs[i + 1]); },
                      }, '▶'),
                    ),
                    h('img', {
                      src: url,
                      style: { maxWidth: '100%', maxHeight: '360px', display: 'block',
                               border: '1px solid rgba(128,128,128,0.4)', borderRadius: '6px' },
                    }),
                  );
                })()
              : null,
            h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
              h('button', {
                type: 'button', style: S.btn,
                onClick: () => setConfirmDlg(null),
              }, '取消'),
              h('button', {
                type: 'button', style: S.btnOn,
                onClick: () => { try { confirmDlg.onOk && confirmDlg.onOk(); } catch (e) { setConfirmDlg(null); } },
              }, confirmDlg.okText || '确定'),
            ),
          ),
        ) : null,
      );
    }

    /* ---------------- 侧边栏入口(可开关,双端共享设置) ---------------- */

    const UI_CACHE_KEY = 'manga-desk-ui-cfg';
    function readUiCache() {
      try { return JSON.parse(localStorage.getItem(UI_CACHE_KEY) || 'null') || null; } catch (e) { return null; }
    }
    function writeUiCache(patch) {
      try {
        const cur = readUiCache() || {};
        localStorage.setItem(UI_CACHE_KEY, JSON.stringify({ ...cur, ...patch }));
      } catch (e) { /* ignore */ }
    }

    const shell = { ctx: null, dispose: null, bannerDispose: null, enabled: true, bannerEnabled: true, rememberPathWeb: true };

    function applyBannerEntry(enabled) {
      shell.bannerEnabled = !!enabled;
      const ctx = shell.ctx;
      if (!ctx) return;
      try {
        if (enabled) {
          if (!shell.bannerDispose) {
            let inner = null;
            const ret = ctx.slots.inject('conversation.composer.dock', () => {
              inner = ctx.slots.register({ name: 'conversation.composer.dock', id: 'manga-workflow-banner', order: 5 }, Banner);
              return inner;
            });
            shell.bannerDispose = typeof ret === 'function' ? ret : (typeof inner === 'function' ? inner : null);
            if (!shell.bannerDispose) console.warn('[manga-workflow] 提示弹窗注册未返回 disposer,关闭时可能无效');
          }
        } else if (shell.bannerDispose) {
          if (typeof shell.bannerDispose === 'function') shell.bannerDispose();
          shell.bannerDispose = null;
        }
      } catch (e) {
        console.warn('[manga-workflow] 切换启动提示失败:', e);
      }
    }

    function applySidebarEntry(enabled) {
      shell.enabled = !!enabled;
      const ctx = shell.ctx;
      if (!ctx) return;
      try {
        if (enabled) {
          if (!shell.dispose) {
            let inner = null;
            const ret = ctx.slots.inject('sidebar.panellist', () => {
              inner = ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => '漫画工作台' }, PanelIcon);
              return inner;
            });
            shell.dispose = typeof ret === 'function' ? ret : (typeof inner === 'function' ? inner : null);
            if (!shell.dispose) console.warn('[manga-workflow] 侧边栏注册未返回 disposer,关闭时可能无效');
          }
        } else if (shell.dispose) {
          if (typeof shell.dispose === 'function') shell.dispose();
          shell.dispose = null;
        }
      } catch (e) {
        console.warn('[manga-workflow] 切换侧边栏入口失败:', e);
      }
    }

    /* ---------------- 注册 ---------------- */

    // 面板级错误边界:任何渲染异常都不再黑屏,显示错误 + 一键重置记忆
    class PanelErrorBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: '' }; }
      static getDerivedStateFromError(e) { return { err: String((e && e.message) || e) }; }
      componentDidCatch(e) { console.error('[manga-workflow] 面板异常:', e); }
      render() {
        if (this.state.err) {
          return h('div', { style: { padding: '16px', fontSize: '12px', color: '#ff9b9b' } },
            h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, '⚠ 面板出错(已捕获,未黑屏)'),
            h('pre', { style: { whiteSpace: 'pre-wrap', margin: '0 0 10px' } }, this.state.err),
            h('button', {
              type: 'button', style: S.btn,
              onClick: () => {
                try {
                  localStorage.removeItem('manga-desk-view');
                  localStorage.removeItem('manga-desk-page');
                  localStorage.removeItem('manga-desk-folder');
                } catch (e) { /* ignore */ }
                try { location.reload(); } catch (e) { /* ignore */ }
              },
            }, '重置界面记忆并刷新'),
            h('div', { style: { ...S.muted, fontSize: '10px', marginTop: '8px' } },
              '若仍出错,把上面的错误文字发给开发者。'),
          );
        }
        return this.props.children;
      }
    }
    function SafePanel() { return h(PanelErrorBoundary, null, h(HelpGate, null, h(Workbench))); }

    const ICON_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', fontSize: '15px', lineHeight: 1 };
    function PanelIcon() { return h('span', { style: ICON_STYLE, 'aria-hidden': true }, '🎨'); }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, SafePanel),
        );
        // 侧边栏入口 / 启动提示弹窗:必须**同步注册**(异步注册 dock slot 实测不生效),
        // 初值取 localStorage 缓存(避免关闭状态下闪现),随后再用服务端配置校正。
        shell.ctx = ctx;
        const cached = readUiCache() || {};
        applySidebarEntry(cached.sidebarEnabled !== false);
        applyBannerEntry(cached.bannerEnabled !== false);
        fetch(API + '/settings/ui', { headers: {} })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (!d) return;
            applySidebarEntry(d.sidebarEnabled !== false);
            applyBannerEntry(d.bannerEnabled !== false);
            if (typeof d.rememberPathWeb === 'boolean') shell.rememberPathWeb = d.rememberPathWeb;
            writeUiCache({
              sidebarEnabled: d.sidebarEnabled !== false,
              bannerEnabled: d.bannerEnabled !== false,
              rememberPathWeb: d.rememberPathWeb !== false,
            });
          })
          .catch(() => { /* 读配置失败:保留缓存/默认值 */ });
      },
    };
  },
});
