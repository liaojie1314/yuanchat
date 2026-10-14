/**
 * searchMessages 查询串拼装 + MSW 四态覆盖
 *
 * @description
 * 两件事各一组：
 *   1. `types` 必须以逗号分隔写进 URL，空数组与省略同义 ——
 *      写错的话后端只会静默不过滤，用户看到的是「筛了文件却还是混着文本」。
 *   2. mock handler 的正常/空/错误/加载四态，是命令面板能离线开发的前提。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "../mocks/handlers";
import { searchMessages } from "../api/search";
import { useAuthStore } from "../store/authStore";

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

/** 拦一层 fetch 只为读到最终 URL，请求照旧交给 MSW */
function spyUrl() {
  const seen: string[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    seen.push(typeof input === "string" ? input : String((input as Request).url));
    return real(input as RequestInfo, init);
  });
  return seen;
}

describe("searchMessages 查询串", () => {
  it("types 以逗号分隔写进 URL", async () => {
    const seen = spyUrl();
    await searchMessages({ q: "报告", types: ["file", "image"] });
    expect(
      seen.some((u) => u.includes("types=file%2Cimage") || u.includes("types=file,image")),
    ).toBe(true);
  });

  it("types 为空数组时不写 types 参数（与省略同义）", async () => {
    const seen = spyUrl();
    await searchMessages({ q: "报告", types: [] });
    expect(seen.some((u) => u.includes("types="))).toBe(false);
  });

  it("conversation_id / before / limit 按需拼接", async () => {
    const seen = spyUrl();
    await searchMessages({
      q: "报告",
      conversation_id: "conv_001",
      before: "2026-10-09T14:05:00Z",
      limit: 5,
    });
    const url = seen.find((u) => u.includes("/messages/search")) ?? "";
    expect(url).toContain("conversation_id=conv_001");
    expect(url).toContain("before=");
    expect(url).toContain("limit=5");
  });
});

describe("MSW /messages/search 四态", () => {
  it("正常：返回结果并带上 message_type / file_name / object_key", async () => {
    const res = await searchMessages({ q: "报告" });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.has_more).toBe(false);
    const file = res.results.find((r) => r.message_type === 3);
    expect(file?.file_name).toBeTruthy();
    const image = res.results.find((r) => r.message_type === 2);
    expect(image?.object_key).toBeTruthy();
  });

  it("正常：按 types 过滤只返回该类型", async () => {
    const res = await searchMessages({ q: "报告", types: ["file"] });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.every((r) => r.message_type === 3)).toBe(true);
  });

  it("空：关键词含 nomatch 时返回空数组而非 null", async () => {
    const res = await searchMessages({ q: "nomatch-关键词" });
    expect(res.results).toEqual([]);
    expect(res.has_more).toBe(false);
  });

  it("错误：关键词含 boom 时抛错", async () => {
    await expect(searchMessages({ q: "boom-关键词" })).rejects.toThrow();
  });

  it("错误：未知类型与服务端同口径被拒", async () => {
    // 绕过类型签名传一个不存在的类型名：静默放过会让前端以为筛选生效了
    await expect(searchMessages({ q: "报告", types: ["banana" as never] })).rejects.toThrow();
  });

  it("加载：关键词含 slow 时明显更慢（供骨架屏取景）", async () => {
    const t0 = Date.now();
    await searchMessages({ q: "slow-关键词" });
    expect(Date.now() - t0).toBeGreaterThan(1000);
  }, 10_000);
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ accessToken: null });
});
