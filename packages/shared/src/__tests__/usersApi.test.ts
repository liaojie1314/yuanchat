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
      // 老响应没有状态两列时补空串，调用方不必到处判 undefined
      statusEmoji: "",
      statusText: "",
    });
  });

  it("fetchPublicProfile 映射个人状态两列", async () => {
    mockFetchOnce({
      id: "u1",
      nickname: "Bob",
      avatar_url: null,
      short_id: 10002,
      bio: null,
      gender: 0,
      status_emoji: "🌊",
      status_text: "休假中",
    });
    const p = await fetchPublicProfile("u1");
    expect(p.statusEmoji).toBe("🌊");
    expect(p.statusText).toBe("休假中");
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

  it("updateMyProfile 透传状态三字段（含清除用的空串与 0）", async () => {
    mockFetchOnce({
      id: "u1",
      nickname: "我",
      avatar_url: null,
      short_id: 10001,
      bio: null,
      gender: 0,
    });
    await updateMyProfile({ statusEmoji: "", statusText: "", statusDuration: 0 });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body)).toEqual({
      status_emoji: "",
      status_text: "",
      status_duration: 0,
    });
  });
});
