import { cyan, green, red, yellow } from 'kolorist'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ZTOOLS_CONFIG_DIR = path.join(os.homedir(), '.config', 'ztools')
const FORK_REPO_DIR = path.join(ZTOOLS_CONFIG_DIR, 'ZTools-plugins')

const UPSTREAM_OWNER = 'ZToolsCenter'
const UPSTREAM_REPO = 'ZTools-plugins'
// Override only for local testing / staging mirrors; production resolves to GitHub.
const UPSTREAM_URL =
  process.env.ZTOOLS_UPSTREAM_URL || `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}.git`

const COPY_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.vscode',
  '.idea',
  '.parcel-cache'
])

const COPY_IGNORE_FILE_PATTERNS: RegExp[] = [
  /^\.DS_Store$/,
  /\.log$/,
  /^\.env(\..+)?$/,
  /^npm-debug\.log.*$/,
  /^yarn-debug\.log.*$/,
  /^yarn-error\.log.*$/
]

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
    const stderr = error.stderr?.toString() || ''
    const stdout = error.stdout?.toString() || ''
    const details = stderr || stdout || error.message
    throw new Error(`Git命令执行失败: ${command}\n${details}`)
  }
}

function tryGit(command: string, cwd?: string): { ok: true; output: string } | { ok: false; error: string } {
  try {
    return { ok: true, output: execGit(command, cwd) }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 检查当前目录是否是Git仓库
 */
export function isGitRepo(dir: string = process.cwd()): boolean {
  return tryGit('git rev-parse --git-dir', dir).ok
}

/**
 * 检查是否有commits
 */
export function hasCommits(dir: string = process.cwd()): boolean {
  return tryGit('git rev-parse HEAD', dir).ok
}

/**
 * 工作区是否干净（无未提交改动）。
 * 返回未跟踪/未提交的文件列表，干净则返回空数组。
 */
export function getWorkingTreeStatus(dir: string = process.cwd()): string[] {
  const r = tryGit('git status --porcelain', dir)
  if (!r.ok) return []
  return r.output.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
}

function buildAuthUrl(forkUrl: string, username: string, accessToken: string): string {
  return forkUrl.replace('https://', `https://${username}:${accessToken}@`)
}

/**
 * 准备好本地 fork 克隆：首次 clone，之后复用并 fetch。
 * 同时确保 origin（fork）/ upstream（中心仓库）两个 remote 都已配好。
 */
export async function ensureForkClone(
  forkUrl: string,
  username: string,
  accessToken: string
): Promise<void> {
  if (!fs.existsSync(ZTOOLS_CONFIG_DIR)) {
    fs.mkdirSync(ZTOOLS_CONFIG_DIR, { recursive: true })
  }

  const authForkUrl = buildAuthUrl(forkUrl, username, accessToken)

  if (isForkRepoCloned()) {
    console.log(cyan('\n复用本地 fork 克隆，拉取最新引用...'))
    execGit(`git remote set-url origin "${authForkUrl}"`, FORK_REPO_DIR)
    ensureUpstreamRemote()
    execGit('git fetch origin --prune', FORK_REPO_DIR)
    execGit('git fetch upstream --prune', FORK_REPO_DIR)
    console.log(green('✓ 本地 fork 已就绪'))
    return
  }

  if (fs.existsSync(FORK_REPO_DIR)) {
    console.log(yellow('检测到已存在但损坏的本地仓库，重新克隆...'))
    fs.rmSync(FORK_REPO_DIR, { recursive: true, force: true })
  }

  console.log(cyan('\n克隆 fork 仓库（首次）...'))
  execGit(`git clone "${authForkUrl}" "${FORK_REPO_DIR}"`, ZTOOLS_CONFIG_DIR)
  ensureUpstreamRemote()
  execGit('git fetch upstream --prune', FORK_REPO_DIR)
  console.log(green('✓ 克隆完成'))
}

function ensureUpstreamRemote(): void {
  const remotes = tryGit('git remote', FORK_REPO_DIR)
  if (!remotes.ok) {
    throw new Error('无法读取 git remote 列表')
  }
  const list = remotes.output.split('\n').map((s) => s.trim())
  if (!list.includes('upstream')) {
    execGit(`git remote add upstream "${UPSTREAM_URL}"`, FORK_REPO_DIR)
  } else {
    execGit(`git remote set-url upstream "${UPSTREAM_URL}"`, FORK_REPO_DIR)
  }
}

/**
 * 切到 plugin/<name> 分支：
 *  - 若 origin（fork）已有同名分支：以 origin 为基础 checkout，保留远端历史。
 *  - 否则：基于 upstream/main 新建。
 * 返回值用于上层判断是首次发布还是后续发布。
 */
export function prepareBranch(pluginName: string): { existedRemotely: boolean; branchName: string } {
  const branchName = `plugin/${pluginName}`
  console.log(cyan(`\n准备分支: ${branchName}`))

  const remoteRefCheck = tryGit(
    `git ls-remote --exit-code --heads origin "${branchName}"`,
    FORK_REPO_DIR
  )
  const existedRemotely = remoteRefCheck.ok

  if (existedRemotely) {
    execGit(`git fetch origin ${branchName}:refs/remotes/origin/${branchName}`, FORK_REPO_DIR)

    // 若本地缓存已存在该分支，检测它是否落后于（或偏离于）远端。
    // 落后通常意味着审核者/他人直接在 PR 分支上推送过新 commit；为避免覆盖，
    // 直接拒绝发布，让用户先把那些改动同步回本地工作目录。
    const localBranchExists = tryGit(`git rev-parse --verify "${branchName}"`, FORK_REPO_DIR).ok
    if (localBranchExists) {
      const localTip = execGit(`git rev-parse "${branchName}"`, FORK_REPO_DIR)
      const remoteTip = execGit(`git rev-parse "refs/remotes/origin/${branchName}"`, FORK_REPO_DIR)
      if (localTip !== remoteTip) {
        const remoteIsAncestor = tryGit(
          `git merge-base --is-ancestor "refs/remotes/origin/${branchName}" "${branchName}"`,
          FORK_REPO_DIR
        ).ok
        if (!remoteIsAncestor) {
          // 远端 tip 不是本地 tip 的祖先 → 本地落后或与远端分叉。
          throw new Error(
            [
              `远端 ${branchName} 分支有你本地缓存中没有的新 commit。`,
              '这通常意味着审核者或他人直接在 PR 分支上做了改动。',
              `远端 tip: ${remoteTip.slice(0, 8)}    本地 tip: ${localTip.slice(0, 8)}`,
              '',
              '请先把这些改动同步回本地，再次发布：',
              '  $ ztools pull-contributions',
              '  # 检查 git log -1 -p 内容，按需调整后再次',
              '  $ ztools publish'
            ].join('\n')
          )
        }
        // remote 是 local 的祖先 → 本地领先或一致；checkout 时仍以远端为基保险，
        // 但实际上等于不动（因为 origin 已经是 ancestor）。继续走下去。
      }
    }

    execGit(`git checkout -B ${branchName} refs/remotes/origin/${branchName}`, FORK_REPO_DIR)
    console.log(green('✓ 已切到现有远端分支（将在其基础上追加新 commit）'))
  } else {
    execGit(`git checkout -B ${branchName} refs/remotes/upstream/main`, FORK_REPO_DIR)
    console.log(green('✓ 已基于 upstream/main 新建分支'))
  }

  return { existedRemotely, branchName }
}

function shouldIgnoreEntry(name: string, isDir: boolean): boolean {
  if (isDir) {
    return COPY_IGNORE_DIRS.has(name)
  }
  return COPY_IGNORE_FILE_PATTERNS.some((re) => re.test(name))
}

/**
 * 远端 fork 上是否存在 plugin/<name> 分支。
 */
export function remotePluginBranchExists(pluginName: string): boolean {
  const branchName = `plugin/${pluginName}`
  return tryGit(
    `git ls-remote --exit-code --heads origin "${branchName}"`,
    FORK_REPO_DIR
  ).ok
}

/**
 * 拉取并切换到 fork 远端的 plugin/<name> 分支（不做 behind 检测——
 * 调用者就是为了同步远端进展才执行的）。
 */
export function checkoutForkBranchForPull(pluginName: string): void {
  const branchName = `plugin/${pluginName}`
  execGit(`git fetch origin ${branchName}:refs/remotes/origin/${branchName}`, FORK_REPO_DIR)
  execGit(`git checkout -B ${branchName} refs/remotes/origin/${branchName}`, FORK_REPO_DIR)
}

/**
 * 把 fork 仓库 plugins/<name>/ 的内容镜像到用户工作目录。
 * 仅复制覆盖；不主动删除用户本地多出来的文件（与 Raycast 行为一致）。
 */
export function mirrorForkPluginToCwd(pluginName: string, destDir: string): void {
  const sourceDir = path.join(FORK_REPO_DIR, 'plugins', pluginName)
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`fork 仓库里找不到 plugins/${pluginName}/，PR 分支可能已被删除或为空`)
  }
  copyDirRecursive(sourceDir, destDir)
}

