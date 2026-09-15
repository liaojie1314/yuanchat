/**
 * MessageEditHistoryDialog 编辑历史弹层测试
 *
 * 覆盖四态（加载骨架 / 正常升序 + 当前版本标注 / 错误 + 重试 / 空）、
 * open=false 不请求、Esc 关闭，以及首版时间取消息发送时间的口径
 * （历史端点每行 editedAt 是「被替换掉的时刻」，首版照搬会显示成第二版的生效时间）。
 *
 * 数据源是 REST（fetchMessageEdits），故按仓库既有组件测试惯例打桩
 * `@yuanchat/shared`（本包未引 msw），与 ConversationMediaView.test.tsx 同构：
 * 用 importOriginal 局部覆盖，其余导出（formatListTime / 返回键拦截栈）保持真身。
 * i18n 在 setup 里钉死 en-US，故文案断言取 i18n 实际译文而非硬编码。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n from "@yuanchat/design-system/i18n";
import { MessageEditHistoryDialog } from "../chat/MessageEditHistoryDialog";
import { fetchMessageEdits } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return { ...mod, fetchMessageEdits: vi.fn() };
});

const fetchEdits = vi.mocked(fetchMessageEdits);

/** 取当前语言的实际译文，并断言它不等于 key 本身（locale 漏翻会被这条抓住） */
function label(key: string): string {
  const text = i18n.t(key);
  expect(text).not.toBe(key);
  return text;
}

describe("MessageEditHistoryDialog", () => {
  beforeEach(() => {
    fetchEdits.mockReset();
  });

  it("shows the skeleton while loading", () => {
    fetchEdits.mockReturnValue(new Promise(() => {}));
    render(<MessageEditHistoryDialog messageId="m1" open onClose={() => {}} />);
    expect(screen.getByTestId("edit-history-skeleton")).toBeInTheDocument();
  });

  it("lists versions ascending and marks the current one", async () => {
    fetchEdits.mockResolvedValue([
      { version: 1, text: "第一版", editedAt: "2026-09-05T09:58:00Z" },
      { version: 2, text: "当前版", editedAt: "2026-09-05T10:00:00Z", current: true },
    ]);
    render(<MessageEditHistoryDialog messageId="m1" open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("第一版")).toBeInTheDocument());
    expect(screen.getByText("当前版")).toBeInTheDocument();
    expect(screen.getByTestId("edit-history-current")).toBeInTheDocument();
    expect(screen.getByText(label("chat.message.editCurrent"))).toBeInTheDocument();
    // 升序：非当前项在当前项之前
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-testid", "edit-history-item");
    expect(items[1]).toHaveAttribute("data-testid", "edit-history-current");
  });

  it("shows the error state with a retry that refetches", async () => {
    fetchEdits.mockRejectedValue(new Error("boom"));
    render(<MessageEditHistoryDialog messageId="m1" open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("edit-history-error")).toBeInTheDocument());
    expect(screen.getByText(label("chat.message.editHistoryError"))).toBeInTheDocument();

    fetchEdits.mockResolvedValue([
      { version: 1, text: "唯一版", editedAt: "2026-09-05T10:00:00Z" },
    ]);
    fireEvent.click(screen.getByTestId("edit-history-retry"));
    await waitFor(() => expect(screen.getByText("唯一版")).toBeInTheDocument());
    expect(fetchEdits).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state when there is no history", async () => {
    fetchEdits.mockResolvedValue([]);
    render(<MessageEditHistoryDialog messageId="m1" open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("edit-history-empty")).toBeInTheDocument());
  });

  it("does not request while closed", () => {
    render(<MessageEditHistoryDialog messageId="m1" open={false} onClose={() => {}} />);
    expect(fetchEdits).not.toHaveBeenCalled();
  });

  it("stamps the first version with the message send time, not that row's editedAt", async () => {
    // 只编辑过一次时后端两行的 editedAt 完全相同，首版必须改用发送时间
    const createdAtMs = new Date("2026-09-05T09:00:00Z").getTime();
    fetchEdits.mockResolvedValue([
      { version: 1, text: "原文", editedAt: "2026-09-05T10:00:00Z" },
      { version: 2, text: "改后", editedAt: "2026-09-05T10:00:00Z", current: true },
    ]);
    render(
      <MessageEditHistoryDialog messageId="m1" open createdAtMs={createdAtMs} onClose={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText("原文")).toBeInTheDocument());
    expect(screen.getByTestId("edit-history-time-1")).toHaveAttribute(
      "datetime",
      new Date(createdAtMs).toISOString(),
    );
    expect(screen.getByTestId("edit-history-time-2")).toHaveAttribute(
      "datetime",
      new Date("2026-09-05T10:00:00Z").toISOString(),
    );
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    fetchEdits.mockResolvedValue([]);
    render(<MessageEditHistoryDialog messageId="m1" open onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId("edit-history-empty")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
