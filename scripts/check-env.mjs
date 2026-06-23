#!/usr/bin/env node
import { execSync } from "node:child_process";
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
    const stdout = execSync("pnpm --version", { encoding: "utf-8" }).trim();
    const current = stdout.split(".").map(Number);
    const requiredMajor = Number(required);

    if (Number.isNaN(current[0])) {
      errors.push(
        `⚠️  无法解析 pnpm 版本号: "${stdout}"\n` +
          `   请确保 pnpm 已正确安装`,
      );
    } else if (current[0] < requiredMajor) {
      errors.push(
        `❌ pnpm 版本不匹配！\n` +
          `   当前版本: v${stdout}\n` +
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
