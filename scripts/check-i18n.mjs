/**
 * i18n 翻译完整性校验
 *
 * 以 zh-CN.json 为基准，检查其余 locale 文件：
 * - 缺失 key（基准有、目标没有）→ fail
 * - 多余 key（目标有、基准没有）→ fail
 * - 占位符不一致（%{var} 集合与基准不同）→ fail
 *
 * 用法：node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LOCALES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/design-system/src/i18n/locales",
);
const BASE = "zh-CN.json";

const placeholders = (s) => [...s.matchAll(/%\{(\w+)\}/g)].map((m) => m[1]).sort();

const base = JSON.parse(readFileSync(join(LOCALES_DIR, BASE), "utf8"));
const baseKeys = Object.keys(base);
const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json") && f !== BASE);

let failed = false;

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

if (failed) {
  console.error(`\ni18n check failed — 以 ${BASE} 为基准修正上述差异`);
  process.exit(1);
}
console.log(`\ni18n check passed — ${files.length} locales × ${baseKeys.length} keys`);
