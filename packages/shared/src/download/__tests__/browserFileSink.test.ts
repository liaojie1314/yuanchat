// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { __resetFileSink, getFileSink } from "../fileSink";
import {
  stageOutboxFile,
  readStagedOutboxFile,
  clearStagedOutboxFile,
} from "../../store/outboxSync";

const control = vi.hoisted(() => ({ directory: null as unknown }));
vi.mock("../browserDirectory", () => ({
  loadBrowserDownloadDirectory: async () => control.directory,
}));

/** 文件系统边界替身：实际保留字节，写入关闭前不提交。 */
function directoryFixture() {
  const files = new Map<string, Uint8Array>();
  let permission = "granted";
  let closeGate = Promise.resolve();
  let writeError: Error | null = null;
  let openError: DOMException | null = null;
  const handles = new Map<string, object>();
  const locations = new Map<object, string>();
  const modified = new Map<string, number>();
  const directory = {
    name: "Downloads",
    isSameEntry: async (other: unknown) => other === directory,
    queryPermission: async () => permission,
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (openError) throw openError;
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException("missing", "NotFoundError");
        files.set(name, new Uint8Array());
        handles.set(name, {});
        locations.set(handles.get(name)!, name);
        modified.set(name, 1);
      }
      const identity = handles.get(name);
      return {
        name,
        isSameEntry: async (other: { identity: object }) => other.identity === identity,
        identity,
        getFile: async () => {
          if (openError) throw openError;
          const trackedName = locations.get(identity!) ?? name;
          if (!files.has(trackedName)) throw new DOMException("missing", "NotFoundError");
          return {
            size: files.get(trackedName)!.length,
            lastModified: modified.get(trackedName),
            arrayBuffer: async () => files.get(trackedName)!.slice().buffer,
          };
        },
        createWritable: async () => {
          let bytes = new Uint8Array();
          return {
            write: async (next: Uint8Array) => {
              if (writeError) throw writeError;
              bytes = next.slice();
            },
            close: async () => {
              await closeGate;
              files.set(name, bytes);
              modified.set(name, modified.get(name)! + 1);
            },
            abort: async () => {},
          };
        },
      };
    },
    removeEntry: async (name: string) => {
      files.delete(name);
      handles.delete(name);
    },
  };
  control.directory = directory;
  return {
    directory,
    files,
    rename: (oldName: string, name: string) => {
      files.set(name, files.get(oldName)!);
      files.delete(oldName);
      locations.set(handles.get(oldName)!, name);
      handles.set(name, handles.get(oldName)!);
      handles.delete(oldName);
      modified.set(name, modified.get(oldName)!);
    },
    modify: (name: string, bytes: Uint8Array) => {
      files.set(name, bytes);
      modified.set(name, modified.get(name)! + 1);
    },
    deny: () => {
      permission = "prompt";
    },
    delayClose: (gate: Promise<void>) => {
      closeGate = gate;
    },
    failWrite: () => {
      writeError = new Error("disk full");
    },
    revokeDuringOpen: () => {
      openError = new DOMException("permission removed", "NotAllowedError");
    },
  };
}

beforeEach(() => {
  __resetFileSink();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:test",
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  // 同源多窗口按平台锁串行，替身也保留这个并发语义。
  let tail = Promise.resolve();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_name: string, work: () => Promise<unknown>) => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await work();
        } finally {
          release();
        }
      },
    },
  });
});

it("授权下载返回独立引用，可查看目录名和实际避重后的文件名，删除后能识别丢失", async () => {
  const disk = directoryFixture();
  disk.files.set("a.txt", new Uint8Array([9]));
  const sink = getFileSink();
  const path = await sink.save(new Uint8Array([1]), "a.txt", "text/plain");
  expect(path).toEqual(expect.any(String));
  expect(sink.revealTarget).toBe("location");
  expect(sink.describe?.(path!)).toBe("Downloads / a (2).txt");
  expect(await sink.exists?.(path!)).toBe(true);
  expect(await sink.reveal?.(path!)).toBe("Downloads / a (2).txt");
  disk.files.delete("a (2).txt");
  expect(await sink.exists?.(path!)).toBe(false);
});

