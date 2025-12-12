export interface TemplateConfig {
  name: string
  display: string
  color: (str: string) => string
}

export interface ProjectOptions {
  projectName: string
  template: string
  pluginName: string
  description: string
  author: string
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn'
