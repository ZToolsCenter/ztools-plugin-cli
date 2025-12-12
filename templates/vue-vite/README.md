# {{PROJECT_NAME}}

{{DESCRIPTION}}

基于 Vue 3 + Vite + TypeScript 开发的 ZTools 插件。

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

```bash
npm run dev
```

这将启动 Vite 开发服务器在 `http://localhost:5173`，支持热更新（HMR）。

#### 在 ZTools 中加载开发中的插件

1. 启动开发服务器（`npm run dev`）
2. 打开 ZTools，进入 **设置 → 插件中心**
3. 点击 **"添加开发中插件"** 按钮
4. 选择当前插件项目的文件夹
5. 完成！现在可以在 ZTools 中测试你的插件了

> 💡 **提示**: 开发模式下，`plugin.json` 中的 `development.main` 会指向 `http://localhost:5173`，ZTools 会自动加载开发服务器的内容，修改代码后会自动热更新。

### 构建生产版本

```bash
npm run build
```

构建产物会输出到 `dist` 目录。

#### 发布插件

1. 构建项目：`npm run build`
2. 确保 `plugin.json` 中的 `main` 字段指向正确的入口文件（如 `dist/index.html`）
3. 将整个项目文件夹打包为 `.zip` 或 `.upx` 格式
4. 在 ZTools 中选择 **"导入本地插件"** 进行安装

## 📁 项目结构

```
.
├── public/
│   ├── logo.png              # 插件图标
│   ├── plugin.json          # 插件配置文件
│   └── preload/
│       └── services.ts      # Preload 脚本（Node.js 环境）
├── src/
│   ├── App.vue              # 根组件
│   ├── main.ts              # 入口文件
│   ├── env.d.ts             # 类型声明
│   ├── Hello/               # 示例：Hello 组件
│   ├── Read/                # 示例：读取文件
│   └── Write/               # 示例：写入文件
├── index.html               # HTML 入口
├── vite.config.js           # Vite 配置
├── tsconfig.json            # TypeScript 配置
└── package.json             # 项目配置
```

## 🔧 配置说明

### `plugin.json`

插件的核心配置文件：

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "{{PROJECT_NAME}}",
  "description": "{{DESCRIPTION}}",
  "version": "1.0.0",
  "main": "dist/index.html",        // 生产环境入口
  "preload": "preload/services.js", // Preload 脚本
  "logo": "logo.png",
  "development": {
    "main": "http://localhost:5173" // 开发环境入口
  },
  "features": [
    // 插件功能定义
  ]
}
```

### Preload 脚本

`public/preload/services.ts` 运行在 Node.js 环境，可以访问文件系统、系统 API 等。

```typescript
// 在 Preload 中定义服务
window.services = {
  readFile: (file: string) => {
    // Node.js API
  }
}
```

```vue
<!-- 在 Vue 组件中使用 -->
<script setup lang="ts">
const content = window.services.readFile('test.txt')
</script>
```

## 📚 API 文档

- [ZTools API 文档](https://github.com/ZToolsCenter/ztools-api-types)
- 使用 `window.ztools.*` 访问 ZTools API
- 完整类型提示支持 (TypeScript)

## 🛠️ 常见问题

### 1. 如何调试插件？

在 ZTools 中打开插件后，按 `Cmd/Ctrl + Shift + I` 打开开发者工具。

### 2. 如何访问 Node.js API？

在 `public/preload/services.ts` 中编写 Preload 脚本，通过 `window.services` 暴露给渲染进程。

### 3. 热更新不生效？

确保：
- 开发服务器正在运行（`npm run dev`）
- ZTools 中添加的是"开发中插件"（不是"导入插件"）
- `plugin.json` 中配置了 `development.main`

### 4. 构建后无法运行？

检查：
- `plugin.json` 中的 `main` 字段路径是否正确
- Preload 脚本路径是否正确（相对于 `plugin.json`）
- 所有资源文件是否包含在构建产物中

## 📄 许可证

MIT
