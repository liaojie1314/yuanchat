/**
 * api/auth 的请求体、请求头与响应映射单元测试
 *
 * 请求字段名是与后端唯一的契约（`reset_ticket` / `new_password` 写错会静默失效：
 * Gin 忽略未知字段，后端只会回一句笼统的 400），因此逐个断言 fetch 实际收到的 body。
 * 两个 204 端点断言解析为 undefined，`verify` 断言 snake_case → camelCase 映射。
 * 扫码链路另断言轮询密钥确实走了请求头 —— 少了它后端一律 403。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  sendResetCode,
  verifyResetCode,
  resetPassword,
  createQrSession,
  pollQrSession,
} from "../api/auth";

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

/** 模拟一次成功信封响应 */
function mockEnvelopeOnce(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ code: 0, message: "ok", data }),
    }),
  );
}

/** 取出唯一一次 fetch 调用的 url 与解析后的请求体 */
function sentRequest(): { url: string; method: string; body: unknown } {
  const call = vi.mocked(globalThis.fetch).mock.calls[0];
  const init = call[1] as RequestInit;
  return {
    url: String(call[0]),
    method: String(init.method),
    body: JSON.parse(String(init.body)) as unknown,
  };
}

/** 取出唯一一次 fetch 调用的 url、方法与请求头（无 body 的 GET 用） */
function sentHeaders(): { url: string; method: string; headers: Record<string, string> } {
  const call = vi.mocked(globalThis.fetch).mock.calls[0];
  const init = call[1] as RequestInit;
  return {
    url: String(call[0]),
    method: String(init.method),
    headers: (init.headers as Record<string, string>) || {},
  };
}

describe("api/auth 改密链路", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("sendResetCode 只发 phone 一个字段，204 解析为 undefined", async () => {
    mockNoContentOnce();
    await expect(sendResetCode("13800138000")).resolves.toBeUndefined();
    const req = sentRequest();
    expect(req.url).toBe("http://localhost:8085/api/v1/auth/password/otp");
    expect(req.method).toBe("POST");
    expect(req.body).toEqual({ phone: "13800138000" });
  });

  it("verifyResetCode 发 phone + code，并把 reset_ticket / expires_in 映射成驼峰", async () => {
    mockEnvelopeOnce({ reset_ticket: "tk-abc", expires_in: 300 });
    const ticket = await verifyResetCode("13800138000", "123456");
    expect(ticket).toEqual({ resetTicket: "tk-abc", expiresIn: 300 });
    const req = sentRequest();
    expect(req.url).toBe("http://localhost:8085/api/v1/auth/password/verify");
    expect(req.body).toEqual({ phone: "13800138000", code: "123456" });
  });

  it("verifyResetCode 的 expiresIn 取后端值而非写死常量", async () => {
    mockEnvelopeOnce({ reset_ticket: "tk-abc", expires_in: 42 });
    await expect(verifyResetCode("13800138000", "123456")).resolves.toEqual({
      resetTicket: "tk-abc",
      expiresIn: 42,
    });
  });

  it("resetPassword 发 reset_ticket + new_password（snake_case），204 解析为 undefined", async () => {
    mockNoContentOnce();
    await expect(resetPassword("tk-abc", "Abcdef12")).resolves.toBeUndefined();
    const req = sentRequest();
    expect(req.url).toBe("http://localhost:8085/api/v1/auth/password/reset");
    expect(req.body).toEqual({ reset_ticket: "tk-abc", new_password: "Abcdef12" });
  });
});

describe("api/auth 扫码链路", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("createQrSession 发空对象请求体（后端要求 body 必须存在），并映射四个字段", async () => {
    mockEnvelopeOnce({
      qr_token: "tk",
      qr_payload: "yuanchat://login?t=tk",
      expires_in: 120,
      poll_secret: "sec",
    });
    await expect(createQrSession()).resolves.toEqual({
      qrToken: "tk",
      qrPayload: "yuanchat://login?t=tk",
      expiresIn: 120,
      pollSecret: "sec",
    });
    const req = sentRequest();
    expect(req.url).toBe("http://localhost:8085/api/v1/auth/qr/session");
    expect(req.method).toBe("POST");
    expect(req.body).toEqual({});
  });

  it("pollQrSession 把轮询密钥放进 X-Qr-Poll-Secret 请求头，而不是 query", async () => {
    mockEnvelopeOnce({ status: "pending", expires_in: 118 });
    await pollQrSession("tk", "sec");
    const req = sentHeaders();
    // 密钥进 query 会被写进服务端 access log，因此必须是请求头
    expect(req.url).toBe("http://localhost:8085/api/v1/auth/qr/tk");
    expect(req.method).toBe("GET");
    expect(req.headers["X-Qr-Poll-Secret"]).toBe("sec");
  });

  it("pollQrSession 未确认时不带 tokens，已确认时映射令牌对", async () => {
    mockEnvelopeOnce({ status: "scanned", expires_in: 100 });
    await expect(pollQrSession("tk", "sec")).resolves.toEqual({
      status: "scanned",
      expiresIn: 100,
      tokens: undefined,
    });

    vi.unstubAllGlobals();
    mockEnvelopeOnce({
      status: "confirmed",
      expires_in: 0,
      tokens: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
    });
    await expect(pollQrSession("tk", "sec")).resolves.toEqual({
      status: "confirmed",
      expiresIn: 0,
      // 会话剩余秒数是 0，令牌寿命是 3600 —— 两个 expires_in 不可混用
      tokens: { accessToken: "at", refreshToken: "rt", expiresIn: 3600 },
    });
  });
});
