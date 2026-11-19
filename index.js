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
  const pythonPath = _rt.python.path
  const workRoot = path.dirname(scriptsDir)
  const runtimeEnv = {
    TORCH_HOME: config.torchHome || path.join(workRoot, '_torchcache'),
    HF_HOME: config.hfHome || path.join(workRoot, '_hfcache'),
    EASYOCR_MODULE_PATH: config.easyocrPath || path.join(workRoot, '_easyocr'),
    PYTHONIOENCODING: 'utf-8',
  }
  const scriptPath = (file) => path.join(scriptsDir, file)

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
      const r = await runProcess(pythonPath, [target, args.folder, '--lang', args.lang || 'ja'], runtimeEnv)
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
      const r = await runProcess(pythonPath, cliArgs, runtimeEnv)
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
}

  // 插件卸载/重载时关闭本机翻译桥
  try {
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => { try { desk.stopDshBridge && desk.stopDshBridge() } catch (e) { /* ignore */ } })
    }
  } catch (e) { /* ignore */ }
