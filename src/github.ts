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

  // 不存在则创建新PR
  console.log(cyan('正在创建Pull Request...'))
  const pr = await githubRequest<{ html_url: string; number: number }>(
    `/repos/${CENTRAL_REPO_OWNER}/${CENTRAL_REPO_NAME}/pulls`,
    accessToken,
    'POST',
    {
      title,
      head,
      base: 'main',
      body
    }
  )

  console.log(green('✓ Pull Request创建成功'))
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
