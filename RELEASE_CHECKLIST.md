# 📦 发布到 npm 检查清单

## 🎯 本次更新内容 (v1.0.28 → v1.1.0)

### 重要功能更新

1. **✅ 修复 Windows 兼容性问题**
   - 修复 `/bin/bash` 硬编码问题
   - 使用临时文件替代管道命令
   - 完全跨平台支持 (Windows/Linux/macOS)

2. **✅ 支持 Git Submodule**
   - 保持 submodule 引用而不是复制内容
   - 仓库体积更小
   - 版本管理更清晰

3. **✅ 优化发布流程**
   - 单次提交替代重放所有历史
   - 提交信息更清晰
   - 发布速度更快

4. **✅ 改进错误处理**
   - 更详细的错误信息
   - 更好的 commit message 转义
   - 支持包含特殊字符的文件名

---

## 🚀 发布步骤

### 1. 更新版本号

由于包含重要功能更新，建议升级到 **1.1.0**：

```bash
npm version minor  # 1.0.28 -> 1.1.0
```

或者手动编辑 `package.json`:
```json
"version": "1.1.0"
```

### 2. 重新编译

```bash
pnpm build
```

### 3. 检查构建产物

```bash
# 确认 dist/ 目录已更新
ls -la dist/

# 检查关键文件
cat dist/git.js | grep -A 5 "exportCommitFiles"
```

### 4. 登录 npm

```bash
npm login
# 输入用户名、密码、邮箱、OTP（如果启用了 2FA）
```

### 5. 发布到 npm

```bash
npm publish --access public
```

⚠️ 注意：`prepublishOnly` 脚本会自动运行 `pnpm build`

### 6. 验证发布

```bash
# 查看发布的版本
npm view @ztools-center/plugin-cli

# 全局安装测试
npm install -g @ztools-center/plugin-cli

# 测试命令
ztools --version
ztools create test-plugin
```

---

## 📝 发布注意事项

### ⚠️ 发布前确认

- [ ] 所有代码已提交到 Git
- [ ] 版本号已更新
- [ ] 构建无错误
- [ ] 已登录 npm (使用 ZTools 官方账号)
- [ ] 网络连接正常

### 📋 版本号规范

- **Major (1.x.x)**: 破坏性更改
- **Minor (x.1.x)**: 新功能，向后兼容
- **Patch (x.x.1)**: Bug 修复

当前更新属于 **Minor**（新功能 + Bug 修复）

---

## 🎉 发布后

### 1. 创建 Git Tag

```bash
git tag v1.1.0
git push origin v1.1.0
```

### 2. 更新 CHANGELOG

添加到 `CHANGELOG.md` 或创建 GitHub Release

### 3. 通知用户

在相关渠道通知更新：
- GitHub Discussions
- 项目文档
- 用户群

---

## 📖 本次更新说明文案

### 中文

```markdown
## v1.1.0

### 🎉 新功能
- 支持 Git Submodule（保持引用，不复制内容）
- 单次提交优化发布流程

### 🐛 Bug 修复
- 修复 Windows 系统兼容性问题（/bin/bash 错误）
- 修复包含中文文件名的文件处理
- 改进 commit message 特殊字符转义

### ⚡ 性能优化
- 发布速度更快（不再重放所有历史）
- 仓库体积更小（submodule 引用）

### 📦 其他改进
- 更详细的错误提示
- 更好的跨平台支持
```

### English

```markdown
## v1.1.0

### 🎉 New Features
- Support Git Submodule (keep reference instead of copying content)
- Optimize publish workflow with single commit

### 🐛 Bug Fixes
- Fix Windows compatibility issue (/bin/bash error)
- Fix handling files with Chinese characters
- Improve commit message escaping for special characters

### ⚡ Performance
- Faster publishing (no longer replaying all history)
- Smaller repository size (submodule references)

### 📦 Other Improvements
- More detailed error messages
- Better cross-platform support
```

---

## ✅ 快速发布命令

```bash
# 一键发布（确认所有检查项后执行）
npm version minor && \
pnpm build && \
npm publish --access public && \
git push && \
git push --tags
```
