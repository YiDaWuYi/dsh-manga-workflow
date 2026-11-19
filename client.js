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
  const APP_VERSION = 'V1.7';

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

    function StyleChips({ presets, value, onChange, glyph }) {
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
            h('span', { style: styleCss(p, 19) }, glyph),
            h('span', { style: { fontSize: '9px', opacity: 0.75 } }, p.label),
          );
        }),
      );
    }

    function Marker({ folder, page, data, mode, setMode, vertical, size, sfx, erase, bodyStyle, sfxStyle, onBoxesChange, onTextEdit }) {
      const [boxes, setBoxes] = React.useState([]);
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
        if (paint && paint.length) {
          const xs = paint.map((p) => p.x);
          const ys = paint.map((p) => p.y);
          const x0 = Math.min(...xs), y0 = Math.min(...ys);
          const w = Math.max(...xs) - x0, hh = Math.max(...ys) - y0;
          pushUndo(boxes);
          if (w >= 4 && hh >= 4) {
            setBoxes((prev) => [...prev, {
              x: x0, y: y0, w, h: hh,
              vertical: !!vertical, size: Number(size) || 20,
              erase: !!erase, sfx: !!sfx,
              style: sfx ? sfxStyle : bodyStyle,
              color: 'black', outline: true,
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
          x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh),
          vertical: !!vertical, size: Number(size) || 20,
          erase: !!erase, sfx: !!sfx,
          style: sfx ? sfxStyle : bodyStyle,
          color: 'black', outline: true,
        }]);
      };

      const hit = (p) => {
        for (let i = boxes.length - 1; i >= 0; i--) {
          const b = boxes[i];
          if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
        }
        return -1;
      };

      const onRight = (e) => {
        e.preventDefault();
        const i = hit(pos(e));
        if (i >= 0) {
          pushUndo(boxes);
          setBoxes((prev) => prev.filter((_, k) => k !== i));
        }
      };

      const onDouble = (e) => {
        const i = hit(pos(e));
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
            boxes.map((b, i) => h('div', {
              key: `b${i}`,
              style: {
                position: 'absolute',
                left: pct(b.x, natural.w), top: pct(b.y, natural.h),
                width: pct(b.w, natural.w), height: pct(b.h, natural.h),
                border: b.sfx ? '2px solid #ff4d4d' : '2px solid #00d000',
                background: b.sfx ? 'rgba(255,77,77,0.10)' : 'rgba(0,208,0,0.08)',
                boxSizing: 'border-box', pointerEvents: 'none',
              },
            }, h('span', {
              style: {
                position: 'absolute', left: 1, top: 1, fontSize: '10px', padding: '0 2px',
                color: b.sfx ? '#ff4d4d' : '#00d000', background: 'rgba(0,0,0,0.45)',
              },
            }, b.sfx ? '拟声' : '正文'))),
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
      ['标框', '框选 / 涂抹', '框选 / 涂抹'],
      ['撤销', '多步(最多 40 步,Ctrl+Z)', '完整栈(Ctrl+Z)'],
      ['双击改字', '弹窗改原文/译文', '弹窗改原文/译文'],
      ['自动标框', '❌ 不支持', '✅ 支持(自动检测气泡)'],
      ['一键识别', '❌ 不支持', '✅ 支持(标框+OCR)'],
      ['重标同步', '❌ 不支持', '✅ 整本 OCR→翻译→校对'],
      ['引擎帮助/修复', '❌ 不支持', '✅ 检测 + 复制修复关键词'],
      ['翻译设置', '读插件配置(不能界面改)', '✅ 引擎多选 + 代理'],
      ['校对模式', '固定「原文+译文」', '✅ 可切「只校原文」'],
      ['自动字号/横竖', '❌ 不支持', '✅ 可开关'],
      ['GPU去字', '读本子 config.json', '✅ 勾选切换'],
      ['缩放/拖动画面', '❌ 自适应铺满', '✅ 适配窗口'],
      ['文件选择', '✅「浏览…」系统对话框 / 粘贴路径', '✅ 系统浏览对话框'],
      ['视觉引擎(设置)', '✅ 两端共用同一份配置', '✅ 同一份配置'],
      ['侧边栏/提示开关', '✅ 设置里可开关(共享)', '✅ 改同一份共享配置'],
      ['互相启动', '✅ 一键「启动桌面版」', '—'],
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
        '2. 工作台里画框(框选或涂抹),选好竖排/横排、字号、是否拟声词',
        '3. 点 OCR 识别原文 → 4. 点 翻译 → 5. 点 校对 → 6. 点 嵌字',
        '7. 改动后点「保存」(Ctrl+S);换页会丢掉未保存的改动',
        '8. 需要精细标注时点「启动桌面版」切到桌面工具(桌面端可「取消当前任务」)',
      ];
      const MOUSE = [
        '左键拖动:画框 / 涂抹',
        '右键:删除点中的框',
        '双击框:编辑原文/译文',
        'B 框选 · P 涂抹 · V 竖排 · H 横排 · N 拟声词 · E 抹除原文',
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

      const FAQ = [
        'Q: 点 OCR/翻译后很久没反应?',
        'A: 任务是异步的,看下方日志滚动;整本 OCR 通常 1-3 分钟。',
        '',
        'Q: 翻译很慢或失败?',
        'A: 没配代理时 Google 会超时,会自动回退到 MyMemory;可在桌面版「翻译设置」配代理。',
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
        'Q: 换成免费模型后 AI 还是看不到图?',
        'A: 先点「测试识图」看是否通过;通过后重开一次对话,识图才会用上新配置。',
      ];

      return h('div', { style: S.root },
        h('div', { style: S.row },
          h('button', { type: 'button', style: S.btn, onClick: onBack }, '← 返回'),
          h('span', { style: { fontWeight: 600, fontSize: '14px' } }, '使用说明'),
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
          h('div', { style: boxTitle }, '八、文字样式(正文 / 拟声词)'),
          h(HelpLines, {
            lines: [
              '工作台里有两排样式按钮,按钮上直接画出渲染效果(和最终嵌字一致):',
              '',
              '【正文样式】经典(黑字白边)· 极简(纯黑)· 细边 · 加粗 · 反白(白字黑边)· 投影',
              '【拟声样式】漫画(黑字白边+影)· 反白 · 燃红 · 亮黄 · 热橙 · 冷蓝',
              '',
              '· 点一下选中(高亮),之后新画的框使用它;',
              '· 改已有框:选好样式 → 点「应用到本页」→ 再保存;',
              '· 拟声样式只作用于勾了「拟声(N)」的框;',
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
      const [setup, setSetup] = React.useState(null);
      const [setupLog, setSetupLog] = React.useState('');
      const [setupBusy, setSetupBusy] = React.useState('');
      const [cost, setCost] = React.useState(null);
      const [ocrCfg, setOcrCfg] = React.useState(null);
      const [ocrMin, setOcrMin] = React.useState('1');
      const [ocrMax, setOcrMax] = React.useState('30');
      const [priceIn, setPriceIn] = React.useState(() => {
        try { const p = JSON.parse(localStorage.getItem('manga-desk-prices') || '{}'); return p.in == null ? '' : String(p.in); } catch (e) { return ''; }
      });
      const [priceOut, setPriceOut] = React.useState(() => {
        try { const p = JSON.parse(localStorage.getItem('manga-desk-prices') || '{}'); return p.out == null ? '' : String(p.out); } catch (e) { return ''; }
      });

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
      }, []);

      React.useEffect(() => {
        const q = folder ? ('?folder=' + encodeURIComponent(folder)) : '';
        api('/cost' + q).then(setCost).catch(() => setCost(null));
        api('/settings/ocr').then((d) => {
          setOcrCfg(d);
          setOcrMin(String(d.minChars));
          setOcrMax(String(d.maxPerBook));
        }).catch(() => setOcrCfg(null));
      }, [folder]);

      async function saveOcrCfg(patch) {
        try {
          const r = await api('/settings/ocr', patch);
          if (r && r.settings) {
            setOcrCfg(r.settings);
            setOcrMin(String(r.settings.minChars));
            setOcrMax(String(r.settings.maxPerBook));
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
        api('/settings/ui').then(setUiCfg).catch(() => setUiCfg(null));
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
          h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '界面选项'),
          h('div', { style: S.row },
            h('span', { style: label }, 'DSH 侧边栏'),
            h('button', {
              type: 'button',
              style: uiCfg && uiCfg.sidebarEnabled ? S.btnOn : S.btn,
              disabled: !uiCfg,
              onClick: () => toggleUi('sidebarEnabled'),
              title: '是否在 DSH 左侧边栏显示「漫画工作台」入口',
            }, uiCfg ? (uiCfg.sidebarEnabled ? '已显示(点击关闭)' : '已隐藏(点击开启)') : '读取中…'),
            h('span', { style: { ...S.muted, fontSize: '11px' } }, '双端共享,桌面版的设置改的是同一项'),
          ),
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
                    h('button', {
                      type: 'button', style: S.btn, disabled: !!setupBusy,
                      onClick: () => installDeps('base'),
                    }, setupBusy === 'base' ? '安装中…' : '装基础依赖'),
                    h('button', {
                      type: 'button', style: S.btn, disabled: !!setupBusy,
                      onClick: () => installDeps('ocr'),
                    }, setupBusy === 'ocr' ? '安装中…' : '装 OCR 依赖(含 torch,大)'),
                    h('button', {
                      type: 'button', style: S.btn, disabled: !!setupBusy,
                      onClick: () => installDeps('gpu'),
                    }, setupBusy === 'gpu' ? '安装中…' : '装 GPU 去字(可选)'),
                  ),
                  h('div', { style: { ...S.muted, fontSize: '10px', marginTop: '2px' } },
                    '首次使用请先「装基础依赖」;要本地 OCR 再装 OCR 依赖(约 2GB);GPU 去字可选。'
                    + ' 依赖会装到插件目录下的 _venv 里,不影响系统 Python。'),
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
      const [view, setView] = React.useState('home');   // home | work
      const [folder, setFolder] = React.useState(() => {
        try { return localStorage.getItem('manga-desk-folder') || ''; } catch { return ''; }
      });
      const [infra, setInfra] = React.useState(null);
      const [vision, setVision] = React.useState(null);

      const [info, setInfo] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [log, setLog] = React.useState('');
      const [page, setPage] = React.useState('');
      const [pageData, setPageData] = React.useState(null);
      const [boxes, setBoxes] = React.useState([]);
      const [msg, setMsg] = React.useState('');
      const textEdits = React.useRef(new Map());

      // 与桌面版一致的操作状态
      const [mode, setMode] = React.useState('box');
      const [vertical, setVertical] = React.useState(true);
      const [size, setSize] = React.useState('20');
      const [sfx, setSfx] = React.useState(false);
      const [erase, setErase] = React.useState(true);
      const [bodyStyle, setBodyStyle] = React.useState('body_classic');
      const [sfxStyle, setSfxStyle] = React.useState('sfx_classic');
      const [stylePresets, setStylePresets] = React.useState(null);

      // 文字样式预设
      React.useEffect(() => {
        api('/styles').then((d) => {
          const ps = (d && d.presets) || [];
          setStylePresets(ps);
          const body = ps.filter((p) => p.kind === 'body');
          const sfxList = ps.filter((p) => p.kind === 'sfx');
          if (body.length && !body.some((p) => p.id === bodyStyle)) setBodyStyle(body[0].id);
          if (sfxList.length && !sfxList.some((p) => p.id === sfxStyle)) setSfxStyle(sfxList[0].id);
        }).catch(() => setStylePresets([]));
      }, []);

      // 启动页:引擎检测 + 视觉引擎状态
      React.useEffect(() => {
        api('/infra').then(setInfra).catch(() => setInfra(null));
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

      async function loadPage(p) {
        setPage(p);
        try {
          const d = await api(`/regions?folder=${encodeURIComponent(folder)}&page=${encodeURIComponent(p)}`);
          setPageData({ ...d, page: p });
        } catch (e) {
          setMsg(String(e.message || e));
        }
      }

      async function run(step) {
        if (!folder) return;
        setLoading(true);
        setLog(`正在执行 ${step}…`);
        try {
          const { jobId } = await api('/run', { folder, step });
          let lastLog = '';
          for (;;) {
            await new Promise((r) => setTimeout(r, 1200));
            const j = await api(`/job?id=${encodeURIComponent(jobId)}`);
            if (j.log && j.log !== lastLog) { lastLog = j.log; setLog(j.log); }
            if (j.status !== 'running') { setLog(`[${step}] exit=${j.code}\n${j.log || ''}`); break; }
          }
          await refresh();
          if (page) await loadPage(page);
        } catch (e) {
          setLog(String(e.message || e));
        } finally {
          setLoading(false);
        }
      }

      async function savePage() {
        if (!folder || !page) return;
        try {
          const edits = [...textEdits.current.entries()].map(([i, v]) => ({ i, orig: v.orig, trans: v.trans }));
          await api('/save', { folder, page, boxes, edits });
          textEdits.current.clear();
          setMsg(edits.length ? `已保存(含 ${edits.length} 处文本修改)` : '已保存');
          await refresh();
        } catch (e) {
          setMsg(String(e.message || e));
        }
      }

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
          if (k === 'v' || k === 'V') { setVertical(true); return; }
          if (k === 'h' || k === 'H') { setVertical(false); return; }
          if (k === 'n' || k === 'N') { setSfx((v) => !v); return; }
          if (k === 'e' || k === 'E') { setErase((v) => !v); return; }
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
          h('button', { type: 'button', style: S.btn, onClick: () => setView('home') }, '← 主页'),
          h('button', { type: 'button', style: S.btn, onClick: () => setView('settings') }, '设置'),
          h('button', { type: 'button', style: S.btn, onClick: () => setView('help') }, '帮助'),
          h('span', { style: { fontWeight: 600, fontSize: '13px' } }, '漫画工作台'),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { ...S.muted, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, folder),
        ),
        info ? h('div', { style: S.box },
          h('div', { style: S.row },
            h('span', { style: S.chip }, `页数 ${info.pageCount}`),
            h('span', { style: S.chip }, `框 ${info.boxes}`),
            h('span', { style: S.chip }, `译 ${info.translated}`),
          ),
          h('div', { style: S.row },
            h('button', { type: 'button', style: S.btn, disabled: loading, onClick: () => run('ocr') }, 'OCR'),
            h('button', { type: 'button', style: S.btn, disabled: loading, onClick: () => run('translate') }, '翻译'),
            h('button', { type: 'button', style: S.btn, disabled: loading, onClick: () => run('proofread') }, '校对'),
            h('button', { type: 'button', style: S.btn, disabled: loading, onClick: () => run('embed') }, '嵌字'),
          ),
        ) : null,
        msg ? h('div', { style: { ...S.muted, marginBottom: '6px' } }, msg) : null,
        info && pages.length ? h('div', null,
          h('div', { style: S.row },
            h('button', { type: 'button', style: S.btn, onClick: () => idx > 0 && loadPage(pages[idx - 1].page) }, '◀'),
            h('span', { style: { flex: 1, textAlign: 'center' } }, page || '-'),
            h('button', { type: 'button', style: S.btn, onClick: () => idx >= 0 && idx < pages.length - 1 && loadPage(pages[idx + 1].page) }, '▶'),
            h('button', { type: 'button', style: S.btn, onClick: savePage }, '保存'),
          ),
          h('div', { style: S.row },
            h('button', { type: 'button', style: mode === 'box' ? S.btnOn : S.btn, title: 'B', onClick: () => setMode('box') }, '框选(B)'),
            h('button', { type: 'button', style: mode === 'paint' ? S.btnOn : S.btn, title: 'P', onClick: () => setMode('paint') }, '涂抹(P)'),
            h('button', { type: 'button', style: vertical ? S.btnOn : S.btn, title: 'V', onClick: () => setVertical(true) }, '竖(V)'),
            h('button', { type: 'button', style: !vertical ? S.btnOn : S.btn, title: 'H', onClick: () => setVertical(false) }, '横(H)'),
            h('span', null, '字号'),
            h('input', { style: { ...S.input, flex: '0 0 52px', minWidth: 0 }, value: size, onChange: (e) => setSize(e.target.value) }),
            h('button', { type: 'button', style: sfx ? S.btnOn : S.btn, title: 'N', onClick: () => setSfx((v) => !v) }, sfx ? '拟声(N)✓' : '拟声(N)'),
            h('button', { type: 'button', style: erase ? S.btnOn : S.btn, title: 'E', onClick: () => setErase((v) => !v) }, erase ? '抹除(E)✓' : '抹除(E)'),
          ),
          h('div', { style: { ...S.row, alignItems: 'center' } },
            h('span', { style: { fontSize: '11px', color: '#888', width: '54px' } }, '正文样式'),
            h(StyleChips, {
              presets: (stylePresets || []).filter((p) => p.kind === 'body'),
              value: bodyStyle, onChange: setBodyStyle, glyph: '正',
            }),
          ),
          h('div', { style: { ...S.row, alignItems: 'center' } },
            h('span', { style: { fontSize: '11px', color: '#888', width: '54px' } }, '拟声样式'),
            h(StyleChips, {
              presets: (stylePresets || []).filter((p) => p.kind === 'sfx'),
              value: sfxStyle, onChange: setSfxStyle, glyph: '音',
            }),
            h('button', {
              type: 'button', style: { ...S.btn, marginLeft: '6px' },
              title: '把当前样式应用到本页所有框',
              onClick: () => {
                setBoxes((prev) => prev.map((b) => ({
                  ...b,
                  style: b.sfx ? sfxStyle : bodyStyle,
                })));
                setMsg('已把样式应用到本页所有框,点「保存」生效');
              },
            }, '应用到本页'),
          ),
          pageData ? h(Marker, {
            folder, page, data: pageData,
            mode, setMode, vertical, size, sfx, erase, bodyStyle, sfxStyle,
            onBoxesChange: setBoxes,
            onTextEdit: (i, orig, trans) => { textEdits.current.set(i, { orig, trans }); },
          }) : null,
          h('div', { style: { ...S.muted, marginTop: '4px' } },
            '快捷键:B 框选 · P 涂抹 · V 竖 · H 横 · N 拟声 · E 抹除 · Ctrl+Z 撤销 · Ctrl+S 保存 · ←/→ 翻页 · 右键删框 · 双击改字'),
        ) : null,
        log ? h('div', { style: S.log }, log) : null,
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

    const ICON_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', fontSize: '15px', lineHeight: 1 };
    function PanelIcon() { return h('span', { style: ICON_STYLE, 'aria-hidden': true }, '🎨'); }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, Workbench),
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