it("切换目录后的同名下载各自保留原目录，旧引用不会指向新文件", async () => {
  const first = directoryFixture();
  const sink = getFileSink();
  const one = await sink.save(new Uint8Array([1]), "a.txt", "text/plain");
  const second = directoryFixture();
  second.directory.name = "Other";
  const two = await sink.save(new Uint8Array([2]), "a.txt", "text/plain");
  expect(one).not.toBe(two);
  expect(sink.describe?.(one!)).toBe("Downloads / a.txt");
  expect(sink.describe?.(two!)).toBe("Other / a.txt");
  await sink.remove?.(one!, "downloads");
  expect(first.files.size).toBe(0);
  expect(second.files.get("a.txt")).toEqual(new Uint8Array([2]));
});

it("已下载结果失去目录权限时提示重新授权，不能当成文件被删除", async () => {
  const disk = directoryFixture();
  const sink = getFileSink();
  const path = await sink.save(new Uint8Array([1]), "a.txt", "text/plain");
  disk.deny();
  await expect(sink.exists?.(path!)).rejects.toThrow("download.directoryPermissionRequired");
});

it("取消清理不能删除用户后来替换的同名文件", async () => {
  const disk = directoryFixture();
  const sink = getFileSink();
  const path = await sink.save(new Uint8Array([1]), "a.txt", "text/plain");
  await disk.directory.removeEntry("a.txt");
  await disk.directory.getFileHandle("a.txt", { create: true });
  disk.files.set("a.txt", new Uint8Array([9]));
  await sink.remove?.(path!, "downloads");
  expect(disk.files.get("a.txt")).toEqual(new Uint8Array([9]));
});

it("取消清理保留用户在同一文件句柄上改写的内容", async () => {
  const disk = directoryFixture();
  const sink = getFileSink();
  const path = await sink.save(new Uint8Array([1]), "a.txt", "text/plain");
  disk.modify("a.txt", new Uint8Array([9]));
  await sink.remove!(path!, "downloads");
  expect(disk.files.get("a.txt")).toEqual(new Uint8Array([9]));
});

it("保存结果可读回内容，并且切换当前目录后不再属于当前目录", async () => {
  directoryFixture();
  const sink = getFileSink();
  const path = await sink.save(new Uint8Array([1, 2]), "a.txt", "text/plain");
  expect(await sink.read!(path!, "downloads")).toEqual(new Uint8Array([1, 2]));
  expect(await sink.isCurrentDirectory!(path!)).toBe(true);
  directoryFixture();
  expect(await sink.isCurrentDirectory!(path!)).toBe(false);
});

it("文件改名后即使句柄跟随且内容未变，原路径也应视为丢失且保留改名文件", async () => {
  const disk = directoryFixture();
  const sink = getFileSink();
  const path = await sink.save(new Uint8Array([1, 2]), "a.txt", "text/plain");
  disk.rename("a.txt", "renamed.txt");
  expect(await sink.exists!(path!)).toBe(false);
  await expect(sink.read!(path!, "downloads")).rejects.toMatchObject({ name: "NotFoundError" });
  expect(disk.files.get("renamed.txt")).toEqual(new Uint8Array([1, 2]));
});

it("存在性查询后读句柄时失权也提示重新授权", async () => {
  const disk = directoryFixture();
  const sink = getFileSink();
  const path = await sink.save(new Uint8Array([1]), "a.txt", "text/plain");
  disk.revokeDuringOpen();
  await expect(sink.exists!(path!)).rejects.toThrow("download.directoryPermissionRequired");
});

it("未设置目录的默认浏览器下载不声称知道位置，仍可重复下载", async () => {
  control.directory = null;
  const sink = getFileSink();
  await expect(sink.save(new Uint8Array([1]), "a.txt", "text/plain")).resolves.toBeNull();
  await expect(sink.save(new Uint8Array([1]), "a.txt", "text/plain")).resolves.toBeNull();
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2);
});

