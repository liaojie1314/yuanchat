/**
 * 消息编辑的共享层单测
 *
 * @description
 * 覆盖三件事：
 * 1. `applyEdited` —— 帧驱动的就地改文，含"未命中不产生新引用"的引用稳定性；
 * 2. `canEdit` —— 编辑入口的闸门（本人 / 已确认 / 纯文本 / 未撤回 / 5 分钟窗口）；
 * 3. `backfillQuotes` —— REST 历史路径此前从不产出 quote，刷新后引用块整体消失。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RE_EDIT_WINDOW_MS, useMessageStore } from "../store/messageStore";
import type { ChatMessage } from "../store/messageStore";
import { EDIT_WINDOW_MS, canEdit } from "../utils/messageActions";
import { backfillQuotes, fetchMessages, mapMessage } from "../api/chat";
import type { MessageDTO } from "../api/chat";

describe("applyEdited", () => {
  beforeEach(() => {
    useMessageStore.setState({
      messagesByConv: {
        c1: [
          { id: "m1", kind: "text", text: "原文", isSelf: true, seq: 10, status: "sent" },
          { id: "m2", kind: "text", text: "别人的", isSelf: false, seq: 11, status: "sent" },
        ],
      },
    } as never);
  });

  it("就地替换正文并置 edited 与 editCount", () => {
    useMessageStore.getState().applyEdited("c1", "m1", "改后", 1);
    const list = useMessageStore.getState().messagesByConv.c1;
    const m1 = list.find((m) => m.id === "m1");
    expect(m1?.text).toBe("改后");
    expect(m1?.edited).toBe(true);
    expect(m1?.editCount).toBe(1);
  });

  it("不影响同会话其他消息", () => {
    useMessageStore.getState().applyEdited("c1", "m1", "改后", 1);
    const m2 = useMessageStore.getState().messagesByConv.c1.find((m) => m.id === "m2");
    expect(m2?.text).toBe("别人的");
    expect(m2?.edited).toBeUndefined();
  });

  it("未命中的 id 原样返回，不产生新引用", () => {
    const before = useMessageStore.getState().messagesByConv;
    useMessageStore.getState().applyEdited("c1", "不存在", "改后", 1);
    expect(useMessageStore.getState().messagesByConv).toBe(before);
  });

  it("未知会话不抛错", () => {
    expect(() => useMessageStore.getState().applyEdited("no-such", "m1", "x", 1)).not.toThrow();
  });
});

describe("canEdit", () => {
  const base = { id: "m1", kind: "text", isSelf: true, seq: 10, createdAtMs: 1_000_000 };
  const now = base.createdAtMs + 1000;

  it("编辑窗口与撤回后重新编辑窗口同值（防两处漂移）", () => {
    expect(EDIT_WINDOW_MS).toBe(RE_EDIT_WINDOW_MS);
  });

  it("本人的服务端已确认文本消息在窗口内可编辑", () => {
    expect(canEdit(base, now)).toBe(true);
  });

  it("别人的消息不可编辑", () => {
    expect(canEdit({ ...base, isSelf: false }, now)).toBe(false);
  });

  it("非文本消息不可编辑", () => {
    for (const kind of ["image", "file", "voice", "video", "sticker", "system"]) {
      expect(canEdit({ ...base, kind }, now)).toBe(false);
    }
  });

  it("已撤回不可编辑", () => {
    expect(canEdit({ ...base, recalled: true }, now)).toBe(false);
  });

  it("无 seq（未经服务端确认）不可编辑", () => {
    expect(canEdit({ ...base, seq: undefined }, now)).toBe(false);
  });

  it("超出 5 分钟窗口不可编辑", () => {
    expect(canEdit(base, base.createdAtMs + RE_EDIT_WINDOW_MS + 1)).toBe(false);
  });

  it("恰好在窗口边界仍可编辑", () => {
    expect(canEdit(base, base.createdAtMs + RE_EDIT_WINDOW_MS)).toBe(true);
  });
});

describe("backfillQuotes", () => {
  /** 造一条已映射好的历史消息（字段只给回填用得到的那几个） */
  function msg(over: Partial<ChatMessage> & { id: string }): ChatMessage {
    // time 是 ChatMessage 的必填字段，回填逻辑不看它，给个占位值即可
    return { conversationId: "c1", kind: "text", isSelf: false, time: "00:00", ...over };
  }

  it("原消息在同一页时拼出引用快照", () => {
    const page = [
      msg({ id: "src", text: "被引用的原文", senderName: "陈曦", seq: 5 }),
      msg({ id: "m9", text: "回复内容", replyToId: "src", seq: 9 }),
    ];
    backfillQuotes(page);
    expect(page[1].quote).toEqual({
      messageId: "src",
      senderName: "陈曦",
      excerpt: "被引用的原文",
    });
    // 原消息自己不该被塞 quote
    expect(page[0].quote).toBeUndefined();
  });

  it("原消息不在本页时保持缺省（不编造内容）", () => {
    const page = [msg({ id: "m9", text: "回复内容", replyToId: "not-in-page", seq: 9 })];
    backfillQuotes(page);
    expect(page[0].replyToId).toBe("not-in-page");
    expect(page[0].quote).toBeUndefined();
  });

  it("已有 quote 的消息不被覆盖（发送时的快照优先）", () => {
    const page = [
      msg({ id: "src", text: "现在的正文", senderName: "陈曦", seq: 5 }),
      msg({
        id: "m9",
        text: "回复内容",
        replyToId: "src",
        seq: 9,
        quote: { messageId: "src", senderName: "陈曦", excerpt: "引用当时的正文" },
      }),
    ];
    backfillQuotes(page);
    expect(page[1].quote?.excerpt).toBe("引用当时的正文");
  });

  it("原消息已撤回时跳过（撤回后 content 被清空，摘要必为空串）", () => {
    const page = [
      msg({ id: "src", text: undefined, senderName: "陈曦", seq: 5, recalled: true }),
      msg({ id: "m9", text: "回复内容", replyToId: "src", seq: 9 }),
    ];
    backfillQuotes(page);
    expect(page[1].quote).toBeUndefined();
  });

  it("引用文件消息时摘要取文件名", () => {
    const page = [
      msg({
        id: "src",
        kind: "file",
        senderName: "陈曦",
        file: { name: "季度报告.pdf", size: "1.0 MB", ext: "PDF" },
        seq: 5,
      }),
      msg({ id: "m9", text: "看这个", replyToId: "src", seq: 9 }),
    ];
    backfillQuotes(page);
    expect(page[1].quote?.excerpt).toBe("季度报告.pdf");
  });
});

