/** 更新检查真实执行来源顺序；只由 MSW 替换外部 HTTP。 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { checkAndroidUpdate } from "../android/otaUpdater";
import { setTokenProvider } from "@yuanchat/shared";

const githubApi = "https://api.github.com/repos/liaojie1314/yuanchat/releases/latest";
const serverApi = "*/api/v1/updates/android/aarch64";
const serverUpdate = {
  version: "0.8.0",
  notes: "server",
  url: "https://storage.yuanyuan.blog/releases/app.apk",
  sha256: "a".repeat(64),
  size: 10,
  mandatory: false,
};
const githubRelease = {
  tag_name: "v0.9.0",
  draft: false,
  prerelease: false,
  html_url: "https://github.com/liaojie1314/yuanchat/releases/tag/v0.9.0",
  body: "github",
  published_at: "2026-11-07T00:00:00Z",
  assets: [
    {
      name: "yuanchat-v0.9.0-app-universal-release.apk",
      size: 5,
      digest: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      browser_download_url:
        "https://github.com/liaojie1314/yuanchat/releases/download/v0.9.0/yuanchat-v0.9.0-app-universal-release.apk",
      url: "https://api.github.com/repos/liaojie1314/yuanchat/releases/assets/123",
    },
  ],
};
const server = setupServer();
const calls: string[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  setTokenProvider(() => null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem("yuanchat-device-uid", "private-device-id");
  setTokenProvider(() => "private-access-token");
  server.use(
    http.get(serverApi, () => {
      calls.push("server");
      return new HttpResponse(null, { status: 503 });
    }),
    http.get(githubApi, ({ request }) => {
      calls.push("github");
      expect(request.credentials).toBe("omit");
      expect(request.url).toBe(githubApi);
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.headers.has("cookie")).toBe(false);
      expect(request.headers.has("X-YuanChat-Update-Cohort")).toBe(false);
      return HttpResponse.json(githubRelease);
    }),
  );
});

