/**
 * api/chat DTO 映射与时间格式化单元测试
 */
import { describe, it, expect } from "vitest";
import {
  formatListTime,
  formatMessageTime,
  mapConversation,
  mapMessage,
  parseTextContent,
} from "../api/chat";
import type { ConversationDTO, MessageDTO } from "../api/chat";

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
});
