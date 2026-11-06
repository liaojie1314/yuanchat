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
const invoked: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
let directory = { path: "/home/u/Downloads", custom: false };
/** 模拟原生文件系统：创建立刻占用名字，写入留下可断言的真实字节。 */
const existing = new Set<string>();
const disk = new Map<string, Uint8Array>();
let chunkLimit = Infinity;
let failAfter = Infinity;
let ipcLimit = Infinity;
let sizeAdjustment = 0;

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Download: "DOWNLOAD", AppLocalData: "APPLOCALDATA" },
  writeFile: vi.fn(async (path: string, data: Uint8Array, opts?: unknown) => {
    if (data.byteLength > ipcLimit) throw new Error("IPC payload too large");
    existing.add(path);
    disk.set(path, data.slice());
    fsCalls.push({ cmd: "writeFile", path, opts });
  }),
  open: vi.fn(
    async (path: string, opts: { createNew?: boolean; read?: boolean; baseDir?: string }) => {
      if (opts.createNew && existing.has(path)) throw new Error("EEXIST");
      if (opts.read) {
        if (!disk.has(path)) throw new Error("ENOENT");
        fsCalls.push({ cmd: "readFile", path, opts: { baseDir: opts.baseDir } });
      } else {
        existing.add(path);
        disk.set(path, new Uint8Array());
      }
      let writes = 0;
      let readOffset = 0;
      return {
        write: async (data: Uint8Array) => {
          if (data.byteLength > ipcLimit) throw new Error("IPC payload too large");
          if (writes++ >= failAfter) throw new Error("disk full");
          const n = Math.min(chunkLimit, data.byteLength);
          const old = disk.get(path)!;
          const next = new Uint8Array(old.byteLength + n);
          next.set(old);
          next.set(data.subarray(0, n), old.byteLength);
          disk.set(path, next);
          fsCalls.push({ cmd: "writeFile", path, opts: { baseDir: opts.baseDir } });
          return n;
        },
        stat: async () => ({ size: disk.get(path)!.byteLength + sizeAdjustment }),
        read: async (buffer: Uint8Array) => {
          if (buffer.byteLength > ipcLimit) throw new Error("IPC payload too large");
          const bytes = disk.get(path)!;
          if (readOffset === bytes.byteLength) return null;
          const n = Math.min(chunkLimit, buffer.byteLength, bytes.byteLength - readOffset);
          buffer.set(bytes.subarray(readOffset, readOffset + n));
          readOffset += n;
          return n;
        },
        close: async () => {
          fsCalls.push({ cmd: "close", path });
        },
      };
    },
  ),
  readFile: vi.fn(async (path: string, opts?: unknown) => {
    fsCalls.push({ cmd: "readFile", path, opts });
    if (!disk.has(path)) throw new Error("ENOENT");
    if (disk.get(path)!.byteLength > ipcLimit) throw new Error("IPC payload too large");
    return disk.get(path)!.slice();
  }),
  remove: vi.fn(async (path: string, opts?: unknown) => {
    disk.delete(path);
    existing.delete(path);
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
  isAbsolute: vi.fn(async (path: string) => path.startsWith("/")),
  dirname: vi.fn(async (path: string) => path.slice(0, path.lastIndexOf("/"))),
  normalize: vi.fn(async (path: string) => path.replace(/\/$/, "")),
  join: vi.fn(async (...parts: string[]) => parts.filter(Boolean).join("/")),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    if (cmd === "get_download_directory") return { ...directory };
  }),
}));

vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "linux" }));

const { installFileSink } = await import("../fileSink");
const { getFileSink, __resetFileSink } = await import("@yuanchat/shared");

beforeEach(() => {
  directory = { path: "/home/u/Downloads", custom: false };
  fsCalls.length = 0;
  invoked.length = 0;
  existing.clear();
  disk.clear();
  chunkLimit = Infinity;
  failAfter = Infinity;
  ipcLimit = Infinity;
  sizeAdjustment = 0;
  __resetFileSink();
  installFileSink();
});

