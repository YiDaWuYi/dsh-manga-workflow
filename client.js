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
  const APP_VERSION = 'V1.12.5';

    const React = require('react');
    const h = React.createElement;

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
      const m = b && b.cover;
      if (m === 'keep') return 'overlay';
      if (m === 'overlay' || m === 'erase' || m === 'cover') return m;
      if (b && 'erase' in b) return b.erase ? 'erase' : 'overlay';
      return kindOfBox(b) === 'plain' ? 'overlay' : 'cover';
    };
    const gpuOfBox = (b) => !!(b && (b.gpu !== undefined ? b.gpu : b.lama));

    function Marker({ folder, page, data, mode, setMode, kind, cover, gpu, dirMode,
                       size, autoSize, bodyStyle, sfxStyle, titleStyle, fontByKind,
                       onBoxesChange, onTextEdit }) {
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
      const wrapRef = React.useRef(null);

      React.useEffect(() => {
        setBoxes(Array.isArray(data && data.boxes) ? data.boxes.map((b) => ({ ...b })) : []);
        setUndo([]);
        setEdit(null);
      }, [data && data.page]);

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
      }, [folder, page]);

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
      }, [kind, cover, gpu, dirMode, size, autoSize, bodyStyle, sfxStyle, titleStyle, fontByKind]);

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

      return h('div', null,
        h('div', { style: S.row },
          h('span', { style: S.muted }, `共 ${boxes.length} 框`),
          h('span', { style: { flex: 1 } }),
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
            boxes.map((b, i) => {
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
      ['自动标框', '❌ 不支持', '✅ 支持(自动检测气泡)'],
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
      ['确认嵌字', '✅ 体检 → 校对 → 页面内确认 → 嵌字 → 表单+预览', '✅ 按钮交给网页端执行'],
      ['DSH 接管模式', '✅ 拟声词识别填词 / DSH汉化模式 / 单页识图翻译', '❌ 仅网页端'],
      ['预计消耗', '✅ 点击时显示 ¥ 区间与框数', '❌ 仅网页端'],
      ['页码直达', '✅ [页码]跳/回车', '✅ ◀ [页码] 跳 ▶'],
      ['版本检测', '✅ 启动页每天自动 + 检查更新', '✅ 启动页每天自动 + 检查更新'],
      ['长任务', '异步任务 + 日志轮询', '后台线程 + 状态栏流式进度'],
      ['中断任务', '❌ 只能等它跑完', '✅「取消当前任务」杀进程树'],
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
        '1. 拟声词不要用「GPU 去字(LaMa)」:拟声词大多压在画面、网点、线条上,LaMa 修复会把画面糊成一片,',
        '   效果普遍很差;拟声词建议用「译文直盖」,或按画面情况用「色块覆盖」。',
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
        'Q: 为什么没有自动标框?',
        'A: 网页版暂不支持,请点「启动桌面版」用桌面工具自动标框。',
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
          h('div', { style: boxTitle }, '八·补充、1.10 新标注体系'),
          h(HelpLines, {
            lines: [
              '【类型】正文(绿框) / 无框正文·拟声词(红虚线框) / 标题(蓝框,嵌字居中加粗)',
              '【原文处理】译文直盖 / 抹除 / 色块覆盖;选「抹除」时下方出现「GPU去字」勾选(按框记录)',
              '【框外标注】左上角=类型,右上角=原文处理(直盖/覆盖/抹除·GPU/抹除·普通)',
              '【点选编辑】单击框=选中(黄框),改类型/处理/GPU/方向/字号/样式会立即写回该框',
              '【记忆】每种类型各自记住上次的原文处理/GPU,切换类型自动恢复(仅本次页面会话)',
              '【方向】自动检测 / 竖排 / 横排;【字号】手动 + 自动字号(拟声放大、正文缩到框内)',
              '【拟声词默认】译文直盖(不擦原字);要擦除请把处理改成「抹除」',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '八·补充2、DSH 接管模式与花费'),
          h(HelpLines, {
            lines: [
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
        '【auto 框】自动标框产生的框默认不参与嵌字;可用「本页auto→参与 / 仅补有译文的 / 全书auto参与」批量处理,',
              '或勾「体检时auto参与」让体检自动把有译文的 auto 框纳入。',
              '【嵌字工作区】设置里指定目录:嵌字报告写入工作区 manga_reports/;未设置时启动页会提示。',
            ],
            style: S.muted,
          }),
        ),
        h('div', { style: S.box },
          h('div', { style: boxTitle }, '九、文字样式(正文 / 拟声 / 标题 三组)'),
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
      const saveUi = async (patch) => {
        try {
          const r = await api('/settings/ui', patch);
          if (r) setUiCfg(r);
          const w = await api('/workspace/status');
          setWsExists(!!(w && w.exists));
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
          api('/workspace/status').then((w) => setWsExists(!!(w && w.exists))).catch(() => setWsExists(false));
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
          uiCfg && uiCfg.file
            ? h('div', { style: { ...S.muted, marginTop: '6px', fontSize: '11px' } }, `共享配置:${uiCfg.file}`)
            : null,
        ),
        h('div', { style: { ...S.box, marginTop: '10px' } },
          h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '嵌字工作区(嵌字报告 / 对话汇报)'),
          h('div', { style: { ...S.muted, fontSize: '11px', marginBottom: '6px' } },
            '嵌字完成后会把结果报告写到这个目录(及其 manga_reports/),并生成待汇报队列;未设置时启动页/确认嵌字会提示。'),
          h('div', { style: S.row },
            h('input', {
              style: { ...S.input, minWidth: '320px' },
              placeholder: '例如 E:\\manga-workspace',
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
                  setMsg(r && r.ok ? ('工作区可用:' + r.dir + (r.existed ? '(已存在)' : '(已创建)')) : ('失败:' + ((r && r.error) || '未知')));
                } catch (e) { setMsg('检查失败:' + String(e.message || e)); }
              },
            }, '检查 / 创建'),
            h('span', { style: { ...S.muted, fontSize: '11px' } },
              wsExists ? '● 已就绪' : '○ 未就绪'),
          ),
        ),
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

      const [info, setInfo] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [wsExists, setWsExists] = React.useState(true);
      const [verInfo, setVerInfo] = React.useState(null);
      const [confirmDlg, setConfirmDlg] = React.useState(null);
      const [previewPg, setPreviewPg] = React.useState('');
      const [pfAuto, setPfAuto] = React.useState(false);   // 体检时让有译文的 auto 框参与
      const [activeJobId, setActiveJobId] = React.useState('');   // 当前任务(用于取消)
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
      // 切换会话/重载时保留界面(view + 当前页)
      React.useEffect(() => {
        try { localStorage.setItem('manga-desk-view', view); } catch (e) { /* ignore */ }
      }, [view]);
      React.useEffect(() => {
        try { if (page) localStorage.setItem('manga-desk-page', page); } catch (e) { /* ignore */ }
      }, [page]);
      const [boxes, setBoxes] = React.useState([]);
      const [msg, setMsg] = React.useState('');
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
        setCover(m.cover || KIND_DEFAULT_COVER[k] || 'cover');
        setGpu(!!m.gpu);
      };
      const pickCover = (c) => {
        setCover(c);
        kindMemRef.current[kind] = { ...(kindMemRef.current[kind] || {}), cover: c, gpu };
      };
      const pickGpu = (v) => {
        setGpu(v);
        kindMemRef.current[kind] = { ...(kindMemRef.current[kind] || {}), cover, gpu: v };
      };
      const [dirMode, setDirMode] = React.useState('auto');
      const [size, setSize] = React.useState('20');
      const [autoSize, setAutoSize] = React.useState(true);
      const [bodyStyle, setBodyStyle] = React.useState('body_classic');
      const [sfxStyle, setSfxStyle] = React.useState('sfx_classic');
      const [titleStyle, setTitleStyle] = React.useState('title_bold');
      const [fontByKind, setFontByKind] = React.useState({ body: '', sfx: '', title: '' });
      const [styleOpen, setStyleOpen] = React.useState(true);
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
        api('/workspace/status').then((w) => setWsExists(!!(w && w.exists))).catch(() => setWsExists(true));
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

      async function refresh() {
        if (!folder) return;
        setLoading(true);
        try {
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
            const nb = boxes.map((b, i) => (
              b.auto && tr[i] && String(tr[i]).trim() ? { ...b, auto: false } : b
            ));
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

      async function runJob(step) {
        const { jobId } = await api('/run', { folder, step });
        setActiveJobId(jobId);
        let lastLog = '';
        for (;;) {
          await new Promise((r) => setTimeout(r, 1200));
          const j = await api(`/job?id=${encodeURIComponent(jobId)}`);
          if (j.log && j.log !== lastLog) { lastLog = j.log; setLog(j.log); }
          if (j.status !== 'running') {
            setLog(`[${step}] exit=${j.code}\n${j.log || ''}`);
            return j;
          }
        }
      }

      async function run(step) {
        if (!folder) return;
        setLoading(true);
        setLog(`正在执行 ${step}…`);
        try {
          await runJob(step);
          await refresh();
          if (page) await loadPage(page);
        } catch (e) {
          setLog(String(e.message || e));
        } finally {
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
            + `预计消耗:${money(est)}(仅视觉识别;DSH 翻译走额度)\n`
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
              + `预计消耗:${money(est)}(仅视觉识别;嵌字本身本地免费)\n`
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
        try {
          if (dirtyRef.current) await savePage({ auto: true });
          setMsg('确认嵌字:0% · 嵌字前体检');
          setLog('确认嵌字:0% · 嵌字前体检(对齐/无效译文/艺术字)');
          let pf = {};
          try { pf = await api('/preflight', { folder, page, autoParticipate: pfAuto }); } catch (e) { pf = {}; }
          setMsg('确认嵌字:10% · 嵌字前校对');
          setLog('[进度] 10% · 嵌字前体检完成,开始校对');
          const r = await runJob('proofread');
          const log = (r && r.log) || '';
          const lines = log.split('\n').filter((l) => l.trim());
          const issues = lines.filter((l) => l.startsWith('[问题]')).length;
          const warns = lines.filter((l) => l.startsWith('[提示]')).length;
          const summaryLine = lines.filter((l) => l.trim().startsWith('{')).slice(-1)[0] || '';
          setMsg(`嵌字前校对完成:问题 ${issues} 条 / 提示 ${warns} 条`);
          setConfirmDlg({
            title: '确认嵌字',
            body: `嵌字前体检:对齐 ${pf.aligned || 0} 处 · 缺译文 ${pf.missing_total || 0} 框 · `
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
          setMsg('嵌字中…');
          const r = await runJob('embed');
          await refresh();
          if (page) await loadPage(page);
          const ok = r && r.code === 0;
          const log = (r && r.log) || '';
          const lines = log.split('\n').filter((l) => l.trim());
          setMsg(ok ? '确认嵌字:100% · 完成(已自动校对输出)' : '确认嵌字:失败,请看日志');
          setLog('[进度] 100% · 嵌字结束');
          // 嵌字完成:提交结果表单 + 预览给用户
          const repLine = lines.filter((l) => l.includes('[报告]') || l.includes('[工作区]')).join('\n');
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
            pickCover(cover === 'overlay' ? 'erase' : (cover === 'erase' ? 'cover' : 'overlay'));
            return;
          }
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
                  ? (verInfo.latest && verInfo.current && verInfo.latest !== verInfo.current
                    ? h('span', { style: { color: '#ffb020' } },
                        '版本 v' + verInfo.current + ' · 有新版本 v' + verInfo.latest + ',建议更新' + (verInfo.url ? ':' + verInfo.url : ''))
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
              }, '检查更新')),
          ),
          h('div', { style: S.row },
            h('input', {
              style: { ...S.input, padding: '8px 10px', fontSize: '13px' },
              value: folder,
              placeholder: '漫画文件夹绝对路径(可粘贴,或点「浏览」选择)',
              onChange: (e) => setFolder(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') refresh(); },
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
              onClick: refresh,
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
          h('span', { style: { ...S.muted, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, folder),
        ),
        (!wsExists) ? h('div', { style: { ...S.box, borderColor: 'rgba(255,180,0,0.5)' } },
          h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, '⚠ 嵌字工作区未就绪'),
          h('div', { style: { ...S.muted, fontSize: '11px' } },
            '嵌字报告与对话汇报需要工作区目录。请到「设置 → 嵌字工作区」指定并点「检查/创建」;'
            + '确认嵌字时会再核实一次,缺失会自动创建。'),
        ) : null,
        info ? h('div', { style: S.box },
          h('div', { style: S.row },
            h('span', { style: S.chip }, `页数 ${info.pageCount}`),
            h('span', { style: S.chip }, `框 ${info.boxes}`),
            h('span', { style: S.chip }, `译 ${info.translated}`),
          ),
          h('div', { style: S.row },
            h('button', { type: 'button', style: S.btn, disabled: loading, onClick: () => run('ocr') }, 'OCR'),
            h('button', { type: 'button', style: S.btn, disabled: loading, onClick: () => run('translate') }, '翻译'),
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
            h('button', { type: 'button', style: S.btn, disabled: loading, onClick: () => run('proofread') }, '校对'),
            h('button', { type: 'button', style: S.btn, disabled: loading, onClick: () => run('embed') }, '嵌字'),
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
              title: '把本页所有框设为参与嵌字',
              onClick: () => {
                setBoxes((prev) => prev.map((b) => ({ ...b, auto: false })));
                markDirty();
                setMsg('本页全部框已设为参与嵌字,点「保存」生效');
              },
            }, '本页auto→参与'),
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '只把有译文的 auto 框设为参与',
              onClick: () => {
                const tr = (pageData && pageData.trans) || [];
                setBoxes((prev) => prev.map((b, i) => {
                  const has = !!(tr[i] && String(tr[i]).trim());
                  return has ? { ...b, auto: false } : b;
                }));
                markDirty();
                setMsg('本页有译文的 auto 框已设为参与,点「保存」生效');
              },
            }, '仅补有译文的'),
            h('button', {
              type: 'button', style: S.btn, disabled: loading,
              title: '全书所有「有译文」的 auto 框设为参与嵌字(可能较慢)',
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
                key: c, type: 'button', style: cover === c ? S.btnOn : S.btn,
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
              h('button', {
                type: 'button', style: S.btn, marginLeft: '54px',
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
            mode, setMode, kind, cover, gpu, dirMode, size, autoSize,
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
          }) : null,
          h('div', { style: { ...S.muted, marginTop: '4px' } },
            '单击框 = 编辑属性(选中后改设置实时写回) · 双击框 = 编辑文字(原文/译文) · 左键拖框/自由框选 · 右键删框 · '
            + 'N=切类型 · E=切原文处理(直盖→抹除→覆盖) · V/H=竖/横 · A=自动 · Ctrl+Z 撤销 · Ctrl+S 保存 · ←/→ 翻页'),
        ) : null,
        log ? h('div', { style: S.log }, log) : null,
        // 底部常驻提示(滚动到底也能看到当前进度/消息)
        h('div', {
          style: {
            position: 'sticky', bottom: 0, marginTop: '6px',
            background: 'rgba(32,33,36,0.95)', borderTop: '1px solid rgba(128,128,128,0.35)',
            padding: '4px 8px', fontSize: '11px', color: '#ffd24d',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', zIndex: 5,
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
    function SafePanel() { return h(PanelErrorBoundary, null, h(Workbench)); }

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
