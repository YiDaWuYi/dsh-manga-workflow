/**
 * Manga translation workflow bundle.
 *
 * Registers Host tools that drive the local pipeline scripts:
 *   - manga_ocr    : local Japanese/Korean OCR over every marked box
 *   - manga_embed  : erase + write Chinese (optional GPU LaMa erase)
 *   - manga_status : summarize pages / boxes / translations of a folder
 *
 * The tool definitions are plain `ToolDefinition` objects so the bundle needs no
 * import of DSH-internal packages (a linked local bundle cannot resolve them).
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { ensureProject } from './src/project.js'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createMangaDesk, resolveRuntime } from './src/host.js'

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

export const name = 'manga-workflow'
export const inject = ['tools', 'webServer', 'connection', 'llm']

// 工具链随插件发布(PLUGIN_DIR/scripts);python 自动探测,无需手动配置
const DEFAULT_SCRIPTS = path.join(PLUGIN_DIR, 'scripts')

const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
    },
  },
  render: (_args, value) => [{ type: 'text', text: String(value && value.text !== undefined ? value.text : '') }],
}

function runProcess(cmd, args, env) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let settled = false
    const done = (code) => {
      if (settled) return
      settled = true
      resolve({ code, out, err })
    }
    let child
    try {
      child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true })
    } catch (e) {
      err = String(e)
      done(-1)
      return
    }
    child.stdout?.on('data', (d) => { out += d.toString() })
    child.stderr?.on('data', (d) => { err += d.toString() })
    child.on('error', (e) => { err += String(e); done(-1) })
    child.on('close', (code) => done(typeof code === 'number' ? code : -1))
  })
}

function tail(text, limit) {
  if (!text) return ''
  const s = text.trim()
  return s.length <= limit ? s : `...(截断)\n${s.slice(-limit)}`
}

export function apply(ctx, config = {}) {
  const _rt = resolveRuntime({
    pythonPath: config.pythonPath,
    scriptsDir: config.scriptsDir || DEFAULT_SCRIPTS,
    toolScriptsDir: path.join(PLUGIN_DIR, 'scripts'),
    config,
  })
  const scriptsDir = _rt.scripts.dir
  // 工具也要遵守「源书只读」:数据读写指向项目库(<工作区>/projects/<书名>)
  function dataEnv(folder) {
    try {
      const cfg = path.join(os.homedir(), '.manga-workflow', 'settings.json')
      const ws = String(JSON.parse(readFileSync(cfg, 'utf8')).workspaceDir || '').trim()
      if (ws && folder) return { ...runtimeEnv, MANGA_DATA_DIR: ensureProject(ws, folder).dir }
    } catch (e) { /* 没设工作区/导入失败 → 退回旧行为 */ }
    return { ...runtimeEnv }
  }

  const pythonPath = _rt.python.path
  const workRoot = path.dirname(scriptsDir)
  const runtimeEnv = {
    TORCH_HOME: config.torchHome || path.join(workRoot, '_torchcache'),
    HF_HOME: config.hfHome || path.join(workRoot, '_hfcache'),
    EASYOCR_MODULE_PATH: config.easyocrPath || path.join(workRoot, '_easyocr'),
    PYTHONIOENCODING: 'utf-8',
  }
  const scriptPath = (file) => path.join(scriptsDir, file)

// ---- 新会话提示:仅对「当前嵌字工作区」里的新对话注入,提示 Agent 先读接管说明 ----
// 所有会话(装了插件的用户)都注入的简短手册:告诉 DSH 失败报告该怎么读、怎么给建议
// 面向「使用者」的助手行为约束:只给"怎么解决",不讨论插件内部实现/优化建议
const MANGA_FAILURE_HINT = [
  '本机装有「漫画汉化工作流」插件。凡涉及漫画/嵌字/OCR/翻译的请求:',
  '① 先调用 manga_failures(folder) 取该书的失败报告(与网页面板同一份口径);',
  '② 只按报告里的 class_counts / advisory 给出**怎么解决**的步骤,不要只报“失败 N 框”,也不要给插件内部优化/改代码类建议:',
  '   untranslated(未翻译正文/拟声)→ 让使用者跑「整本 翻译」,或你直接调 manga_dsh_translate;',
  '   noise(页码/水印/UI/小碎框,[noise]/skip_suggested)→ 告诉使用者这些不用管,建议排除;',
  '   decorative(装饰字/目录页)→ OCR 不可靠,建议手工填原文或保留原样;',
  '   suspect(视觉兜底误判空框)→ 告诉使用者可忽略;ocr_empty→ 让对方手填原文或删框;',
  '③ 用平实中文回答,先给结论再给 3 步内可执行的操作(点哪里/说什么);',
  '④ 若这些办法都解决不了(如反复报错、识别严重错误、程序异常):不要擅自改插件代码,',
  '   引导使用者在 B 站视频评论区反馈 BUG(附现象与截图):https://www.bilibili.com/video/BV15Zs86GEz7',
  '⑤ 报告文件在 <工作区>/projects/<书名>/ocr_failure_report.json(+.md),可读来核对。',
].join(' ')

