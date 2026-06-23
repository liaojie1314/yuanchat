# 前端样式检查 + 版本强制锁定 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 添加 Stylelint 样式检查 + Node/pnpm 版本强制锁定，防止因环境差异导致项目启动失败

**Architecture:** 三层版本防线（声明文件 + engine-strict 强制 + preinstall 检查脚本） + Shell 自动提示脚本 + Stylelint 标准规则集与 Tailwind 兼容配置

**Tech Stack:** stylelint, stylelint-config-standard, stylelint-config-tailwindcss, Node.js engines, nvm/fnm/volta, shell 脚本

## Global Constraints

- 版本硬阻断：`.npmrc` 设置 `engine-strict=true`，版本不符 pnpm install 直接失败
- 样式检查：基于 `stylelint-config-standard` + `stylelint-config-tailwindcss`，覆盖所有 `.css` 文件
- CSS 文件使用 Tailwind 指令（`@tailwind`、`@apply`、`@layer`），Stylelint 必须兼容
- CI 集成：`check` 脚本包含 stylelint，pre-commit hook 通过 lint-staged 自动修复 CSS
- Node 版本推荐 `22`（当前开发环境版本），兼容范围 `>=20`

---

### Task 1: 版本声明文件 + engine-strict 配置

**Files:**

- Create: `.nvmrc`
- Create: `.node-version`
- Create: `.npmrc`

**Interfaces:**

- Consumes: nothing
- Produces: `.nvmrc` → nvm/fnm/volta, `.node-version` → fnm/fish/mise, `.npmrc` → pnpm

- [ ] **Step 1: 创建 `.nvmrc`**

```bash
echo "22" > .nvmrc
```

- [ ] **Step 2: 创建 `.node-version`**

```bash
echo "22" > .node-version
```

- [ ] **Step 3: 创建 `.npmrc`**

内容：

```
engine-strict=true
```

```bash
echo "engine-strict=true" > .npmrc
```

- [ ] **Step 4: 验证 engine-strict 生效**

先用一个错误版本测试（如果安装了 nvm/fnm）：

```bash
# 切换到一个不匹配的 Node 版本（如 18），然后运行：
pnpm install
# 预期：报错 "Your Node version is incompatible with ..."
```

或直接检查配置是否被读取：

```bash
pnpm config get engine-strict --location project
# 预期输出: true
```

- [ ] **Step 5: Commit**

```bash
git add .nvmrc .node-version .npmrc
git commit -m "feat: 添加 Node 版本声明文件及 engine-strict 强制检查"
```

---

### Task 2: preinstall 版本检查脚本

**Files:**

- Create: `scripts/check-env.mjs`
- Modify: `package.json` (添加 `preinstall` 脚本)

**Interfaces:**

- Consumes: `package.json` 的 `engines` 字段
- Produces: 退出码 0（通过）或 1（版本不符）+ 人类可读错误信息

- [ ] **Step 1: 创建 `scripts/check-env.mjs`**

```javascript
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// 读取 package.json 中的 engines 字段
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const engines = pkg.engines || {};

const errors = [];

// 检查 Node 版本
if (engines.node) {
  const required = engines.node.replace(/[>=<~\s]/g, "");
  const current = process.versions.node.split(".").map(Number);
  const requiredParts = required.split(".").map(Number);
  const requiredMajor = requiredParts[0];

  if (current[0] < requiredMajor) {
    errors.push(
      `❌ Node.js 版本不匹配！\n` +
        `   当前版本: v${process.version}\n` +
        `   项目要求: ${engines.node}\n` +
        `\n   请切换到 Node.js ${required} 或更高版本：\n` +
        `   • nvm:  nvm install ${required} && nvm use ${required}\n` +
        `   • fnm:  fnm install ${required} && fnm use ${required}\n` +
        `   • volta: volta install node@${required}\n`,
    );
  }
}

// 检查 pnpm 版本
if (engines.pnpm) {
  const required = engines.pnpm.replace(/[>=<~\s]/g, "");
  try {
    const { stdout } = await import("node:child_process").then((m) =>
      m.execSync("pnpm --version", { encoding: "utf-8" }),
    );
    const current = stdout.trim().split(".").map(Number);
    const requiredMajor = Number(required);

    if (current[0] < requiredMajor) {
      errors.push(
        `❌ pnpm 版本不匹配！\n` +
          `   当前版本: v${stdout.trim()}\n` +
          `   项目要求: ${engines.pnpm}\n` +
          `\n   请升级 pnpm 到 ${required} 或更高版本：\n` +
          `   • npm:  npm install -g pnpm@latest\n` +
          `   • corepack: corepack prepare pnpm@latest --activate\n`,
      );
    }
  } catch {
    errors.push("⚠️  无法检测 pnpm 版本，请确保已安装 pnpm");
  }
}

if (errors.length > 0) {
  console.error("\n" + errors.join("\n\n") + "\n");
  process.exit(1);
}

console.log("✅ 环境版本检查通过");
```

