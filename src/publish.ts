import { blue, cyan, green, red, yellow } from 'kolorist'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAuth } from './auth.js'
import { hasStrictChangelogSection, readChangelogSection } from './changelog.js'
import {
  commitPluginChanges,
  copyPluginFiles,
  ensureForkClone,
  getLocalCommitSubjectsSinceLastPublish,
  getWorkingTreeStatus,
  hasCommits,
  isGitRepo,
  prepareBranch,
  pushPluginBranch,
  tagLastPublishLocally
} from './git.js'
import {
  createPullRequest,
  ensureFork,
  getCurrentUser,
  pluginExistsUpstream,
  syncForkMain
} from './github.js'
import type { PluginConfig } from './types.js'

const CLI_VERSION = JSON.parse(
  fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'),
    'utf-8'
  )
).version as string

/**
 * 验证插件名称格式
 * 只允许小写字母和连字符 "-"
 */
function validatePluginName(name: string): boolean {
  return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)
}

/**
 * 验证版本号格式
 * 必须是语义化版本号格式: x.y.z (例如: 1.0.0, 1.2.3)
 */
function validateVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version)
}

/**
 * 拒绝模板自带的默认图标，避免插件以占位图标提交。
 */
function isDefaultLogo(logoPath: string): boolean {
  if (!fs.existsSync(logoPath)) return false
  const digest = crypto.createHash('sha256').update(fs.readFileSync(logoPath)).digest('hex')
  return digest === '8912367f96e8b21c9bf5e138415347c61eca8d93abccd59650a6b81aaecbd0f6'
}

/**
 * 验证插件项目
 */
function validatePluginProject(): PluginConfig {
  const possiblePaths = [
    path.join(process.cwd(), 'src-ztools', 'plugin.json'),
    path.join(process.cwd(), 'plugin.json'),
    path.join(process.cwd(), 'public', 'plugin.json')
  ]

  let pluginJsonPath: string | null = null
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      pluginJsonPath = p
      break
    }
  }

  if (!pluginJsonPath) {
    throw new Error(
      '未找到plugin.json，请确保在插件项目根目录下执行此命令\n支持的路径：./src-ztools/plugin.json, ./plugin.json, ./public/plugin.json'
    )
  }

  let pluginConfig: PluginConfig
  try {
    const content = fs.readFileSync(pluginJsonPath, 'utf-8')
    pluginConfig = JSON.parse(content)
  } catch (error) {
    throw new Error(`读取plugin.json失败: ${(error as Error).message}`)
  }

  if (!pluginConfig.name) {
    throw new Error('plugin.json中缺少name字段')
  }

  if (!pluginConfig.title) {
    throw new Error('plugin.json中缺少title字段（插件标题）')
  }

  if (!pluginConfig.version) {
    throw new Error('plugin.json中缺少version字段（版本号）')
  }

  const logoValue = typeof pluginConfig.logo === 'string' ? pluginConfig.logo : 'logo.png'
  const logoPath = path.resolve(path.dirname(pluginJsonPath), logoValue)
  if (isDefaultLogo(logoPath)) {
    throw new Error('logo不能使用默认图标，可以使用ai生成svg转png图标')
  }

  if (!validatePluginName(pluginConfig.name)) {
    throw new Error(
      `插件名称格式不正确: "${pluginConfig.name}"\n` +
        '插件名称只允许小写字母、数字和连字符 "-"，且必须以字母开头，以字母或数字结尾\n' +
        '示例: my-plugin, hello-world, plugin-123'
    )
  }

  if (!validateVersion(pluginConfig.version)) {
    throw new Error(
      `版本号格式不正确: "${pluginConfig.version}"\n` +
        '版本号必须是语义化版本号格式 (major.minor.patch)\n' +
        '示例: 1.0.0, 1.2.3, 2.10.5'
    )
  }

  if (!hasStrictChangelogSection(pluginConfig.version, process.cwd())) {
    throw new Error(
      `CHANGELOG.md 缺少版本 ${pluginConfig.version} 的有效更新日志。\n` +
        `必须使用格式：## ${pluginConfig.version} - YYYY-MM-DD，并填写至少一行正文后再提交。`
    )
  }

  if (!isGitRepo()) {
    throw new Error('当前目录不是Git仓库，请先执行 git init')
  }

  if (!hasCommits()) {
    throw new Error('没有找到任何提交记录，请至少提交一次代码')
  }

  const dirty = getWorkingTreeStatus()
  if (dirty.length > 0) {
    const preview = dirty.slice(0, 8).join('\n  ')
    const more = dirty.length > 8 ? `\n  ... 还有 ${dirty.length - 8} 项未列出` : ''
    throw new Error(
      `工作区存在未提交的改动，请先 commit 或 discard 后再发布：\n  ${preview}${more}\n\n` +
        `提示：git add -A && git commit -m "your changes"  或  git restore --staged . && git checkout -- .`
    )
  }

  return pluginConfig
}

/**
 * 解析 plugin.json 里的 author 字段，支持 "Name <email>" 或纯名称两种写法。
 */
