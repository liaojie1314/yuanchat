#!/usr/bin/env node
/**
 * 一键启动开发环境编排脚本
 *
 * @description
 * 按目标端 + 数据模式组合拉起完整开发环境：
 *
 *   node scripts/dev.mjs web              # 真实后端 + Web（docker → seed → go server → vite）
 *   node scripts/dev.mjs web --mock       # MSW Mock + Web（无需后端/数据库）
 *   node scripts/dev.mjs desktop          # 真实后端 + Tauri 桌面窗口
 *   node scripts/dev.mjs desktop --mock   # Mock + Tauri 桌面窗口
 *   node scripts/dev.mjs android          # 真实后端 + Tauri Android（自动 adb reverse 8085/8086）
 *   node scripts/dev.mjs android --mock   # Mock + Tauri Android
 *   node scripts/dev.mjs server           # 仅后端（docker → seed → go server）
 *   node scripts/dev.mjs stop             # 停止全部（应用进程 + go server + docker 容器）
 *
 * 真实模式流程：启动 PostgreSQL/Redis 容器（--wait 等待健康）→ 幂等 seed
 * → go run ./cmd/server（REST :8085 + WS :8086）→ 健康检查通过后再拉起前端。
 *
 * Ctrl+C 会终止本脚本拉起的应用进程与 go server（进程组整体 kill，
 * 避免 `go run` 的子进程残留）；docker 容器保持运行以加速下次启动，
 * 需要彻底清理时执行 `pnpm dev:stop`。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE_FILE = join(root, "deploy", "docker-compose.yml");
/** 本机 Go 工具链的兜底位置（go 不在 PATH 时使用） */
const GO_FALLBACK_DIR = "/home/liaojie1314/env/go/go/bin";
const GOPATH_FALLBACK = "/home/liaojie1314/env/go/GOPATH";

const APP_PORTS = { web: 5173, desktop: 1420, android: 1420 };
const SERVER_PORTS = [8085, 8086];
/**
 * 真机需要反向转发的端口：REST / WS 之外还有 MinIO(9002) 与 coturn(3478)。
 * 预签名 URL 与头像直链里写的是 localhost:9002，不转发的话手机上所有图片、
 * 语音、头像都拿不到（表现为空白占位，不报错），排查起来很费时间。
 * 3478 是 TURN 控制端口：模拟器在 10.0.2.x NAT 后，host candidate 对宿主不可达，
 * 只能走 TURN over TCP（adb reverse 不转发 UDP），没有这条转发通话必然打不通。
 * 注意 9002 与 3478 都不进 SERVER_PORTS —— dev:stop 不该去杀 docker 起的容器。
 */
const REVERSE_PORTS = [...SERVER_PORTS, 9002, 3478];

// ========================================
// 参数解析
// ========================================

const [, , target, ...rest] = process.argv;
const mock = rest.includes("--mock");
const VALID = ["web", "desktop", "android", "server", "stop"];

if (!VALID.includes(target)) {
  console.log(`用法: node scripts/dev.mjs <${VALID.join("|")}> [--mock]`);
  console.log("示例: pnpm dev:web / pnpm dev:web:mock / pnpm dev:stop");
  process.exit(1);
}

// ========================================
// 工具函数
// ========================================

const color = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const tagOf = { server: color(36, "[server]"), app: color(35, "[app]"), infra: color(33, "[infra]") };

function log(tag, msg) {
  console.log(`${tagOf[tag] ?? tag} ${msg}`);
}

/** 解析 go 可执行文件与环境变量（优先 PATH，兜底本机安装目录） */
function resolveGoEnv() {
  const probe = spawnSync("go", ["version"], { stdio: "ignore" });
  if (probe.status === 0) return { ...process.env };
  if (existsSync(join(GO_FALLBACK_DIR, "go"))) {
    return {
      ...process.env,
      PATH: `${GO_FALLBACK_DIR}:${process.env.PATH}`,
      GOPATH: process.env.GOPATH ?? GOPATH_FALLBACK,
    };
  }
  console.error("❌ 未找到 go 命令。请安装 Go ≥1.24 或将其加入 PATH。");
  process.exit(1);
}

