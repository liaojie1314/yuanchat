/**
 * 未读选择器测试 —— 侧栏角标与桌面托盘共用的唯一口径。
 *
 * 钉住两条业务规则：
 * 1. 免打扰会话不计入未读总数（用户静音就是不想被提醒，角标为它亮起等于绕过免打扰）
 * 2. selectFirstUnreadId 没有未读时返回 null，调用方只聚焦窗口不跳转
 */
import { describe, it, expect } from "vitest";
import { selectTotalUnread, selectFirstUnreadId } from "../store/selectors";
import type { Conversation } from "../store/conversationStore";

function conv(p: Partial<Conversation>): Conversation {
  return {
    id: "c",
    type: "private",
    name: "n",
    unreadCount: 0,
    isMuted: false,
    ...p,
  } as Conversation;
}

describe("selectTotalUnread", () => {
  it("累加未读，免打扰会话不计入", () => {
    expect(
      selectTotalUnread([
        conv({ id: "a", unreadCount: 3 }),
        conv({ id: "b", unreadCount: 5, isMuted: true }),
        conv({ id: "c", unreadCount: 2 }),
      ]),
    ).toBe(5);
  });

  it("空列表为 0", () => {
    expect(selectTotalUnread([])).toBe(0);
  });

  it("全部免打扰时为 0（托盘不该因免打扰会话亮角标）", () => {
    expect(selectTotalUnread([conv({ unreadCount: 9, isMuted: true })])).toBe(0);
  });
});

describe("selectFirstUnreadId", () => {
  it("返回列表顺序里第一个有未读且非免打扰的会话", () => {
    expect(
      selectFirstUnreadId([
        conv({ id: "a", unreadCount: 0 }),
        conv({ id: "b", unreadCount: 1, isMuted: true }),
        conv({ id: "c", unreadCount: 4 }),
        conv({ id: "d", unreadCount: 7 }),
      ]),
    ).toBe("c");
  });

  it("没有未读时返回 null —— 点托盘只聚焦窗口，不能把用户正在看的位置顶掉", () => {
    expect(selectFirstUnreadId([conv({ unreadCount: 0 })])).toBeNull();
    expect(selectFirstUnreadId([])).toBeNull();
  });
});
