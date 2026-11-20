// 项目库:漫画源目录只读,工作数据(框/译文/OCR/配置/报告)统一存在工作区里。
// 目录结构:
//   <工作区>/projects/index.json          源目录 -> 项目名 的映射
//   <工作区>/projects/<项目名>/regions.json、trans.json、ocr_text.json、config.json
//   <工作区>/projects/<项目名>/meta.json  源路径、创建/更新时间、统计
//   <工作区>/已完成/<项目名>/             最终成品页(用户确认后输出)
import fs from 'node:fs'
import path from 'node:path'

const DATA_FILES = ['regions.json', 'trans.json', 'ocr_text.json', 'config.json']

function readJsonSafe(f, dflt) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return dflt }
}

function writeJsonSafe(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(data, null, 1), 'utf8')
}

// Windows 下大小写不敏感,统一小写做键
export function pathKey(p) {
  const abs = path.resolve(String(p || ''))
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

// 项目名:取文件夹名,去掉 Windows 非法字符;过长截断
export function projectName(folder) {
  let name = path.basename(path.resolve(String(folder || 'book')))
  name = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  if (!name) name = 'book'
  if (name.length > 80) name = name.slice(0, 80)
  return name
}

export function projectsRoot(workspace) {
  return path.join(String(workspace), 'projects')
}

export function doneRoot(workspace) {
  return path.join(String(workspace), '已完成')
}

function indexFile(workspace) {
  return path.join(projectsRoot(workspace), 'index.json')
}

function loadIndex(workspace) {
  const idx = readJsonSafe(indexFile(workspace), null)
  return idx && typeof idx === 'object' ? idx : {}
}

function saveIndex(workspace, idx) {
  writeJsonSafe(indexFile(workspace), idx)
}

/**
 * 解析(必要时创建)某本漫画的项目目录。
 * - 工作区必须已设置,否则抛出 code=PROJECT_NO_WORKSPACE
 * - 同名书自动加 __2 / __3 后缀;index 记录 绝对路径 -> 项目名
 * - 首次创建时,若源目录里已有旧的工作文件(regions/trans/ocr/config),自动复制进项目(源文件保留)
 * 返回 { name, dir, isNew, migrated, workspace }
 */
export function ensureProject(workspace, folder) {
  const ws = String(workspace || '').trim()
  if (!ws) {
    const e = new Error('还没有设置「嵌字工作区」。请到「设置 → 嵌字工作区」指定一个目录,项目数据会存在那里。')
    e.code = 'PROJECT_NO_WORKSPACE'
    throw e
  }
  const src = path.resolve(String(folder || ''))
  if (!src) {
    const e = new Error('没有选择漫画文件夹')
    e.code = 'PROJECT_NO_FOLDER'
    throw e
  }
  const key = pathKey(src)
  const proot = projectsRoot(ws)
  fs.mkdirSync(proot, { recursive: true })
  const idx = loadIndex(ws)
  const rec = idx[key]

  // 已有项目:直接返回
  if (rec && rec.name && fs.existsSync(path.join(proot, rec.name))) {
    if (rec.source !== src) { rec.source = src; saveIndex(ws, idx) }
    return { name: rec.name, dir: path.join(proot, rec.name), isNew: false, migrated: [], workspace: ws }
  }

  // 新项目:分配不冲突的名字
  let name = projectName(src)
  let dir = path.join(proot, name)
  let n = 1
  while (fs.existsSync(dir)) {
    n += 1
    name = projectName(src) + '__' + n
    dir = path.join(proot, name)
  }
  fs.mkdirSync(dir, { recursive: true })

  // 迁移源目录里的旧数据(复制,不删除)
  const migrated = []
  const migratedFrom = []
  for (const f of DATA_FILES) {
    const s = path.join(src, f)
    if (fs.existsSync(s)) {
      try {
        fs.copyFileSync(s, path.join(dir, f))
        migrated.push(f)
        migratedFrom.push(s)
      } catch { /* 忽略单个文件失败 */ }
    }
  }
  // 旧输出目录也迁进来(预览/成品来源)
  for (const sub of ['out', 'out_lama', 'preview']) {
    const s = path.join(src, sub)
    if (fs.existsSync(s) && fs.statSync(s).isDirectory()) {
      try { fs.cpSync(s, path.join(dir, sub), { recursive: true }) } catch { /* ignore */ }
    }
  }

  const meta = {
    source: src,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    migratedFrom,
  }
  writeJsonSafe(path.join(dir, 'meta.json'), meta)
  idx[key] = { name, source: src, createdAt: meta.createdAt }
  saveIndex(ws, idx)
  return { name, dir, isNew: true, migrated, workspace: ws }
}

/** 只读查询:返回项目信息;不存在时返回 null(不创建) */
export function findProject(workspace, folder) {
  const ws = String(workspace || '').trim()
  if (!ws) return null
  const idx = loadIndex(ws)
  const rec = idx[pathKey(folder)]
  if (!rec) return null
  const dir = path.join(projectsRoot(ws), rec.name)
  if (!fs.existsSync(dir)) return null
  const meta = readJsonSafe(path.join(dir, 'meta.json'), {})
  return { name: rec.name, dir, meta, workspace: ws, doneDir: path.join(doneRoot(ws), rec.name) }
}

/** 成品目录(按需创建),返回 <工作区>/已完成/<项目名> */
export function ensureDoneDir(project) {
  const d = project.doneDir || path.join(doneRoot(project.workspace), project.name)
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** 列出工作区里所有项目(给设置页/首页显示) */
export function listProjects(workspace) {
  const ws = String(workspace || '').trim()
  if (!ws) return []
  const idx = loadIndex(ws)
  return Object.entries(idx).map(([k, v]) => {
    const dir = path.join(projectsRoot(ws), v.name)
    const meta = readJsonSafe(path.join(dir, 'meta.json'), {})
    return { ...v, key: k, dir, exists: fs.existsSync(dir), meta }
  })
}

export function touchProject(project) {
  try {
    const f = path.join(project.dir, 'meta.json')
    const meta = readJsonSafe(f, {})
    meta.updatedAt = new Date().toISOString()
    writeJsonSafe(f, meta)
  } catch { /* ignore */ }
}
