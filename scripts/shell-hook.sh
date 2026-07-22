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
