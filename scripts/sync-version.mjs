#!/usr/bin/env node
/**
 * 同步根 package.json 的 version 到子 package 和 tauri.conf.json。
 * 由 release-it 的 after:bump hook 调用。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = rootPkg.version;

const targets = [
  "apps/web/package.json",
  "apps/desktop/package.json",
  "packages/design-system/package.json",
  "packages/shared/package.json",
  "packages/ui/package.json",
];

for (const rel of targets) {
  const path = join(root, rel);
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    if (pkg.version === version) continue;
    pkg.version = version;
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  ${rel}: → ${version}`);
  } catch (err) {
    console.warn(`  ${rel}: skip (${err.message})`);
  }
}

const tauriPath = join(root, "apps/desktop/src-tauri/tauri.conf.json");
try {
  const raw = readFileSync(tauriPath, "utf8");
  const conf = JSON.parse(raw);
  if (conf.version !== version) {
    conf.version = version;
    writeFileSync(tauriPath, JSON.stringify(conf, null, 2) + "\n");
    console.log(`  apps/desktop/src-tauri/tauri.conf.json: → ${version}`);
  }
} catch (err) {
  console.warn(`  tauri.conf.json: skip (${err.message})`);
}

console.log(`✓ Synced version ${version} to workspace packages`);
