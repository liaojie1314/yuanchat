/**
 * MomentPostCard 测试：文本折叠、删除按钮可见性、点赞态、回复形态、状态 emoji
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MomentPostCard } from "../moments/MomentPostCard";
import type { MomentPost } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async () => {
  const actual = await vi.importActual<typeof import("@yuanchat/shared")>("@yuanchat/shared");
  return { ...actual, getDownloadUrl: vi.fn(async (key: string) => "blob:" + key) };
});

function makePost(overrides: Partial<MomentPost> = {}): MomentPost {
  return {
    id: "p1",
    user: { id: "u1", nickname: "Alice", avatarUrl: "", statusEmoji: "" },
    content: "hello",
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

describe("MomentPostCard", () => {
  it("长文本折叠，点全文展开", () => {
    const long = Array.from({ length: 12 }, (_, i) => "第 " + i + " 行文字").join("\n");
    render(<MomentPostCard post={makePost({ content: long })} />);
    const body = screen.getByTestId("moment-post-text");
    expect(body.getAttribute("data-expanded")).toBe("false");

    fireEvent.click(screen.getByText("More"));
    expect(screen.getByTestId("moment-post-text").getAttribute("data-expanded")).toBe("true");
  });

  it("短文本不渲染全文按钮", () => {
    render(<MomentPostCard post={makePost({ content: "一行就够" })} />);
    expect(screen.queryByText("More")).toBeNull();
  });

  it("deletable=false 时不渲染删除按钮", () => {
    render(<MomentPostCard post={makePost({ deletable: false })} />);
    expect(screen.queryByLabelText("Delete")).toBeNull();
  });

  it("deletable=true 时点击删除触发 onDelete", () => {
    const onDelete = vi.fn();
    render(<MomentPostCard post={makePost()} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(onDelete).toHaveBeenCalledWith("p1");
  });

  it("点赞按钮触发 onLike，已赞态图标带 data-liked", () => {
    const onLike = vi.fn();
    render(<MomentPostCard post={makePost({ likedByMe: true, likeCount: 1 })} onLike={onLike} />);
    const btn = screen.getByTestId("moment-like-btn");
    expect(btn.getAttribute("data-liked")).toBe("true");
    fireEvent.click(btn);
    expect(onLike).toHaveBeenCalledWith("p1");
  });

  it("评论带 replyToUser 时渲染「A 回复 B」形态", () => {
    render(
      <MomentPostCard
        post={makePost({
          comments: [
            {
              id: "c1",
              user: { id: "u2", nickname: "Bob", avatarUrl: "", statusEmoji: "" },
              replyToUser: { id: "u3", nickname: "Carol", avatarUrl: "", statusEmoji: "" },
              content: "同意",
              createdAt: "2026-09-13T10:01:00Z",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText(/同意/)).toBeInTheDocument();
  });

  it("昵称旁渲染个人状态 emoji", () => {
    render(
      <MomentPostCard
        post={makePost({ user: { id: "u1", nickname: "Alice", avatarUrl: "", statusEmoji: "🌊" } })}
      />,
    );
    expect(screen.getByText("🌊")).toBeInTheDocument();
  });
});
