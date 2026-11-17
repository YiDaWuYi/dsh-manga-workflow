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
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const name = 'manga-workflow'
export const inject = ['tools']

const DEFAULT_SCRIPTS = 'E:/manga_tool'
const DEFAULT_PYTHON = 'E:/_venv/Scripts/python.exe'

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
  const scriptsDir = config.scriptsDir || DEFAULT_SCRIPTS
  const pythonPath = config.pythonPath || DEFAULT_PYTHON
  const workRoot = path.dirname(scriptsDir)
  const runtimeEnv = {
    TORCH_HOME: config.torchHome || path.join(workRoot, '_torchcache'),
    HF_HOME: config.hfHome || path.join(workRoot, '_hfcache'),
    EASYOCR_MODULE_PATH: config.easyocrPath || path.join(workRoot, '_easyocr'),
    PYTHONIOENCODING: 'utf-8',
  }
  const scriptPath = (file) => path.join(scriptsDir, file)

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
        enum: ['ja', 'ko'],
        description: 'Source language: ja (Manga OCR) or ko (EasyOCR). Defaults to ja.',
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
}