- [ ] **Step 2: 修改 `package.json` — 添加 `preinstall` 脚本**

在 `scripts` 块中添加：

```json
"preinstall": "node scripts/check-env.mjs"
```

在根 `package.json` 的 `scripts` 对象中，在 `"prepare": "husky"` 之前插入：

```
"preinstall": "node scripts/check-env.mjs",
```

- [ ] **Step 3: 测试脚本**

```bash
node scripts/check-env.mjs
# 预期输出: ✅ 环境版本检查通过
```

- [ ] **Step 4: Commit**

```bash
git add scripts/check-env.mjs package.json
git commit -m "feat: 添加 preinstall 版本检查脚本"
```

---

### Task 3: Stylelint 安装与配置

**Files:**

- Create: `stylelint.config.js`
- Modify: `package.json` (devDependencies + scripts)

**Interfaces:**

- Consumes: 项目中的 `.css` 文件（含 `@tailwind`/`@apply`/`@layer` 指令）
- Produces: lint 报告 + 自动修复

- [ ] **Step 1: 安装 Stylelint 依赖**

```bash
pnpm add -D -w stylelint stylelint-config-standard stylelint-config-tailwindcss
```

`-w` 标志用于 workspace root 安装（monorepo）。

- [ ] **Step 2: 创建 `stylelint.config.js`**

```javascript
/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard", "stylelint-config-tailwindcss"],
  rules: {
    // 与 Tailwind 兼容的规则调整
    "no-descending-specificity": [true, { severity: "warning" }],
    // 允许 Tailwind 的 @apply 中使用的自定义属性
    "custom-property-pattern": null,
    // 允许 :root 中的大量自定义属性
    "selector-pseudo-class-no-unknown": [true, { ignorePseudoClasses: ["global"] }],
  },
};
```

- [ ] **Step 3: 修改 `package.json` — 添加 Stylelint 脚本**

在 `scripts` 块中添加：

```json
"lint:style": "stylelint \"**/*.css\" --ignore-path .gitignore",
"lint:style:fix": "stylelint \"**/*.css\" --fix --ignore-path .gitignore",
```

修改 `check` 脚本为：

```json
"check": "pnpm lint && pnpm format:check && pnpm lint:style",
```

- [ ] **Step 4: 修改 `lint-staged` 配置 — 自动修复 CSS**

在 `lint-staged` 块中添加 CSS 处理规则。将以下内容合并到已有的 `lint-staged` 配置：

```json
"*.css": [
  "stylelint --fix",
  "prettier --write"
]
```

- [ ] **Step 5: 测试 Stylelint**

```bash
pnpm lint:style
# 检查所有 CSS 文件，确认没有误报
```

- [ ] **Step 6: Commit**

```bash
git add stylelint.config.js package.json pnpm-lock.yaml
git commit -m "feat: 集成 Stylelint + 标准规则 + Tailwind 兼容"
```

---

### Task 4: Shell 自动提示脚本（cd 进入目录时）

**Files:**

- Create: `scripts/shell-hook.sh`

**Interfaces:**

- Consumes: `.nvmrc`
- Produces: shell 函数 `_yuanchat_version_check`，在 `cd` 后自动触发

- [ ] **Step 1: 创建 `scripts/shell-hook.sh`**

