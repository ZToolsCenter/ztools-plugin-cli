import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { blue, cyan, green, red, yellow } from 'kolorist'
import { ensureAuth } from './auth.js'
import {
  checkoutForkBranchForPull,
  ensureForkClone,
  getCurrentBranchName,
  getLastPublishCommit,
  getWorkingTreeStatus,
  hasCommits,
  isGitRepo,
  mirrorForkPluginToCwd,
  remotePluginBranchExists
} from './git.js'
import { ensureFork, getCurrentUser } from './github.js'
import type { PluginConfig } from './types.js'

function readPluginConfig(): PluginConfig {
  const candidates = [
    path.join(process.cwd(), 'plugin.json'),
    path.join(process.cwd(), 'public', 'plugin.json')
  ]
  let pluginJsonPath: string | null = null
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      pluginJsonPath = p
      break
    }
  }
  if (!pluginJsonPath) {
    throw new Error(
      '未找到 plugin.json，请确保在插件项目根目录下执行此命令\n支持的路径：./plugin.json, ./public/plugin.json'
    )
  }
  const cfg = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8')) as PluginConfig
  if (!cfg.name) throw new Error('plugin.json 中缺少 name 字段')
  return cfg
}

function runInCwd(cmd: string): void {
  execSync(cmd, { cwd: process.cwd(), stdio: ['pipe', 'inherit', 'inherit'] })
}

