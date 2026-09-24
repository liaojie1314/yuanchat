/**
 * MessageBubble 贴纸渲染、「添加到表情」菜单项与视频气泡测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n from "@yuanchat/design-system/i18n";
import { MessageBubble } from "../chat/MessageBubble";
import { setVoiceRate, stopVoice } from "../chat/voicePlayer";
import type { ChatMessage } from "@yuanchat/shared";

/**
 * 菜单项文案取当前语言的实际译文，而非正则匹配。
 *
 * @remarks 原实现用 `/add.*sticker|添加到表情/i` 定位——该正则恰好也匹配**原始 key**
 *   `sticker.addToStickers`（"add" + "Sticker"），于是 i18n key 写错、UI 显示原始 key
 *   时测试照样通过（假绿）。这里额外断言译文 ≠ key 本身，
 *   locale 缺该 key 时 i18next 回落成 key，正好被这条断言抓住。
 */
function label(key: string): string {
  const text = i18n.t(key);
  expect(text).not.toBe(key);
  return text;
}

// 打桩 shared 模块
vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    getDownloadUrl: vi.fn(async (key: string) => "https://signed/" + key),
    showToast: vi.fn(),
  };
});

describe("sticker rendering and add-to-favorites menu item", () => {
  it("renders sticker without bubble padding/background", () => {
    const msg: ChatMessage = {
      id: "m1",
      conversationId: "c1",
      kind: "sticker",
      isSelf: false,
      sticker: { key: "images/x.png", width: 96, height: 96 },
      time: "10:00",
      seq: 1,
    };
    const { container } = render(<MessageBubble msg={msg} />);
    // 贴纸容器不应带 msg-bubble-self/msg-bubble-peer 背景类
    const bubbleDiv = container.querySelector(".msg-bubble-peer, .msg-bubble-self");
    expect(bubbleDiv).toBeNull();
  });

  it("shows add-to-sticker menu item only for image messages with onAddSticker", () => {
    const msg: ChatMessage = {
      id: "m1",
      conversationId: "c1",
      kind: "image",
      isSelf: false,
      senderName: "Bob",
      image: { key: "images/x.png", width: 200, height: 200 },
      time: "10:00",
      seq: 1,
    };
    const onAddSticker = vi.fn();
    const { container } = render(<MessageBubble msg={msg} onAddSticker={onAddSticker} />);

    // 定位图片气泡容器（p-1.5 + rounded-lg 的那层）
    const bubble = container.querySelector(".msg-bubble-peer");
    expect(bubble).toBeTruthy();
    fireEvent.contextMenu(bubble!);

    const item = screen.getByRole("menuitem", { name: label("sticker.addToStickers") });
    fireEvent.click(item);
    expect(onAddSticker).toHaveBeenCalledTimes(1);
  });

  it("hides add-to-sticker menu item when onAddSticker is not provided", () => {
    const msg: ChatMessage = {
      id: "m1",
      conversationId: "c1",
      kind: "image",
      isSelf: false,
      senderName: "Bob",
      image: { key: "images/x.png", width: 200, height: 200 },
      time: "10:00",
      seq: 1,
    };
    const { container } = render(<MessageBubble msg={msg} />);
    fireEvent.contextMenu(container.querySelector(".msg-bubble-peer")!);

    expect(
      screen.queryByRole("menuitem", { name: label("sticker.addToStickers") }),
    ).not.toBeInTheDocument();
  });

  it("sticker messages have no onClick lightbox handler (excluded from image viewer flow)", async () => {
    const msg: ChatMessage = {
      id: "m1",
      conversationId: "c1",
      kind: "sticker",
      isSelf: false,
      sticker: { key: "images/x.png", width: 96, height: 96 },
      time: "10:00",
      seq: 1,
    };
    const onImageClick = vi.fn();
    const { container } = render(<MessageBubble msg={msg} onImageClick={onImageClick} />);

    // 必须等签名 URL 落地后再点：原实现用 `if (img) click` 兜底，而 <img> 只在
    // getDownloadUrl resolve 后才渲染，同步查询恒为 null → 断言从未真正点到过东西
    await vi.waitFor(() => {
      expect(container.querySelector("img")).not.toBeNull();
    });
    fireEvent.click(container.querySelector("img")!);
    expect(onImageClick).not.toHaveBeenCalled();
  });
});

