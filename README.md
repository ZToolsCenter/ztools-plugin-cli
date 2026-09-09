# ZTools Plugin CLI

快速创建和发布 ZTools 插件项目的命令行工具。

## 安装

```bash
npm install -g @ztools-center/plugin-cli
# 或
pnpm add -g @ztools-center/plugin-cli
```

## 命令

### create - 创建插件项目

创建一个新的 ZTools 插件项目。

```bash
ztools create <project-name>
```

**示例：**

```bash
ztools create my-awesome-plugin
```

这将引导你完成以下步骤：

1. 选择模板（Vue + Vite、React + Vite 或 Preload Only）
2. 输入插件信息（名称、描述、作者等）
3. 自动生成项目文件

**可用模板：**

- **Vue + TypeScript + Vite** - 使用 Vue 3 开发插件 UI
- **React + TypeScript + Vite** - 使用 React 开发插件 UI
- **Preload Only (TypeScript)** - 仅使用 Preload API，无 UI 界面

---

### publish - 发布插件

将插件提交 Pull Request 到 ZTools 中心插件仓库。

```bash
ztools publish
```

**前置条件：**

1. 在插件项目根目录执行
2. 项目包含 `src-ztools/plugin.json`、根目录 `plugin.json` 或 `public/plugin.json` 文件
3. 已初始化 Git 仓库（`git init`）
4. 至少有一次提交记录

**首次使用：**

首次执行 `ztools publish` 时：

1. 自动打开浏览器进行 GitHub OAuth 认证
2. 授权成功后，Token 将保存到本地（`~/.config/ztools/cli-config.json`）
3. 后续使用将自动使用已保存的 Token

**发布流程：**

```bash
# 1. 开发插件
ztools create my-plugin
cd my-plugin

# 2. 开发功能...

# 3. 提交代码
git init
git add .
git commit -m "Initial commit"

# 4. 发布插件
ztools publish
```

**自动处理的事项：**

- ✅ GitHub OAuth 认证
- ✅ Fork 中心插件仓库（如果尚未 fork）
- ✅ 创建插件分支（`plugin/{插件名称}`）
- ✅ 重放所有 commit 历史到插件目录
- ✅ 推送到你的 fork 仓库
- ✅ 创建 Pull Request 到中心仓库

**多次发布：**

如果你修改了插件并再次执行 `ztools publish`，将会：

- 保留所有新的 commit 历史
- 创建新的 Pull Request

**本地存储：**

- Token 配置：`~/.config/ztools/cli-config.json`
- Fork 仓库缓存：`~/.config/ztools/ZTools-plugins`

---

## 开发

- 🚀 快速创建项目
- 📦 TypeScript 支持
- 🎨 交互式命令行
- 🔧 自动配置类型定义
- 📝 JSON Schema 验证

## 文档

- [ZTools](https://github.com/ZToolsCenter/ZTools)
- [API 类型定义](https://www.npmjs.com/package/@ztools-center/ztools-api-types)

## License

MIT
