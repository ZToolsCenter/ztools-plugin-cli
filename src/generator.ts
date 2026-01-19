import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectOptions } from './types.js'
import { copyDir, replaceTemplateVarsInDir } from './utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 生成项目
 */
export async function generateProject(options: ProjectOptions): Promise<void> {
  const { projectName, template, pluginName, pluginTitle, description, author } = options

  // 获取模板目录
  const templateDir = path.resolve(__dirname, '../templates', template)
  const targetDir = path.resolve(process.cwd(), projectName)

  // 检查模板是否存在
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template "${template}" not found`)
  }

  // 检查目标目录
  if (fs.existsSync(targetDir)) {
    throw new Error(`Directory "${projectName}" already exists`)
  }

  // 复制模板
  copyDir(templateDir, targetDir)

  // 替换模板变量
  const vars = {
    PROJECT_NAME: projectName,
    PLUGIN_NAME: pluginName,
    PLUGIN_TITLE: pluginTitle,
    DESCRIPTION: description,
    AUTHOR: author
  }

  replaceTemplateVarsInDir(targetDir, vars)

  console.log(`\n✅ Project created successfully!\n`)
}
