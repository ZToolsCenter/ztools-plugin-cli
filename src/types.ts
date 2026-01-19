export interface TemplateConfig {
  name: string
  display: string
  color: (str: string) => string
}

export interface ProjectOptions {
  projectName: string
  template: string
  pluginName: string // 插件 ID（只允许小写字母、数字和连字符）
  pluginTitle: string // 插件显示名称（无限制）
  description: string
  author: string
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn'

export interface GitHubToken {
  access_token: string
  token_type: string
  scope: string
  created_at: number
}

export interface GitHubUser {
  login: string
  name: string | null
  email: string | null
  html_url: string
  public_repos: number
}

export interface GitHubFork {
  id: number
  name: string
  full_name: string
  owner: {
    login: string
  }
  clone_url: string
  ssh_url: string
  html_url: string
}

export interface PluginConfig {
  name: string // 插件 ID（只允许小写字母、数字和连字符）
  title?: string // 插件显示名称（可选，无限制）
  description: string
  author: string
  version: string
  [key: string]: any
}

export interface CLIConfig {
  github?: GitHubToken
}

export interface CommitInfo {
  hash: string
  author: string
  date: string
  message: string
}
