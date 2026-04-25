import https from 'node:https'
import { green, cyan, yellow } from 'kolorist'
import type { GitHubFork, GitHubUser } from './types.js'

const CENTRAL_REPO_OWNER = 'ZToolsCenter'
const CENTRAL_REPO_NAME = 'ZTools-plugins'

/**
 * GitHub API请求封装
 */
function githubRequest<T>(
  path: string,
  accessToken: string,
  method: string = 'GET',
  body?: any
): Promise<T> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : undefined
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'zTools-CLI',
        Accept: 'application/vnd.github.v3+json',
        ...(postData && {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        })
      }
    }

    const req = https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const statusCode = res.statusCode || 500

          if (statusCode >= 400) {
            const errorData = JSON.parse(data)
            reject(new Error(`GitHub API错误 (${statusCode}): ${errorData.message || data}`))
            return
          }

          // 处理204 No Content
          if (statusCode === 204) {
            resolve(null as T)
            return
          }

          const result = JSON.parse(data)
          resolve(result as T)
        } catch (error) {
          reject(new Error(`解析响应失败: ${(error as Error).message}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    if (postData) {
      req.write(postData)
    }
    req.end()
  })
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(accessToken: string): Promise<GitHubUser> {
  return githubRequest<GitHubUser>('/user', accessToken)
}

/**
 * 检查用户是否已fork中心仓库
 */
export async function checkForkExists(
  username: string,
  accessToken: string
): Promise<GitHubFork | null> {
  try {
    const fork = await githubRequest<GitHubFork>(
      `/repos/${username}/${CENTRAL_REPO_NAME}`,
      accessToken
    )
    // 检查是否确实是fork
    if (fork && fork.owner.login === username) {
      return fork
    }
    return null
  } catch (error) {
    // 404表示不存在
    if ((error as Error).message.includes('404')) {
      return null
    }
    throw error
  }
}

/**
 * Fork中心仓库
 */
export async function forkRepository(accessToken: string): Promise<GitHubFork> {
  console.log(cyan('正在fork中心仓库...'))

  const fork = await githubRequest<GitHubFork>(
    `/repos/${CENTRAL_REPO_OWNER}/${CENTRAL_REPO_NAME}/forks`,
    accessToken,
    'POST'
  )

  console.log(green('✓ Fork成功'))
  return fork
}

/**
 * 等待fork完成
 */
export async function waitForFork(
  username: string,
  accessToken: string,
  maxAttempts: number = 10
): Promise<GitHubFork> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const fork = await checkForkExists(username, accessToken)
    if (fork) {
      return fork
    }

    console.log(yellow(`  等待fork完成... (${i + 1}/${maxAttempts})`))
  }

  throw new Error('Fork超时，请稍后重试')
}

/**
 * 创建Pull Request
 */
export async function createPullRequest(
  accessToken: string,
  head: string,
  title: string,
  body: string
): Promise<{ html_url: string; number: number }> {
  console.log(cyan('\n正在检查Pull Request...'))

  // 先检查是否已存在PR
  const existingPR = await findExistingPR(accessToken, head)
  if (existingPR) {
    console.log(yellow('⚠ Pull Request已存在，已更新commits'))
    console.log(green('✓ Pull Request链接保持不变'))
    return existingPR
  }

  // 不存在则创建新PR（默认 draft，作者准备好后自行 mark Ready for review）
  console.log(cyan('正在创建Pull Request (draft)...'))
  const pr = await githubRequest<{ html_url: string; number: number }>(
    `/repos/${CENTRAL_REPO_OWNER}/${CENTRAL_REPO_NAME}/pulls`,
    accessToken,
    'POST',
    {
      title,
      head,
      base: 'main',
      body,
      draft: true
    }
  )

  console.log(green('✓ Pull Request 创建成功（draft 状态，准备好后请在网页上 Mark Ready for review）'))
  return pr
}

/**
 * 查找现有的PR
 */
async function findExistingPR(
  accessToken: string,
  head: string
): Promise<{ html_url: string; number: number } | null> {
  try {
    const prs = await githubRequest<Array<{ html_url: string; number: number; head: any }>>(
      `/repos/${CENTRAL_REPO_OWNER}/${CENTRAL_REPO_NAME}/pulls?state=open&head=${encodeURIComponent(head)}`,
      accessToken
    )

    if (prs && prs.length > 0) {
      return prs[0]
    }
    return null
  } catch (error) {
    console.error('查找PR失败:', error)
    return null
  }
}

/**
 * 上游中心仓库当前是否已经有 plugins/<name>/ 目录。
 * 用于判定本次发布是 "Add" 还是 "Update"——比依赖 fork 分支状态更准，
 * PR 合并 + 分支被自动删除后仍然能正确报告 Update。
 */
export async function pluginExistsUpstream(
  pluginName: string,
  accessToken: string
): Promise<boolean> {
  try {
    await githubRequest<unknown>(
      `/repos/${CENTRAL_REPO_OWNER}/${CENTRAL_REPO_NAME}/contents/plugins/${encodeURIComponent(pluginName)}`,
      accessToken
    )
    return true
  } catch (error) {
    if ((error as Error).message.includes('404')) return false
    // 任何其他错误都让上层兜底——这里返回 false 偏向"标 Add"，
    // 避免一次网络抖动让标题变成误导性的 Update。
    throw error
  }
}

/**
 * 把 fork 的 main 同步到 upstream/main（GitHub 原生 merge-upstream API）
 * 失败时不抛——上游不可达、无网或 fork 已分叉时都让发布流程继续，
 * 让本地 git fetch upstream 阶段决定如何处理。
 */
export async function syncForkMain(
  username: string,
  accessToken: string
): Promise<{ ok: boolean; message?: string }> {
  console.log(cyan('\n同步 fork 的 main 到上游...'))
  try {
    const result = await githubRequest<{ message: string; merge_type: string; base_branch: string }>(
      `/repos/${username}/${CENTRAL_REPO_NAME}/merge-upstream`,
      accessToken,
      'POST',
      { branch: 'main' }
    )
    console.log(green(`✓ ${result.merge_type === 'fast-forward' ? '已 fast-forward' : '已同步'}: ${result.message}`))
    return { ok: true, message: result.message }
  } catch (error) {
    const msg = (error as Error).message
    console.log(yellow(`⚠ fork main 同步失败（不影响后续流程）: ${msg}`))
    return { ok: false, message: msg }
  }
}

/**
 * 确保用户已fork仓库
 */
export async function ensureFork(username: string, accessToken: string): Promise<GitHubFork> {
  console.log(cyan('\n检查fork状态...'))

  let fork = await checkForkExists(username, accessToken)

  if (fork) {
    console.log(green('✓ 已找到fork'))
    return fork
  }

  console.log(yellow('未找到fork，正在创建...'))
  fork = await forkRepository(accessToken)

  // 等待fork完成
  console.log(cyan('等待fork完成...'))
  fork = await waitForFork(username, accessToken)

  return fork
}
