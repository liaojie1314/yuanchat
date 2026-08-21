/**
 * 会话列表预览文案两端同源单元测试
 *
 * 背景：同一条消息经 WS 实时帧与 REST `last_message` 两条路径到达前端，
 * 此前各自造文案（服务端硬编码中文 / 前端 i18n），多语言下"实时一种语言、
 * 刷新另一种语言"。现在服务端只给 preview_kind，文案统一由 previewBodyOf 产出。
 */
import { describe, it, expect } from "vitest";
import i18n from "@yuanchat/design-system/i18n";
import { previewBodyOf } from "../utils/messagePreview";
import { mapConversation } from "../api/chat";
import type { ConversationDTO } from "../api/chat";

describe("previewBodyOf", () => {
  it("非文本类消息返回当前语言的占位文案", () => {
    expect(previewBodyOf("image")).toBe(i18n.t("chat.message.image"));
    expect(previewBodyOf("file")).toBe(i18n.t("chat.message.file"));
    expect(previewBodyOf("voice")).toBe(i18n.t("chat.message.voice"));
    expect(previewBodyOf("video")).toBe(i18n.t("chat.message.video"));
    expect(previewBodyOf("sticker")).toBe(i18n.t("chat.message.sticker"));
    expect(previewBodyOf("encrypted")).toBe(i18n.t("chat.message.encrypted"));
  });

  it("占位文案必须真的有翻译（缺 key 时 i18n.t 会原样返回 key）", () => {
    for (const kind of ["image", "file", "voice", "video", "sticker", "encrypted"]) {
      const text = previewBodyOf(kind);
      expect(text).not.toMatch(/^chat\.message\./);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("文本/系统消息用正文，未知类型回退正文而不是空白", () => {
    expect(previewBodyOf("text", "你好")).toBe("你好");
    expect(previewBodyOf("system", "甲 创建了群聊")).toBe("甲 创建了群聊");
    expect(previewBodyOf("unknown", "原样正文")).toBe("原样正文");
    expect(previewBodyOf(undefined, "旧服务端没有 preview_kind")).toBe("旧服务端没有 preview_kind");
    expect(previewBodyOf("text", null)).toBe("");
  });
});

describe("mapConversation 预览本地化", () => {
  const base: ConversationDTO = {
    id: "c1",
    type: 2,
    name: "研发群",
    member_count: 3,
    unread_count: 0,
    is_muted: false,
    last_seq: 3,
    my_last_read_seq: 3,
    updated_at: new Date().toISOString(),
    last_message: {
      preview: "",
      preview_kind: "sticker",
      sender_nickname: "陈曦",
      created_at: new Date().toISOString(),
    },
  };

  it("贴纸预览走本地化占位并保留群聊昵称前缀", () => {
    const conv = mapConversation(base);
    expect(conv.lastMessage).toBe("陈曦: " + i18n.t("chat.message.sticker"));
  });

  it("加密消息预览不再是空串", () => {
    const conv = mapConversation({
      ...base,
      type: 1,
      last_message: { ...base.last_message!, preview_kind: "encrypted" },
    });
    expect(conv.lastMessage).toBe(i18n.t("chat.message.encrypted"));
  });

  it("系统消息用正文且不加昵称前缀", () => {
    const conv = mapConversation({
      ...base,
      last_message: {
        ...base.last_message!,
        preview: "陈曦 创建了群聊",
        preview_kind: "system",
      },
    });
    expect(conv.lastMessage).toBe("陈曦 创建了群聊");
  });

  it("文本消息仍是昵称 + 正文", () => {
    const conv = mapConversation({
      ...base,
      last_message: { ...base.last_message!, preview: "发布评审改到明早", preview_kind: "text" },
    });
    expect(conv.lastMessage).toBe("陈曦: 发布评审改到明早");
  });
});