const MANGA_AGENT_HINT = [
  '本机安装了「漫画汉化工作流」插件(manga_* 工具 + 网页工作台)。',
  '接手任何漫画翻译/嵌字任务前,第一步是用 read 工具读取工作区根目录的「DSH-接管说明.md」',
  '(若不存在,先调用 manga_status 了解文件夹,并提示用户到网页设置里点「检查 / 创建」生成)。',
  '按该文件里的目录约定与流程执行:源书只读、数据在 <工作区>/projects/<书名>/、成品输出到 <工作区>/已完成/<书名>/。',
  '源书目录只读;动手改任何数据文件前先备份,并在回复里说明回滚路径。',
].join(' ')

function _normPath(p) {
  return String(p || '').trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
}

// 读双端共享设置里的「嵌字工作区」:~/.manga-workflow/settings.json
function _readMangaWorkspace() {
  try {
    const f = path.join(os.homedir(), '.manga-workflow', 'settings.json')
    if (!existsSync(f)) return ''
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return String(j.workspaceDir || '')
  } catch (e) {
    return ''
  }
}


  // 只在「用户设置的嵌字工作区」里的新会话注入系统提示(其它项目的新对话不受影响)
  try {
    const attachSessionHint = (agent) => {
      try {
        const cwd = _normPath(agent && agent.session && agent.session.header ? agent.session.header.cwd : '')
        const ws = _normPath(_readMangaWorkspace())
        if (!cwd || !ws || cwd !== ws) return
        const prompt = agent.ctx && typeof agent.ctx.get === 'function' ? agent.ctx.get('systemPrompt') : null
        if (!prompt || typeof prompt.section !== 'function') return
        const _stops = []
        // 所有会话:失败报告读法 + 建议口径(短手册)
        _stops.push(prompt.section({
          name: 'manga-workflow:failure-guide',
          order: 3300,
          interpolate: false,
          text: (c) => (c && c.scope === agent ? MANGA_FAILURE_HINT : ''),
        }))
        // 仅嵌字工作区:目录约定 + 先读 DSH-接管说明
        const _inWs = !!(cwd && ws && cwd === ws)
        if (_inWs) {
          _stops.push(prompt.section({
            name: 'manga-workflow:workspace-guide',
            order: 3200,
            interpolate: false,
            text: (c) => (c && c.scope === agent ? MANGA_AGENT_HINT : ''),
          }))
        }
        if (agent.ctx && typeof agent.ctx.effect === 'function') {
          agent.ctx.effect(() => () => { for (const st of _stops) { try { st() } catch (e) {} } })
        }
        console.log('[manga] 已注入会话提示: failure-guide' + (_inWs ? ' + workspace-guide' : '') + ' cwd=' + cwd)
      } catch (e) {
        console.log('[manga] 注入会话提示失败:', e && e.message ? e.message : e)
      }
    }
    if (typeof ctx.on === 'function') ctx.on('agent/created', ({ agent }) => { attachSessionHint(agent) })
  } catch (e) {
    console.log('[manga] 注册会话提示失败:', e && e.message ? e.message : e)
  }

  // 侧边栏工作台的 HTTP 接口
  try {
    let _llm = null
  try { _llm = ctx.get('llm') || null } catch (e) { _llm = null }
  const desk = createMangaDesk({
    llm: _llm, pythonPath, scriptsDir, toolScriptsDir: path.join(PLUGIN_DIR, 'scripts'), runtimeEnv, config, getDirectoryPicker: () => ctx.get('directoryPicker') })
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/manga-desk',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        try {
          const conn = ctx.get('connection')
          if (typeof conn?.requestRejection === 'function') {
            const rejection = conn.requestRejection({ headers: req.headers })
            if (rejection) {
              res.statusCode = rejection
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ error: '未授权' }))
              return
            }
          }
          await desk.handle(req, res, url)
        } catch (e) {
          if (res.headersSent) { res.end(); return }
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: String(e && e.message || e) }))
        }
      },
    }), 'dsh-manga-workflow: /manga-desk routes')
  } catch (e) {
    // 没有 webServer 时(非 Web profile)跳过,工具仍可用
  }

  ctx.tools.register({
    name: 'manga_ocr',
    description: 'Run local Japanese/Korean OCR over every marked box in a manga folder (regions.json) and write ocr_text.json next to it.',
    parameters: {
      folder: {
        type: 'string',
        required: true,
        description: 'Absolute path to the manga image folder that contains regions.json.',
      },
      lang: {
        type: 'string',
        enum: ['ja', 'ko', 'en'],
        description: 'Source language: ja (Manga OCR), ko (EasyOCR) or en (EasyOCR). Defaults to ja.',
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const target = scriptPath('ocr_regions.py')
      if (!existsSync(target)) return { text: `找不到脚本: ${target}` }
      const r = await runProcess(pythonPath, [target, args.folder, '--lang', args.lang || 'ja'], dataEnv(args.folder))
      return { text: [`exit=${r.code}`, tail(r.out, 3000), tail(r.err, 1500)].filter(Boolean).join('\n') }
    },
  })

  ctx.tools.register({
    name: 'manga_embed',
    description: 'Erase the source text and write Chinese translations into a manga folder using trans.json. Supports GPU LaMa erase and preview mode.',
    parameters: {
      folder: {
        type: 'string',
        required: true,
        description: 'Absolute path to the manga image folder that contains regions.json and trans.json.',
      },
      lama: {
        type: 'boolean',
        description: 'Use the GPU LaMa inpainting pipeline (cleaner erase, slower). Defaults to the folder config.json setting.',
      },
      preview: {
        type: 'boolean',
        description: 'Only overlay Chinese on top of the original text to check placement, without erasing.',
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const target = scriptPath('embed_regions.py')
      if (!existsSync(target)) return { text: `找不到脚本: ${target}` }
      const cliArgs = [target, args.folder]
      if (args.lama) cliArgs.push('--lama')
      if (args.preview) cliArgs.push('--preview')
      const r = await runProcess(pythonPath, cliArgs, dataEnv(args.folder))
      return { text: [`exit=${r.code}`, tail(r.out, 3000), tail(r.err, 1500)].filter(Boolean).join('\n') }
    },
  })

  ctx.tools.register({
    name: 'manga_status',
    description: 'Summarize a manga folder: marked pages, total boxes, translated boxes and fully untranslated pages.',
    parameters: {
      folder: {
        type: 'string',
        required: true,
        description: 'Absolute path to the manga image folder.',
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const regionsFile = path.join(args.folder, 'regions.json')
      const transFile = path.join(args.folder, 'trans.json')
      if (!existsSync(regionsFile)) return { text: `缺少 regions.json: ${regionsFile}` }
      let regions
      try {
        regions = JSON.parse(readFileSync(regionsFile, 'utf8'))
      } catch (e) {
        return { text: `regions.json 解析失败: ${String(e)}` }
      }
      let trans = {}
      if (existsSync(transFile)) {
        try { trans = JSON.parse(readFileSync(transFile, 'utf8')) } catch { trans = {} }
      }
      const pages = Object.keys(regions).filter((k) => Array.isArray(regions[k]) && regions[k].length > 0)
      let boxes = 0
      let translated = 0
      const missing = []
      for (const p of pages) {
        boxes += regions[p].length
        const t = Array.isArray(trans[p]) ? trans[p] : []
        const n = t.filter((x) => typeof x === 'string' && x.trim().length > 0).length
        translated += n
        if (n === 0) missing.push(p)
      }
      const lines = [
        `页数(有标框): ${pages.length}`,
        `总框数: ${boxes}`,
        `已翻译: ${translated}`,
        missing.length ? `整页未翻译: ${missing.join(', ')}` : '所有标注页都有翻译',
      ]
      return { text: lines.join('\n') }
    },
  })

  ctx.tools.register({
    name: 'manga_bench',
    description: 'Benchmark automatic box detection against an existing manual regions.json (treated as ground truth). Reports recall, precision and noise rate. Requires GPU.',
    parameters: {
      folder: {
        type: 'string',
        required: true,
        description: 'Absolute path to an already-annotated manga folder (must contain regions.json).',
      },
      all: {
        type: 'boolean',
        description: 'Detect all text instead of bubble text only. Defaults to bubble-only mode.',
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const target = path.join(PLUGIN_DIR, 'scripts', 'bench.py')
      if (!existsSync(target)) return { text: `找不到基准脚本: ${target}` }
      const cliArgs = [target, args.folder, '--tools', scriptsDir]
      if (args.all) cliArgs.push('--all')
      const r = await runProcess(pythonPath, cliArgs, runtimeEnv)
      return { text: [`exit=${r.code}`, tail(r.out, 4000), tail(r.err, 1500)].filter(Boolean).join('\n') }
    },
  })

  ctx.tools.register({
    name: 'manga_dsh_translate',
    description: 'Translate a manga folder using the DSH model via the local bridge (no API key). Writes trans.json. Use for boxes that have no translation yet.',
    parameters: {
      folder: { type: 'string', required: true, description: 'Absolute path to the manga folder.' },
      page: { type: 'string', description: 'Optional page key to translate only that page.' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const hostFile = path.join(os.homedir(), '.manga-workflow', 'host.json')
      let info = {}
      try { info = JSON.parse(readFileSync(hostFile, 'utf8')) } catch (e) { info = {} }
      if (!info.port || !info.token) return { text: 'DSH 本机桥不可用(DSH 未运行或插件未加载)' }
      try {
        const r = await fetch('http://127.0.0.1:' + info.port + '/translate-dsh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-manga-token': info.token },
          body: JSON.stringify({ folder: args.folder, page: args.page || null, overwrite: false }),
        })
        const j = await r.json()
        if (!j.ok) return { text: 'DSH 翻译失败:' + (j.error || ('HTTP ' + r.status)) }
        return { text: 'DSH 翻译完成:' + (j.done || 0) + ' 条' }
      } catch (e) {
        return { text: 'DSH 翻译调用失败:' + String(e && e.message || e) }
      }
    },
  })

  ctx.tools.register({
    name: 'manga_report',
    description: 'Read the pending manga embed report queued by the web panel (workspace pending_report.json) and return it; marks it consumed.',
    parameters: {},
    output: TEXT_OUTPUT,
    async execute() {
      const uiFile = path.join(os.homedir(), '.manga-workflow', 'settings.json')
      let ws = ''
      try { ws = String(JSON.parse(readFileSync(uiFile, 'utf8')).workspaceDir || '') } catch (e) { ws = '' }
      if (!ws) return { text: '未设置嵌字工作区(网页端 设置 → 嵌字工作区)。' }
      const pending = path.join(ws, 'pending_report.json')
      if (!existsSync(pending)) return { text: '没有待汇报的嵌字报告。' }
      let info = {}
      try { info = JSON.parse(readFileSync(pending, 'utf8')) } catch (e) { info = {} }
      let body = ''
      try { body = readFileSync(String(info.report || ''), 'utf8') } catch (e) { body = '' }
      try { renameSync(pending, pending + '.done') } catch (e) { /* ignore */ }
      const txt = (info.folder ? '书:' + info.folder + '\n' : '')
        + (info.at ? '时间:' + info.at + '\n' : '')
        + (body ? '\n' + body.slice(-6000) : '(报告文件缺失)')
      return { text: txt }
    },
  })

  // OCR/翻译失败报告:DSH 直接读,用于接管「哪些框没认出来 / 没译文」
  ctx.tools.register({
    name: 'manga_failures',
    description: 'Read the OCR/translation failure report of a manga folder (boxes with empty OCR, failed vision fallback, or missing translation). Generates it on demand by running failure_report.py. Use this when the user says OCR produced nothing / some boxes are untranslated.',
    parameters: {
      folder: { type: 'string', required: true, description: 'Absolute path to the manga folder (the book folder, not the project dir).' },
      limit: { type: 'number', description: 'How many failure items to list. Default 40.' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      let dataDir = String(args.folder || '')
      try {
        const uiFile = path.join(os.homedir(), '.manga-workflow', 'settings.json')
        const ws = String(JSON.parse(readFileSync(uiFile, 'utf8')).workspaceDir || '')
        if (ws) {
          const p = ensureProject(ws, args.folder)
          try { dataDir = p.dir } catch (e) { dataDir = p.dir || dataDir }
        }
      } catch (e) { /* 退回用书目录 */ }
      const scriptPath = path.join(DEFAULT_SCRIPTS, 'failure_report.py')
      const rt = (() => { try { return resolveRuntime() } catch (e) { return null } })()
      const pyPath = rt && rt.python && rt.python.path
      if (pyPath && /\.exe$/i.test(pyPath) && existsSync(pyPath) && existsSync(scriptPath)) {
        try {
          await runProcess(pyPath, [scriptPath, args.folder],
            { MANGA_DATA_DIR: dataDir, PYTHONIOENCODING: 'utf-8' })
        } catch (e) { /* 报告生成失败时继续尝试读旧报告 */ }
      }
      const jp = path.join(dataDir, 'ocr_failure_report.json')
      if (!existsSync(jp)) return { text: '还没有失败报告(先跑一次 OCR 或视觉兜底):' + jp }
      let rep = null
      try { rep = JSON.parse(readFileSync(jp, 'utf8')) } catch (e) { return { text: '失败报告解析失败: ' + String(e) } }
      const c = rep.failure_counts || {}
      const lim = Math.max(1, Math.min(200, Number(args.limit) || 40))
      const lines = [
        '书: ' + (rep.book || args.folder),
        '数据目录: ' + (rep.data_dir || dataDir),
        '生成时间: ' + (rep.generated_at || ''),
        '扫描页 ' + (rep.pages_scanned || 0) + ' / 框 ' + (rep.boxes_total || 0) + ' / 失败 ' + (rep.failures_total || 0),
        '分类: OCR空 ' + (c.ocr_empty || 0) + ' · 兜底失败 ' + (c.fallback_failed || 0)
          + ' · 疑似错 ' + (c.ocr_suspect || 0) + ' · 缺译文 ' + (c.trans_missing || 0),
        '',
      ]
      for (const it of (rep.items || []).slice(0, lim)) {
        const b = it.box || {}
        lines.push(`- ${it.page}[${it.index}] ${b.x},${b.y},${b.w},${b.h} ${it.kind || ''} ${it.reason}${it.cls ? ' [' + it.cls + ']' : ''}: 原文「${it.ocr || ''}」 译文「${it.trans || ''}」`)
      }
      if ((rep.items || []).length > lim) lines.push(`… 还有 ${rep.items.length - lim} 条,完整见 ` + jp)
      const cc = rep.class_counts || {}
      if (cc.untranslated || cc.noise || cc.decorative || cc.suspect) {
        lines.push('', '细分: 未翻译 ' + (cc.untranslated || 0) + ' · 噪音(建议排除) ' + (cc.noise || 0)
          + ' · 装饰字 ' + (cc.decorative || 0) + ' · 疑似误判 ' + (cc.suspect || 0))
      }
      const adv = Array.isArray(rep.advisory) ? rep.advisory : []
      if (adv.length) {
        lines.push('', '处理建议(与网页面板一致):')
        for (const a of adv) if (a && a[1]) lines.push('  · ' + a[0] + ' ' + a[1] + ' 条:' + a[2])
      } else {
        lines.push('', '处理建议: OCR空/兜底失败→手填原文或换框;缺译文→跑翻译或手填译文。')
      }
      return { text: lines.join('\n') }
    },
  })
}

  // 插件卸载/重载时关闭本机翻译桥
  try {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => { try { desk.stopDshBridge && desk.stopDshBridge() } catch (e) { /* ignore */ } })
    }
  } catch (e) { /* ignore */ }
