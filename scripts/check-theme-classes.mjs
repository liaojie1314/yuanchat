/**
 * 主题色工具类有效性校验
 *
 * 背景：色板里没注册的 Tailwind 颜色类（如 `hover:bg-surface-container-highest`、
 * `text-on-surface-variant`）不会报错，只是**不产出任何 CSS**——元素静默回落到
 * 继承色，hover 没反应、次要文字与正文同色。这类问题肉眼极难发现，
 * 曾导致 210 处次要文字色与两处右键菜单 hover 全部失效。
 *
 * 检查内容：
 * 1. 三个 app 的 Tailwind 配置解析出的颜色色板必须一致（共用同一 preset 的前提）
 * 2. 源码里所有指向主题色板的颜色工具类，必须能在色板里找到对应 key
 *
 * 判定范围只覆盖主题色前缀（surface / primary / secondary / tertiary / error /
 * outline / background / on-*），标准 Tailwind 色（red-500 等）与非颜色工具类
 * （outline-none / border-2 / text-left）不参与。
 *
 * 用法：node scripts/check-theme-classes.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** tailwindcss 由 design-system 声明，从它的位置解析，避免根目录幽灵依赖 */
const require = createRequire(join(ROOT, "packages/design-system/package.json"));

/** 参与校验的 app 配置（第一个作为色板基准） */
const APP_CONFIGS = [
  "apps/web/tailwind.config.ts",
  "apps/desktop/tailwind.config.ts",
  "apps/admin/tailwind.config.ts",
];
/** 扫描源码的根目录 */
const SRC_ROOTS = ["packages", "apps"];
/** 不进入的目录名 */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "gen", ".turbo", "e2e"]);
const SRC_EXT = /\.(ts|tsx|css)$/;

/** 会带颜色值的工具类前缀 */
const COLOR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "fill",
  "stroke",
  "from",
  "via",
  "to",
  "placeholder",
  "divide",
  "outline",
  "accent",
  "caret",
  "decoration",
  "shadow",
];
/** 颜色名的首段必须命中主题色板，才纳入校验 */
const THEME_ROOTS = new Set([
  "surface",
  "primary",
  "secondary",
  "tertiary",
  "error",
  "outline",
  "background",
  "on",
]);
/** 与主题色同前缀但并非颜色的关键字（outline-none / outline-offset-2 等） */
const NON_COLOR = new Set([
  "none",
  "hidden",
  "dashed",
  "dotted",
  "solid",
  "double",
  "offset",
  "inherit",
  "current",
  "transparent",
]);

const colorClass = new RegExp(
  "(?:^|[\\s\"'`{}(])((?:[a-z0-9-]+:)*(?:" + COLOR_PREFIXES.join("|") + ")-[a-z][a-z0-9-]*(?:/\\d+)?)",
  "g",
);

/** 解析单个 Tailwind 配置，返回扁平化后的颜色 key 集合 */
function paletteOf(configPath) {
  const { loadConfig } = require("tailwindcss/lib/lib/load-config.js");
  const resolveConfig = require("tailwindcss/resolveConfig");
  const flatten = require("tailwindcss/lib/util/flattenColorPalette").default;
  const resolved = resolveConfig(loadConfig(join(ROOT, configPath)));
  return new Set(Object.keys(flatten(resolved.theme.colors)));
}

/** 递归收集待扫描的源码文件 */
function collect(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (SRC_EXT.test(name)) out.push(full);
  }
  return out;
}

/**
 * 从类名里剥出颜色名：去掉变体前缀、工具类前缀与透明度后缀。
 * 返回 null 表示这个类不指向主题色板，无需校验。
 */
function colorNameOf(cls) {
  const bare = cls.slice(cls.lastIndexOf(":") + 1).split("/")[0];
  const dash = bare.indexOf("-");
  const name = bare.slice(dash + 1);
  const head = name.split("-")[0];
  if (!THEME_ROOTS.has(head)) return null;
  if (NON_COLOR.has(name.split("-")[1] ?? "")) return null;
  return name;
}

const palettes = APP_CONFIGS.map((c) => ({ config: c, keys: paletteOf(c) }));
const base = palettes[0];
const errors = [];

for (const other of palettes.slice(1)) {
  const missing = Array.from(base.keys).filter((k) => !other.keys.has(k));
  const extra = Array.from(other.keys).filter((k) => !base.keys.has(k));
  if (missing.length || extra.length) {
    errors.push(
      `色板与基准不一致: ${other.config}` +
        (missing.length ? `\n    缺少: ${missing.join(", ")}` : "") +
        (extra.length ? `\n    多出: ${extra.join(", ")}` : ""),
    );
  }
}

const files = SRC_ROOTS.reduce((acc, r) => collect(join(ROOT, r), acc), []);
/** 无效类名 → 出现位置列表 */
const dead = new Map();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    // 任意值语法（bg-[rgb(...)] / text-[10px]）不做判定：整段替掉，
    // 只丢弃这一段而不是整行，否则同行的普通类名会被一起漏检
    const scan = line.replace(/-\[[^\]]*\]/g, "-ARBITRARY");
    let m;
    colorClass.lastIndex = 0;
    while ((m = colorClass.exec(scan)) !== null) {
      const name = colorNameOf(m[1]);
      if (!name || name.includes("ARBITRARY") || base.keys.has(name)) continue;
      const where = `${relative(ROOT, file)}:${i + 1}`;
      const list = dead.get(m[1]) ?? [];
      list.push(where);
      dead.set(m[1], list);
    }
  });
}

for (const [cls, where] of Array.from(dead.entries()).sort()) {
  errors.push(
    `色板里没有 "${cls}"（${where.length} 处），该类不产出任何 CSS\n    ` +
      where.slice(0, 5).join("\n    ") +
      (where.length > 5 ? `\n    …还有 ${where.length - 5} 处` : ""),
  );
}

if (errors.length) {
  console.error("✗ 主题色工具类校验失败：\n");
  errors.forEach((e) => console.error("  - " + e + "\n"));
  console.error(
    `共 ${errors.length} 项。修法：在 packages/design-system/src/tailwind.config.ts 的 colors 里补上对应 key，` +
      "并确认 themeStore.applyTheme 写入了同名 CSS 变量。",
  );
  process.exit(1);
}

console.log(
  `✓ 主题色工具类校验通过（色板 ${base.keys.size} 个 key，扫描 ${files.length} 个文件）`,
);
