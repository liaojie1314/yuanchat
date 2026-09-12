/**
 * CallInviteModal 组件测试
 *
 * 测试范围：mesh 人数上限的前置拦截（最多选 3 人，第 4 个被禁用）、
 * 自己不出现在候选里、确认时把选中的 id 交给调用方。
 *
 * setup.ts 已把语言钉成 en-US，故文案断言写英文。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useAuthStore } from "@yuanchat/shared";
import type { ConversationMember } from "@yuanchat/shared";
import { CallInviteModal } from "../CallInviteModal";

const MEMBERS: ConversationMember[] = [
  { userId: "me", nickname: "Me", avatarUrl: null, role: 2 },
  { userId: "u1", nickname: "Alice", avatarUrl: null, role: 0 },
  { userId: "u2", nickname: "Bob", avatarUrl: null, role: 0 },
  { userId: "u3", nickname: "Carol", avatarUrl: null, role: 0 },
  { userId: "u4", nickname: "Dave", avatarUrl: null, role: 0 },
];

describe("CallInviteModal", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: "me", nickname: "Me", shortId: 1, avatarUrl: null },
    } as Partial<ReturnType<typeof useAuthStore.getState>> as never);
  });

  const open = (onConfirm = vi.fn()) => {
    const utils = render(
      <CallInviteModal
        open
        convId="g1"
        media="audio"
        members={MEMBERS}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    return { ...utils, onConfirm };
  };

  it("候选里不含自己（自己已占一席）", () => {
    open();
    expect(screen.queryByText("Me")).toBeNull();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Dave")).toBeInTheDocument();
  });

  it("最多只能勾选 3 人，第 4 个被禁用", () => {
    open();
    // mesh 上限 4 = 自己 + 3：提示从「还能选几个」起步
    expect(screen.getByText("Up to 3 more")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Bob"));
    fireEvent.click(screen.getByText("Carol"));
    expect(screen.getByText("Up to 0 more")).toBeInTheDocument();

    const dave = screen.getByText("Dave").closest("button");
    expect(dave).toBeDisabled();
    // 禁用的按钮点了也不能越过上限
    fireEvent.click(dave as HTMLElement);
    expect(screen.getByText("Up to 0 more")).toBeInTheDocument();

    // 取消一个之后第 4 个重新可选
    fireEvent.click(screen.getByText("Alice"));
    expect(screen.getByText("Dave").closest("button")).not.toBeDisabled();
  });

  it("未选人时确认按钮禁用；选了之后把 media 与 id 交给调用方", () => {
    const { onConfirm } = open();
    const submit = screen.getByRole("button", { name: "Voice call" });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByText("Bob"));
    fireEvent.click(submit);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("audio", ["u2"]);
  });

  it("open 为 false 时不渲染任何内容", () => {
    render(
      <CallInviteModal
        open={false}
        convId="g1"
        media="video"
        members={MEMBERS}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText("Select participants")).toBeNull();
  });
});
