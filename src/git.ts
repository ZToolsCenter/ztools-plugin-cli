import { execSync, exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { green, red, cyan, yellow } from 'kolorist'
import type { CommitInfo } from './types.js'

const ZTOOLS_CONFIG_DIR = path.join(os.homedir(), '.config', 'ztools')
const FORK_REPO_DIR = path.join(ZTOOLS_CONFIG_DIR, 'ZTools-plugins')

/**
 * 执行Git命令
 */
function execGit(command: string, cwd?: string): string {
  try {
    return execSync(command, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
  } catch (error: any) {
    throw new Error(`Git命令执行失败: ${command}\n${error.message}`)
  }
}

/**
 * 异步执行Git命令
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function execGitAsync(command: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd: cwd || process.cwd(),
        encoding: 'utf-8'
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Git命令执行失败: ${command}\n${stderr || error.message}`))
        } else {
          resolve(stdout.trim())
        }
      }
    )
  })
}

/**
 * 检查当前目录是否是Git仓库
 */
export function isGitRepo(dir: string = process.cwd()): boolean {
  try {
    execGit('git rev-parse --git-dir', dir)
    return true
  } catch {
    return false
  }
}

/**
 * 检查是否有commits
 */
export function hasCommits(dir: string = process.cwd()): boolean {
  try {
    execGit('git rev-parse HEAD', dir)
    return true
  } catch {
    return false
  }
}

/**
 * 获取提交历史(按时间顺序)
 */
export function getCommitHistory(dir: string = process.cwd()): CommitInfo[] {
  try {
    // 使用%s获取单行commit message，避免%B的多行问题
    const separator = '<<<COMMIT_SEP>>>'
    const format = `%H${separator}%an <%ae>${separator}%ad${separator}%s`

    const output = execGit(`git log --reverse --format="${format}"`, dir)

    if (!output) {
      return []
    }

    const commits: CommitInfo[] = []
    const lines = output.split('\n').filter((line) => line.trim())

    for (const line of lines) {
      const parts = line.split(separator)
      if (parts.length >= 4) {
        commits.push({
          hash: parts[0].trim(),
          author: parts[1].trim(),
          date: parts[2].trim(),
          message: parts[3].trim()
        })
      }
    }

    return commits
  } catch (error) {
    console.error(red('读取commit历史失败:'), (error as Error).message)
    return []
  }
}

/**
 * 导出某个commit的文件到目标目录
 */
export function exportCommitFiles(
  commitHash: string,
  targetDir: string,
  sourceDir: string = process.cwd()
): void {
  try {
    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // 使用git archive导出文件
    const archiveCmd = `git archive ${commitHash} | tar -x -C "${targetDir}"`
    execSync(archiveCmd, {
      cwd: sourceDir,
      shell: '/bin/bash'
    })
  } catch (error) {
    throw new Error(`导出commit文件失败: ${(error as Error).message}`)
  }
}

/**
 * Sparse checkout克隆fork仓库
 */
export async function cloneForkRepo(
  forkUrl: string,
  username: string,
  accessToken: string
): Promise<void> {
  console.log(cyan('\n检出fork仓库...'))

  // 确保配置目录存在
  if (!fs.existsSync(ZTOOLS_CONFIG_DIR)) {
    fs.mkdirSync(ZTOOLS_CONFIG_DIR, { recursive: true })
  }

  // 如果已存在，先删除
  if (fs.existsSync(FORK_REPO_DIR)) {
    console.log(yellow('删除旧的本地仓库...'))
    fs.rmSync(FORK_REPO_DIR, { recursive: true, force: true })
  }

  try {
    // 构建带认证的URL
    const urlWithAuth = forkUrl.replace('https://', `https://${username}:${accessToken}@`)

    // Clone with sparse checkout
    console.log(cyan('正在克隆仓库...'))
    execGit(
      `git clone --no-checkout --filter=blob:none "${urlWithAuth}" "${FORK_REPO_DIR}"`,
      ZTOOLS_CONFIG_DIR
    )

    // 初始化sparse checkout，但不检出任何内容
    execGit('git sparse-checkout init --cone', FORK_REPO_DIR)
    execGit('git sparse-checkout set --no-cone', FORK_REPO_DIR)

    // Checkout main分支
    execGit('git checkout main', FORK_REPO_DIR)

    console.log(green('✓ 仓库检出完成'))
  } catch (error) {
    throw new Error(`克隆fork仓库失败: ${(error as Error).message}`)
  }
}

/**
 * 创建插件分支
 */
export function createPluginBranch(pluginName: string): void {
  const branchName = `plugin/${pluginName}`

  try {
    console.log(cyan(`\n创建分支: ${branchName}`))

    // 添加特定插件目录到sparse checkout
    execGit(`git sparse-checkout add plugins/${pluginName}`, FORK_REPO_DIR)

    // 创建plugins目录（如果不存在）
    const pluginsDir = path.join(FORK_REPO_DIR, 'plugins')
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true })
    }

    // 检查分支是否已存在
    try {
      execGit(`git rev-parse --verify ${branchName}`, FORK_REPO_DIR)
      // 分支已存在，切换到该分支
      console.log(yellow('分支已存在，切换到该分支'))
      execGit(`git checkout ${branchName}`, FORK_REPO_DIR)
    } catch {
      // 分支不存在，创建新分支
      execGit(`git checkout -b ${branchName}`, FORK_REPO_DIR)
      console.log(green('✓ 分支创建成功'))
    }
  } catch (error) {
    throw new Error(`创建分支失败: ${(error as Error).message}`)
  }
}