describe("video bubble", () => {
  /** 已确认的视频消息（有对象 key 与缩略图 key，元数据齐全） */
  function videoMsg(overrides: Partial<ChatMessage["video"]> = {}): ChatMessage {
    return {
      id: "mv1",
      conversationId: "c1",
      kind: "video",
      isSelf: false,
      senderName: "Bob",
      video: {
        duration: 75,
        width: 1280,
        height: 720,
        key: "files/2026/09/a.mp4",
        thumbKey: "images/2026/09/a.jpg",
        name: "demo.mp4",
        size: "2.0 MB",
        ...overrides,
      },
      time: "10:00",
      seq: 3,
    };
  }

  it("渲染封面缩略图与 m:ss 时长角标", async () => {
    render(<MessageBubble msg={videoMsg()} />);

    // 封面按 thumbKey 签下载 URL（正片不在消息流里下载）
    await waitFor(() => {
      const img = document.querySelector("img");
      expect(img?.getAttribute("src")).toBe("https://signed/images/2026/09/a.jpg");
    });
    expect(screen.getByText("1:15")).toBeInTheDocument();
  });

  it("点播放钮按对象 key 现签地址并打开全屏播放层", async () => {
    render(<MessageBubble msg={videoMsg()} />);

    fireEvent.click(screen.getByTestId("video-play"));

    const overlay = await screen.findByRole("dialog", { name: label("media.videoPlay") });
    await waitFor(() => {
      expect(overlay.querySelector("video")?.getAttribute("src")).toBe(
        "https://signed/files/2026/09/a.mp4",
      );
    });

    // Esc 关闭（与 ImageLightbox 同键位）
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: label("media.videoPlay") }),
      ).not.toBeInTheDocument();
    });
  });

  it("乐观发送态（无缩略图、时长未知）显示占位且播本地 blob", async () => {
    const msg = videoMsg({
      duration: 0,
      width: 0,
      height: 0,
      key: undefined,
      thumbKey: undefined,
      localUrl: "blob:local-video",
    });
    render(<MessageBubble msg={msg} />);

    // 没有封面对象 → 不发签名请求、不渲染 img（灰底占位 + 播放钮）
    expect(document.querySelector("img")).toBeNull();
    // 时长未知时不显示 0:00 角标（假信息比没信息更糟）
    expect(screen.queryByText("0:00")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("video-play"));
    const overlay = await screen.findByRole("dialog", { name: label("media.videoPlay") });
    expect(overlay.querySelector("video")?.getAttribute("src")).toBe("blob:local-video");
  });

  it("视频气泡保留气泡背景（与贴纸不同），并带 data-kind 锚点", () => {
    const { container } = render(<MessageBubble msg={videoMsg()} />);
    expect(container.querySelector('[data-kind="video"]')).toBeTruthy();
    expect(container.querySelector(".msg-bubble-peer")).toBeTruthy();
  });
});

describe("voice playback rate", () => {
  /** 替身音频：jsdom 未实现 HTMLMediaElement.play */
  class FakeAudio {
    playbackRate = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) {}
    play(): Promise<void> {
      return Promise.resolve();
    }
    pause(): void {}
  }

  /** 一条可播放的语音消息（有对象 key，播放按钮才会去签地址） */
  const voiceMsg: ChatMessage = {
    id: "mv-voice",
    conversationId: "c1",
    kind: "voice",
    isSelf: false,
    senderName: "Bob",
    voice: { seconds: 12, wave: [6, 12, 18], key: "files/2026/09/v.webm" },
    time: "10:00",
    seq: 2,
  };

  beforeEach(() => {
    vi.stubGlobal("Audio", FakeAudio);
    // 播放器是模块级单例：用例间必须归零，否则「上一条还在播」会串态
    stopVoice();
    setVoiceRate(1);
  });

  afterEach(() => {
    stopVoice();
    setVoiceRate(1);
    vi.unstubAllGlobals();
  });

  it("倍速按钮只在本行正在播放时出现，且按 1 → 1.5 → 2 → 1 循环", async () => {
    render(<MessageBubble msg={voiceMsg} />);

    // 未播放：不占位、不出现（每行都挂一个倍速钮会把消息流塞满）
    expect(screen.queryByTestId("voice-rate")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: label("chat.input.voice") }));

    const rateBtn = await screen.findByTestId("voice-rate");
    expect(rateBtn).toHaveTextContent("1x");

    fireEvent.click(rateBtn);
    expect(rateBtn).toHaveTextContent("1.5x");
    fireEvent.click(rateBtn);
    expect(rateBtn).toHaveTextContent("2x");
    fireEvent.click(rateBtn);
    expect(rateBtn).toHaveTextContent("1x");
  });

  it("另一条语音消息（未在播放）不显示倍速按钮", async () => {
    render(<MessageBubble msg={voiceMsg} />);
    fireEvent.click(screen.getByRole("button", { name: label("chat.input.voice") }));
    await screen.findByTestId("voice-rate");

    // 同一播放态下渲染另一条语音：倍速钮不应跟着长出来
    render(<MessageBubble msg={{ ...voiceMsg, id: "other-voice" }} />);
    expect(screen.getAllByTestId("voice-rate")).toHaveLength(1);
  });
});
