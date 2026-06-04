import fs from 'node:fs'
import path from 'node:path'
import type { DiscoveredPluginProject, PluginConfig, PluginLayout } from './types.js'

interface PluginPathCandidate {
  layout: PluginLayout
  pluginRoot: string
  pluginJsonPath: string
}

/**
 * 插件项目发现模块。
 *
 * 该模块集中维护 CLI 对插件根目录的判断规则，避免 publish、pull 等入口各自
 * 手写路径候选列表后产生结构兼容差异。最新的 src-ztools 结构优先，旧结构继续
 * 兼容以避免破坏已有插件项目。
 */
export function discoverPluginProject(cwd: string = process.cwd()): DiscoveredPluginProject {
  const projectRoot = path.resolve(cwd)
  const candidates = buildPluginPathCandidates(projectRoot)
  const existing = candidates.filter((candidate) => fs.existsSync(candidate.pluginJsonPath))

  if (existing.length === 0) {
    throw new Error(
      '未找到 plugin.json，请确保在插件项目根目录下执行此命令\n' +
        '支持的路径：./src-ztools/plugin.json, ./plugin.json, ./public/plugin.json'
    )
  }

  const selected = existing[0]
  const config = readPluginConfig(selected.pluginJsonPath)
  const warnings = buildMultipleConfigWarnings(existing)

  return {
    projectRoot,
    pluginRoot: selected.pluginRoot,
    pluginJsonPath: selected.pluginJsonPath,
    layout: selected.layout,
    config,
    warnings
  }
}

/**
 * 按优先级构造候选路径。
 *
 * src-ztools 是新模板结构，必须优先于根目录和旧 public 结构；否则同一项目中残留
 * 旧配置时，CLI 会错误读取过期配置。
 */
function buildPluginPathCandidates(projectRoot: string): PluginPathCandidate[] {
  return [
    {
      layout: 'src-ztools',
      pluginRoot: path.join(projectRoot, 'src-ztools'),
      pluginJsonPath: path.join(projectRoot, 'src-ztools', 'plugin.json')
    },
    {
      layout: 'root',
      pluginRoot: projectRoot,
      pluginJsonPath: path.join(projectRoot, 'plugin.json')
    },
    {
      layout: 'public',
      pluginRoot: path.join(projectRoot, 'public'),
      pluginJsonPath: path.join(projectRoot, 'public', 'plugin.json')
    }
  ]
}

/**
 * 读取插件配置。
 *
 * 只负责 JSON 解析，不做业务字段校验；字段校验仍由 publish 等调用方根据命令场景
 * 执行，避免解析器承担过多职责。
 */
function readPluginConfig(pluginJsonPath: string): PluginConfig {
  try {
    const content = fs.readFileSync(pluginJsonPath, 'utf-8')
    return JSON.parse(content) as PluginConfig
  } catch (error) {
    throw new Error(`读取 plugin.json 失败: ${(error as Error).message}`)
  }
}

/**
 * 构造多配置文件提示。
 *
 * 多个 plugin.json 同时存在通常意味着迁移残留。这里不直接失败，是为了保留旧项目
 * 的渐进迁移能力；调用方负责把 warning 展示给用户。
 */
function buildMultipleConfigWarnings(existing: PluginPathCandidate[]): string[] {
  if (existing.length <= 1) {
    return []
  }

  const selected = existing[0]
  const ignored = existing.slice(1).map((candidate) => candidate.pluginJsonPath)

  return [
    [
      `检测到多个 plugin.json，已使用 ${selected.pluginJsonPath}`,
      '被忽略的配置：',
      ...ignored.map((item) => `  - ${item}`)
    ].join('\n')
  ]
}