describe("Android 更新来源", () => {
  it("第一次服务器成功后不再请求其他来源", async () => {
    server.use(
      http.get(serverApi, ({ request }) => {
        calls.push("server");
        expect(new URL(request.url).searchParams.get("device")).toBe("private-device-id");
        return HttpResponse.json(serverUpdate);
      }),
    );
    await expect(checkAndroidUpdate("0.7.0")).resolves.toMatchObject({ notes: "server" });
    expect(calls).toEqual(["server"]);
  });

  it("服务器第一次失败后第二次成功，不请求 GitHub", async () => {
    server.use(
      http.get(serverApi, () => {
        calls.push("server");
        return calls.length === 1
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json(serverUpdate);
      }),
    );
    await expect(checkAndroidUpdate("0.7.0")).resolves.toMatchObject({ notes: "server" });
    expect(calls).toEqual(["server", "server"]);
  });

  it("服务器首次 200 返回坏元数据时重试，第二次正常即结束", async () => {
    server.use(
      http.get(serverApi, () => {
        calls.push("server");
        return HttpResponse.json(calls.length === 1 ? { error: "proxy response" } : serverUpdate);
      }),
    );
    await expect(checkAndroidUpdate("0.7.0")).resolves.toMatchObject({ notes: "server" });
    expect(calls).toEqual(["server", "server"]);
  });

  it.each([
    ["不是对象", null],
    ["缺少版本", { ...serverUpdate, version: undefined }],
    ["缺少地址", { ...serverUpdate, url: undefined }],
    ["不是 HTTP 地址", { ...serverUpdate, url: "javascript:alert(1)" }],
    ["地址损坏", { ...serverUpdate, url: "https://" }],
    ["缺少摘要", { ...serverUpdate, sha256: undefined }],
    ["摘要损坏", { ...serverUpdate, sha256: "bad-digest" }],
    ["缺少大小", { ...serverUpdate, size: undefined }],
    ["大小无效", { ...serverUpdate, size: 0 }],
  ])("服务器连续两次 200 的%s元数据走 GitHub 后备", async (_name, body) => {
    server.use(
      http.get(serverApi, () => {
        calls.push("server");
        return HttpResponse.json(body);
      }),
    );
    await expect(checkAndroidUpdate("0.7.0")).resolves.toMatchObject({ notes: "github" });
    expect(calls).toEqual(["server", "server", "github"]);
  });

  it("服务器两次失败才请求一次 GitHub，并隔离凭据和设备标识", async () => {
    await expect(checkAndroidUpdate("0.7.0")).resolves.toMatchObject({
      version: "0.9.0",
      notes: "github",
      size: 5,
      mandatory: false,
      url: "https://api.github.com/repos/liaojie1314/yuanchat/releases/assets/123",
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    expect(calls).toEqual(["server", "server", "github"]);
  });

  it.each([1, 2])("服务器第 %i 次返回 204 时即停止，保留灰度和回滚决定", async (attempt) => {
    server.use(
      http.get(serverApi, () => {
        calls.push("server");
        return new HttpResponse(null, { status: calls.length < attempt ? 503 : 204 });
      }),
    );
    await expect(checkAndroidUpdate("0.7.0")).resolves.toBeNull();
    expect(calls).toEqual(Array(attempt).fill("server"));
  });

  it.each(["0.9.0", "0.10.0", "1.0.0", "0.9.0+build.1"])(
    "GitHub 版本不高于当前 %s 时无更新",
    async (version) => {
      await expect(checkAndroidUpdate(version)).resolves.toBeNull();
      expect(calls).toEqual(["server", "server", "github"]);
    },
  );

  it("GitHub 没有已发布版本时返回无更新", async () => {
    server.use(
      http.get(githubApi, () => {
        calls.push("github");
        return new HttpResponse(null, { status: 404 });
      }),
    );
    await expect(checkAndroidUpdate("0.7.0")).resolves.toBeNull();
    expect(calls).toEqual(["server", "server", "github"]);
  });

  it("同版本预发布客户端可升级到 GitHub 稳定版", async () => {
    await expect(checkAndroidUpdate("0.9.0-beta.1")).resolves.toMatchObject({ version: "0.9.0" });
  });

  it("两次自建请求各超时 10 秒后才切换 GitHub", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      const github = url === githubApi;
      calls.push(github ? "github" : "server");
      if (github) return Promise.resolve(HttpResponse.json(githubRelease));
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("timed out", "AbortError")),
        );
      });
    });
    const checking = checkAndroidUpdate("0.7.0");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(calls).toEqual(["server"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["server", "server"]);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(checking).resolves.toMatchObject({ version: "0.9.0" });
    expect(calls).toEqual(["server", "server", "github"]);
  });

  it("GitHub 失败后终止，不无限重试", async () => {
    server.use(
      http.get(githubApi, () => {
        calls.push("github");
        return new HttpResponse(null, { status: 403 });
      }),
    );
    await expect(checkAndroidUpdate("0.7.0")).rejects.toThrow();
    expect(calls).toEqual(["server", "server", "github"]);
  });

  it.each([
    ["非版本 tag", { tag_name: "main" }],
    ["预发布 tag", { tag_name: "v0.9.0-beta.1" }],
    ["非法版本数字", { tag_name: "v00.9.0" }],
    ["草稿", { draft: true }],
    ["预发布", { prerelease: true }],
    ["其他仓库", { html_url: "https://github.com/attacker/yuanchat/releases/tag/v0.9.0" }],
    ["缺少 APK", { assets: [] }],
    ["同名 APK 不唯一", { assets: [githubRelease.assets[0], githubRelease.assets[0]] }],
    ["不是 JSON 对象", null],
  ])("拒绝 GitHub 的%s元数据", async (_name, patch) => {
    server.use(
      http.get(githubApi, () => {
        calls.push("github");
        return HttpResponse.json(patch === null ? null : { ...githubRelease, ...patch });
      }),
    );
    await expect(checkAndroidUpdate("0.7.0")).rejects.toThrow();
    expect(calls).toEqual(["server", "server", "github"]);
  });

  it.each([
    ["缺失摘要", { digest: null }],
    ["错误摘要算法", { digest: "sha512:" + "a".repeat(64) }],
    ["摘要长度不对", { digest: "sha256:1234" }],
    ["负大小", { size: -1 }],
    ["零大小", { size: 0 }],
    ["不是整数大小", { size: 5.5 }],
    ["其他架构", { name: "yuanchat-v0.9.0-app-arm64-release.apk" }],
    [
      "其他版本下载链接",
      {
        browser_download_url:
          "https://github.com/liaojie1314/yuanchat/releases/download/v0.7.0/yuanchat-v0.7.0-app-universal-release.apk",
      },
    ],
    [
      "其他仓库下载链接",
      { url: "https://api.github.com/repos/attacker/yuanchat/releases/assets/123" },
    ],
    [
      "伪造 GitHub 主机",
      {
        url: "https://api.github.com.attacker.example/repos/liaojie1314/yuanchat/releases/assets/123",
      },
    ],
    ["不安全协议", { url: "http://api.github.com/repos/liaojie1314/yuanchat/releases/assets/123" }],
    [
      "下载链接附带参数",
      {
        url: "https://api.github.com/repos/liaojie1314/yuanchat/releases/assets/123?redirect=evil",
      },
    ],
  ])("拒绝 APK 的%s", async (_name, patch) => {
    server.use(
      http.get(githubApi, () => {
        calls.push("github");
        return HttpResponse.json({
          ...githubRelease,
          assets: [{ ...githubRelease.assets[0], ...patch }],
        });
      }),
    );
    await expect(checkAndroidUpdate("0.7.0")).rejects.toThrow();
    expect(calls).toEqual(["server", "server", "github"]);
  });
});
