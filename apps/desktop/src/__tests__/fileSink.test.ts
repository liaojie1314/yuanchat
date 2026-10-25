/**
 * fileSink 的 Tauri 实现契约测试。
 *
 * 全程 mock `@tauri-apps/plugin-fs` / `@tauri-apps/api/path` / `@tauri-apps/api/core`：
 * 这里钉的是「发给 Rust 侧的参数形状」与「返回值怎么拼」，不是真实文件系统 ——
 * 真机落盘属于实测范畴（计划 Task 21）。
 *
 * 最要紧的一条：`save()` 必须返回**绝对路径**。安卓上「打开」按钮是用户触达
 * 已下载文件的唯一途径（app 私有目录在文件管理器里不可见），返回值会被原样
 * 喂给 `open_local_file` 命令，只给文件名等于打不开。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** plugin-fs 各命令的调用记录（[命令, 路径, 其余参数] 简化形状） */
const fsCalls: Array<{ cmd: string; path: string; opts?: unknown }> = [];
/** invoke（自定义命令）的调用记录 */
const invoked: Array<{ cmd: string; args: Record<string, unknown> }> = [];
/** exists 命中集合：模拟「目录里已有这些文件」 */
const existing = new Set<string>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Download: "DOWNLOAD", AppLocalData: "APPLOCALDATA" },
  writeFile: vi.fn(async (path: string, _data: Uint8Array, opts?: unknown) => {
    fsCalls.push({ cmd: "writeFile", path, opts });
  }),
  readFile: vi.fn(async (path: string, opts?: unknown) => {
    fsCalls.push({ cmd: "readFile", path, opts });
    return new Uint8Array([1]);
  }),
  remove: vi.fn(async (path: string, opts?: unknown) => {
    fsCalls.push({ cmd: "remove", path, opts });
  }),
  exists: vi.fn(async (path: string, opts?: unknown) => {
    fsCalls.push({ cmd: "exists", path, opts });
    return existing.has(path);
  }),
  mkdir: vi.fn(async (path: string, opts?: unknown) => {
    fsCalls.push({ cmd: "mkdir", path, opts });
  }),
}));

vi.mock("@tauri-apps/api/path", () => ({
  downloadDir: vi.fn(async () => "/home/u/Downloads"),
  appLocalDataDir: vi.fn(async () => "/data/app/com.yuanchat.desktop"),
  join: vi.fn(async (...parts: string[]) => parts.filter(Boolean).join("/")),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    invoked.push({ cmd, args });
  }),
}));

const { installFileSink } = await import("../fileSink");
const { getFileSink, __resetFileSink } = await import("@yuanchat/shared");

beforeEach(() => {
  fsCalls.length = 0;
  invoked.length = 0;
  existing.clear();
  __resetFileSink();
  installFileSink();
});

describe("save 落 downloads 目录", () => {
  it("无同名时按原名落盘，并返回可喂给 open_local_file 的绝对路径", async () => {
    const path = await getFileSink().save(new Uint8Array([1, 2]), "a.pdf", "application/pdf");

    const write = fsCalls.find((c) => c.cmd === "writeFile");
    expect(write?.path).toBe("a.pdf");
    expect(write?.opts).toEqual({ baseDir: "DOWNLOAD" });
    expect(path).toBe("/home/u/Downloads/a.pdf");
  });

  it("同名避让：a.pdf 已存在时写 a (2).pdf，扩展名不动", async () => {
    existing.add("a.pdf");
    const path = await getFileSink().save(new Uint8Array(), "a.pdf", "application/pdf");

    expect(fsCalls.find((c) => c.cmd === "writeFile")?.path).toBe("a (2).pdf");
    expect(path).toBe("/home/u/Downloads/a (2).pdf");
  });

  it("连 a (2).pdf 也被占用时递增到 a (3).pdf", async () => {
    existing.add("a.pdf");
    existing.add("a (2).pdf");
    const path = await getFileSink().save(new Uint8Array(), "a.pdf", "application/pdf");

    expect(fsCalls.find((c) => c.cmd === "writeFile")?.path).toBe("a (3).pdf");
    expect(path).toBe("/home/u/Downloads/a (3).pdf");
  });
});

describe("save 落 appdata 目录（outbox 副本）", () => {
  it("先递归建 outbox 目录再写入，路径带 outbox 前缀", async () => {
    const path = await getFileSink().save(
      new Uint8Array(),
      "c-1-a.pdf",
      "application/pdf",
      "appdata",
    );

    const mkdir = fsCalls.find((c) => c.cmd === "mkdir");
    expect(mkdir?.path).toBe("outbox");
    expect((mkdir?.opts as { baseDir: string; recursive: boolean }).recursive).toBe(true);

    const write = fsCalls.find((c) => c.cmd === "writeFile");
    expect(write?.path).toBe("outbox/c-1-a.pdf");
    expect(write?.opts).toEqual({ baseDir: "APPLOCALDATA" });
    expect(path).toBe("/data/app/com.yuanchat.desktop/outbox/c-1-a.pdf");
  });

  it("appdata 不做同名避让 —— 键自带 clientMsgId，天然不冲突", async () => {
    existing.add("outbox/c-1-a.pdf");
    const path = await getFileSink().save(
      new Uint8Array(),
      "c-1-a.pdf",
      "application/pdf",
      "appdata",
    );
    // 存在性探测不该发生：outbox 的名字已由 clientMsgId 保证唯一
    expect(fsCalls.find((c) => c.cmd === "exists")).toBeUndefined();
    expect(path).toBe("/data/app/com.yuanchat.desktop/outbox/c-1-a.pdf");
  });
});

describe("read / remove / reveal", () => {
  it("read 与 remove 透传到 plugin-fs 并带对应 baseDir", async () => {
    const sink = getFileSink();
    await sink.read!("c-1-a.pdf", "appdata");
    expect(fsCalls.find((c) => c.cmd === "readFile")?.opts).toEqual({ baseDir: "APPLOCALDATA" });

    await sink.remove!("c-1-a.pdf", "appdata");
    expect(fsCalls.find((c) => c.cmd === "remove")?.opts).toEqual({ baseDir: "APPLOCALDATA" });
  });

  it("reveal 原样把绝对路径交给 open_local_file 命令", async () => {
    await getFileSink().reveal!("/home/u/Downloads/a.pdf");
    expect(invoked).toEqual([
      { cmd: "open_local_file", args: { path: "/home/u/Downloads/a.pdf" } },
    ]);
  });
});

describe("注入本身", () => {
  it("installFileSink 后 getFileSink 拿到的是带磁盘能力的实现", () => {
    const sink = getFileSink();
    // web 默认实现没有 read/remove/reveal —— 有了说明注入生效
    expect(typeof sink.read).toBe("function");
    expect(typeof sink.remove).toBe("function");
    expect(typeof sink.reveal).toBe("function");
  });
});
