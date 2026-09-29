import { describe, it, expect } from "vitest";
import { localRowOf, chatMessageOf, mediaKeysOf } from "../store/messageLocalSync";
import type { ChatMessage } from "../store/messageStore";

/** 造一条最小文本消息 */
function text(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    conversationId: "c1",
    kind: "text",
    isSelf: true,
    senderName: "我",
    text: "hi",
    time: "10:00",
    status: "sent",
    seq: 5,
    createdAtMs: 1_700_000_000_000,
    ...over,
  } as ChatMessage;
}

describe("localRowOf —— 剥掉瞬态字段", () => {
  it("剥掉 image.localUrl（刷新后即为死链）", () => {
    const m = text({
      kind: "image",
      image: { key: "k1", localUrl: "blob:abc", width: 10, height: 10 },
    } as Partial<ChatMessage>);
    const row = localRowOf(m);
    const back = chatMessageOf(row);
    expect(back.image!.localUrl).toBeUndefined();
    expect(back.image!.key).toBe("k1");
  });

  it("剥掉 file.localUrl 与 voice.localUrl", () => {
    const f = localRowOf(
      text({
        kind: "file",
        file: { key: "f1", name: "a.pdf", size: "3.2 MB", ext: "PDF", localUrl: "blob:f" },
      } as Partial<ChatMessage>),
    );
    expect(chatMessageOf(f).file!.localUrl).toBeUndefined();

    const v = localRowOf(
      text({
        kind: "voice",
        voice: { key: "v1", seconds: 3, wave: [], localUrl: "blob:v" },
      } as Partial<ChatMessage>),
    );
    expect(chatMessageOf(v).voice!.localUrl).toBeUndefined();
  });

  it("剥掉 video.localUrl（视频载荷同样带 blob: 预览链）", () => {
    const row = localRowOf(
      text({
        kind: "video",
        video: {
          key: "v1",
          thumbKey: "t1",
          name: "a.mp4",
          size: "1.0 MB",
          duration: 2,
          width: 1,
          height: 1,
          localUrl: "blob:vv",
        },
      } as Partial<ChatMessage>),
    );
    const back = chatMessageOf(row);
    expect(back.video!.localUrl).toBeUndefined();
    expect(back.video!.key).toBe("v1");
    expect(back.video!.thumbKey).toBe("t1");
  });

  it("status 一律按 sent 读回（sending/failed 属 outbox 职责）", () => {
    expect(chatMessageOf(localRowOf(text({ status: "sending" }))).status).toBe("sent");
    expect(chatMessageOf(localRowOf(text({ status: "failed" }))).status).toBe("sent");
    expect(chatMessageOf(localRowOf(text({ status: "read" }))).status).toBe("sent");
  });

  it("id / conversationId / seq 原样保留，供索引与游标使用", () => {
    const row = localRowOf(text({ seq: 42 }));
    expect(row.id).toBe("m1");
    expect(row.conversationId).toBe("c1");
    expect(row.seq).toBe(42);
  });

  it("无 seq 的消息（乐观条目）seq 记为 0，由调用方负责不落库", () => {
    const row = localRowOf(text({ seq: undefined } as Partial<ChatMessage>));
    expect(row.seq).toBe(0);
  });

  it("往返不丢正文与时间", () => {
    const back = chatMessageOf(localRowOf(text()));
    expect(back.text).toBe("hi");
    expect(back.createdAtMs).toBe(1_700_000_000_000);
  });
});

describe("mediaKeysOf —— 撤回时要删哪些 blob", () => {
  it("文本消息无 key", () => {
    expect(mediaKeysOf(text())).toEqual([]);
  });

  it("图片取 image.key", () => {
    expect(
      mediaKeysOf(
        text({ kind: "image", image: { key: "k1", width: 1, height: 1 } } as Partial<ChatMessage>),
      ),
    ).toEqual(["k1"]);
  });

  it("视频同时取 key 与 thumbKey（封面也要随撤回删掉）", () => {
    const keys = mediaKeysOf(
      text({
        kind: "video",
        video: {
          key: "v1",
          thumbKey: "t1",
          name: "a.mp4",
          size: "1.0 MB",
          duration: 2,
          width: 1,
          height: 1,
        },
      } as Partial<ChatMessage>),
    );
    expect(keys.sort()).toEqual(["t1", "v1"]);
  });

  it("语音与文件各取自己的 key", () => {
    expect(
      mediaKeysOf(
        text({ kind: "voice", voice: { key: "v", seconds: 1, wave: [] } } as Partial<ChatMessage>),
      ),
    ).toEqual(["v"]);
    expect(
      mediaKeysOf(
        text({
          kind: "file",
          file: { key: "f", name: "n", size: "1 B", ext: "TXT" },
        } as Partial<ChatMessage>),
      ),
    ).toEqual(["f"]);
  });

  it("贴纸 key 不算进来（内容寻址共享对象，撤回不能删别处在用的图）", () => {
    expect(
      mediaKeysOf(
        text({
          kind: "sticker",
          sticker: { stickerId: "s1", key: "shared-sticker-key", width: 1, height: 1 },
        } as Partial<ChatMessage>),
      ),
    ).toEqual([]);
  });

  it("缺 key 的媒体消息不产出空字符串（否则会去删 key 为空的行）", () => {
    expect(
      mediaKeysOf(text({ kind: "image", image: { width: 1, height: 1 } } as Partial<ChatMessage>)),
    ).toEqual([]);
  });
});
