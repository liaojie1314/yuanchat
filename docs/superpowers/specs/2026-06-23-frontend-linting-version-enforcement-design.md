# 前端样式检查 + 版本强制锁定 — 设计文档

**日期**: 2026-06-23
**目标**: 添加 Stylelint 样式检查 + Node/pnpm 版本强制锁定，防止因环境差异导致项目启动失败

## 一、版本检查与强制锁定

### 三层防线

| 层       | 文件                            | 机制                                                           |
| -------- | ------------------------------- | -------------------------------------------------------------- |
| 1 — 声明 | `.nvmrc`, `.node-version`       | 声明精确 Node 版本，被 nvm/fnm/fish/mise 等自动读取            |
| 2 — 强制 | `.npmrc` → `engine-strict=true` | pnpm install 时校验 `engines` 字段，不匹配则拒绝安装           |
| 3 — 提示 | `scripts/check-env.mjs`         | preinstall 脚本，版本不符时给出清晰的中英文错误信息 + 修复指引 |

### Shell 自动提示（cd 进入目录时）

`scripts/shell-hook.sh` — 用户将以下行加入 `.zshrc`/`.bashrc`：

```bash
source /path/to/yuanchat/scripts/shell-hook.sh
```

效果：每次 `cd` 进入项目目录时自动检查 Node 版本，不匹配则询问是否切换到正确版本。
兼容 nvm、fnm、volta。

## 二、Stylelint 样式检查

### 依赖

- `stylelint` — 核心
- `stylelint-config-standard` — 标准 CSS 规则集
- `stylelint-config-tailwindcss` — Tailwind 兼容（`@apply`, `@screen`, `theme()` 等）

### 配置 (`stylelint.config.js`)

- 继承 `standard` + `tailwindcss`
- 规则：禁止重复选择器、无效属性值、空规则块等
- 检查范围：`.css`, `.module.css`

### 集成

- `package.json`: `lint:style` / `lint:style:fix` 脚本
- `check` 脚本追加 stylelint
- `lint-staged`: CSS 文件自动 fix
- `.vscode/`: 推荐 Stylelint 插件 + 保存时自动修复

## 三、文件变更清单

| 操作 | 文件                                         |
| ---- | -------------------------------------------- |
| 新增 | `.nvmrc`                                     |
| 新增 | `.node-version`                              |
| 新增 | `.npmrc`                                     |
| 新增 | `stylelint.config.js`                        |
| 新增 | `scripts/check-env.mjs`                      |
| 新增 | `scripts/shell-hook.sh`                      |
| 修改 | `package.json` (deps + scripts + preinstall) |
| 修改 | `.vscode/extensions.json`                    |
| 修改 | `.vscode/settings.json`                      |
