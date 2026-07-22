#!/usr/bin/env node

/**
 * 元聊 YuanChat — 交互式打包脚本
 *
 * @description
 * 支持桌面端（Linux/macOS/Windows）和安卓端打包，交互式选择：
 * - 构建目标：桌面端 / 安卓端 / 全平台
 * - 构建类型：正式包（release）/ 调试包（debug）
 * - 桌面端：deb、AppImage、msi、dmg 等格式
 * - 安卓端：APK / AAB，目标架构，是否按 ABI 拆分
 *
 * 纯 Node.js 实现，无外部依赖，跨平台可用。
 *
 * @usage
 *   node scripts/build.mjs
 *   npm run build:pkg         # 通过 package.json scripts 调用
 *
 * @see docs/DEVELOPMENT.md
 */

import readline from "node:readline";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ========================================
// 路径 & 常量
// ========================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DESKTOP_DIR = path.join(ROOT, "apps", "desktop");

const platform = os.platform(); // 'linux' | 'darwin' | 'win32'

/** 当前平台支持的桌面端打包格式 */
const PLATFORM_BUNDLES = {
  linux: ["deb", "appimage", "rpm"],
  darwin: ["dmg", "app"],
  win32: ["msi", "nsis"],
};

/** 安卓 ABI 目标 */
const ANDROID_TARGETS = [
  { value: "aarch64", label: "ARM64 (aarch64) — 大多数现代手机" },
  { value: "armv7", label: "ARMv7 (armv7) — 旧 32 位设备" },
  { value: "i686", label: "x86 (i686) — 模拟器" },
  { value: "x86_64", label: "x86_64 — 模拟器 (64 位)" },
];

// ========================================
// 交互式提示工具
// ========================================

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/** 询问一个问题，返回用户输入的字符串 */
function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

/** 显示带编号的选项列表，让用户选择，返回选中的值 */
async function select(label, options) {
  console.log(`\n${label}`);
  options.forEach((opt, i) => console.log(`  [${i + 1}] ${opt.label}`));
  while (true) {
    const answer = await ask("请输入选项编号: ");
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < options.length) return options[idx].value;
    console.log(`  无效选项，请输入 1-${options.length}`);
  }
}

/** 多选：返回选中的值数组 */
async function multiSelect(label, options) {
  console.log(`\n${label}`);
  options.forEach((opt, i) => console.log(`  [${i + 1}] ${opt.label}`));
  console.log("  输入编号（逗号分隔），或直接回车选择全部");
  while (true) {
    const answer = (await ask("请输入: ")).trim();
    if (answer === "") return options.map((o) => o.value);
    const indices = answer.split(",").map((s) => parseInt(s.trim(), 10) - 1);
    if (indices.every((i) => i >= 0 && i < options.length)) {
      return indices.map((i) => options[i].value);
    }
    console.log(`  无效选项，请输入 1-${options.length}（逗号分隔）`);
  }
}

/** 询问 yes/no，返回 boolean */
async function confirm(question) {
  while (true) {
    const answer = (await ask(`${question} [Y/n]: `)).trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
  }
}