/**
 * 重放commits到fork仓库
 */
export async function replayCommits(
  commits: CommitInfo[],
  pluginName: string,
  sourceDir: string
): Promise<void> {
  const pluginDir = path.join(FORK_REPO_DIR, 'plugins', pluginName)

  console.log(cyan(`\n开始重放${commits.length}个commit...`))

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    console.log(cyan(`  [${i + 1}/${commits.length}] ${commit.message.split('\n')[0]}`))

    try {
      // 清空插件目录
      if (fs.existsSync(pluginDir)) {
        const files = fs.readdirSync(pluginDir)
        for (const file of files) {
          fs.rmSync(path.join(pluginDir, file), { recursive: true, force: true })
        }
      }

      // 导出commit的文件到插件目录
      exportCommitFiles(commit.hash, pluginDir, sourceDir)

      // 添加到git
      execGit(`git add plugins/${pluginName}`, FORK_REPO_DIR)

      // 提交(保留原始author和date)
      const commitCmd = `git commit --author="${commit.author}" --date="${commit.date}" -m "${commit.message.replace(/"/g, '\\"')}"`
      execGit(commitCmd, FORK_REPO_DIR)
    } catch (error) {
      // 如果没有变更，可能会报错，这是正常的
      const errorMsg = (error as Error).message
      if (!errorMsg.includes('nothing to commit')) {
        throw new Error(`重放commit失败: ${errorMsg}`)
      }
    }
  }

  console.log(green(`✓ 成功重放${commits.length}个commit`))
}

/**
 * 推送分支到远程
 */
export async function pushBranch(pluginName: string): Promise<void> {
  const branchName = `plugin/${pluginName}`

  try {
    console.log(cyan(`\n推送分支到远程: ${branchName}`))

    // 使用force推送(因为可能是第二次publish)
    execGit(`git push -f origin ${branchName}`, FORK_REPO_DIR)

    console.log(green('✓ 推送成功'))
  } catch (error) {
    throw new Error(`推送失败: ${(error as Error).message}`)
  }
}

/**
 * 检查fork仓库是否已克隆
 */
export function isForkRepoCloned(): boolean {
  return fs.existsSync(FORK_REPO_DIR) && isGitRepo(FORK_REPO_DIR)
}

/**
 * 获取fork仓库路径
 */
export function getForkRepoPath(): string {
  return FORK_REPO_DIR
}
