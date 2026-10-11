/**
 * 管理端 401 处置单元测试
 *
 * 要钉住的三件事：
 * 1. 读出口（pagedGet / envelopeGet）拿到 401 必须清本地登录态 ——
 *    RequireAuth 订阅 isAuthenticated，清掉就等于跳登录页
 * 2. 写出口（adminPost / adminDelete）同样要生效。这条单独测是因为
 *    refresh token 缺失时 shared 的刷新兜底不会清登录态，只补读出口
 *    就会出现「列表页会跳、操作按钮不跳」
 * 3. 401 只清不吞：错误照旧抛回调用方；非 401（403）一概不动登录态；
 *    登录接口自己的 401（密码错）不走本模块，不该把人踢走
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, useAuthStore } from "@yuanchat/shared";
import { banUser, listUsers, takeSessionExpired } from "../api";

/**
 * 造一个已登录的管理端会话。
 * refreshToken 置空是故意的：模拟 refresh 也没了的真实掉线场景，
 * 此时 shared 的刷新兜底返回 null 且不清登录态，正好暴露出口是否都补上了。
 */
function signInWithoutRefreshToken() {
  useAuthStore.setState({
    user: { id: "u1", nickname: "admin" },
    accessToken: "access-token",
    refreshToken: null,
    expiresAt: Date.now() + 10 * 60_000,
    isAuthenticated: true,
  });
}

/** 让所有 fetch 都回同一个信封 */
function mockEnvelope(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status, json: () => Promise.resolve(body) }));
}

const UNAUTHORIZED = { code: 401, message: "unauthorized", data: null };
const FORBIDDEN = { code: 403, message: "admin privilege required", data: null };

describe("管理端 401 统一跳登录页", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.getState().clearSession();
    takeSessionExpired();
  });

  it("读出口：列表接口 401 清掉登录态，并把错误抛回调用方", async () => {
    signInWithoutRefreshToken();
    mockEnvelope(401, UNAUTHORIZED);

    const err: unknown = await listUsers("", 1).catch((e: unknown) => e);

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
    // 清而不吞：页面仍能拿到错误，不会停在一张没有任何提示的空列表上
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(401);
    expect(takeSessionExpired()).toBe(true);
  });

  it("写出口：操作接口 401 同样清掉登录态", async () => {
    signInWithoutRefreshToken();
    mockEnvelope(401, UNAUTHORIZED);

    await expect(banUser("u2")).rejects.toBeInstanceOf(ApiError);

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(takeSessionExpired()).toBe(true);
  });

  it("403 不是登录态问题，登录态必须原样保留", async () => {
    signInWithoutRefreshToken();
    mockEnvelope(403, FORBIDDEN);

    await expect(listUsers("", 1)).rejects.toBeInstanceOf(ApiError);

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(takeSessionExpired()).toBe(false);
  });

  it("登录接口自身的 401（密码错）不触发跳转，错误原样交给登录页展示", async () => {
    mockEnvelope(401, { code: 401, message: "auth.invalidCredentials", data: null });

    const err: unknown = await useAuthStore
      .getState()
      .loginWithPassword("13800000001", "wrong-password")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("auth.invalidCredentials");
    expect(takeSessionExpired()).toBe(false);
  });
});
