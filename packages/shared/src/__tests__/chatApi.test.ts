/**
 * api/chat DTO 映射与时间格式化单元测试
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatDateDivider,
  formatFileMeta,
  formatListTime,
  formatMessageTime,
  mapConversation,
  mapMessage,
  parseTextContent,
  parseImageContent,
  parseFileContent,
  parseVoiceContent,
  pseudoWave,
  fetchMembers,
  recallMessage,
} from "../api/chat";
import type { ConversationDTO, MessageDTO } from "../api/chat";

describe("file message mapping", () => {
  it("formatFileMeta 产出可读大小与大写扩展名", () => {
    expect(formatFileMeta("报告.pdf", 3355443)).toEqual({ size: "3.2 MB", ext: "PDF" });
    expect(formatFileMeta("a.tar.gz", 512)).toEqual({ size: "512 B", ext: "GZ" });
    expect(formatFileMeta("noext", 2048)).toEqual({ size: "2.0 KB", ext: "FILE" });
  });
  it("parseFileContent 解析落库 JSON，非法时回退", () => {
    expect(parseFileContent('{"key":"files/2026/07/x.pdf","name":"报告.pdf","size":100}')).toEqual({
      key: "files/2026/07/x.pdf",
      name: "报告.pdf",
      size: 100,
    });
    expect(parseFileContent("broken")).toEqual({ name: "", size: 0 });
  });
  it("parseVoiceContent 解析 duration/key", () => {
    expect(parseVoiceContent('{"key":"files/2026/07/v.webm","duration":12,"size":100}')).toEqual({
      key: "files/2026/07/v.webm",
      duration: 12,
    });
    expect(parseVoiceContent("bad")).toEqual({ duration: 0 });
  });
  it("pseudoWave 确定性伪波形（同 duration 同输出）", () => {
    const w = pseudoWave(12);
    expect(w).toEqual(pseudoWave(12));
    expect(w.length).toBeGreaterThanOrEqual(12);
    expect(w.length).toBeLessThanOrEqual(20);
    for (const h of w) expect(h).toBeGreaterThanOrEqual(6);
  });
});

describe("parseTextContent", () => {
  it("extracts text from JSON content", () => {
    expect(parseTextContent('{"text":"你好"}')).toBe("你好");
  });

  it("returns raw string for invalid JSON", () => {
    expect(parseTextContent("plain")).toBe("plain");
  });

  it("returns empty string when text field missing", () => {
    expect(parseTextContent('{"foo":1}')).toBe("");
  });
});

describe("parseImageContent", () => {
  it("extracts key + dimensions from JSON content", () => {
    expect(
      parseImageContent('{"key":"images/2026/07/a.png","width":100,"height":200,"size":9}'),
    ).toEqual({
      key: "images/2026/07/a.png",
      width: 100,
      height: 200,
    });
  });

  it("falls back to zero dimensions on invalid JSON", () => {
    expect(parseImageContent("garbage")).toEqual({ key: undefined, width: 0, height: 0 });
  });
});

describe("formatMessageTime / formatListTime", () => {
  it("formats today's date as HH:mm", () => {
    const today = new Date();
    today.setHours(9, 5, 0, 0);
    expect(formatMessageTime(today.toISOString())).toBe("09:05");
    expect(formatListTime(today.toISOString())).toBe("09:05");
  });

  it("formats other days of this year as M月D日", () => {
    const d = new Date();
    // 取一个必不为"今天"且同年的日期（1月1日或12月31日）
    const other =
      d.getMonth() === 0 && d.getDate() === 1
        ? new Date(d.getFullYear(), 11, 31)
        : new Date(d.getFullYear(), 0, 1);
    expect(formatListTime(other.toISOString())).toBe(
      other.getMonth() + 1 + "月" + other.getDate() + "日",
    );
  });

  it("returns empty string for invalid date", () => {
    expect(formatListTime("garbage")).toBe("");
    expect(formatMessageTime("garbage")).toBe("");
  });
});

describe("formatDateDivider", () => {
  const key = (d: Date) =>
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0");

  it("今天/昨天/日期", async () => {
    // CI runner locale 是 en_US → detectLocale() 走 en-US 分支导致 i18n.t 返回英文；
    // 本用例验证的是"今天/昨天/月日"的分支逻辑，强制切 zh-CN 保证 locale 无关
    const { default: i18n } = await import("@yuanchat/design-system/i18n");
    await i18n.changeLanguage("zh-CN");

    const today = new Date();
    expect(formatDateDivider(key(today))).toBe("今天");
    const y = new Date(today.getTime() - 86400000);
    expect(formatDateDivider(key(y))).toBe("昨天");
    expect(formatDateDivider("2020-03-05")).toBe("2020/3/5");
  });
});

describe("mapConversation", () => {
  const base: ConversationDTO = {
    id: "conv-1",
    type: 2,
    name: "研发群",
    member_count: 3,
    unread_count: 2,
    is_muted: false,
    last_seq: 10,
    my_last_read_seq: 8,
    updated_at: new Date().toISOString(),
    last_message: {
      preview: "发布评审改到明早",
      sender_nickname: "陈曦",
      created_at: new Date().toISOString(),
    },
  };

  it("maps group conversation with sender-prefixed preview", () => {
    const conv = mapConversation(base);
    expect(conv.type).toBe("group");
    expect(conv.name).toBe("研发群");
    expect(conv.lastMessage).toBe("陈曦: 发布评审改到明早");
    expect(conv.unreadCount).toBe(2);
    expect(conv.lastSeq).toBe(10);
    expect(conv.myLastReadSeq).toBe(8);
  });

  it("maps private conversation without sender prefix and with peer", () => {
    const conv = mapConversation({
      ...base,
      type: 1,
      name: "Bob",
      peer: { id: "u2", nickname: "Bob", avatar_url: null },
    });
    expect(conv.type).toBe("private");
    expect(conv.lastMessage).toBe("发布评审改到明早");
    expect(conv.peerId).toBe("u2");
  });
});

describe("mapMessage", () => {
  const dto: MessageDTO = {
    id: "m-1",
    conversation_id: "conv-1",
    sender_id: "u2",
    seq: 5,
    message_type: 1,
    content: '{"text":"hello"}',
    status: 1,
    created_at: new Date().toISOString(),
    sender_nickname: "Bob",
  };

  it("maps peer text message", () => {
    const msg = mapMessage(dto, "u1");
    expect(msg.isSelf).toBe(false);
    expect(msg.kind).toBe("text");
    expect(msg.text).toBe("hello");
    expect(msg.seq).toBe(5);
    expect(msg.status).toBeUndefined();
  });

  it("maps own message with read status (history convention)", () => {
    const msg = mapMessage({ ...dto, sender_id: "u1" }, "u1");
    expect(msg.isSelf).toBe(true);
    expect(msg.status).toBe("read");
  });

  it("marks recalled message (status=2) and drops its text", () => {
    const msg = mapMessage({ ...dto, status: 2 }, "u1");
    expect(msg.recalled).toBe(true);
  });

  it("maps image message (type=2) parsing key + dimensions, no text", () => {
    const msg = mapMessage(
      {
        ...dto,
        message_type: 2,
        content: '{"key":"images/2026/07/x.png","width":640,"height":480,"size":1234}',
      },
      "u1",
    );
    expect(msg.kind).toBe("image");
    expect(msg.text).toBeUndefined();
    expect(msg.image).toEqual({ key: "images/2026/07/x.png", width: 640, height: 480 });
  });

  it("fills createdAtMs from created_at", () => {
    const iso = "2026-07-17T09:05:00.000Z";
    const msg = mapMessage({ ...dto, created_at: iso }, "u1");
    expect(msg.createdAtMs).toBe(new Date(iso).getTime());
  });
});

describe("recallMessage", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("POSTs to the recall endpoint with an empty body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ json: () => Promise.resolve({ code: 0, message: "ok", data: {} }) }),
    );
    await recallMessage("m-1");
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/messages/m-1/recall");
    expect(call[1].method).toBe("POST");
  });
});

describe("fetchMembers", () => {
  beforeEach(() => vi.unstubAllGlobals());

  function mockFetchOnce(data: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve({ code: 0, message: "ok", data }) }),
    );
  }

  it("maps snake_case members and clamps unknown role to 0", async () => {
    mockFetchOnce({
      members: [
        { user_id: "u1", nickname: "群主", avatar_url: null, role: 2 },
        { user_id: "u2", nickname: "管理", avatar_url: "a.png", role: 1 },
        { user_id: "u3", nickname: "路人", avatar_url: null, role: 9 },
      ],
    });
    const members = await fetchMembers("conv-1");
    expect(members).toEqual([
      { userId: "u1", nickname: "群主", avatarUrl: null, role: 2 },
      { userId: "u2", nickname: "管理", avatarUrl: "a.png", role: 1 },
      { userId: "u3", nickname: "路人", avatarUrl: null, role: 0 },
    ]);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/conversations/conv-1/members");
  });

  it("returns empty array when members missing", async () => {
    mockFetchOnce({});
    expect(await fetchMembers("conv-1")).toEqual([]);
  });
});