/**
 * 把用户工作目录的插件文件复制到 fork 仓库的 plugins/<name>/ 下。
 * 复制前先清空目标目录，确保用户本地删除的文件也会反映到 fork。
 */
export function copyPluginFiles(pluginName: string, sourceDir: string): void {
  const destDir = path.join(FORK_REPO_DIR, 'plugins', pluginName)
  console.log(cyan(`\n同步插件文件到 plugins/${pluginName}/ ...`))

  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true })
  }
  fs.mkdirSync(destDir, { recursive: true })

  copyDirRecursive(sourceDir, destDir)
  console.log(green('✓ 文件同步完成'))
}

function copyDirRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (shouldIgnoreEntry(entry.name, entry.isDirectory())) continue
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      copyDirRecursive(srcPath, destPath)
    } else if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(srcPath)
      fs.symlinkSync(link, destPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * 在 fork 仓库提交本次插件变更。
 * 无变更时返回 false。
 */
export function commitPluginChanges(
  pluginName: string,
  title: string,
  options: { body?: string; authorName?: string; authorEmail?: string } = {}
): boolean {
  execGit(`git add "plugins/${pluginName}"`, FORK_REPO_DIR)

  const diff = tryGit('git diff --cached --quiet', FORK_REPO_DIR)
  if (diff.ok) {
    return false
  }

  const { body, authorName, authorEmail } = options

  // Resolve identity (author/committer fallback ladder).
  let authorN = authorName?.trim() || ''
  let authorE = authorEmail?.trim() || ''
  const cn = tryGit('git config user.name', FORK_REPO_DIR)
  const ce = tryGit('git config user.email', FORK_REPO_DIR)
  let committerN = cn.ok ? cn.output : ''
  let committerE = ce.ok ? ce.output : ''
  if (!committerN) committerN = authorN || 'ztools-cli'
  if (!committerE) committerE = authorE || 'ztools-cli@local'
  if (!authorN) authorN = committerN
  if (!authorE) authorE = committerE

  // Use a tmpfile to pass the message — avoids shell-escaping multi-line bodies.
  const msgFile = path.join(FORK_REPO_DIR, '.git', `COMMIT_EDITMSG_ztools_${Date.now()}`)
  const message = body && body.trim().length > 0 ? `${title}\n\n${body.trim()}\n` : `${title}\n`
  fs.writeFileSync(msgFile, message, 'utf-8')

  const q = (s: string) => s.replace(/"/g, '\\"')
  try {
    const cmd =
      `git -c user.name="${q(committerN)}" -c user.email="${q(committerE)}" ` +
      `commit --author="${q(authorN)} <${q(authorE)}>" -F "${msgFile}"`
    execGit(cmd, FORK_REPO_DIR)
  } finally {
    try {
      fs.unlinkSync(msgFile)
    } catch {
      /* ignore */
    }
  }
  return true
}

/**
 * 推送分支到远程（普通 push，不 force）。
 */
export async function pushPluginBranch(pluginName: string): Promise<void> {
  const branchName = `plugin/${pluginName}`
  console.log(cyan(`\n推送分支到远端: ${branchName}`))
  const result = tryGit(`git push -u origin ${branchName}`, FORK_REPO_DIR)
  if (result.ok) {
    console.log(green('✓ 推送成功'))
    return
  }

  const err = result.error.toLowerCase()
  if (err.includes('non-fast-forward') || err.includes('rejected') || err.includes('fetch first')) {
    throw new Error(
      [
        '推送被拒绝：远端分支已经有你本地没有的 commit（可能是审核者或他人推送过）。',
        '解决方法（任选其一）：',
        `  1) 进入 ${FORK_REPO_DIR}，执行 git pull --ff-only origin ${branchName} 后重试 ztools publish`,
        `  2) 删除本地缓存仓库（rm -rf ${FORK_REPO_DIR}）后重试，CLI 会重新克隆并基于远端分支继续追加`
      ].join('\n')
    )
  }
  throw new Error(`推送失败: ${result.error}`)
}

/**
 * 在用户当前插件仓库给 HEAD 打/移动 `ztools-last-publish` 标签。
 * pull-contributions 会以这个标签为 3-way merge 的 base。
 */
export function tagLastPublishLocally(dir: string = process.cwd()): void {
  execGit('git tag -f ztools-last-publish HEAD', dir)
}

/**
 * 读取 ztools-last-publish 标签指向的 commit；未打过则返回 null。
 */
export function getLastPublishCommit(dir: string = process.cwd()): string | null {
  const r = tryGit('git rev-parse --verify ztools-last-publish^{commit}', dir)
  return r.ok ? r.output : null
}

/**
 * 当前是否在某个具名分支上（非 detached HEAD）。
 */
export function getCurrentBranchName(dir: string = process.cwd()): string | null {
  const r = tryGit('git symbolic-ref --short HEAD', dir)
  return r.ok ? r.output : null
}

/**
 * 取本地插件仓库自上次成功 publish 以来的 commit subject 列表。
 * 没打过 ztools-last-publish 标签时退化为整段历史，按时间顺序返回。
 */
export function getLocalCommitSubjectsSinceLastPublish(
  dir: string = process.cwd()
): string[] {
  const tag = getLastPublishCommit(dir)
  const range = tag ? 'ztools-last-publish..HEAD' : ''
  const r = tryGit(`git log --reverse --pretty=format:%s ${range}`, dir)
  if (!r.ok) return []
  return r.output
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
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