/** 前台执行命令，失败即退出 */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
  if (r.status !== 0) {
    console.error(`❌ 命令失败: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

/** 后台拉起长驻进程（detached 进程组，便于连子进程一起 kill） */
const children = [];
function launch(tag, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  const forward = (stream) =>
    stream.on("data", (buf) => {
      for (const line of buf.toString().split("\n")) {
        if (line.trim()) log(tag, line);
      }
    });
  forward(child.stdout);
  forward(child.stderr);
  child.on("exit", (code) => {
    log(tag, `进程退出 (code=${code ?? "signal"})`);
    // 长驻进程意外退出时整体收场，避免半死状态
    shutdown(code === 0 ? 0 : 1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM"); // 负 pid = 整个进程组（含 go run 的子二进制）
    } catch {
      /* 已退出 */
    }
  }
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/** 轮询等待 HTTP 端点就绪 */
async function waitFor(url, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* 未就绪，继续轮询 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`❌ 等待 ${label} 超时（${url}）`);
  shutdown(1);
}

/** 杀掉占用指定端口的进程（幂等） */
function killPort(port) {
  const r = spawnSync("lsof", ["-t", `-i:${port}`], { encoding: "utf-8" });
  const pids = (r.stdout ?? "").split("\n").filter(Boolean);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
      log("infra", `已停止端口 ${port} 的进程 (pid=${pid})`);
    } catch {
      /* 已退出 */
    }
  }
}

// ========================================
// 步骤
// ========================================

/** 启动 PostgreSQL + Redis 并等待健康检查通过，随后幂等 seed */
function ensureBackendInfra(goEnv) {
  log("infra", "启动 PostgreSQL / Redis 容器…");
  run("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "--wait"]);
  log("infra", "灌入测试数据（幂等）…");
  run("go", ["run", "./cmd/seed"], { cwd: join(root, "server"), env: goEnv });
}

/** 拉起 go server 并等待 REST 健康检查 */
async function startGoServer(goEnv) {
  log("server", "启动后端（REST :8085 + WS :8086）…");
  launch("server", "go", ["run", "./cmd/server"], { cwd: join(root, "server"), env: goEnv });
  await waitFor("http://localhost:8085/api/v1/health", "后端");
  log("server", "后端就绪 ✔");
}

/** 前端环境变量：真实模式关闭 MSW */
function appEnv() {
  return mock ? { ...process.env } : { ...process.env, VITE_ENABLE_MOCK: "false" };
}

function startWeb() {
  log("app", `启动 Web（${mock ? "Mock" : "真实后端"}模式）→ http://localhost:5173`);
  launch("app", "pnpm", ["--filter", "@yuanchat/web", "dev"], { env: appEnv() });
}

function startDesktop() {
  log("app", `启动 Tauri 桌面端（${mock ? "Mock" : "真实后端"}模式）…`);
  // VITE_ENABLE_MOCK 会传递给 beforeDevCommand 启动的 Vite
  launch("app", "pnpm", ["--filter", "@yuanchat/desktop", "tauri:dev"], { env: appEnv() });
}

function startAndroid() {
  if (!process.env.ANDROID_HOME) {
    console.error("❌ 未设置 ANDROID_HOME。参见 docs/DEVELOPMENT.md 第三章（移动端）。");
    process.exit(1);
  }
  if (!mock) {
    // 真实模式：把设备的 localhost:8085/8086/9002 反向转发到宿主机后端与对象存储
    for (const port of REVERSE_PORTS) {
      const r = spawnSync("adb", ["reverse", `tcp:${port}`, `tcp:${port}`], { stdio: "ignore" });
      log("infra", r.status === 0 ? `adb reverse tcp:${port} ✔` : `adb reverse tcp:${port} 失败（请确认设备已连接）`);
    }
  }
  log("app", `启动 Tauri Android（${mock ? "Mock" : "真实后端"}模式）…`);
  launch("app", "pnpm", ["--filter", "@yuanchat/desktop", "tauri", "android", "dev"], {
    env: appEnv(),
  });
}

// ========================================
// 主流程
// ========================================

if (target === "stop") {
  for (const port of [...SERVER_PORTS, ...Object.values(APP_PORTS)]) killPort(port);
  log("infra", "停止 docker 容器…");
  run("docker", ["compose", "-f", COMPOSE_FILE, "stop"]);
  log("infra", "全部已停止 ✔");
  process.exit(0);
}

const needBackend = !mock;
const goEnv = needBackend ? resolveGoEnv() : null;

if (needBackend) {
  ensureBackendInfra(goEnv);
  await startGoServer(goEnv);
}

if (target === "web") startWeb();
else if (target === "desktop") startDesktop();
else if (target === "android") startAndroid();
else if (target === "server") log("server", "仅后端模式：Ctrl+C 停止（容器保持运行）");

if (target !== "server" || needBackend) {
  log("infra", "Ctrl+C 停止全部进程；彻底清理（含容器）用 pnpm dev:stop");
}
