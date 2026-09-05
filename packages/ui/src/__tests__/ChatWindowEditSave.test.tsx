/**
 * ChatWindow 编辑态保存失败后的编辑态存续测试
 *
 * 只覆盖「失败后编辑态与输入框内容是否保留」这一条：用户刚改的文本此刻只存在于
 * 输入框里，除窗口过期（4032，再也存不上）外都必须留住，否则等于让人白打一遍。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatWindow } from "../ChatWindow";
import { useAuthStore, useConversationStore, useMessageStore, ApiError } from "@yuanchat/shared";
import type { Conversation } from "@yuanchat/shared";

const editMessageMock = vi.fn();

// jsdom 下容器高度恒为 0，真实 useVirtualizer 会算出「一个可见行都没有」，
// 消息气泡根本不渲染（这也是 ChatWindow.test.tsx 刻意只测空消息流的原因）。
// 这里给一个最小替身：把全部行都当作可见，其余 API 退化成空操作。
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 80,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        key: index,
        start: index * 80,
        size: 80,
      })),
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    isMockEnabled: () => true,
    editMessage: (id: string, text: string) => editMessageMock(id, text),
  };
});

const CONV: Conversation = {
  id: "c1",
  type: "private",
  name: "Bob",
  unreadCount: 0,
  isMuted: false,
};

/** 装一条本人发出、刚发出（在编辑窗口内）的文本消息 */
function setupWithOwnText() {
  useAuthStore.setState({ user: { id: "self", nickname: "Me" } });
  useConversationStore.setState({ activeId: CONV.id, conversations: [CONV] });
  useMessageStore.setState({
    messagesByConv: {
      [CONV.id]: [
        {
          id: "m1",
          conversationId: CONV.id,
          kind: "text",
          text: "原始文本",
          isSelf: true,
          seq: 10,
          status: "sent",
          createdAtMs: Date.now(),
          time: "10:00",
        },
      ],
    },
    hasMoreByConv: { [CONV.id]: false },
    typingByConv: {},
    replyingTo: null,
    composerInsert: "",
  });
}

/** 打开右键菜单点「编辑」，再把输入框改成新文本并回车保存 */
async function editAndSave(newText: string) {
  const bubble = screen.getByText("原始文本").closest("[data-kind]") as HTMLElement;
  fireEvent.contextMenu(bubble);
  fireEvent.click(await screen.findByTestId("msg-menu-edit"));

  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: newText } });
  fireEvent.keyDown(box, { key: "Enter" });
}

describe("ChatWindow 编辑保存失败后的编辑态存续", () => {
  beforeEach(() => {
    editMessageMock.mockReset();
    setupWithOwnText();
  });

  it("次数超限（4033）时保留编辑态与已输入文本 —— 用户刚打的字不能丢", async () => {
    editMessageMock.mockRejectedValue(new ApiError(4033, "edit limit exceeded"));
    render(<ChatWindow />);
    await editAndSave("改后文本");

    await waitFor(() => expect(editMessageMock).toHaveBeenCalled());
    expect(await screen.findByTestId("composer-editing-hint")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("改后文本");
  });

  it("窗口过期（4032）时退出编辑态 —— 再也存不上了，留着只让人徒劳重试", async () => {
    editMessageMock.mockRejectedValue(new ApiError(4032, "edit window expired"));
    render(<ChatWindow />);
    await editAndSave("改后文本");

    await waitFor(() => expect(editMessageMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("composer-editing-hint")).toBeNull());
  });

  it("网络故障（非 ApiError）时同样保留编辑态与文本", async () => {
    editMessageMock.mockRejectedValue(new Error("network down"));
    render(<ChatWindow />);
    await editAndSave("改后文本");

    await waitFor(() => expect(editMessageMock).toHaveBeenCalled());
    expect(await screen.findByTestId("composer-editing-hint")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("改后文本");
  });

  it("保存成功时退出编辑态并清空输入框", async () => {
    editMessageMock.mockResolvedValue({ editedAt: "2026-09-05T10:00:00Z", editCount: 1 });
    render(<ChatWindow />);
    await editAndSave("改后文本");

    await waitFor(() => expect(editMessageMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("composer-editing-hint")).toBeNull());
  });
});

describe("进入编辑态时的光标位置", () => {
  beforeEach(() => {
    editMessageMock.mockReset();
    setupWithOwnText();
  });

  // 安卓真机实测发现：程序化 setValue + focus 会把光标留在 0，
  // 用户接着打字变成往原文**前面**插（输入 -EDITED 得到 -EDITEDandroid-edit-orig）。
  //
  // 断言的是「组件显式调了 setSelectionRange」而不是 selectionStart 的最终值：
  // jsdom 给 textarea 赋值时自己就把 selectionStart 挪到末尾，拿最终值断言的话
  // 去掉修复照样通过（已实测），等于白测。
  it("显式把光标移到预填原文末尾 —— 否则接着打字会插到原文前面", async () => {
    const spy = vi.spyOn(HTMLTextAreaElement.prototype, "setSelectionRange");
    try {
      render(<ChatWindow />);
      const bubble = screen.getByText("原始文本").closest("[data-kind]") as HTMLElement;
      fireEvent.contextMenu(bubble);
      fireEvent.click(await screen.findByTestId("msg-menu-edit"));

      await waitFor(() => {
        expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("原始文本");
      });
      const end = "原始文本".length;
      await waitFor(() => expect(spy).toHaveBeenCalledWith(end, end));
    } finally {
      spy.mockRestore();
    }
  });
});