function parseAuthor(raw: string | undefined): { name?: string; email?: string } {
  if (!raw || typeof raw !== 'string') return {}
  const m = raw.match(/^(.*?)\s*<([^>]+)>\s*$/)
  if (m) {
    return { name: m[1].trim(), email: m[2].trim() }
  }
  return { name: raw.trim() }
}

/**
 * 把"默认前缀 + 用户自上次发布以来的 commit subjects"组装成 fork 端的
 * commit message 与 PR 标题。规则参考 Raycast：
 *
 *   PR 标题永远使用 `Add/Update plugin <name> v<version>` 固定格式——
 *   这样维护者浏览 PR 列表时一眼就能区分新增与更新、不被零散的 commit
 *   subject 干扰。
 *
 *   commit message 则更细致：
 *     - 0 个 subject  → 直接用默认标题
 *     - 1 个 subject → 用用户原始 subject 当 commit 标题（保留语义）
 *     - ≥2 个        → 默认标题 + bullet list 正文
 */
export function buildCommitTitle(
  isExisting: boolean,
  displayName: string,
  version: string,
  subjects: string[]
): { commitTitle: string; commitBody: string | null; prTitle: string } {
  const action = isExisting ? 'Update' : 'Add'
  const fallback = `${action} plugin ${displayName} v${version}`

  if (subjects.length === 0) {
    return { commitTitle: fallback, commitBody: null, prTitle: fallback }
  }
  if (subjects.length === 1) {
    return { commitTitle: subjects[0], commitBody: null, prTitle: fallback }
  }
  const body = '- ' + subjects.join('\n- ')
  return { commitTitle: fallback, commitBody: body, prTitle: fallback }
}

/**
 * 渲染 PR description。CHANGELOG 段优先使用从 CHANGELOG.md 抽出的版本节，
 * 找不到时给一段 placeholder 让用户在 PR 上手填。
 */
function renderPRBody(
  pluginConfig: PluginConfig,
  displayName: string,
  isExisting: boolean,
  changelog: string | null,
  commitSubjects: string[]
): string {
  const action = isExisting ? '更新' : '新增'
  const changelogBlock = changelog
    ? changelog
    : commitSubjects.length > 0
      ? '- ' + commitSubjects.join('\n- ')
      : '<!-- 简要描述本次新增 / 更新内容 -->'

  return `## 插件信息

- **名称**: ${displayName}
- **插件ID**: ${pluginConfig.name}
- **版本**: ${pluginConfig.version}
- **CLI版本**: ${CLI_VERSION}
- **描述**: ${pluginConfig.description || 'N/A'}
- **作者**: ${pluginConfig.author || 'N/A'}
- **类型**: ${action}

## 本次变更

${changelogBlock}

## 截图 / 演示

<!-- 如果是新插件或包含界面变化，请附 1-2 张截图或 GIF -->

## 自检清单

- [ ] plugin.json 的 name / title / version / description / author 字段均已检查
- [ ] 已移除调试日志、未使用文件、敏感信息（.env、token、密钥等）
- [ ] 本次 PR 的 diff 仅涉及 \`plugins/${pluginConfig.name}/\` 目录
- [ ] 已在本地 ZTools 客户端实际加载并测试过此插件，主要功能正常
- [ ] 同意以仓库声明的开源协议发布此插件

---
*此 PR 由 ztools-plugin-cli 自动管理：每次 \`ztools publish\` 在分支上追加一个 commit，PR 链接保持不变。*
`
}

/**
 * 发布插件
 */