it("Web读取下载能力不改变发送附件行为：appdata暂存不触发浏览器下载", async () => {
  const disk = directoryFixture();
  await stageOutboxFile("sending", new Uint8Array([1]), "a.txt", "text/plain");
  await expect(readStagedOutboxFile("sending", "a.txt")).rejects.toThrow("no disk sink");
  await clearStagedOutboxFile("sending", "a.txt");
  expect(disk.files.size).toBe(0);
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

afterEach(() => {
  control.directory = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("授权目录直接落盘，关闭写入流后才完成，不交给浏览器下载", async () => {
  const disk = directoryFixture();
  let release!: () => void;
  disk.delayClose(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  let done = false;
  const saving = getFileSink()
    .save(new Uint8Array([1, 2, 3]), "a.txt", "text/plain")
    .then(() => {
      done = true;
    });
  await vi.waitFor(() => expect(disk.files.has("a.txt")).toBe(true));
  expect(done).toBe(false);
  release();
  await saving;
  expect(Array.from(disk.files.get("a.txt")!)).toEqual([1, 2, 3]);
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

it("并发同名下载不覆盖已有文件或彼此", async () => {
  const disk = directoryFixture();
  disk.files.set("a.txt", new Uint8Array([9]));
  await Promise.all([
    getFileSink().save(new Uint8Array([1]), "a.txt", "text/plain"),
    getFileSink().save(new Uint8Array([2]), "a.txt", "text/plain"),
  ]);
  expect(disk.files.size).toBe(3);
  expect(Array.from(disk.files.get("a.txt")!)).toEqual([9]);
  expect(Array.from(disk.files.get("a (2).txt")!)).toEqual([1]);
  expect(Array.from(disk.files.get("a (3).txt")!)).toEqual([2]);
});

it("目录授权失效明确失败，不悄悄改走保存对话框", async () => {
  const disk = directoryFixture();
  disk.deny();
  await expect(getFileSink().save(new Uint8Array([1]), "a.txt", "text/plain")).rejects.toThrow(
    "download.directoryPermissionRequired",
  );
  expect(disk.files.size).toBe(0);
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

it("权限在查询后撤销也提示重新授权", async () => {
  const disk = directoryFixture();
  disk.revokeDuringOpen();
  await expect(getFileSink().save(new Uint8Array([1]), "a.txt", "text/plain")).rejects.toThrow(
    "download.directoryPermissionRequired",
  );
  expect(disk.files.size).toBe(0);
});

it("写盘失败删除本次半成品，保留原有同名文件", async () => {
  const disk = directoryFixture();
  disk.files.set("a.txt", new Uint8Array([9]));
  disk.failWrite();
  await expect(getFileSink().save(new Uint8Array([1]), "a.txt", "text/plain")).rejects.toThrow(
    "disk full",
  );
  expect([...disk.files.keys()]).toEqual(["a.txt"]);
  expect(Array.from(disk.files.get("a.txt")!)).toEqual([9]);
});

it("写盘阶段取消后不遗留下载产物", async () => {
  const disk = directoryFixture();
  let release!: () => void;
  disk.delayClose(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const controller = new AbortController();
  const result = getFileSink()
    .save(new Uint8Array([1]), "a.txt", "text/plain", "downloads", controller.signal)
    .catch((error: Error) => error);
  await vi.waitFor(() => expect(disk.files.has("a.txt")).toBe(true));
  controller.abort();
  release();
  expect(await result).toMatchObject({ name: "AbortError" });
  expect(disk.files.size).toBe(0);
});

it("读取未设置的目录期间取消，也不能再触发浏览器保存", async () => {
  let finish!: () => void;
  control.directory = new Promise<null>((resolve) => {
    finish = () => resolve(null);
  });
  const controller = new AbortController();
  const saving = getFileSink()
    .save(new Uint8Array([1]), "a.txt", "text/plain", "downloads", controller.signal)
    .catch((error: Error) => error);
  controller.abort();
  finish();
  expect(await saving).toMatchObject({ name: "AbortError" });
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});
