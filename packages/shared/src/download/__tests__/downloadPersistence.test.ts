import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { closeLocalStore, initLocalStore, localDb, purgeLocalStore } from "../../localdb/session";
import { API_BASE } from "../../api/client";
import { STORE_META, txDone } from "../../localdb/db";
import { __resetFileSink, setFileSink, uniqueFileName } from "../fileSink";
import {
  resetDownloads,
  restoreDownloads,
  refreshDownloads,
  revealDownload,
  startDownload,
  useDownloadStore,
} from "../downloadStore";

vi.mock("../../api/files", () => ({ getDownloadUrl: async () => "http://localhost/file" }));

/** 真实 IDB 事务持久化下载结果，网络与原生磁盘边界使用内存替身。 */
async function completed(user = "download-owner") {
  await initLocalStore(user);
  setFileSink({
    read: async () => new Uint8Array([1, 2]),
    save: async () => "/Downloads/a.txt",
    exists: async () => true,
    reveal: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2]))),
  );
  await startDownload("m1", "files/a", "a.txt");
}

afterEach(async () => {
  resetDownloads();
  await purgeLocalStore();
  __resetFileSink();
  vi.unstubAllGlobals();
});

it("完成记录在关闭本地库和清空内存后恢复，查看不重新下载", async () => {
  await completed();
  resetDownloads();
  closeLocalStore();
  await initLocalStore("download-owner");
  await restoreDownloads();
  expect(useDownloadStore.getState().entries.m1).toMatchObject({
    phase: "done",
    savedPath: "/Downloads/a.txt",
  });
  vi.mocked(fetch).mockClear();
  await revealDownload("m1", "files/a", "a.txt");
  expect(fetch).not.toHaveBeenCalled();
});

it("重载时确认文件已删除则丢弃完成记录，不恢复成进行中", async () => {
  await completed();
  resetDownloads();
  setFileSink({
    read: async () => new Uint8Array([1, 2]),
    save: vi.fn(),
    exists: async () => false,
  });
  await restoreDownloads();
  expect(useDownloadStore.getState().entries).toEqual({});
});

it("恢复时权限失效保留完成记录，不能误判文件被删", async () => {
  await completed();
  resetDownloads();
  setFileSink({
    read: async () => new Uint8Array([1, 2]),
    save: vi.fn(),
    exists: async () => {
      throw new Error("download.directoryPermissionRequired");
    },
  });
  await restoreDownloads();
  expect(useDownloadStore.getState().entries.m1.phase).toBe("done");
});

it("账号与服务器分别隔离，其他账号和其他服务器的完成记录不恢复", async () => {
  await completed();
  resetDownloads();
  await initLocalStore("other-owner");
  const tx = localDb()!.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put({
    key: "downloads:https://other.example",
    value: { foreign: { phase: "done", received: 2, total: 2, savedPath: "/secret/file" } },
  });
  await txDone(tx);
  await restoreDownloads();
  expect(useDownloadStore.getState().entries).toEqual({});
  expect(API_BASE).not.toBe("https://other.example");
  await purgeLocalStore();
  await initLocalStore("download-owner");
});

it("恢复遇到迟到结果时不能覆盖新账号内存", async () => {
  await completed();
  resetDownloads();
  let finish!: (exists: boolean) => void;
  const exists = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  setFileSink({ read: async () => new Uint8Array([1, 2]), save: vi.fn(), exists });
  const pending = restoreDownloads();
  await vi.waitFor(() => expect(exists).toHaveBeenCalled());
  resetDownloads();
  finish(true);
  await pending;
  expect(useDownloadStore.getState().entries).toEqual({});
});

it("登出时取消在途写入，旧下载完成后不污染新账号或持久化未完成记录", async () => {
  await initLocalStore("download-owner");
  let finish!: (path: string) => void;
  const save = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  setFileSink({ read: async () => new Uint8Array([1, 2]), save, remove: vi.fn() });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1]))),
  );
  const pending = startDownload("m1", "files/a", "a.txt");
  await vi.waitFor(() => expect(save).toHaveBeenCalled());
  resetDownloads();
  finish("/Downloads/a.txt");
  await pending;
  await restoreDownloads();
  expect(useDownloadStore.getState().entries).toEqual({});
});