```bash
#!/usr/bin/env bash
# shellcheck shell=bash
# ==============================================
# YuanChat 版本自动检查 Hook
# 用法: 在 ~/.zshrc 或 ~/.bashrc 中添加：
#   source /path/to/yuanchat/scripts/shell-hook.sh
# ==============================================

_yuanchat_version_check() {
  # 仅在进入项目目录时触发
  if [[ ! -f ".nvmrc" ]]; then
    return
  fi

  local required
  required=$(head -1 .nvmrc | tr -d '[:space:]')
  if [[ -z "$required" ]]; then
    return
  fi

  local current
  current=$(node -v 2>/dev/null | sed 's/v//')
  if [[ -z "$current" ]]; then
    return
  fi

  local required_major current_major
  required_major=$(echo "$required" | cut -d'.' -f1)
  current_major=$(echo "$current" | cut -d'.' -f1)

  if [[ "$current_major" -lt "$required_major" ]]; then
    echo ""
    echo -e "\033[33m⚠️  Node.js 版本不匹配\033[0m"
    echo "   当前: v${current}  →  项目要求: >= ${required}.0.0"
    echo ""

    # 检测可用的版本管理器
    local manager=""
    if command -v fnm &>/dev/null; then
      manager="fnm"
    elif command -v nvm &>/dev/null; then
      manager="nvm"
    elif command -v volta &>/dev/null; then
      manager="volta"
    fi

    if [[ -n "$manager" ]]; then
      echo -n "   是否使用 ${manager} 安装 Node.js v${required}？[Y/n] "
      read -r answer
      if [[ -z "$answer" || "$answer" =~ ^[Yy]$ ]]; then
        case "$manager" in
          fnm)
            fnm install "$required" && fnm use "$required"
            ;;
          nvm)
            nvm install "$required" && nvm use "$required"
            ;;
          volta)
            volta install node@"$required"
            ;;
        esac
        echo -e "\033[32m✅ 已切换到 Node.js $(node -v)\033[0m"
      fi
    else
      echo "   未检测到 nvm/fnm/volta，请手动安装 Node.js >= ${required}.0.0"
      echo "   推荐使用 fnm: https://github.com/Schniz/fnm"
    fi
    echo ""
  fi
}

# 仅在交互式 shell 中启用
if [[ $- == *i* ]]; then
  # 使用 chpwd (zsh) 或 PROMPT_COMMAND (bash) 在 cd 后触发
  if [[ -n "$ZSH_VERSION" ]]; then
    autoload -U add-zsh-hook 2>/dev/null
    add-zsh-hook chpwd _yuanchat_version_check 2>/dev/null
  elif [[ -n "$BASH_VERSION" ]]; then
    # 仅在未设置时保存原始 PROMPT_COMMAND
    if [[ "$PROMPT_COMMAND" != *_yuanchat_version_check* ]]; then
      PROMPT_COMMAND="_yuanchat_version_check;${PROMPT_COMMAND#;}"
    fi
  fi
fi
```

- [ ] **Step 2: 添加执行权限**

```bash
chmod +x scripts/shell-hook.sh
```

- [ ] **Step 3: 测试 shell hook**

```bash
# 在另一个终端中测试：
source scripts/shell-hook.sh
cd /tmp && cd /path/to/yuanchat
# 预期: 如果版本匹配则无输出；不匹配则显示提示
```

- [ ] **Step 4: Commit**

```bash
git add scripts/shell-hook.sh
git commit -m "feat: 添加 shell 版本自动检查 hook"
```

---

### Task 5: VSCode 编辑器集成

**Files:**

- Create: `.vscode/extensions.json`
- Create: `.vscode/settings.json`

**Interfaces:**

- Consumes: Stylelint 配置、Prettier 配置
- Produces: VSCode 保存时自动修复 CSS + 推荐插件提示

- [ ] **Step 1: 创建 `.vscode/extensions.json`**

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "stylelint.vscode-stylelint",
    "bradlc.vscode-tailwindcss"
  ]
}
```

- [ ] **Step 2: 创建 `.vscode/settings.json`**

```json
{
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "source.fixAll.stylelint": "explicit"
  },
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[css]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "stylelint.validate": ["css"],
  "css.validate": false
}
```

> 注意: `"css.validate": false` 禁用 VSCode 内置 CSS 验证，避免与 Stylelint 重复。

- [ ] **Step 3: Commit**

```bash
git add .vscode/
git commit -m "feat: 配置 VSCode 推荐插件 + 保存时自动修复"
```

---

### Task 6: 最终验证

**Files:** 无新增，验证所有功能正常工作

- [ ] **Step 1: 运行完整检查**

```bash
pnpm check
# 预期: ESLint + Prettier + Stylelint 全部通过
```

- [ ] **Step 2: 测试 Stylelint 自动修复**

```bash
# 创建临时测试文件，引入一个可修复的问题
echo "a {color: red;}" > /tmp/test-style.css
pnpm stylelint /tmp/test-style.css --fix
cat /tmp/test-style.css
# 预期: 自动添加分号尾、修复格式
rm /tmp/test-style.css
```

- [ ] **Step 3: 验证 preinstall 检查**

```bash
node scripts/check-env.mjs
# 预期: ✅ 环境版本检查通过
```

- [ ] **Step 4: 验证 engine-strict + preinstall 联动**

```bash
pnpm install
# 预期: 正常安装，preinstall 脚本通过
```

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "chore: 最终验证通过 — lint/style/version 检查全部就绪"
```
