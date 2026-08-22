/**
 * i18n 翻译完整性校验
 *
 * 三层检查：
 * 1. **locale 互相对账**（以 zh-CN.json 为基准）：缺失 key / 多余 key /
 *    占位符（`%{var}`）集合不一致 → fail
 * 2. **代码 → locale**：源码里 `t("some.key")` 的静态 key 必须在基准里存在 → fail
 * 3. **locale → 代码**：基准里的 key 若在源码中完全找不到字面量 → fail（死键）
 *
 * 第 2、3 层是后补的：原实现只做第 1 层，于是
 * `t("sticker.added")`（locale 里叫 `sticker.addSuccess`）这类错位能通过门禁，
 * UI 直接显示原始 key，而四个 locale 全都"完整"。
 *
 * 动态调用（`t(labelKey)` / `t(cond ? "a" : "b")` / `t(MAP[x])`）无法静态解析，
 * 故第 3 层的"被引用"判定放宽到**任意形如 key 的字符串字面量**——上述写法的 key
 * 最终都以字面量形式出现在某个常量表或三元里，仍能被认出。
 *
 * 用法：node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = join(ROOT, "packages/design-system/src/i18n/locales");
const BASE = "zh-CN.json";

/** 扫描源码的根目录（相对仓库根）。 */
const SRC_ROOTS = ["packages", "apps"];
/** 不进入的目录名。 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "gen",
  ".turbo",
  "locales",
]);
const SRC_EXT = /\.(ts|tsx)$/;

/**
 * `t("key")` / `i18n.t('key')` / t(`key`) 的静态形式。
 * `\bt\(` 前的 `\b` 让 `assert(` 之类以 t 结尾的函数名不被误命中。
 */
const T_CALL = /\bt\(\s*(['"`])([^'"`\n]+)\1/g;
/** 形如 i18n key 的字符串字面量（`a.b` / `a.b.c`，首段小写开头）。 */
const KEY_LITERAL = /(['"`])([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)\1/g;

const placeholders = (s) => [...s.matchAll(/%\{(\w+)\}/g)].map((m) => m[1]).sort();

/** 递归收集待扫描源文件的绝对路径。 */
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSources(full, out);
    else if (SRC_EXT.test(entry)) out.push(full);
  }
  return out;
}

const base = JSON.parse(readFileSync(join(LOCALES_DIR, BASE), "utf8"));
const baseKeys = Object.keys(base);
const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json") && f !== BASE);

let failed = false;

// ── 第 1 层：locale 互相对账 ────────────────────────────────────────────────
for (const file of files) {
  const target = JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8"));
  const targetKeys = new Set(Object.keys(target));

  const missing = baseKeys.filter((k) => !targetKeys.has(k));
  const extra = [...targetKeys].filter((k) => !(k in base));
  const badVars = baseKeys.filter(
    (k) =>
      targetKeys.has(k) &&
      JSON.stringify(placeholders(base[k])) !== JSON.stringify(placeholders(target[k])),
  );

  if (missing.length || extra.length || badVars.length) {
    failed = true;
    console.error(`✗ ${file}`);
    for (const k of missing) console.error(`    missing: ${k}`);
    for (const k of extra) console.error(`    extra:   ${k}`);
    for (const k of badVars)
      console.error(`    placeholder mismatch: ${k} (${base[k]} → ${target[k]})`);
  } else {
    console.log(`✓ ${file} (${targetKeys.size} keys)`);
  }
}

// ── 扫描源码 ────────────────────────────────────────────────────────────────
const sources = SRC_ROOTS.flatMap((r) => collectSources(join(ROOT, r)));
/** key → 首个出现位置（`文件:行`），仅静态 t() 调用。 */
const tCalls = new Map();
/** 源码中出现过的、形如 key 的全部字面量。 */
const literals = new Set();

for (const file of sources) {
  const code = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1);
  for (const m of code.matchAll(T_CALL)) {
    const key = m[2];
    if (!key.includes(".")) continue; // 非 key 形态（如 t(" ") 拼接）跳过
    if (!tCalls.has(key)) {
      const line = code.slice(0, m.index).split("\n").length;
      tCalls.set(key, `${rel}:${line}`);
    }
  }
  for (const m of code.matchAll(KEY_LITERAL)) literals.add(m[2]);
}

// ── 第 2 层：代码里的 key 必须存在 ──────────────────────────────────────────
const unknown = [...tCalls.keys()].filter((k) => !(k in base));
if (unknown.length) {
  failed = true;
  console.error(`✗ 代码引用了不存在的 key（UI 会直接显示原始 key）`);
  for (const k of unknown) console.error(`    ${k}  ← ${tCalls.get(k)}`);
} else {
  console.log(`✓ 代码 t() 静态 key 全部存在（${tCalls.size} 个）`);
}

// ── 第 3 层：locale 里的 key 必须被用到 ────────────────────────────────────
const dead = baseKeys.filter((k) => !literals.has(k));
if (dead.length) {
  failed = true;
  console.error(`✗ ${BASE} 存在死键（源码中找不到该字面量）`);
  for (const k of dead) console.error(`    ${k}`);
} else {
  console.log(`✓ 无死键`);
}

if (failed) {
  console.error(`\ni18n check failed — 以 ${BASE} 为基准修正上述差异`);
  process.exit(1);
}
console.log(`\ni18n check passed — ${files.length} locales × ${baseKeys.length} keys`);