describe("save 落 downloads 目录", () => {
  it("自定义目录按实际绝对路径落盘和避重，切回原目录可以识别已有下载", async () => {
    directory = { path: "/chosen/A", custom: true };
    existing.add("/chosen/A/a.pdf");
    const sink = getFileSink();
    const path = await sink.save(new Uint8Array([8]), "a.pdf", "application/pdf");
    expect(path).toBe("/chosen/A/a (2).pdf");
    expect([...disk.get(path!)!]).toEqual([8]);
    expect(await sink.isCurrentDirectory!(path!)).toBe(true);
    directory = { path: "/chosen/B", custom: true };
    expect(await sink.isCurrentDirectory!(path!)).toBe(false);
    await sink.read!(path!, "downloads");
    expect(fsCalls.find((call) => call.cmd === "readFile")?.path).toBe(path);
    directory = { path: "/chosen/A", custom: true };
    expect(await sink.isCurrentDirectory!(path!)).toBe(true);
  });

  it("附件名不能借路径穿越写入其他已授权目录", async () => {
    await expect(
      getFileSink().save(new Uint8Array([8]), "../other/a.pdf", "application/pdf"),
    ).rejects.toThrow("invalid download filename");
    expect(disk.size).toBe(0);
  });

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

  it("同时保存同名文件时两份字节都保留，路径不同", async () => {
    const sink = getFileSink();
    const paths = await Promise.all([
      sink.save(new Uint8Array([1]), "a.pdf", "application/pdf"),
      sink.save(new Uint8Array([2]), "a.pdf", "application/pdf"),
    ]);
    expect(new Set(paths).size).toBe(2);
    expect([...disk.values()].map((bytes) => [...bytes])).toEqual([[1], [2]]);
  });

  it("已有超过一百个同名副本时继续避让，不覆盖最后一份", async () => {
    existing.add("a.pdf");
    for (let n = 2; n <= 101; n += 1) existing.add(`a (${n}).pdf`);
    disk.set("a (101).pdf", new Uint8Array([9]));
    const path = await getFileSink().save(new Uint8Array([3]), "a.pdf", "application/pdf");
    expect(path).toBe("/home/u/Downloads/a (102).pdf");
    expect([...disk.get("a (101).pdf")!]).toEqual([9]);
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
  it("桌面打开目标是文件夹，并按实际绝对路径检查文件是否被删除", async () => {
    const sink = getFileSink();
    const path = "/home/u/Downloads/a.pdf";
    expect(sink.revealTarget).toBe("folder");
    existing.add(path);
    expect(await sink.exists!(path)).toBe(true);
    existing.delete(path);
    expect(await sink.exists!(path)).toBe(false);
  });

  it("read 与 remove 透传到 plugin-fs 并带对应 baseDir", async () => {
    const sink = getFileSink();
    disk.set("outbox/c-1-a.pdf", new Uint8Array([1]));
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

it("原生短写会继续写完，不能把不完整文件标为下载成功", async () => {
  chunkLimit = 2;
  await getFileSink().save(
    new Uint8Array([1, 2, 3, 4, 5]),
    "partial.bin",
    "application/octet-stream",
  );
  expect([...disk.get("partial.bin")!]).toEqual([1, 2, 3, 4, 5]);
});

it("写到一半失败关闭句柄并删除本次半成品，不留下损坏下载", async () => {
  chunkLimit = 2;
  failAfter = 1;
  await expect(
    getFileSink().save(new Uint8Array([1, 2, 3, 4]), "failed.bin", "application/octet-stream"),
  ).rejects.toThrow("disk full");
  expect(disk.has("failed.bin")).toBe(false);
  expect(fsCalls.some((call) => call.cmd === "close")).toBe(true);
});

it.each(["downloads", "appdata"] as const)(
  "%s 大文件以有界 IPC 写完，保留短写后的全部字节",
  async (dir) => {
    ipcLimit = 1024 * 1024;
    chunkLimit = 512 * 1024;
    const bytes = Uint8Array.from({ length: 2 * ipcLimit + 17 }, (_, i) => i % 251);
    await getFileSink().save(bytes, "large.bin", "application/octet-stream", dir);
    const stored = disk.get(dir === "appdata" ? "outbox/large.bin" : "large.bin")!;
    expect(Buffer.from(stored).equals(Buffer.from(bytes))).toBe(true);
    expect(fsCalls.filter((call) => call.cmd === "close")).toHaveLength(1);
  },
);

it.each(["downloads", "appdata"] as const)(
  "%s 大文件通过有界 IPC 读回，短读不截断内容",
  async (dir) => {
    ipcLimit = 1024 * 1024;
    chunkLimit = 512 * 1024;
    const bytes = Uint8Array.from({ length: 2 * ipcLimit + 17 }, (_, i) => i % 251);
    disk.set(dir === "appdata" ? "outbox/large.bin" : "/home/u/Downloads/large.bin", bytes);
    const result = await getFileSink().read!("large.bin", dir);
    expect(Buffer.from(result).equals(Buffer.from(bytes))).toBe(true);
    expect(fsCalls.filter((call) => call.cmd === "close")).toHaveLength(1);
  },
);

it.each([-1, 1])("读取期间文件长度变化 %s 时拒绝返回截断内容并关闭句柄", async (adjustment) => {
  disk.set("outbox/changed.bin", new Uint8Array([1, 2, 3]));
  sizeAdjustment = adjustment;
  await expect(getFileSink().read!("changed.bin", "appdata")).rejects.toThrow();
  expect(fsCalls.some((call) => call.cmd === "close")).toBe(true);
});

it("出站副本短写失败也关闭句柄并清除半成品", async () => {
  chunkLimit = 2;
  failAfter = 1;
  await expect(
    getFileSink().save(
      new Uint8Array([1, 2, 3, 4]),
      "failed.bin",
      "application/octet-stream",
      "appdata",
    ),
  ).rejects.toThrow("disk full");
  expect(disk.has("outbox/failed.bin")).toBe(false);
  expect(fsCalls.some((call) => call.cmd === "close")).toBe(true);
});
