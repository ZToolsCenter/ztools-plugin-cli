# 发布指南

## 发布到 GitHub 独立仓库

### 前置要求

1. 在 GitHub 创建仓库：`ZToolsCenter/ztools-plugin-cli`
   - 可以是 Public（推荐）或 Private
   - **不要**初始化 README、.gitignore 或 license
   - 仓库描述：`ZTools 插件 CLI 工具 - 快速创建 ZTools 插件项目`

### 发布步骤

#### Linux/Mac 用户

```bash
# 在 ZTools 根目录运行
cd d:/Projects/Github/ZTools
bash scripts/publish-plugin-cli.sh
```

#### Windows 用户

```cmd
# 在 ZTools 根目录运行
cd d:\Projects\Github\ZTools
scripts\publish-plugin-cli.bat
```

### 发布原理

使用 `git subtree push` 将 `ztools-plugin-cli` 子目录推送到独立仓库：

```bash
git subtree push --prefix=ztools-plugin-cli https://github.com/ZToolsCenter/ztools-plugin-cli.git main
```

### 优势

- ✅ 保持主仓库的 monorepo 结构
- ✅ 独立仓库便于单独克隆和使用
- ✅ 自动同步最新代码
- ✅ 保留完整的 git 历史

---

## 发布到 npm

### 方式 1：从主仓库发布（推荐）

```bash
cd d:/Projects/Github/ZTools/ztools-plugin-cli
npm run build
npm publish --access public
```

### 方式 2：从独立仓库发布

```bash
# 克隆独立仓库
git clone https://github.com/ZToolsCenter/ztools-plugin-cli.git
cd ztools-plugin-cli

# 安装依赖并发布
npm install
npm run build
npm publish --access public
```

### npm 包信息

- **包名**: `@ztools-center/plugin-cli`
- **命令**: `ztools`
- **已发布**: https://www.npmjs.com/package/@ztools-center/plugin-cli

---

## 更新流程

1. 在主仓库 `ZTools` 中修改 `ztools-plugin-cli/` 的代码
2. 提交并推送到主仓库
3. 运行发布脚本同步到独立仓库
4. （可选）发布新版本到 npm

```bash
# 更新版本号
cd ztools-plugin-cli
npm version patch  # 或 minor, major

# 发布到 npm
npm run build
npm publish --access public

# 同步到 GitHub 独立仓库
cd ..
bash scripts/publish-plugin-cli.sh
```