it("同名同大小文件内容被修改后重新下载，保留用户修改的旧文件", async () => {
  await completed();
  const save = vi.fn(async () => "/Downloads/a (2).txt");
  const remove = vi.fn();
  setFileSink({
    save,
    remove,
    read: async () => new Uint8Array([9, 9]),
    exists: async () => true,
    isCurrentDirectory: async () => true,
    reveal: vi.fn(),
  });
  await revealDownload("m1", "files/a", "a.txt");
  expect(save).toHaveBeenCalledOnce();
  expect(remove).not.toHaveBeenCalled();
  expect(useDownloadStore.getState().entries.m1.savedPath).toBe("/Downloads/a (2).txt");
});

it("切换目录后刷新入口允许重新下载，不搬动或删除旧文件", async () => {
  await completed();
  const remove = vi.fn();
  setFileSink({
    save: vi.fn(),
    remove,
    read: async () => new Uint8Array([1, 2]),
    isCurrentDirectory: async () => false,
  });
  await refreshDownloads();
  expect(useDownloadStore.getState().entries).toEqual({});
  expect(remove).not.toHaveBeenCalled();
  resetDownloads();
  await restoreDownloads();
  expect(useDownloadStore.getState().entries).toEqual({});
});

it("没有摘要的旧记录不冒充已核验下载，不删除原文件", async () => {
  await completed();
  const tx = localDb()!.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put({
    key: `download:${JSON.stringify(API_BASE)}:m1`,
    value: { phase: "done", received: 2, total: 2, savedPath: "/Downloads/a.txt" },
  });
  await txDone(tx);
  resetDownloads();
  await restoreDownloads();
  expect(useDownloadStore.getState().entries).toEqual({});
});

it("A原文件被改后保存后缀副本，切到B下载再切回A复用正确副本，重启仍保留候选", async () => {
  await initLocalStore("download-owner");
  let directory = "/A";
  const disk = new Map<string, Uint8Array>();
  const reveal = vi.fn();
  const remove = vi.fn();
  setFileSink({
    save: async (bytes, name) => {
      const path = `${directory}/${uniqueFileName(name, (candidate) => disk.has(`${directory}/${candidate}`))}`;
      disk.set(path, bytes.slice());
      return path;
    },
    read: async (path) => disk.get(path)!,
    exists: async (path) => disk.has(path),
    isCurrentDirectory: async (path) => path.startsWith(directory + "/"),
    reveal,
    remove,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2]))),
  );
  await startDownload("m1", "files/a", "a.txt");
  disk.set("/A/a.txt", new Uint8Array([9, 9]));
  await revealDownload("m1", "files/a", "a.txt");
  expect(useDownloadStore.getState().entries.m1.savedPath).toBe("/A/a (2).txt");
  directory = "/B";
  await refreshDownloads();
  expect(useDownloadStore.getState().entries.m1).toBeUndefined();
  await startDownload("m1", "files/a", "a.txt");
  directory = "/A";
  await refreshDownloads();
  expect(useDownloadStore.getState().entries.m1.savedPath).toBe("/A/a (2).txt");
  resetDownloads();
  await restoreDownloads();
  await revealDownload("m1", "files/a", "a.txt");
  expect(reveal).toHaveBeenLastCalledWith("/A/a (2).txt");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(disk.get("/A/a.txt")).toEqual(new Uint8Array([9, 9]));
  expect(disk.get("/B/a.txt")).toEqual(new Uint8Array([1, 2]));
  expect(remove).not.toHaveBeenCalled();
});

it("连续切目录时先前目录的迟到校验不能覆盖最新目录入口", async () => {
  await completed();
  useDownloadStore.setState({ entries: {} });
  let finish!: (value: boolean) => void;
  const isCurrentDirectory = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(false);
  setFileSink({ save: vi.fn(), read: async () => new Uint8Array([1, 2]), isCurrentDirectory });
  const previous = refreshDownloads();
  await vi.waitFor(() => expect(isCurrentDirectory).toHaveBeenCalledOnce());
  await refreshDownloads();
  finish(true);
  await previous;
  expect(useDownloadStore.getState().entries).toEqual({});
});
