import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_FALLBACK_LINES = 80
const TRUNCATE_TO_LINES = 50

/**
 * 在 dir 下查找 CHANGELOG.md（大小写不敏感），返回绝对路径或 null。
 */
function findChangelogPath(dir: string): string | null {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (e.isFile() && /^changelog\.md$/i.test(e.name)) {
      return path.join(dir, e.name)
    }
  }
  return null
}

/**
 * 判断一行是否是 markdown 标题，返回 level；不是则返回 0。
 * 兼容 #/##/### 形式；不处理 setext 形式（=== / ---）。
 */
function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s+/)
  return m ? m[1].length : 0
}

/**
 * 标题行是否匹配指定 version。匹配 `# 0.1.1`, `## v0.1.1`, `### [0.1.1]`,
 * `## 0.1.1 - 2026-04-25` 等常见写法。
 */
function headingMatchesVersion(line: string, version: string): boolean {
  const stripped = line.replace(/^#{1,6}\s+/, '')
  // 在标题正文中找到独立出现的版本号
  const escaped = version.replace(/[.+*?^$()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[^\\d])v?\\[?${escaped}\\]?(?![\\d])`, 'i')
  return re.test(stripped)
}

/**
 * 抓取 CHANGELOG.md 中"当前版本"那一节的内容。
 *  - 找不到文件 → null
 *  - 找到文件、命中版本 → 返回该节正文（去掉首尾空行）
 *  - 找到文件、未命中版本：
 *      - 文件 ≤ 80 行 → 返回整文件
 *      - 否则 → 返回前 50 行 + 截断说明
 */
export function readChangelogSection(version: string, dir: string = process.cwd()): string | null {
  const file = findChangelogPath(dir)
  if (!file) return null

  let content: string
  try {
    content = fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }

  const lines = content.split(/\r?\n/)
  // 优先尝试匹配版本节
  let startIdx = -1
  let startLevel = 0
  for (let i = 0; i < lines.length; i++) {
    const lvl = headingLevel(lines[i])
    if (lvl > 0 && headingMatchesVersion(lines[i], version)) {
      startIdx = i
      startLevel = lvl
      break
    }
  }

  if (startIdx >= 0) {
    let endIdx = lines.length
    for (let j = startIdx + 1; j < lines.length; j++) {
      const lvl = headingLevel(lines[j])
      // 同级或更高级标题（数字更小）即下一节起点
      if (lvl > 0 && lvl <= startLevel) {
        endIdx = j
        break
      }
    }
    // 跳过版本标题本身，只返回正文
    return lines
      .slice(startIdx + 1, endIdx)
      .join('\n')
      .replace(/^\s*\n+/, '')
      .replace(/\n+\s*$/, '')
  }

  // 没匹配到当前版本：整文件 / 截断
  if (lines.length <= MAX_FALLBACK_LINES) {
    return content.trim()
  }
  const head = lines.slice(0, TRUNCATE_TO_LINES).join('\n').trim()
  return `${head}\n\n_…(CHANGELOG 已截断，完整内容请见仓库)_`
}

/**
 * 把模板写入临时文件，用 $EDITOR / $VISUAL / vi 打开让用户录入；
 * 用户保存退出后剥掉以 # 开头的注释行，去掉首尾空白返回。
 *
 * 用户没输入实质内容（全是注释或空白）→ 返回 null。
 * 编辑器调用失败 / 没装 vi 之类 → 抛错。
 * 当前进程的 stdin/stdout 不是 TTY（CI 等场景）→ 返回 null，调用者应回退到 placeholder。
 */
export function promptChangelogInEditor(version: string, displayName: string): string | null {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null

  const editor = process.env.EDITOR || process.env.VISUAL || 'vi'
  const date = new Date().toISOString().slice(0, 10)
  const template = [
    `# 请简述 ${displayName} v${version} 的本次变更。`,
    '# 以 # 开头的行会被忽略；保存并关闭编辑器即可继续发布。',
    '# 直接关闭（不保存）或留空 → 跳过本次录入。',
    '#',
    '# 例如：',
    '#   ### Added',
    '#   - 新增批量导入',
    '#',
    '#   ### Fixed',
    '#   - 修复空输入崩溃',
    '',
    ''
  ].join('\n')

  const tmp = path.join(os.tmpdir(), `ztools-changelog-${process.pid}-${Date.now()}.md`)
  fs.writeFileSync(tmp, template, 'utf-8')

  const r = spawnSync(editor, [tmp], { stdio: 'inherit' })
  let captured = ''
  try {
    captured = fs.readFileSync(tmp, 'utf-8')
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }

  if (r.status !== 0) {
    throw new Error(`编辑器 (${editor}) 退出码非 0，跳过录入`)
  }

  const stripped = captured
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
    .replace(/^\s+|\s+$/g, '')

  return stripped.length > 0 ? stripped : null
}

/**
 * 把 entry 作为 ## v{version} - {date} 节，prepend 到 CHANGELOG.md（不存在则新建）。
 *  - 若已有 H1（# Changelog 之类）→ 插在 H1 之后、首个 H2 之前
 *  - 若没有 H1 → 直接插在文件最前
 * 返回写入的绝对路径。
 */
export function writeChangelogEntry(version: string, entry: string, dir: string = process.cwd()): string {
  const target = findChangelogPath(dir) || path.join(dir, 'CHANGELOG.md')
  const date = new Date().toISOString().slice(0, 10)
  const newSection = `## ${version} - ${date}\n\n${entry.trim()}\n`

  if (!fs.existsSync(target)) {
    const initial = `# Changelog\n\n${newSection}\n`
    fs.writeFileSync(target, initial, 'utf-8')
    return target
  }

  const existing = fs.readFileSync(target, 'utf-8')
  const lines = existing.split(/\r?\n/)

  // 找首个 H2
  let firstH2 = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2}\s+/.test(lines[i])) {
      firstH2 = i
      break
    }
  }

  let merged: string
  if (firstH2 === -1) {
    // 没 H2 → 在文件末尾追加
    const sep = existing.endsWith('\n') ? '\n' : '\n\n'
    merged = existing + sep + newSection + '\n'
  } else {
    // 有 H2 → 插在它之前
    const before = lines.slice(0, firstH2).join('\n')
    const after = lines.slice(firstH2).join('\n')
    merged = `${before.replace(/\s+$/, '')}\n\n${newSection}\n${after}`
  }

  fs.writeFileSync(target, merged, 'utf-8')
  return target
}
