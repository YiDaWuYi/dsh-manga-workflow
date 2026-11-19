/**
 * Host half of the manga workbench: serves /manga-desk/* routes used by the
 * sidebar panel and runs the local workflow scripts on request.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { deflateSync } from 'node:zlib'

const EXTS = ['.webp', '.png', '.jpg', '.jpeg', '.bmp']

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function loadJson(file) {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function listPages(folder) {
  let files = []
  try {
    files = readdirSync(folder)
  } catch {
    return []
  }
  return files
    .filter((f) => EXTS.some((e) => f.toLowerCase().endsWith(e)))
    .sort()
    .map((f) => ({ page: f.replace(/\.[^.]+$/, ''), file: f }))
}

function runProcess(pythonPath, args, env, onData) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    const finish = (code) => {
      if (done) return
      done = true
      resolve({ code, out, err })
    }
    let child
    try {
      child = spawn(pythonPath, args, { env: { ...process.env, ...env }, windowsHide: true })
    } catch (e) {
      finish(-1)
      err = String(e)
      return
    }
    const push = (d) => {
      const t = d.toString()
      out += t
      if (onData) { try { onData(t) } catch {} }
    }
    child.stdout?.on('data', push)
    child.stderr?.on('data', (d) => { err += d.toString() })
    child.on('error', (e) => { err += String(e); finish(-1) })
    child.on('close', (code) => finish(typeof code === 'number' ? code : -1))
  })
}

function readBody(req, limit = 8_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** CRC32(用于 PNG chunk)。 */
function crc32(buf) {
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

/**
 * 生成一张"白底 + 绿色向上三角形"的 PNG,用于验证模型是否真能看图。
 * 不依赖任何图像库,纯 Buffer + zlib。
 */
function makeVisionTestPng(size = 128) {
  const w = size
  const h = size
  const stride = w * 3 + 1
  const raw = Buffer.alloc(stride * h)
  const topY = Math.round(h * 0.10)
  const botY = Math.round(h * 0.90)
  const cx = w / 2
  const maxHalf = w / 2 - Math.round(w * 0.10)
  for (let y = 0; y < h; y++) {
    const row = y * stride
    raw[row] = 0
    const t = (y - topY) / (botY - topY)
    const inside = y >= topY && y <= botY
    const half = inside ? t * maxHalf : -1
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3
      const isTriangle = inside && Math.abs(x - cx) <= half
      if (isTriangle) {
        raw[o] = 0
        raw[o + 1] = 170
        raw[o + 2] = 60
      } else {
        raw[o] = 255
        raw[o + 1] = 255
        raw[o + 2] = 255
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // color type: truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------- 运行环境探测(自带工具链 + Python) ----------------
const REQUIRED_SCRIPTS = ['ocr_regions.py', 'embed_regions.py', 'translate.py',
  'proofread.py', 'styles.py', 'styles.json']

const DEP_MODULES = [
  { pkg: 'PIL', tier: 'base', label: '图像处理(Pillow)' },
  { pkg: 'numpy', tier: 'base', label: 'numpy' },
  { pkg: 'cv2', tier: 'base', label: '图像匹配(OpenCV)' },
  { pkg: 'requests', tier: 'base', label: '网络请求(requests)' },
  { pkg: 'torch', tier: 'ocr', label: 'PyTorch(本地 OCR)' },
  { pkg: 'manga_ocr', tier: 'ocr', label: '日文 OCR(manga-ocr)' },
  { pkg: 'easyocr', tier: 'ocr', label: '韩英 OCR(easyocr)' },
  { pkg: 'iopaint', tier: 'gpu', label: 'GPU 去字(iopaint)' },
]

const _PY_CACHE = new Map()

function probePython(cmd) {
  try {
    const out = execFileSync(cmd, ['-c', 'import sys;print("%d.%d" % sys.version_info[:2])'],
      { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const [maj, min] = out.split('.').map(Number)
    if (maj === 3 && min >= 9) return { path: cmd, version: out }
  } catch (e) { /* 不可用 */ }
  return null
}

function pythonCandidates({ pythonPath, pluginDir }) {
  const out = []
  const add = (p, source) => { if (p) out.push({ path: p, source }) }
  add(pythonPath, '插件配置')
  add(process.env.DSH_MANGA_PYTHON, '环境变量 DSH_MANGA_PYTHON')
  if (pluginDir) {
    add(path.join(pluginDir, '_venv', 'Scripts', 'python.exe'), '插件内置环境')
    add(path.join(pluginDir, '_venv', 'bin', 'python'), '插件内置环境')
    add(path.join(pluginDir, '..', '..', '_venv', 'Scripts', 'python.exe'), '相邻 _venv')
    add(path.join(pluginDir, '..', '_venv', 'Scripts', 'python.exe'), '相邻 _venv')
  }
  add('python', '系统 PATH')
  add('python3', '系统 PATH')
  add('py', '系统 PATH')
  return out
}

function isCommandName(p) {
  return !path.isAbsolute(p) && !p.includes('/') && !p.includes('\\')
}

/** 探测可用的 Python:优先插件内置 venv → 配置 → 环境变量 → 系统 PATH。 */
export function resolveRuntime({ pythonPath, scriptsDir, toolScriptsDir, config, refresh } = {}) {
  const cfg = config || {}
  const pluginDir = toolScriptsDir ? path.dirname(toolScriptsDir) : null
  const cacheKey = [pythonPath, pluginDir].join('|')
  let py = refresh ? null : _PY_CACHE.get(cacheKey)
  if (!py) {
    py = { path: cfg.pythonPath || 'python', version: '', source: '未找到', ok: false }
    for (const c of pythonCandidates({ pythonPath: cfg.pythonPath || pythonPath, pluginDir })) {
      if (!isCommandName(c.path) && !existsSync(c.path)) continue
      if (existsSync(c.path) || isCommandName(c.path)) {
        const p = probePython(c.path)
        if (p) {
          py = { ...p, source: c.source, ok: true }
          break
        }
      }
    }
    _PY_CACHE.set(cacheKey, py)
  }
  // 脚本目录:配置里若有完整工具链则用配置,否则用插件自带
  let sd = { dir: scriptsDir || '', source: '插件配置' }
  if (!sd.dir || !existsSync(path.join(sd.dir, 'ocr_regions.py'))) {
    sd = { dir: path.join(pluginDir || '.', 'scripts'), source: '插件自带' }
  }
  return { python: py, scripts: sd, pluginDir }
}

/** 检查依赖包(用 importlib.util.find_spec,不会真的加载 torch)。 */
export function checkDeps(pythonPath) {
  const code = 'import importlib.util,json;mods=' + JSON.stringify(DEP_MODULES.map((d) => d.pkg)) +
    ';print(json.dumps({m: bool(importlib.util.find_spec(m)) for m in mods}))'
  let map = {}
  try {
    const out = execFileSync(pythonPath, ['-c', code],
      { encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const lines = out.trim().split('\n')
    map = JSON.parse(lines[lines.length - 1])
  } catch (e) {
    map = {}
  }
  return DEP_MODULES.map((d) => ({ ...d, ok: !!map[d.pkg] }))
}

/** 读图片宽高(用 venv 的 PIL,结果按「路径+大小+修改时间」缓存)。 */
const IMAGE_SIZE_CACHE = new Map()
function imageSizeOf(pythonPath, file) {
  try {
    const st = statSync(file)
    const key = file + '|' + st.size + '|' + st.mtimeMs
    const hit = IMAGE_SIZE_CACHE.get(key)
    if (hit) return hit
    const out = execFileSync(
      pythonPath,
      ['-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]);print(im.size[0], im.size[1])', file],
      { encoding: 'utf8', timeout: 20000, windowsHide: true },
    )
    const parts = out.trim().split(/\s+/)
    const r = { w: parseInt(parts[0], 10) || 0, h: parseInt(parts[1], 10) || 0 }
    IMAGE_SIZE_CACHE.set(key, r)
    return r
  } catch (e) {
    return { w: 0, h: 0 }
  }
}

export function createMangaDesk({ pythonPath: pythonPathCfg, scriptsDir: scriptsDirCfg, toolScriptsDir, runtimeEnv, config, getDirectoryPicker }) {
  const _rt0 = resolveRuntime({ pythonPath: pythonPathCfg, scriptsDir: scriptsDirCfg, toolScriptsDir, config })
  const pythonPath = _rt0.python.path
  const scriptsDir = _rt0.scripts.dir
  const PLUGIN_DIR = _rt0.pluginDir
  const scriptPath = (f) => path.join(scriptsDir, f)
  const toolPath = (f) => path.join(toolScriptsDir || scriptsDir, f)
  const jobs = new Map()
  const JOB_TTL = 3600 * 1000

  // ---------- OCR 兜底配置(manga_tool/_ocr_cfg.json) ----------
  // mode: off | empty(只补空框) | short(空+极短) | all(全部重读)
  const ocrCfgFile = () => path.join(scriptsDir, '_ocr_cfg.json')
  const OCR_DEFAULTS = { mode: 'empty', minChars: 1, maxPerBook: 30 }
  const OCR_MODES = ['off', 'empty', 'short', 'all']
  function readOcrCfg() {
    const d = loadJson(ocrCfgFile())
    const out = { ...OCR_DEFAULTS }
    if (d && typeof d === 'object') {
      if (OCR_MODES.includes(d.mode)) out.mode = d.mode
      if (Number.isFinite(Number(d.minChars))) out.minChars = Math.max(0, Math.min(20, Number(d.minChars)))
      if (Number.isFinite(Number(d.maxPerBook))) out.maxPerBook = Math.max(1, Math.min(500, Number(d.maxPerBook)))
    }
    return out
  }
  function writeOcrCfg(patch) {
    const cur = readOcrCfg()
    const next = { ...cur }
    if (patch && OCR_MODES.includes(patch.mode)) next.mode = patch.mode
    if (patch && Number.isFinite(Number(patch.minChars))) next.minChars = Math.max(0, Math.min(20, Number(patch.minChars)))
    if (patch && Number.isFinite(Number(patch.maxPerBook))) next.maxPerBook = Math.max(1, Math.min(500, Number(patch.maxPerBook)))
    const file = ocrCfgFile()
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
    return next
  }

  // ---------- 双端共享的界面设置(~/.manga-workflow/settings.json) ----------
  // sidebarEnabled  : 是否在 DSH 侧边栏显示「漫画工作台」入口(双端共享)
  // rememberPathWeb : 网页端是否记住上次文件夹(仅网页端改)
  // rememberPathDesktop: 桌面端是否记住上次文件夹(仅桌面端改)
  const uiSettingsFile = () => path.join(os.homedir(), '.manga-workflow', 'settings.json')
  const UI_DEFAULTS = { sidebarEnabled: true, bannerEnabled: true, rememberPathWeb: true, rememberPathDesktop: true }
  function readUiSettings() {
    const d = loadJson(uiSettingsFile())
    const out = { ...UI_DEFAULTS }
    if (d && typeof d === 'object') {
      for (const k of Object.keys(UI_DEFAULTS)) {
        if (typeof d[k] === 'boolean') out[k] = d[k]
      }
    }
    return out
  }
  function writeUiSettings(patch) {
    const file = uiSettingsFile()
    // 直接读原始对象:保留未来版本写入的未知键,避免回写时被抹掉
    const raw = loadJson(file)
    const base = (raw && typeof raw === 'object') ? { ...raw } : {}
    const next = { ...UI_DEFAULTS }
    for (const k of Object.keys(UI_DEFAULTS)) {
      if (typeof base[k] === 'boolean') next[k] = base[k]
      if (patch && typeof patch[k] === 'boolean') next[k] = patch[k]
    }
    const merged = { ...base, ...next }
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8')
    return next
  }

  // ---------- 设置:识图用的视觉模型(modlens 的 ~/.modlens/config.json) ----------
  // modlens 是 DSH 读图用的桥,providers.openai 就是它的 OpenAI 兼容视觉后端。
  // 桌面端与网页端改的是同一个文件,所以能真正替换掉正在用的那家 API。
  const settingsFile = () => path.join(os.homedir(), '.modlens', 'config.json')
  const SETTINGS_DEFAULT = {
    model: 'kimi-k3',
    apiBase: 'https://api.moonshot.cn/v1',
    apiKey: '',
  }
  function maskKey(k) {
    if (!k) return ''
    if (k.length <= 8) return '****'
    return k.slice(0, 4) + '****' + k.slice(-4)
  }
  function readSettings() {
    const d = loadJson(settingsFile())
    const prov = (d && typeof d === 'object' && d.providers && typeof d.providers === 'object')
      ? d.providers
      : {}
    const v = (prov.openai && typeof prov.openai === 'object') ? prov.openai : {}
    return {
      model: typeof v.model === 'string' && v.model ? v.model : SETTINGS_DEFAULT.model,
      apiBase: typeof v.baseUrl === 'string' && v.baseUrl ? v.baseUrl : SETTINGS_DEFAULT.apiBase,
      apiKey: typeof v.apiKey === 'string' ? v.apiKey : SETTINGS_DEFAULT.apiKey,
    }
  }
  function writeSettings(v) {
    const file = settingsFile()
    let d = loadJson(file)
    if (!d || typeof d !== 'object') d = {}
    if (!d.providers || typeof d.providers !== 'object') d.providers = {}
    const cur = (d.providers.openai && typeof d.providers.openai === 'object') ? d.providers.openai : {}
    d.providers.openai = {
      ...cur,
      baseUrl: v.apiBase,
      apiKey: v.apiKey,
      model: v.model,
      // 保留 modlens 的其它字段;缺省时给一份可用默认
      structuredOutput: cur.structuredOutput !== false,
      extraBody: cur.extraBody || { thinking: { type: 'disabled' } },
    }
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(d, null, 2), 'utf8')
  }
  function publicSettings(v) {
    return {
      model: v.model,
      apiBase: v.apiBase,
      apiKeySet: !!v.apiKey,
      apiKeyHint: maskKey(v.apiKey),
      file: settingsFile(),
      provider: 'openai',
    }
  }

  function infra(workRoot) {
    const py = pickPython()
    const deps = checkDeps(py.path)
    const items = [
      { label: 'Python 环境' + (py.version ? '(' + py.version + ')' : ''), ok: !!py.version },
      ...deps.map((d) => ({ label: d.label, ok: d.ok })),
    ]
    return {
      workRoot,
      items,
      missing: items.filter((i) => !i.ok).map((i) => i.label),
      pythonPath: py.path,
      pythonSource: py.source,
      scriptsDir,
      scriptsSource: _rt0.scripts.source,
    }
  }

  function pickPython(refresh) {
    const rt = resolveRuntime({
      pythonPath: pythonPathCfg, scriptsDir: scriptsDirCfg, toolScriptsDir, config, refresh,
    })
    if (refresh) _PY_CACHE.clear()
    return rt.python
  }

  function installDeps(tier, onData) {
    const runCmd = (cmd, args) => new Promise((resolve) => {
      let out = ''
      let err = ''
      let child
      try {
        child = spawn(cmd, args, { env: { ...process.env, ...(runtimeEnv || {}) }, windowsHide: true })
      } catch (e) {
        return resolve({ code: -1, out: '', err: String(e) })
      }
      child.stdout.on('data', (d) => { out += d.toString(); onData && onData(d.toString()) })
      child.stderr.on('data', (d) => { err += d.toString(); onData && onData(d.toString()) })
      child.on('close', (code) => resolve({ code, out, err }))
      child.on('error', (e) => resolve({ code: -1, out, err: err + String(e) }))
    })
    const venvDir = path.join(PLUGIN_DIR || '.', '_venv')
    const venvPy = process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python')
    const py = pickPython()
    return (async () => {
      if (!existsSync(venvPy)) {
        onData && onData('[1/3] 创建独立运行环境:' + venvDir + '\n')
        const base = py.ok ? py.path : 'python'
        const r = await runCmd(base, ['-m', 'venv', venvDir])
        if (r.code !== 0) return r
      }
      const target = existsSync(venvPy) ? venvPy : py.path
      onData && onData('[2/3] 升级 pip\n')
      await runCmd(target, ['-m', 'pip', 'install', '--upgrade', 'pip'])
      const req = path.join(scriptsDir, 'requirements-' + tier + '.txt')
      if (!existsSync(req)) return { code: -1, out: '', err: '缺少依赖清单:' + req }
      onData && onData('[3/3] 安装 ' + tier + ' 依赖(可能需要几分钟)\n')
      const r2 = await runCmd(target, ['-m', 'pip', 'install', '-r', req])
      _PY_CACHE.clear()
      return r2
    })()
  }

  function launchDesktop(folder) {
    // 用 pythonw 启动桌面标框工具(无控制台窗口)
    const scriptsRoot = scriptsDir
    const toolPy = path.join(scriptsRoot, 'mark_tool.py')
    if (!existsSync(toolPy)) return { ok: false, error: `找不到 mark_tool.py: ${toolPy}` }
    let py = pythonPath
    const pyw = pythonPath.replace(/python\.exe$/i, 'pythonw.exe')
    if (existsSync(pyw)) py = pyw
    const args = [toolPy]
    if (folder && existsSync(folder)) args.push(folder)
    try {
      const child = spawn(py, args, {
        cwd: scriptsRoot,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      child.unref()
      return { ok: true, pid: child.pid, python: py, target: folder || '' }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  async function status(folder) {
    const pages = listPages(folder)
    const regions = loadJson(path.join(folder, 'regions.json'))
    const ocr = loadJson(path.join(folder, 'ocr_text.json'))
    const trans = loadJson(path.join(folder, 'trans.json'))
    let boxes = 0
    let sfx = 0
    let translated = 0
    let ocrCount = 0
    const rows = pages.map((p) => {
      const b = Array.isArray(regions[p.page]) ? regions[p.page] : []
      const o = Array.isArray(ocr[p.page]) ? ocr[p.page] : []
      const t = Array.isArray(trans[p.page]) ? trans[p.page] : []
      const nSfx = b.filter((x) => x && x.sfx).length
      const nTr = t.filter((x) => typeof x === 'string' && x.trim()).length
      boxes += b.length
      sfx += nSfx
      translated += nTr
      ocrCount += o.filter((x) => typeof x === 'string' && x.trim()).length
      return {
        page: p.page,
        file: p.file,
        boxes: b.length,
        sfx: nSfx,
        ocr: o.filter((x) => typeof x === 'string' && x.trim()).length,
        translated: nTr,
      }
    })
    return {
      folder,
      pageCount: pages.length,
      boxes,
      sfx,
      dialogue: boxes - sfx,
      ocr: ocrCount,
      translated,
      pages: rows,
    }
  }

  async function runStep(folder, step, onData) {
    const env = { ...runtimeEnv }
    let args = null
    let label = step
    if (step === 'ocr') {
      args = [scriptPath('ocr_regions.py'), folder, '--lang', config.lang || 'ja']
    } else if (step === 'translate') {
      const engines = config.engines || 'google,mymemory'
      args = [scriptPath('translate.py'), folder, '--engines', engines, '--from', config.lang || 'ja']
      if (config.proxy) args.push('--proxy', config.proxy)
    } else if (step === 'proofread') {
      args = [scriptPath('proofread.py'), folder, '--stage', 'pre', '--mode', config.proofMode || 'both']
    } else if (step === 'embed') {
      args = [scriptPath('embed_regions.py'), folder]
      if (config.lama) args.push('--lama')
    } else if (step === 'bench') {
      args = [toolPath('bench.py'), folder, '--tools', scriptsDir]
      if (config.benchAll) args.push('--all')
    } else {
      return { code: -1, out: '', err: `未知步骤: ${step}` }
    }
    if (!existsSync(args[0])) return { code: -1, out: '', err: `找不到脚本: ${args[0]}` }
    const r = await runProcess(pythonPath, args, env, onData)
    let out = r.out
    let err = r.err
    let code = r.code

    // OCR 之后按配置接「视觉引擎兜底」
    if (step === 'ocr' && code === 0) {
      const oc = readOcrCfg()
      if (oc.mode && oc.mode !== 'off') {
        const fb = path.join(scriptsDir, 'ocr_fallback.py')
        if (existsSync(fb)) {
          const fbArgs = [fb, folder, '--mode', oc.mode,
            '--min-chars', String(oc.minChars), '--max', String(oc.maxPerBook)]
          if (config.lang) fbArgs.push('--lang', config.lang)
          if (onData) onData(`\n--- OCR 兜底(mode=${oc.mode}, 上限 ${oc.maxPerBook} 框) ---\n`)
          const r2 = await runProcess(pythonPath, fbArgs, env, onData)
          out += '\n' + r2.out
          err += r2.err
          if (r2.code !== 0) {
            out += '\n[提示] OCR 兜底未完成,但本地 OCR 已成功\n'
          }
        }
      }
    }
    return { code, out, err, label }
  }

  async function handle(req, res, url) {
    const folder = url.searchParams.get('folder') || ''
    const name = url.pathname.replace(/^\/manga-desk\/?/, '') || 'status'

    if (name === 'pick') {
      // 调用 DSH 的 directoryPicker 服务(capability.kind === 'native' 时可用)
      let dp = null
      try { dp = getDirectoryPicker ? getDirectoryPicker() : null } catch {}
      if (!dp || typeof dp.capability !== 'function') {
        return json(res, 400, { ok: false, error: '当前环境没有目录选择服务' })
      }
      const cap = dp.capability()
      if (cap.kind !== 'native' || typeof cap.pick !== 'function') {
        return json(res, 400, { ok: false, error: '当前环境不支持系统目录选择,请手动粘贴路径' })
      }
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 5 * 60 * 1000)
      try {
        const picked = await cap.pick(ac.signal)
        return json(res, 200, { ok: !!picked, path: picked || '' })
      } catch (e) {
        return json(res, 200, { ok: false, path: '', error: String((e && e.message) || e) })
      } finally {
        clearTimeout(timer)
      }
    }

    if (name === 'launch' && req.method === 'POST') {
      const raw = await readBody(req)
      let body = {}
      try { body = JSON.parse(raw) } catch {}
      const r = launchDesktop(body.folder || folder)
      return json(res, r.ok ? 200 : 500, r)
    }

    // ---------- 设置 ----------
    if (name === 'settings') {
      if (req.method === 'POST') {
        const raw = await readBody(req)
        let body
        try { body = JSON.parse(raw) } catch { return json(res, 400, { error: '无效 JSON' }) }
        const cur = readSettings()
        const next = { ...cur }
        if (typeof body.model === 'string') next.model = body.model.trim()
        if (typeof body.apiBase === 'string') next.apiBase = body.apiBase.trim()
        // apiKey 留空表示不修改;clearKey=true 才会清空
        if (typeof body.apiKey === 'string' && body.apiKey.trim()) next.apiKey = body.apiKey.trim()
        if (body.clearKey === true) next.apiKey = ''
        try {
          writeSettings(next)
        } catch (e) {
          return json(res, 500, { error: '保存失败: ' + String((e && e.message) || e) })
        }
        return json(res, 200, { ok: true, settings: publicSettings(next) })
      }
      return json(res, 200, publicSettings(readSettings()))
    }

    if (name === 'settings/test' && req.method === 'POST') {
      const raw = await readBody(req)
      let body = {}
      try { body = JSON.parse(raw) } catch {}
      const cur = readSettings()
      // 显式传了字段就用传的值(空字符串=用户清空了,要报错);没传才回退到已保存值
      const model = String(body.model != null ? body.model : cur.model || '').trim()
      const base = String(body.apiBase != null ? body.apiBase : cur.apiBase || '').trim()
      const key = (typeof body.apiKey === 'string' && body.apiKey.trim()) ? body.apiKey.trim() : cur.apiKey
      if (!model) return json(res, 400, { ok: false, error: '请先填写模型名' })
      if (!base) return json(res, 400, { ok: false, error: '请先填写 API Base' })
      const url = base.replace(/\/+$/, '') + '/chat/completions'
      const t0 = Date.now()
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 20000)
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 8,
            stream: false,
          }),
          signal: ac.signal,
        })
        const text = await r.text()
        let data = null
        try { data = JSON.parse(text) } catch {}
        const latencyMs = Date.now() - t0
        if (!r.ok) {
          const msg = (data && data.error && (data.error.message || data.error.code)) || text.slice(0, 300) || ('HTTP ' + r.status)
          return json(res, 200, { ok: false, status: r.status, latencyMs, error: String(msg) })
        }
        const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        return json(res, 200, {
          ok: true, status: r.status, latencyMs, model,
          reply: String(reply == null ? '' : reply).slice(0, 120),
        })
      } catch (e) {
        const cause = e && e.cause && (e.cause.message || e.cause.code)
        const msg = String((e && (e.name === 'AbortError' ? '请求超时(20s)' : e.message)) || e)
        return json(res, 200, {
          ok: false,
          latencyMs: Date.now() - t0,
          error: cause ? `${msg} (${cause})` : msg,
        })
      } finally {
        clearTimeout(timer)
      }
    }

    if (name === 'settings/ui') {
      if (req.method === 'POST') {
        const raw = await readBody(req)
        let body = {}
        try { body = JSON.parse(raw) } catch { return json(res, 400, { error: '无效 JSON' }) }
        try {
          const next = writeUiSettings(body)
          return json(res, 200, { ok: true, settings: next })
        } catch (e) {
          return json(res, 500, { ok: false, error: '保存失败: ' + String((e && e.message) || e) })
        }
      }
      return json(res, 200, { ...readUiSettings(), file: uiSettingsFile() })
    }

    if (name === 'settings/vision-test' && req.method === 'POST') {
      const raw = await readBody(req)
      let body = {}
      try { body = JSON.parse(raw) } catch {}
      const cur = readSettings()
      const model = String(body.model != null ? body.model : cur.model || '').trim()
      const base = String(body.apiBase != null ? body.apiBase : cur.apiBase || '').trim()
      const key = (typeof body.apiKey === 'string' && body.apiKey.trim()) ? body.apiKey.trim() : cur.apiKey
      if (!model) return json(res, 400, { ok: false, error: '请先填写模型名' })
      if (!base) return json(res, 400, { ok: false, error: '请先填写 API Base' })
      const url = base.replace(/\/+$/, '') + '/chat/completions'
      const dataUrl = 'data:image/png;base64,' + makeVisionTestPng().toString('base64')
      const t0 = Date.now()
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 30000)
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: '这张图里是什么形状、什么颜色?只回答"形状,颜色",例如:三角形,绿色' },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            }],
            max_tokens: 40,
            stream: false,
          }),
          signal: ac.signal,
        })
        const text = await r.text()
        let data = null
        try { data = JSON.parse(text) } catch {}
        const latencyMs = Date.now() - t0
        if (!r.ok) {
          const msg = (data && data.error && (data.error.message || data.error.code)) || text.slice(0, 300) || ('HTTP ' + r.status)
          return json(res, 200, {
            ok: false, status: r.status, latencyMs,
            error: String(msg),
            hint: /image|vision|multimodal|content|modal/i.test(String(msg))
              ? '这个模型/接口可能不支持图片输入'
              : '',
          })
        }
        const replyRaw = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        const reply = String(replyRaw == null ? '' : replyRaw).slice(0, 200)
        const sawGreen = /绿|green|绿\b/i.test(reply)
        const sawTriangle = /三角|triangle|▲/i.test(reply)
        return json(res, 200, {
          ok: true, status: r.status, latencyMs, model, reply,
          visionOk: sawGreen && sawTriangle,
          visionPartial: sawGreen || sawTriangle,
          expected: '三角形,绿色',
        })
      } catch (e) {
        const cause = e && e.cause && (e.cause.message || e.cause.code)
        const msg = String((e && (e.name === 'AbortError' ? '请求超时(30s)' : e.message)) || e)
        return json(res, 200, {
          ok: false, latencyMs: Date.now() - t0,
          error: cause ? `${msg} (${cause})` : msg,
        })
      } finally {
        clearTimeout(timer)
      }
    }

    // 运行环境:状态(自动探测 Python + 依赖)
    if (name === 'setup/status') {
      const py = pickPython(true)
      const deps = checkDeps(py.path)
      const missing = REQUIRED_SCRIPTS.filter((f) => !existsSync(path.join(scriptsDir, f)))
      const venvDir = path.join(PLUGIN_DIR || '.', '_venv')
      const venvPy = process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'python.exe')
        : path.join(venvDir, 'bin', 'python')
      const reqs = {}
      for (const t of ['base', 'ocr', 'gpu']) {
        reqs[t] = existsSync(path.join(scriptsDir, 'requirements-' + t + '.txt'))
      }
      return json(res, 200, {
        python: py,
        scripts: { dir: scriptsDir, source: _rt0.scripts.source, missing },
        deps,
        missingCount: deps.filter((d) => !d.ok).length,
        venv: { dir: venvDir, exists: existsSync(venvPy) },
        requirements: reqs,
        pluginDir: PLUGIN_DIR,
      })
    }

    // 运行环境:一键安装依赖(base / ocr / gpu),返回 jobId 供轮询
    if (name === 'setup/install' && req.method === 'POST') {
      const raw = await readBody(req)
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch {}
      const tier = ['base', 'ocr', 'gpu'].includes(body.tier) ? body.tier : 'base'
      const id = 's' + Date.now().toString(36)
      const job = { id, step: 'setup:' + tier, folder: '', status: 'running', code: null,
                    log: '准备中…\n', started: Date.now() }
      jobs.set(id, job)
      installDeps(tier, (t) => { job.log += t })
        .then((r) => {
          job.status = 'done'
          job.code = r.code
          job.log += '\n' + (r.out || '') + (r.err || '')
          job.log += r.code === 0 ? '\n[完成] 依赖已安装,请点「重新检测」\n' : '\n[失败] 请查看上面的错误\n'
        })
        .catch((e) => { job.status = 'error'; job.log += '\n' + String((e && e.message) || e) })
      return json(res, 200, { ok: true, jobId: id, tier })
    }

    // 文字样式预设(styles.json,与桌面端/嵌字渲染共用)
    if (name === 'styles') {
      try {
        const f = path.join(scriptsDir, 'styles.json')
        const d = JSON.parse(readFileSync(f, 'utf8'))
        return json(res, 200, { presets: d.presets || [], note: d._note || '' })
      } catch (e) {
        return json(res, 500, { error: '读取样式失败: ' + String((e && e.message) || e) })
      }
    }

    // OCR 兜底阈值
    if (name === 'settings/ocr') {
      if (req.method === 'POST') {
        const raw = await readBody(req)
        let body = {}
        try { body = JSON.parse(raw) } catch { return json(res, 400, { error: '无效 JSON' }) }
        try {
          return json(res, 200, { ok: true, settings: writeOcrCfg(body) })
        } catch (e) {
          return json(res, 500, { ok: false, error: '保存失败: ' + String((e && e.message) || e) })
        }
      }
      return json(res, 200, { ...readOcrCfg(), file: ocrCfgFile(), modes: OCR_MODES })
    }

    // 成本预估:识图(外接视觉引擎)token 与嵌字(本地 GPU)耗时
    if (name === 'cost') {
      const folder = url.searchParams.get('folder') || ''
      const outTok = Math.max(0, parseInt(url.searchParams.get('out') || '400', 10) || 400)
      const longSide = Math.max(256, parseInt(url.searchParams.get('long') || '2048', 10) || 2048)
      const v = readSettings()
      const tokOf = (cw, chh) => {
        const sc = Math.min(1, longSide / Math.max(cw, chh))
        const fw = Math.max(1, Math.round(cw * sc))
        const fh = Math.max(1, Math.round(chh * sc))
        return Math.ceil(fw / 28) * Math.ceil(fh / 28)
      }
      let pageCount = 0
      let sizes = []
      let files = []
      if (folder && existsSync(folder)) {
        files = listPages(folder)
        pageCount = files.length
        // 采样最多 3 页(首/中/尾),避免只按第一页(可能是短页)估低
        const picks = files.length <= 3
          ? files
          : [files[0], files[Math.floor(files.length / 2)], files[files.length - 1]]
        sizes = picks
          .map((f) => imageSizeOf(pythonPath, path.join(folder, f.file)))
          .filter((sz) => sz.w > 0)
      }
      if (!sizes.length) sizes = [{ w: 1280, h: 1830 }]
      const toks = sizes.map((sz) => tokOf(sz.w, sz.h))
      const biggest = sizes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
      const scale0 = Math.min(1, longSide / Math.max(biggest.w, biggest.h))
      const fittedW = Math.max(1, Math.round(biggest.w * scale0))
      const fittedH = Math.max(1, Math.round(biggest.h * scale0))
      const inTok = Math.round(toks.reduce((a, b) => a + b, 0) / toks.length)
      const inTokMax = Math.max.apply(null, toks)
      return json(res, 200, {
        model: v.model,
        apiBase: v.apiBase,
        pageCount,
        image: {
          width: biggest.w, height: biggest.h,
          fittedWidth: fittedW, fittedHeight: fittedH,
          longSide, sampled: sizes.length,
        },
        tokens: { input: inTok, inputMax: inTokMax, output: outTok },
        embed: {
          moneyPerPage: 0,
          secondsPerPage: 0.4,
          note: '本地 GPU / OpenCV,不产生 API 费用',
        },
        note: 'token 数为按 28px patch 的估算值;实际以各厂商计费口径为准',
      })
    }

    if (name === 'infra') {
      const root = url.searchParams.get('root')
      return json(res, 200, infra(root || path.dirname(scriptsDir)))
    }

    if (name === 'status') {
      if (!folder || !existsSync(folder)) return json(res, 400, { error: '文件夹不存在' })
      return json(res, 200, await status(folder))
    }

    if (name === 'image') {
      const page = url.searchParams.get('page') || ''
      const pageFile = listPages(folder).find((p) => p.page === page)
      if (!pageFile) return json(res, 404, { error: '找不到页面' })
      const full = path.join(folder, pageFile.file)
      const ext = path.extname(full).toLowerCase()
      const mime = ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.webp' ? 'image/webp' : 'application/octet-stream'
      res.statusCode = 200
      res.setHeader('content-type', mime)
      res.setHeader('cache-control', 'no-store')
      res.end(readFileSync(full))
      return
    }

    if (name === 'regions') {
      const page = url.searchParams.get('page') || ''
      const regions = loadJson(path.join(folder, 'regions.json'))
      const ocr = loadJson(path.join(folder, 'ocr_text.json'))
      const trans = loadJson(path.join(folder, 'trans.json'))
      return json(res, 200, {
        boxes: Array.isArray(regions[page]) ? regions[page] : [],
        texts: Array.isArray(ocr[page]) ? ocr[page] : [],
        trans: Array.isArray(trans[page]) ? trans[page] : [],
      })
    }

    if (name === 'save' && req.method === 'POST') {
      const raw = await readBody(req)
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        return json(res, 400, { error: '无效 JSON' })
      }
      const page = body.page || ''
      // folder 优先取 body(前端 POST 只带 body,不带 query)
      const target = body.folder || folder
      if (!page) return json(res, 400, { error: '缺少 page' })
      if (!target || !existsSync(target)) return json(res, 400, { error: '文件夹不存在' })
      const rf = path.join(target, 'regions.json')
      const regions = loadJson(rf)
      regions[page] = Array.isArray(body.boxes) ? body.boxes : []
      writeFileSync(rf, JSON.stringify(regions, null, 1), 'utf8')
      // 只应用用户真正改过的文本(edits),避免用旧快照覆盖掉新跑出来的 OCR/译文
      if (Array.isArray(body.edits) && body.edits.length) {
        const of = path.join(target, 'ocr_text.json')
        const tf = path.join(target, 'trans.json')
        const ocr = loadJson(of)
        const trans = loadJson(tf)
        const oRow = Array.isArray(ocr[page]) ? ocr[page] : []
        const tRow = Array.isArray(trans[page]) ? trans[page] : []
        let changed = false
        for (const ed of body.edits) {
          const i = Number(ed && ed.i)
          if (!Number.isInteger(i) || i < 0) continue
          while (oRow.length <= i) oRow.push('')
          while (tRow.length <= i) tRow.push('')
          if (ed.orig !== undefined && String(ed.orig) !== String(oRow[i])) {
            oRow[i] = String(ed.orig)
            changed = true
          }
          if (ed.trans !== undefined && String(ed.trans) !== String(tRow[i])) {
            tRow[i] = String(ed.trans)
            changed = true
          }
        }
        if (changed) {
          ocr[page] = oRow
          trans[page] = tRow
          writeFileSync(of, JSON.stringify(ocr, null, 1), 'utf8')
          writeFileSync(tf, JSON.stringify(trans, null, 1), 'utf8')
        }
      }
      return json(res, 200, { ok: true })
    }

    if (name === 'run' && req.method === 'POST') {
      const raw = await readBody(req)
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        return json(res, 400, { error: '无效 JSON' })
      }
      if (!body.folder || !existsSync(body.folder)) return json(res, 400, { error: '文件夹不存在' })
      // 异步启动,立即返回任务 id;前端轮询 /job 拿进度
      const id = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const job = { id, step: body.step, folder: body.folder, status: 'running', code: null, log: '', started: Date.now() }
      jobs.set(id, job)
      runStep(body.folder, body.step, (t) => { job.log += t })
        .then((r) => {
          job.status = 'done'
          job.code = r.code
          job.log = (r.out || '') + (r.err || '')
        })
        .catch((e) => {
          job.status = 'error'
          job.log = String((e && e.message) || e)
        })
      for (const [k, v] of jobs) {
        if (Date.now() - v.started > JOB_TTL) jobs.delete(k)
      }
      return json(res, 200, { jobId: id, step: body.step })
    }

    if (name === 'job') {
      const id = url.searchParams.get('id') || ''
      const job = jobs.get(id)
      if (!job) return json(res, 404, { error: '任务不存在或已过期' })
      return json(res, 200, {
        id: job.id, step: job.step, status: job.status, code: job.code,
        log: job.log.length > 200000 ? job.log.slice(-200000) : job.log,
      })
    }

    return json(res, 404, { error: '未知接口' })
  }

  return { handle }
}