function tryRunInCwd(cmd: string): boolean {
  try {
    execSync(cmd, { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

/**
 * 把 PR 分支上由审核者/他人推过来的改动同步到本地工作目录。
 *
 * 算法（与 Raycast 一致的 3-way merge）：
 *   - base   = ztools-last-publish 标签（上次成功 publish 时本地 HEAD）
 *   - ours   = 用户当前分支 HEAD（包含上次 publish 后的本地新改动）
 *   - theirs = 临时分支：从 base 创建，把 fork 端 plugin/<name> 当前内容提交上去
 *
 * 这样 git merge 会保留双方的改动；冲突时由用户手工解决。
 */
export async function pullContributions(): Promise<void> {
  console.log()
  console.log(blue('🔄 ZTools Pull Contributions\n'))

  const cwd = process.cwd()
  let originalBranch: string | null = null
  let tempBranch: string | null = null
  // Set to true once we successfully switch back to original branch in the
  // happy path; the cleanup block then knows it doesn't need to switch again.
  let restored = false

  try {
    // 1. 校验本地仓库
    if (!isGitRepo()) {
      throw new Error('当前目录不是 Git 仓库')
    }
    if (!hasCommits()) {
      throw new Error('当前仓库还没有任何 commit')
    }
    const dirty = getWorkingTreeStatus()
    if (dirty.length > 0) {
      const preview = dirty.slice(0, 8).join('\n  ')
      throw new Error(`工作区有未提交的改动，请先 commit 或 discard 后再拉取：\n  ${preview}`)
    }
    originalBranch = getCurrentBranchName()
    if (!originalBranch) {
      throw new Error('当前处于 detached HEAD 状态，请先切到一个分支再执行 pull-contributions')
    }
    const baseSha = getLastPublishCommit()
    if (!baseSha) {
      throw new Error(
        'find no ztools-last-publish 标签——请先 ztools publish 成功一次后再使用 pull-contributions。'
      )
    }
    const pluginConfig = readPluginConfig()
    const displayName = pluginConfig.title || pluginConfig.name
    console.log(green(`✓ 插件: ${displayName} (${pluginConfig.name})`))
    console.log(green(`✓ 当前分支: ${originalBranch}`))
    console.log(green(`✓ 上次发布 base: ${baseSha.slice(0, 8)}`))

    // 2. GitHub 认证
    console.log(cyan('\n🔐 GitHub 认证...'))
    const accessToken = await ensureAuth()
    const user = await getCurrentUser(accessToken)
    console.log(green(`✓ 已认证: ${user.login}`))

    // 3. fork + 本地 fork 克隆
    const fork = await ensureFork(user.login, accessToken)
    await ensureForkClone(fork.clone_url, user.login, accessToken)

    // 4. 远端 PR 分支存在吗
    if (!remotePluginBranchExists(pluginConfig.name)) {
      console.log(yellow(`\n⚠ 远端 fork 上没有 plugin/${pluginConfig.name} 分支，无 contributions 可拉。`))
      return
    }

    // 5. 在 fork 克隆里 checkout 远端 plugin 分支（不做 behind 检测）
    checkoutForkBranchForPull(pluginConfig.name)

    // 6. 在本地仓库新建临时分支 theirs，从 ztools-last-publish 出发
    tempBranch = `ztools/pull-${Date.now()}`
    runInCwd(`git checkout -b "${tempBranch}" "${baseSha}"`)

    // 7. 把 fork 当前 plugin 内容镜像到工作树并提交（这就是 theirs 的内容快照）
    mirrorForkPluginToCwd(pluginConfig.name, cwd)
    runInCwd('git add -A')
    const hasForkDiff = !tryRunInCwd('git diff --cached --quiet')

    if (!hasForkDiff) {
      // fork 端自上次 publish 后没有任何新改动
      runInCwd(`git checkout "${originalBranch}"`)
      restored = true
      runInCwd(`git branch -D "${tempBranch}"`)
      tempBranch = null
      console.log()
      console.log(yellow('⚠ fork PR 分支自上次发布以来没有新改动，无 contributions 可拉。'))
      return
    }

    runInCwd(`git commit -m "Pull contributions from PR (${pluginConfig.name})"`)

    // 8. 切回原分支并 merge theirs
    runInCwd(`git checkout "${originalBranch}"`)
    restored = true

    const mergeMsg = `Merge pull-contributions for ${pluginConfig.name}`.replace(/"/g, '\\"')
    const mergeOk = tryRunInCwd(`git merge --no-ff -m "${mergeMsg}" "${tempBranch}"`)

    if (!mergeOk) {
      console.log()
      console.log(red('❌ 合并出现冲突，需要你手工解决。'))
      console.log(yellow('  当前处于合并未完成状态：'))
      console.log(yellow(`  - 临时分支: ${tempBranch}（解决后可删除：git branch -D ${tempBranch}）`))
      console.log(yellow('  解决步骤：'))
      console.log(yellow('    1) 编辑冲突文件 → git add <文件>'))
      console.log(yellow('    2) git commit  完成合并'))
      console.log(yellow('    3) 然后再 ztools publish'))
      console.log(yellow(`  或者放弃此次拉取：git merge --abort && git branch -D ${tempBranch}`))
      // 故意不删除 tempBranch — 用户可能想 reset 回去
      tempBranch = null // 防止 finally 又删
      process.exit(1)
    }

    // 9. 清理临时分支
    runInCwd(`git branch -D "${tempBranch}"`)
    tempBranch = null

    console.log()
    console.log(green('=' + '='.repeat(60)))
    console.log(green('✨ Contributions 已合并到本地'))
    console.log(green('=' + '='.repeat(60)))
    console.log()
    console.log(yellow('💡 下一步:'))
    console.log(yellow('  1. git log -1   # 查看 merge 结果'))
    console.log(yellow('  2. 继续修改后再次 ztools publish'))
    console.log()
  } catch (error) {
    console.error()
    console.error(red('=' + '='.repeat(60)))
    console.error(red('❌ Pull contributions 失败'))
    console.error(red('=' + '='.repeat(60)))
    console.error(red(`错误: ${(error as Error).message}`))

    // 尽力恢复：切回原分支并清理临时分支（best-effort，不抛）
    if (originalBranch && !restored) {
      tryRunInCwd(`git checkout -- .`)
      tryRunInCwd(`git checkout "${originalBranch}"`)
    }
    if (tempBranch) {
      tryRunInCwd(`git branch -D "${tempBranch}"`)
    }
    process.exit(1)
  }
}
