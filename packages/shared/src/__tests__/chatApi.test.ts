/**
 * api/chat DTO 映射与时间格式化单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  parseVideoContent,
  formatMediaDuration,
  fetchConversationMedia,
  pseudoWave,
  fetchMembers,
  recallMessage,
  conversationUpdatePatch,
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
  // 固定"现在"为 2026-08-23 15:00（周日），各档期望值才与运行日期无关
  const NOW = new Date(2026, 7, 23, 15, 0, 0);

  beforeEach(async () => {
    // CI runner locale 是 en_US，强制切 zh-CN 保证"昨天"与 Intl 输出可断言
    const { default: i18n } = await import("@yuanchat/design-system/i18n");
    await i18n.changeLanguage("zh-CN");
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("今天 → HH:mm", () => {
    const today = new Date(2026, 7, 23, 9, 5, 0);
    expect(formatMessageTime(today.toISOString())).toBe("09:05");
    expect(formatListTime(today.toISOString())).toBe("09:05");
  });

  it("昨天 → 昨天（不是 8月22日）", () => {
    expect(formatListTime(new Date(2026, 7, 22, 23, 30).toISOString())).toBe("昨天");
  });

  it("一周内 → 星期简称", () => {
    expect(formatListTime(new Date(2026, 7, 18, 10, 0).toISOString())).toBe("周二");
  });

  it("今年更早 → 月日", () => {
    expect(formatListTime(new Date(2026, 7, 1, 10, 0).toISOString())).toBe("8月1日");
  });

  it("跨年 → 完整日期", () => {
    expect(formatListTime(new Date(2025, 11, 31, 10, 0).toISOString())).toBe("2025/12/31");
  });

  it("客户端时钟偏差导致的未来时间按今天显示", () => {
    expect(formatListTime(new Date(2026, 7, 24, 8, 30).toISOString())).toBe("08:30");
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

  it("ja-JP 今日/昨日", async () => {
    const { default: i18n } = await import("@yuanchat/design-system/i18n");
    await i18n.changeLanguage("ja-JP");

    const today = new Date();
    expect(formatDateDivider(key(today))).toBe("今日");
    const y = new Date(today.getTime() - 86400000);
    expect(formatDateDivider(key(y))).toBe("昨日");

    await i18n.changeLanguage("zh-CN");
  });

  it("ko-KR 오늘/어제", async () => {
    const { default: i18n } = await import("@yuanchat/design-system/i18n");
    await i18n.changeLanguage("ko-KR");

    const today = new Date();
    expect(formatDateDivider(key(today))).toBe("오늘");
    const y = new Date(today.getTime() - 86400000);
    expect(formatDateDivider(key(y))).toBe("어제");

    await i18n.changeLanguage("zh-CN");
  });

  it("Intl.DateTimeFormat 在 ja/ko 输出正确", () => {
    const d = new Date(2026, 2, 5);
    expect(new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric" }).format(d)).toBe(
      "3月5日",
    );
    expect(new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(d)).toBe(
      "3월 5일",
    );
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

  it("passes through alias when present, omits when absent/null", async () => {
    mockFetchOnce({
      members: [
        { user_id: "u1", nickname: "群主", avatar_url: null, role: 2, alias: "老板" },
        { user_id: "u2", nickname: "管理", avatar_url: null, role: 1, alias: null },
        { user_id: "u3", nickname: "路人", avatar_url: null, role: 0 },
      ],
    });
    const members = await fetchMembers("conv-1");
    expect(members[0].alias).toBe("老板");
    expect(members[1].alias).toBeUndefined();
    expect(members[2].alias).toBeUndefined();
  });
});

describe("mapConversation announcement fields", () => {
  const base: ConversationDTO = {
    id: "c1",
    type: 2,
    name: "研发群",
    member_count: 3,
    unread_count: 0,
    is_muted: false,
    last_seq: 0,
    my_last_read_seq: 0,
    updated_at: "2026-07-31T10:00:00+08:00",
  };

  it("maps announcement and announcement_updated_at when present", () => {
    const conv = mapConversation({
      ...base,
      announcement: "周五 15:00 发布评审",
      announcement_updated_at: "2026-08-01T09:00:00+08:00",
    });
    expect(conv.announcement).toBe("周五 15:00 发布评审");
    expect(conv.announcementUpdatedAt).toBe("2026-08-01T09:00:00+08:00");
  });

  it("leaves announcement undefined when absent", () => {
    const conv = mapConversation(base);
    expect(conv.announcement).toBeUndefined();
    expect(conv.announcementUpdatedAt).toBeUndefined();
  });

  it("maps empty-string announcement to undefined (cleared), symmetric with conversationUpdatePatch", () => {
    const conv = mapConversation({
      ...base,
      announcement: "",
      announcement_updated_at: "2026-08-01T09:05:00+08:00",
    });
    expect(conv.announcement).toBeUndefined();
    expect(conv.announcementUpdatedAt).toBe("2026-08-01T09:05:00+08:00");
  });
});

describe("mapConversation pinned fields", () => {
  const base: ConversationDTO = {
    id: "c1",
    type: 1,
    name: "张三",
    member_count: 2,
    unread_count: 0,
    is_muted: false,
    last_seq: 0,
    my_last_read_seq: 0,
    updated_at: "2026-07-31T10:00:00+08:00",
  };

  it("maps is_pinned and pinned_at", () => {
    const conv = mapConversation({
      ...base,
      is_pinned: true,
      pinned_at: "2026-07-31T09:00:00+08:00",
    });
    expect(conv.isPinned).toBe(true);
    expect(conv.pinnedAt).toBe("2026-07-31T09:00:00+08:00");
  });

  it("defaults to unpinned when fields absent", () => {
    const conv = mapConversation(base);
    expect(conv.isPinned).toBe(false);
    expect(conv.pinnedAt).toBeUndefined();
  });
});

describe("conversationUpdatePatch", () => {
  it("patches settings fields when present", () => {
    expect(
      conversationUpdatePatch({
        conversation_id: "c1",
        is_pinned: true,
        pinned_at: "2026-07-31T09:00:00+08:00",
        is_muted: true,
      }),
    ).toEqual({
      isPinned: true,
      pinnedAt: "2026-07-31T09:00:00+08:00",
      isMuted: true,
    });
  });

  it("clears pinnedAt on unpin and skips absent fields", () => {
    expect(conversationUpdatePatch({ conversation_id: "c1", is_pinned: false })).toEqual({
      isPinned: false,
      pinnedAt: undefined,
    });
    // 群改名帧不携带设置字段：不误触 isPinned/isMuted
    expect(conversationUpdatePatch({ conversation_id: "c1", name: "新群名" })).toEqual({
      name: "新群名",
    });
  });

  it("maps non-empty announcement and updatedAt", () => {
    expect(
      conversationUpdatePatch({
        conversation_id: "c1",
        announcement: "新公告内容",
        announcement_updated_at: "2026-08-01T09:00:00+08:00",
      }),
    ).toEqual({
      announcement: "新公告内容",
      announcementUpdatedAt: "2026-08-01T09:00:00+08:00",
    });
  });

  it("maps empty-string announcement to undefined (cleared) but keeps updatedAt", () => {
    expect(
      conversationUpdatePatch({
        conversation_id: "c1",
        announcement: "",
        announcement_updated_at: "2026-08-01T09:05:00+08:00",
      }),
    ).toEqual({
      announcement: undefined,
      announcementUpdatedAt: "2026-08-01T09:05:00+08:00",
    });
  });

  it("skips announcement key entirely when absent (e.g. rename frame)", () => {
    expect(conversationUpdatePatch({ conversation_id: "c1", name: "新群名" })).not.toHaveProperty(
      "announcement",
    );
  });
});

describe("mapMessage sticker", () => {
  it("maps message_type 8 to kind sticker with parsed content", () => {
    const dto: MessageDTO = {
      id: "m1",
      conversation_id: "c1",
      sender_id: "u1",
      seq: 1,
      message_type: 8,
      content: JSON.stringify({
        sticker_id: "s1",
        key: "images/2026/08/a.png",
        width: 96,
        height: 96,
      }),
      status: 1,
      created_at: "2026-08-09T10:00:00+08:00",
      sender_nickname: "Alice",
    };
    const msg = mapMessage(dto, "u2");
    expect(msg.kind).toBe("sticker");
    expect(msg.sticker).toEqual({
      stickerId: "s1",
      key: "images/2026/08/a.png",
      width: 96,
      height: 96,
    });
  });
});

describe("mapMessage e2ee history", () => {
  const dto: MessageDTO = {
    id: "m-e2ee",
    conversation_id: "c1",
    sender_id: "u2",
    seq: 9,
    message_type: 7,
    content: JSON.stringify({ ratchet_key: "rk", n: 0, pn: 0, nonce: "nn", ciphertext: "cc" }),
    status: 1,
    created_at: "2026-08-21T10:00:00+08:00",
    sender_nickname: "Alice",
  };

  it("加密历史消息给出可读占位，而不是空气泡", () => {
    const msg = mapMessage(dto, "u1");
    // kindMap 没有 7，kind 回退 text；关键是 text 必须有内容
    expect(msg.kind).toBe("text");
    expect(msg.text).toBeTruthy();
    // 必须是真有翻译的文案，而不是原始 key
    expect(msg.text).not.toMatch(/^e2ee\./);
  });
});

describe("video message mapping", () => {
  const dto: MessageDTO = {
    id: "m-video",
    conversation_id: "c1",
    sender_id: "u2",
    seq: 12,
    message_type: 5,
    content: JSON.stringify({
      key: "files/2026/09/a.mp4",
      thumb_key: "images/2026/09/a.jpg",
      name: "发布演示.mp4",
      size: 3355443,
      duration: 15,
      width: 1280,
      height: 720,
    }),
    status: 1,
    created_at: "2026-09-02T10:00:00+08:00",
    sender_nickname: "李四",
  };

  it("parseVideoContent 解析全部字段，非法 JSON 回退零值", () => {
    expect(parseVideoContent(dto.content)).toEqual({
      key: "files/2026/09/a.mp4",
      thumbKey: "images/2026/09/a.jpg",
      name: "发布演示.mp4",
      size: 3355443,
      duration: 15,
      width: 1280,
      height: 720,
    });
    expect(parseVideoContent("broken")).toEqual({ duration: 0, width: 0, height: 0 });
  });

  it("message_type=5 映射为 video 气泡，size 走文件大小口径", () => {
    const msg = mapMessage(dto, "u1");
    expect(msg.kind).toBe("video");
    expect(msg.video).toEqual({
      duration: 15,
      width: 1280,
      height: 720,
      key: "files/2026/09/a.mp4",
      thumbKey: "images/2026/09/a.jpg",
      name: "发布演示.mp4",
      size: "3.2 MB",
    });
    // 视频不是文本消息：text 必须为空，否则气泡会同时渲染正文
    expect(msg.text).toBeUndefined();
  });

  it("formatMediaDuration 输出 m:ss，异常值按 0 处理", () => {
    expect(formatMediaDuration(15)).toBe("0:15");
    expect(formatMediaDuration(65)).toBe("1:05");
    expect(formatMediaDuration(600)).toBe("10:00");
    expect(formatMediaDuration(0)).toBe("0:00");
    expect(formatMediaDuration(-1)).toBe("0:00");
    expect(formatMediaDuration(Infinity)).toBe("0:00");
  });
});

describe("fetchConversationMedia", () => {
  beforeEach(() => vi.unstubAllGlobals());

  function mockFetchOnce(data: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve({ code: 0, message: "ok", data }) }),
    );
  }

  it("按 type/before_seq/limit 拼查询串并映射 snake_case 条目", async () => {
    mockFetchOnce({
      items: [
        {
          message_id: "m1",
          seq: 42,
          message_type: 5,
          sender_nickname: "张伟",
          created_at: "2026-09-02T10:00:00+08:00",
          key: "files/2026/09/x.mp4",
          thumb_key: "images/2026/09/y.jpg",
          name: "demo.mp4",
          size: 2048000,
          duration: 15,
          width: 1280,
          height: 720,
        },
      ],
      has_more: true,
    });

    const { items, hasMore } = await fetchConversationMedia("conv-1", "video", 50, 30);
    expect(hasMore).toBe(true);
    expect(items).toEqual([
      {
        messageId: "m1",
        seq: 42,
        messageType: 5,
        senderNickname: "张伟",
        createdAt: "2026-09-02T10:00:00+08:00",
        key: "files/2026/09/x.mp4",
        thumbKey: "images/2026/09/y.jpg",
        name: "demo.mp4",
        size: 2048000,
        duration: 15,
        width: 1280,
        height: 720,
        stickerId: undefined,
      },
    ]);

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/conversations/conv-1/media?");
    expect(call[0]).toContain("type=video");
    expect(call[0]).toContain("before_seq=50");
    expect(call[0]).toContain("limit=30");
  });

  it("items 缺失时返回空列表且 hasMore=false（不抛错）", async () => {
    mockFetchOnce({});
    expect(await fetchConversationMedia("conv-1", "all", 0, 30)).toEqual({
      items: [],
      hasMore: false,
    });
  });
});