export async function publish(): Promise<void> {
  console.log()
  console.log(blue('🚀 ZTools Plugin Publisher\n'))

  try {
    // 1. 验证插件项目
    console.log(cyan('📋 验证插件项目...'))
    const pluginConfig = validatePluginProject()
    const displayName = pluginConfig.title || pluginConfig.name
    console.log(green(`✓ 插件: ${displayName} (${pluginConfig.name})`))
    console.log(green(`✓ 描述: ${pluginConfig.description || 'N/A'}`))
    console.log(green(`✓ 版本: ${pluginConfig.version}\n`))

    // 1.5 CHANGELOG 已在项目校验阶段严格检查；缺失或格式错误会直接终止发布。
    const changelog = readChangelogSection(pluginConfig.version, process.cwd())

    // 2. GitHub 认证
    console.log(cyan('🔐 GitHub认证...'))
    const accessToken = await ensureAuth()
    const user = await getCurrentUser(accessToken)
    console.log(green(`✓ 已认证: ${user.login}\n`))

    // 3. 确保 fork 存在
    const fork = await ensureFork(user.login, accessToken)
    console.log(green(`✓ Fork仓库: ${fork.html_url}\n`))

    // 4. 准备本地 fork 克隆（持久化复用）
    await ensureForkClone(fork.clone_url, user.login, accessToken)

    // 5. 把 fork 的 main 同步到 upstream（避免分支基于落后的 main）
    await syncForkMain(user.login, accessToken)

    // 6. 判定 Add / Update：以"中心仓库 plugins/<name>/ 是否存在"为权威依据，
    //    比依赖 fork 分支状态更准（合并后分支被删的情况也能正确报 Update）。
    let isExisting = false
    try {
      isExisting = await pluginExistsUpstream(pluginConfig.name, accessToken)
      console.log(green(`✓ 上游状态: ${isExisting ? '已存在 → Update' : '未发布 → Add'}\n`))
    } catch (e) {
      console.log(yellow(`⚠ 检查上游插件状态失败，默认按 Add 处理: ${(e as Error).message}\n`))
    }

    // 7. 切换到 plugin/<name> 分支（仅用于决定从哪里出发追加 commit）
    prepareBranch(pluginConfig.name)

    // 8. 把工作目录文件复制进 plugins/<name>/
    copyPluginFiles(pluginConfig.name, process.cwd())

    // 9. 组装 commit 标题 / 正文 / PR 标题
    const commitSubjects = getLocalCommitSubjectsSinceLastPublish()
    const { commitTitle, commitBody, prTitle } = buildCommitTitle(
      isExisting,
      displayName,
      pluginConfig.version,
      commitSubjects
    )
    const author = parseAuthor(pluginConfig.author)

    const hasChanges = commitPluginChanges(pluginConfig.name, commitTitle, {
      body: commitBody || undefined,
      authorName: author.name,
      authorEmail: author.email
    })

    if (hasChanges) {
      console.log(green(`✓ 已生成 commit: ${commitTitle}`))
      if (commitBody) {
        console.log(green('  Body:'))
        for (const line of commitBody.split('\n')) console.log(green(`    ${line}`))
      }
      // 10. 推送（普通 push，不 force）
      await pushPluginBranch(pluginConfig.name)
    } else {
      console.log(yellow('⚠ fork plugin 分支与本地内容一致，没有新 commit 可追加'))
      console.log(yellow('  → 继续检查 PR 状态'))
    }

    // 11. 渲染 PR description，注入项目中手动维护的 CHANGELOG 版本节。
    if (changelog) {
      console.log(green(`✓ 已注入 v${pluginConfig.version} 变更说明到 PR description\n`))
    }
    const prBody = renderPRBody(pluginConfig, displayName, isExisting, changelog, commitSubjects)

    // 12. 创建 / 关联 PR
    const pr = await createPullRequest(
      accessToken,
      `${user.login}:plugin/${pluginConfig.name}`,
      prTitle,
      prBody
    )

    // 13. 仅在真的新增了 commit 的情况下，更新本地 ztools-last-publish 标签。
    //     无新增 commit 时不动标签，避免 pull-contributions 的 base 飘移。
    if (hasChanges) {
      try {
        tagLastPublishLocally()
      } catch (e) {
        console.log(
          yellow(`⚠ 未能打 ztools-last-publish 标签（不影响发布）: ${(e as Error).message}`)
        )
      }
    }

    // 14. 成功
    console.log()
    console.log(green('=' + '='.repeat(60)))
    if (hasChanges) {
      console.log(green('✨ 插件发布成功!'))
    } else {
      console.log(green('✓ PR 已就绪（fork 分支与本地一致，无新 commit）'))
    }
    console.log(green('=' + '='.repeat(60)))
    console.log()
    console.log(cyan(`📦 插件: ${displayName}`))
    console.log(cyan(`🔗 Pull Request: ${pr.html_url}`))
    console.log(cyan(`#️⃣  PR编号: #${pr.number}`))
    console.log()
    console.log(yellow('💡 下一步：去 PR 网页完善以下内容（CLI 无法自动生成）'))
    console.log(yellow('  📸 上传截图 / 演示 GIF'))
    console.log(yellow('       直接把图片拖到 PR description 编辑框即可，GitHub 会自动上传'))
    console.log(yellow('  ✅ 勾选自检清单'))
    console.log(yellow('       逐条确认无误后再提交评审'))
    console.log(yellow('  🚦 把 PR 从 Draft 切到 "Ready for review"'))
    console.log(yellow('       右下角 "Ready for review" 按钮'))
    console.log()
    console.log(yellow('   做完以上 3 项，维护者才会真正进入审核。合并后你的插件就会上线。'))
    console.log()
  } catch (error) {
    console.error()
    console.error(red('=' + '='.repeat(60)))
    console.error(red('❌ 发布失败'))
    console.error(red('=' + '='.repeat(60)))
    console.error()
    console.error(red(`错误: ${(error as Error).message}`))
    console.error()

    if ((error as Error).message.includes('plugin.json')) {
      console.log(yellow('💡 提示: 确保在插件项目根目录下执行此命令'))
    } else if ((error as Error).message.includes('Git')) {
      console.log(yellow('💡 提示: 请先初始化Git仓库并提交代码'))
      console.log(yellow('   git init'))
      console.log(yellow('   git add .'))
      console.log(yellow('   git commit -m "Initial commit"'))
    }

    process.exit(1)
  }
}