describe("fetchMessages 引用回填接线", () => {
  /** 造一条 REST 历史 DTO（后端从不下发 quote，只给 reply_to_id） */
  function dto(over: Partial<MessageDTO> & { id: string; seq: number }): MessageDTO {
    return {
      conversation_id: "c1",
      sender_id: "u2",
      message_type: 1,
      content: '{"text":"' + (over.id === "src" ? "被引用的原文" : "回复内容") + '"}',
      status: 1,
      created_at: "2026-09-05T10:00:00Z",
      sender_nickname: "陈曦",
      ...over,
    };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("REST 历史返回的引用回复带上 quote（刷新后引用块不再消失）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            code: 0,
            message: "ok",
            // 后端按 seq 降序返回
            data: {
              messages: [dto({ id: "m9", seq: 9, reply_to_id: "src" }), dto({ id: "src", seq: 5 })],
              has_more: false,
            },
          }),
      }),
    );

    const { messages } = await fetchMessages("c1", 0, 30, "u1");
    const reply = messages.find((m) => m.id === "m9");
    expect(reply?.replyToId).toBe("src");
    expect(reply?.quote).toEqual({
      messageId: "src",
      senderName: "陈曦",
      excerpt: "被引用的原文",
    });
  });

  it("mapMessage 单条映射本身不产出 quote（回填是页级动作）", () => {
    const mapped = mapMessage(dto({ id: "m9", seq: 9, reply_to_id: "src" }), "u1");
    expect(mapped.replyToId).toBe("src");
    expect(mapped.quote).toBeUndefined();
  });
});
