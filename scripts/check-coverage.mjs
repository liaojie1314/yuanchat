#!/usr/bin/env node
/**
 * 后端覆盖率门禁脚本（B7）。
 *
 * 解析 `go test -coverprofile` 生成的 profile（mode: atomic / set 均可），
 * 按语句数加权计算总覆盖率，并与阈值比较；低于阈值则退出码 1。
 *
 * 排除规则（不计入分母与分子）：
 * - `cmd/`                 —— main 入口（server/gc/genvapid/migrate/seed）
 * - `internal/testutil/`   —— 测试辅助代码
 * - `internal/database/`   —— DB 连接/迁移胶水层，由集成环境覆盖
 *
 * 用法：
 *   go test ./... -coverprofile=coverage.out -covermode=atomic
 *   node scripts/check-coverage.mjs <阈值%> [coverage.out 路径]
 */

import { readFileSync } from "node:fs";

const threshold = Number.parseFloat(process.argv[2]);
const profilePath = process.argv[3] ?? "coverage.out";

if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
  console.error(`用法: node scripts/check-coverage.mjs <阈值 0-100> [coverage.out]`);
  process.exit(2);
}

/** 排除的包路径前缀（对应 profile 行 `github.com/.../<dir>/...`） */
const EXCLUDED = ["/cmd/", "/internal/testutil/", "/internal/database/"];

let text;
try {
  text = readFileSync(profilePath, "utf8");
} catch (err) {
  console.error(`无法读取覆盖率文件 ${profilePath}: ${err.message}`);
  console.error(`请先运行: go test ./... -coverprofile=${profilePath} -covermode=atomic`);
  process.exit(2);
}

let total = 0;
let covered = 0;
for (const line of text.split("\n")) {
  if (!line || line.startsWith("mode:")) continue;
  const fields = line.trim().split(/\s+/);
  if (fields.length < 3) continue;
  const file = fields[0];
  const numStmts = Number.parseInt(fields[1], 10);
  const count = Number.parseInt(fields[2], 10);
  if (!Number.isFinite(numStmts) || numStmts <= 0) continue;
  if (EXCLUDED.some((p) => file.includes(p))) continue;
  total += numStmts;
  if (count > 0) covered += numStmts;
}

if (total === 0) {
  console.error("coverage profile 为空（没有任何语句被统计），请检查 go test 命令");
  process.exit(2);
}

const percent = (covered / total) * 100;
const pass = percent >= threshold;
console.log(
  `后端覆盖率（排除 cmd/ testutil/ database/）: ${percent.toFixed(2)}% ` +
    `（${covered}/${total} 语句），阈值 ${threshold}% → ${pass ? "PASS" : "FAIL"}`,
);
process.exit(pass ? 0 : 1);
