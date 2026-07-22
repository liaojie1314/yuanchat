/**
 * api/users DTO 映射与 PUT 请求体单元测试
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchPublicProfile, updateMyProfile } from "../api/users";

function mockFetchOnce(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ code: 0, message: "ok", data }) }),
  );
}

describe("users api", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("fetchPublicProfile 映射 snake_case → camelCase", async () => {
    mockFetchOnce({
      id: "u1",
      nickname: "Bob",
      avatar_url: null,
      short_id: 10002,
      bio: "hi",
      gender: 1,
    });
    const p = await fetchPublicProfile("u1");
    expect(p).toEqual({
      id: "u1",
      nickname: "Bob",
      avatarUrl: null,
      shortId: 10002,
      bio: "hi",
      gender: 1,
    });
  });

  it("updateMyProfile 发 PUT 且只带出现的字段", async () => {
    mockFetchOnce({
      id: "u1",
      nickname: "新名",
      avatar_url: null,
      short_id: 10001,
      bio: null,
      gender: 0,
    });
    await updateMyProfile({ nickname: "新名" });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body)).toEqual({ nickname: "新名" });
  });
});
