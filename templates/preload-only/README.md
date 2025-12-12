# {{PROJECT_NAME}}

{{DESCRIPTION}}

纯 Preload 脚本的 ZTools 插件（无界面）。

## 🚀 快速开始

### 安装依赖

```bash
npm install
# 或
pnpm install
# 或
yarn install
```

### 开发模式

#### 编译 TypeScript

```bash
npm run build
```

#### 在 ZTools 中加载开发中的插件

1. 编译项目（`npm run build`）
2. 打开 ZTools，进入 **设置 → 插件中心**
3. 点击 **"添加开发中插件"** 按钮
4. 选择当前插件项目的文件夹
5. 完成！现在可以在 ZTools 中测试你的插件了

> 💡 **提示**: 纯 Preload 插件没有界面，所有逻辑都在 `src/preload.ts` 中。修改代码后需要重新编译并在 ZTools 中重新加载插件。

### 发布插件

1. 构建项目：`npm run build`
2. 确保 `plugin.json` 配置正确
3. 将整个项目文件夹打包为 `.zip` 或 `.upx` 格式
4. 在 ZTools 中选择 **"导入本地插件"** 进行安装

## 📁 项目结构

```
.
├── logo.png                 # 插件图标
├── plugin.json              # 插件配置文件
├── src/
│   └── preload.ts           # Preload 脚本源码（TypeScript）
├── dist/
│   └── preload.js           # 编译后的 JavaScript
├── tsconfig.json            # TypeScript 配置
└── package.json             # 项目配置
```

## 🔧 配置说明

### `plugin.json`

纯 Preload 插件不需要 `main` 字段，只需要 `preload`：

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "{{PROJECT_NAME}}",
  "description": "{{DESCRIPTION}}",
  "version": "1.0.0",
  "preload": "dist/preload.js",  // 编译后的脚本
  "logo": "logo.png",
  "features": [
    {
      "code": "example",
      "explain": "示例功能",
      "cmds": ["example", "示例"]
    }
  ]
}
```

### Preload 脚本

`src/preload.ts` 可以访问完整的 Node.js API 和 ZTools API：

```typescript
import { exec } from 'node:child_process'

// 监听插件进入事件
window.ztools.onPluginEnter((action) => {
  console.log('Plugin entered:', action)
  
  // 执行操作
  if (action.code === 'example') {
    window.ztools.showNotification('Hello from preload!')
    window.ztools.hideMainWindow()
  }
})
```

## 📚 API 文档

- [ZTools API 文档](https://github.com/ZToolsCenter/ztools-api-types)
- 使用 `window.ztools.*` 访问 ZTools API
- 完整类型提示支持 (TypeScript)

## 🛠️ 常见问题

### 1. 为什么要用纯 Preload 插件？

纯 Preload 插件适合：
- 快捷操作、脚本执行等不需要界面的场景
- 系统命令、文件操作等后台任务
- 启动速度要求高的场景（无需加载前端框架）

### 2. 如何调试？

在 ZTools 中使用插件时，查看主窗口的控制台（`Cmd/Ctrl + Shift + I`）。

### 3. 修改代码后如何生效？

1. 运行 `npm run build` 重新编译
2. 在 ZTools 插件中心点击"重新加载"按钮
3. 或重启 ZTools

### 4. 可以显示界面吗？

纯 Preload 插件本身不能显示界面，但可以：
- 使用 `window.ztools.showNotification()` 显示通知
- 使用 `window.ztools.createBrowserWindow()` 创建新窗口
- 使用 `window.ztools.redirect()` 跳转到其他插件

## 📄 许可证

MIT
