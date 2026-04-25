import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import https from 'node:https'
import { exec } from 'node:child_process'
import { green, red, yellow, cyan, blue } from 'kolorist'
import type { CLIConfig, GitHubToken, GitHubUser } from './types.js'

// Device Flow 不需要 clientSecret
// 需要 workflow scope，因为中心仓库 main 上含 .github/workflows/*.yml；
// 即使 publish 不修改这些文件，从 upstream/main 衍生的分支推到 fork
// 时 GitHub 也会校验 token 是否拥有 workflow scope。
const GITHUB_CONFIG = {
  clientId: 'Ov23liLg5G9eD70HMXay',
  scope: 'user repo workflow'
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'ztools')
const CONFIG_FILE = path.join(CONFIG_DIR, 'cli-config.json')

/**
 * 读取配置文件
 */
export function readConfig(): CLIConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return {}
    }
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error(red('读取配置文件失败:'), error)
    return {}
  }
}

/**
 * 保存配置文件
 */
export function saveConfig(config: CLIConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error(red('保存配置文件失败:'), error)
    throw error
  }
}

/**
 * 获取GitHub Token
 */
export function getToken(): GitHubToken | null {
  const config = readConfig()
  return config.github || null
}

/**
 * 保存GitHub Token
 */
export function saveToken(token: GitHubToken): void {
  const config = readConfig()
  config.github = token
  saveConfig(config)
}

/**
 * 清除GitHub Token
 */
export function clearToken(): void {
  const config = readConfig()
  delete config.github
  saveConfig(config)
}

/**
 * 在默认浏览器中打开URL
 */
function openBrowser(url: string): void {
  const platform = process.platform
  let command: string

  if (platform === 'darwin') {
    command = `open "${url}"`
  } else if (platform === 'win32') {
    command = `start "" "${url}"`
  } else {
    command = `xdg-open "${url}"`
  }

  exec(command, (error) => {
    if (error) {
      console.error(red('打开浏览器失败:'), error.message)
      console.log(yellow('\n请手动访问以下URL:'))
      console.log(cyan(url))
    }
  })
}

/**
 * HTTP请求封装
 */
function request(url: string, method: string, body: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body)
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'zTools-CLI',
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    const req = https.request(url, options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          console.error(red('解析响应失败:'), e)
          reject(new Error(`解析响应失败: ${data}`))
        }
      })
    })

    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

/**
 * 获取用户信息(验证token是否有效)
 */
export function getUserInfo(accessToken: string): Promise<GitHubUser> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: '/user',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'zTools-CLI',
        Accept: 'application/vnd.github.v3+json'
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`))
            return
          }
          const userInfo = JSON.parse(data)
          resolve(userInfo as GitHubUser)
        } catch (error) {
          reject(new Error(`解析用户信息失败: ${(error as Error).message}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.end()
  })
}

/**
 * 启动Device Flow认证流程
 */
export async function startOAuthFlow(): Promise<GitHubToken> {
  console.log(cyan('\n🔐 正在启动GitHub Device Flow认证...\n'))

  // 1. 请求设备代码
  const deviceRes = await request('https://github.com/login/device/code', 'POST', {
    client_id: GITHUB_CONFIG.clientId,
    scope: GITHUB_CONFIG.scope
  })

  if (!deviceRes.device_code) {
    throw new Error(`获取设备代码失败: ${deviceRes.error_description || JSON.stringify(deviceRes)}`)
  }

  console.log(cyan(`DEBUG: deviceRes: ${JSON.stringify(deviceRes)}`))

  const { device_code, user_code, verification_uri, interval } = deviceRes

  // 确保轮询间隔至少为5秒
  let pollInterval = (interval || 10) * 1000

  // 2. 显示验证码并打开浏览器
  console.log(yellow('! 请在打开的浏览器中输入以下验证码:'))
  console.log(blue(green(`\n    ${user_code}\n`)))
  console.log(yellow(`验证地址: ${verification_uri}`))
  console.log(cyan('\n正在打开浏览器...\n'))

  openBrowser(verification_uri)

  // 3. 轮询等待Token
  console.log('等待用户授权...')

  return new Promise((resolve, reject) => {
    const poll = async (): Promise<void> => {
      try {
        const tokenRes = await request('https://github.com/login/oauth/access_token', 'POST', {
          client_id: GITHUB_CONFIG.clientId,
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })

        if (tokenRes.access_token) {
          const token: GitHubToken = {
            access_token: tokenRes.access_token,
            token_type: tokenRes.token_type,
            scope: tokenRes.scope,
            created_at: Date.now()
          }

          // 验证并显示用户信息
          try {
            const userInfo = await getUserInfo(token.access_token)
            console.log(green('\n✓ 认证成功'))
            console.log(cyan(`  用户名: ${userInfo.login}`))
            console.log(cyan(`  姓名: ${userInfo.name || 'N/A'}\n`))
            resolve(token)
          } catch (e) {
            reject(new Error(`Token验证失败: ${(e as Error).message}`))
          }
          return
        }

        if (tokenRes.error) {
          if (tokenRes.error === 'authorization_pending') {
            // 继续等待，使用当前间隔
            process.stdout.write('.')
            setTimeout(poll, pollInterval)
          } else if (tokenRes.error === 'slow_down') {
            // GitHub要求增加轮询间隔(通常增加5秒)
            pollInterval += 5000
            process.stdout.write('.')
            setTimeout(poll, pollInterval)
          } else if (tokenRes.error === 'expired_token') {
            reject(new Error('验证码已过期，请重试'))
          } else {
            reject(new Error(`认证错误: ${tokenRes.error_description}`))
          }
        } else {
          // 如果没有token也没有error，继续轮询
          setTimeout(poll, pollInterval)
        }
      } catch (error) {
        reject(error)
      }
    }

    // 开始第一次轮询
    setTimeout(poll, pollInterval)
  })
}

/**
 * 确保有有效的Token
 */
export async function ensureAuth(): Promise<string> {
  let token = getToken()

  if (token) {
    try {
      // 验证token是否有效
      await getUserInfo(token.access_token)
      return token.access_token
    } catch (error) {
      console.error(red('Token验证失败:'), error)
      console.log(yellow('⚠ 现有token已失效，需要重新认证'))
      clearToken()
    }
  }

  // 启动OAuth流程
  token = await startOAuthFlow()
  saveToken(token)
  return token.access_token
}
