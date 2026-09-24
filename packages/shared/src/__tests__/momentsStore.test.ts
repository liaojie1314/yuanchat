/**
 * momentsStore 单测：分页追加、乐观点赞回滚、未读计数增减
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useMomentsStore } from "../store/momentsStore";
import * as api from "../api/moments";
import type { MomentPost } from "../api/moments";

function makePost(id: string, overrides: Partial<MomentPost> = {}): MomentPost {
  return {
    id,
    user: { id: "u1", nickname: "张三", avatarUrl: "", statusEmoji: "" },
    content: "内容 " + id,
    mediaKind: 0,
    media: [],
    visibility: 0,
    likeCount: 0,
    likedByMe: false,
    likes: [],
    comments: [],
    createdAt: "2026-09-13T10:00:00Z",
    deletable: true,
    ...overrides,
  };
}

beforeEach(() => {
  useMomentsStore.setState({
    posts: [],
    nextCursor: "",
    hasMore: true,
    loading: false,
    unreadCount: 0,
    activities: [],
  });
});

afterEach(() => vi.restoreAllMocks());

describe("momentsStore", () => {
  it("loadMore 追加而非覆盖，并推进游标", async () => {
    vi.spyOn(api, "fetchFeed").mockResolvedValueOnce({ posts: [makePost("p1")], nextCursor: "c1" });
    await useMomentsStore.getState().loadFeed();
    expect(useMomentsStore.getState().posts.map((p) => p.id)).toEqual(["p1"]);

    vi.spyOn(api, "fetchFeed").mockResolvedValueOnce({ posts: [makePost("p2")], nextCursor: "" });
    await useMomentsStore.getState().loadMore();
    expect(useMomentsStore.getState().posts.map((p) => p.id)).toEqual(["p1", "p2"]);
    // 空游标 = 到底
    expect(useMomentsStore.getState().hasMore).toBe(false);
  });

  it("点赞乐观更新，失败回滚", async () => {
    useMomentsStore.setState({ posts: [makePost("p1")] });
    vi.spyOn(api, "likePost").mockRejectedValueOnce(new Error("network"));

    await useMomentsStore.getState().toggleLike("p1");

    const post = useMomentsStore.getState().posts[0];
    expect(post.likedByMe).toBe(false);
    expect(post.likeCount).toBe(0);
  });

  it("点赞成功后保持新状态", async () => {
    useMomentsStore.setState({ posts: [makePost("p1")] });
    vi.spyOn(api, "likePost").mockResolvedValueOnce(undefined);

    await useMomentsStore.getState().toggleLike("p1");

    const post = useMomentsStore.getState().posts[0];
    expect(post.likedByMe).toBe(true);
    expect(post.likeCount).toBe(1);
  });

  it("pushActivity 累加未读，markRead 归零", async () => {
    useMomentsStore.getState().pushActivity({
      id: "a1",
      kind: 2,
      postId: "p1",
      actor: { id: "u2", nickname: "李四", avatarUrl: "", statusEmoji: "" },
      commentPreview: "好看",
      postPreview: "",
      postThumbKey: "",
      read: false,
      createdAt: "2026-09-13T10:01:00Z",
    });
    expect(useMomentsStore.getState().unreadCount).toBe(1);

    vi.spyOn(api, "markActivitiesRead").mockResolvedValueOnce(undefined);
    await useMomentsStore.getState().markRead();
    expect(useMomentsStore.getState().unreadCount).toBe(0);
  });

  it("removePost 乐观摘除，失败回滚", async () => {
    useMomentsStore.setState({ posts: [makePost("p1"), makePost("p2")] });
    vi.spyOn(api, "deletePost").mockRejectedValueOnce(new Error("network"));

    await expect(useMomentsStore.getState().removePost("p1")).rejects.toThrow();
    expect(useMomentsStore.getState().posts.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("comment 成功后把评论追加进该帖", async () => {
    useMomentsStore.setState({ posts: [makePost("p1")] });
    vi.spyOn(api, "addComment").mockResolvedValueOnce({
      id: "c1",
      user: { id: "u2", nickname: "李四", avatarUrl: "", statusEmoji: "" },
      replyToUser: null,
      content: "好看",
      createdAt: "2026-09-13T10:02:00Z",
    });

    await useMomentsStore.getState().comment("p1", "好看");

    expect(useMomentsStore.getState().posts[0].comments.map((c) => c.id)).toEqual(["c1"]);
  });
});