/** 执行命令（继承 stdio，实时输出），返回 exit code */
function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    console.log(`\n▶ ${cmd} ${args.join(" ")}\n`);
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: true });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// ========================================
// 主流程
// ========================================

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   元聊 YuanChat — 交互式打包工具   ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`\n当前平台: ${platform}`);

  // ---- 步骤 1: 选择构建目标 ----
  const TARGET_OPTIONS = [
    { value: "desktop", label: "桌面端 (Windows/macOS/Linux)" },
    { value: "android", label: "安卓端 (APK / AAB)" },
    { value: "both", label: "全平台 (桌面 + 安卓)" },
  ];
  const target = await select("1. 选择构建目标", TARGET_OPTIONS);

  // ---- 步骤 2: 选择构建类型 ----
  const TYPE_OPTIONS = [
    { value: "release", label: "正式包 (Release) — 优化体积和性能" },
    { value: "debug", label: "调试包 (Debug) — 包含调试符号，方便排查问题" },
  ];
  const buildType = await select("2. 选择构建类型", TYPE_OPTIONS);
  const isDebug = buildType === "debug";

  // ---- 步骤 3: 桌面端配置 ----
  /** @type {{ bundles: string[] } | null} */
  let desktopConfig = null;
  if (target === "desktop" || target === "both") {
    const available = PLATFORM_BUNDLES[platform] || ["deb"];
    const bundleOptions = available.map((b) => ({
      value: b,
      label: {
        deb: "deb — Debian/Ubuntu (推荐 Linux)",
        appimage: "AppImage — 通用 Linux 免安装",
        rpm: "rpm — Fedora/RHEL/CentOS",
        dmg: "dmg — macOS 磁盘映像 (推荐)",
        app: "app — macOS 应用包",
        msi: "msi — Windows 安装程序 (推荐)",
        nsis: "nsis — Windows NSIS 安装程序",
      }[b] || b,
    }));
    const selectedBundles = await multiSelect("3. 选择桌面端打包格式", bundleOptions);
    desktopConfig = { bundles: selectedBundles };
  }

  // ---- 步骤 4: 安卓端配置 ----
  /** @type {{ outputTypes: string[], targets: string[], splitPerAbi: boolean } | null} */
  let androidConfig = null;
  if (target === "android" || target === "both") {
    const OUTPUT_OPTIONS = [
      { value: "apk", label: "APK — 直接安装到设备" },
      { value: "aab", label: "AAB — Google Play 商店发布格式" },
    ];
    const outputTypes = await multiSelect("4. 选择安卓输出格式", OUTPUT_OPTIONS);

    const archs = await multiSelect("5. 选择目标架构", ANDROID_TARGETS);

    const splitPerAbi = await confirm("6. 是否按 ABI 拆分 APK？(减小体积)");

    androidConfig = { outputTypes, targets: archs, splitPerAbi };
  }

  // ---- 步骤 5: 确认摘要 ----
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║           构建摘要                  ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`  构建目标:     ${target === "desktop" ? "桌面端" : target === "android" ? "安卓端" : "全平台"}`);
  console.log(`  构建类型:     ${isDebug ? "调试包 (Debug)" : "正式包 (Release)"}`);

  if (desktopConfig) {
    console.log(`  桌面端格式:   ${desktopConfig.bundles.join(", ")}`);
  }
  if (androidConfig) {
    console.log(`  安卓端输出:   ${androidConfig.outputTypes.join(", ")}`);
    console.log(`  安卓端架构:   ${androidConfig.targets.join(", ")}`);
    console.log(`  按 ABI 拆分:  ${androidConfig.splitPerAbi ? "是" : "否"}`);
  }

  console.log(`\n  工作目录: ${DESKTOP_DIR}`);
  console.log("");

  const proceed = await confirm("确认开始构建？");

  if (!proceed) {
    console.log("\n已取消。");
    rl.close();
    return;
  }

  rl.close();

  // ---- 步骤 6: 执行构建 ----
  /**
   * 构建桌面端
   */
  async function buildDesktop() {
    const args = ["tauri", "build"];
    if (isDebug) args.push("--debug");
    if (desktopConfig && desktopConfig.bundles.length > 0) {
      args.push("--bundles", desktopConfig.bundles.join(","));
    }

    console.log("\n═══ 正在构建桌面端 ═══");
    const code = await run("npx", args, DESKTOP_DIR);
    if (code !== 0) {
      console.error("\n❌ 桌面端构建失败！");
      return false;
    }
    console.log("\n✅ 桌面端构建完成！");
    // 输出产物位置
    const ext =
      platform === "win32" ? "msi" : platform === "darwin" ? "dmg" : "deb";
    console.log(`   产物目录: ${path.join(DESKTOP_DIR, "src-tauri", "target", isDebug ? "debug" : "release", "bundle")}`);
    return true;
  }

  /**
   * 构建安卓端
   */
  async function buildAndroid() {
    const args = ["tauri", "android", "build"];

    if (isDebug) args.push("--debug");

    // 输出格式
    if (androidConfig) {
      if (androidConfig.outputTypes.includes("apk")) args.push("--apk");
      if (androidConfig.outputTypes.includes("aab")) args.push("--aab");
    }

    // 目标架构
    if (androidConfig && androidConfig.targets.length > 0) {
      args.push("--target", ...androidConfig.targets);
    }

    // 按 ABI 拆分
    if (androidConfig && androidConfig.splitPerAbi) {
      args.push("--split-per-abi");
    }

    console.log("\n═══ 正在构建安卓端 ═══");
    const code = await run("npx", args, DESKTOP_DIR);
    if (code !== 0) {
      console.error("\n❌ 安卓端构建失败！");
      return false;
    }
    console.log("\n✅ 安卓端构建完成！");
    console.log(
      `   产物目录: ${path.join(DESKTOP_DIR, "src-tauri", "gen", "android", "app", "build", "outputs", isDebug ? "apk" : "bundle")}`,
    );
    return true;
  }

  let success = true;
  const startTime = Date.now();

  if (target === "desktop") {
    success = await buildDesktop();
  } else if (target === "android") {
    success = await buildAndroid();
  } else {
    success = (await buildDesktop()) && (await buildAndroid());
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n🏁 总耗时: ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`);

  if (success) {
    console.log("🎉 全部构建完成！");
    process.exit(0);
  } else {
    console.error("⚠ 部分构建失败，请检查上方日志。");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  rl.close();
  process.exit(1);
});
