/**
 * api/client 响应解析单元测试
 *
 * 覆盖 204 空响应体分支与非 204 错误响应分支：
 * 前者必须直接返回 undefined（后端 c.Status(204) 没有 body，解析 JSON 会抛 SyntaxError），
 * 后者必须照旧解析信封并抛 ApiError —— 两条一起才能证明 204 短路没有把错误响应吞掉。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError, apiGet, apiPost } from "../api/client";
import { deleteFriend, unblockUser } from "../api/contacts";

/** 模拟一次 204 响应：无 body，`res.json()` 与浏览器一致地抛 SyntaxError */
function mockNoContentOnce() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 204,
      json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
    }),
  );
}

/** 模拟一次带信封的响应（成功或失败都走这里） */
function mockEnvelopeOnce(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status, json: () => Promise.resolve(body) }));
}

describe("doFetch 的 204 处理", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("204 空响应体返回 undefined 而不抛错", async () => {
    mockNoContentOnce();
    await expect(apiPost<void>("/api/v1/auth/logout", {})).resolves.toBeUndefined();
  });

  it("非 204 的错误响应仍解析信封并抛 ApiError（code 为 number）", async () => {
    mockEnvelopeOnce(400, { code: 400, message: "validation.passwordDigit" });
    const err = await apiGet<unknown>("/api/v1/users/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(400);
    expect(typeof (err as ApiError).code).toBe("number");
    expect((err as ApiError).message).toBe("validation.passwordDigit");
  });

  it("429 限流响应仍抛 ApiError 而不被 204 短路吞掉", async () => {
    mockEnvelopeOnce(429, { code: 429, message: "rate limit exceeded, please try again later" });
    await expect(
      apiPost<void>("/api/v1/auth/password/otp", { phone: "13800138000" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("200 正常响应照旧返回 data", async () => {
    mockEnvelopeOnce(200, { code: 0, message: "ok", data: { id: "u1" } });
    await expect(apiGet<{ id: string }>("/api/v1/users/u1")).resolves.toEqual({ id: "u1" });
  });
});

describe("既有 204 端点的调用方", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("deleteFriend 打 204 端点时正常完成", async () => {
    mockNoContentOnce();
    await expect(deleteFriend("u1")).resolves.toBeUndefined();
  });

  it("unblockUser 打 204 端点时正常完成", async () => {
    mockNoContentOnce();
    await expect(unblockUser("u1")).resolves.toBeUndefined();
  });
});
