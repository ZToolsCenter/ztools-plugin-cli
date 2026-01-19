import fs from 'node:fs'
import path from 'node:path'
import { blue, cyan, green, red, yellow } from 'kolorist'
import { ensureAuth } from './auth.js'
import { getCurrentUser, ensureFork, createPullRequest } from './github.js'
import {
  isGitRepo,
  hasCommits,
  getCommitHistory,
  cloneForkRepo,
  createPluginBranch,
  replayCommits,
  pushBranch,
  isForkRepoCloned
} from './git.js'
import type { PluginConfig } from './types.js'

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
 * 验证插件项目
 */
function validatePluginProject(): PluginConfig {
  // 检查plugin.json（支持多个路径）
  const possiblePaths = [
    path.join(process.cwd(), 'plugin.json'),        // 根目录
    path.join(process.cwd(), 'public', 'plugin.json') // public 目录（Vite 项目）
  ]

  let pluginJsonPath: string | null = null
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      pluginJsonPath = p
      break
    }
  }

  if (!pluginJsonPath) {
    throw new Error('未找到plugin.json，请确保在插件项目根目录下执行此命令\n支持的路径：./plugin.json, ./public/plugin.json')
  }

  // 读取plugin.json
  let pluginConfig: PluginConfig
  try {
    const content = fs.readFileSync(pluginJsonPath, 'utf-8')
    pluginConfig = JSON.parse(content)
  } catch (error) {
    throw new Error(`读取plugin.json失败: ${(error as Error).message}`)
  }

  // 验证必需字段
  if (!pluginConfig.name) {
    throw new Error('plugin.json中缺少name字段')
  }

  if (!pluginConfig.title) {
    throw new Error('plugin.json中缺少title字段（插件标题）')
  }

  if (!pluginConfig.version) {
    throw new Error('plugin.json中缺少version字段（版本号）')
  }

  // 验证 name 字段格式
  if (!validatePluginName(pluginConfig.name)) {
    throw new Error(
      `插件名称格式不正确: "${pluginConfig.name}"\n` +
      '插件名称只允许小写字母、数字和连字符 "-"，且必须以字母开头，以字母或数字结尾\n' +
      '示例: my-plugin, hello-world, plugin-123'
    )
  }

  // 验证 version 字段格式
  if (!validateVersion(pluginConfig.version)) {
    throw new Error(
      `版本号格式不正确: "${pluginConfig.version}"\n` +
      '版本号必须是语义化版本号格式 (major.minor.patch)\n' +
      '示例: 1.0.0, 1.2.3, 2.10.5'
    )
  }

  // 检查是否是git仓库
  if (!isGitRepo()) {
    throw new Error('当前目录不是Git仓库，请先执行 git init')
  }

  // 检查是否有commits
  if (!hasCommits()) {
    throw new Error('没有找到任何提交记录，请至少提交一次代码')
  }

  return pluginConfig
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
    console.log(green(`✓ 版本: ${pluginConfig.version || 'N/A'}\n`))

    // 2. 读取commit历史
    console.log(cyan('📝 读取提交历史...'))
    const commits = getCommitHistory()
    if (commits.length === 0) {
      throw new Error('未找到有效的提交记录')
    }
    console.log(green(`✓ 找到${commits.length}个提交\n`))

    // 3. GitHub认证
    console.log(cyan('🔐 GitHub认证...'))
    const accessToken = await ensureAuth()
    const user = await getCurrentUser(accessToken)
    console.log(green(`✓ 已认证: ${user.login}\n`))

    // 4. 确保fork存在
    const fork = await ensureFork(user.login, accessToken)
    console.log(green(`✓ Fork仓库: ${fork.html_url}\n`))

    // 5. 克隆/更新fork仓库
    if (!isForkRepoCloned()) {
      await cloneForkRepo(fork.clone_url, user.login, accessToken)
    } else {
      console.log(yellow('⚠ 检测到已存在的本地仓库，将重新克隆以确保最新状态'))
      await cloneForkRepo(fork.clone_url, user.login, accessToken)
    }

    // 6. 创建插件分支
    createPluginBranch(pluginConfig.name)

    // 7. 重放commits
    await replayCommits(commits, pluginConfig.name, process.cwd())

    // 8. 推送到远程
    await pushBranch(pluginConfig.name)

    // 9. 创建PR
    const prTitle = `Add/Update plugin: ${displayName}`
    const prBody = `## 插件信息

**插件名称**: ${displayName}
**插件ID**: ${pluginConfig.name}
**描述**: ${pluginConfig.description || 'N/A'}
**版本**: ${pluginConfig.version || 'N/A'}
**作者**: ${pluginConfig.author || 'N/A'}

## 提交说明

此PR包含${commits.length}个提交，添加/更新插件 \`${displayName}\`。

---
*此PR由 ztools-plugin-cli 自动生成*
`

    const pr = await createPullRequest(
      accessToken,
      `${user.login}:plugin/${pluginConfig.name}`,
      prTitle,
      prBody
    )

    // 10. 成功
    console.log()
    console.log(green('=' + '='.repeat(60)))
    console.log(green('✨ 插件发布成功!'))
    console.log(green('=' + '='.repeat(60)))
    console.log()
    console.log(cyan(`📦 插件: ${displayName}`))
    console.log(cyan(`🔗 Pull Request: ${pr.html_url}`))
    console.log(cyan(`#️⃣  PR编号: #${pr.number}`))
    console.log()
    console.log(yellow('💡 下一步:'))
    console.log(yellow('  1. 访问PR链接查看详情'))
    console.log(yellow('  2. 等待维护者审核'))
    console.log(yellow('  3. PR合并后，你的插件将在插件中心上线'))
    console.log()
  } catch (error) {
    console.error()
    console.error(red('=' + '='.repeat(60)))
    console.error(red('❌ 发布失败'))
    console.error(red('=' + '='.repeat(60)))
    console.error()
    console.error(red(`错误: ${(error as Error).message}`))
    console.error()

    // 提供帮助信息
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
