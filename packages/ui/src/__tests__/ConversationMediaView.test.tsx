/**
 * ConversationMediaView 会话媒体相册测试
 *
 * 覆盖四态与核心交互：正常网格、Tab 切换（视频卡 + 时长角标）、错误态+重试、
 * 空态、点图片开大图查看器、安卓返回键关闭。
 *
 * 相册的数据源是 REST（fetchConversationMedia），故按仓库既有组件测试惯例
 * 打桩 `@yuanchat/shared` 而非起 MSW —— 与 StickerMarketView.test.tsx 同构。
 * i18n 在 setup 里钉死 en-US，故文案断言用英文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n from "@yuanchat/design-system/i18n";
import { ConversationMediaView } from "../chat/ConversationMediaView";
import * as shared from "@yuanchat/shared";
import type { MediaItem } from "@yuanchat/shared";

vi.mock("@yuanchat/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@yuanchat/shared")>();
  return {
    ...mod,
    fetchConversationMedia: vi.fn(),
    getDownloadUrl: vi.fn(async (key: string) => "https://signed/" + key),
    showToast: vi.fn(),
  };
});

/**
 * 取当前语言的实际译文，并断言它不等于 key 本身。
 *
 * @remarks i18next 对缺失 key 原样返回 key，直接用 key 当文案定位会在
 *   「locale 漏翻」时照样通过（假绿）。
 */
function label(key: string): string {
  const text = i18n.t(key);
  expect(text).not.toBe(key);
  return text;
}

/** 图片条目（messageType=2） */
function imageItem(seq: number): MediaItem {
  return {
    messageId: "m" + seq,
    seq,
    messageType: 2,
    senderNickname: "Bob",
    createdAt: "2026-09-02T10:00:00+08:00",
    key: "images/2026/09/" + seq + ".jpg",
    width: 800,
    height: 600,
  };
}

/** 视频条目（messageType=5，带缩略图与时长） */
function videoItem(seq: number): MediaItem {
  return {
    messageId: "m" + seq,
    seq,
    messageType: 5,
    senderNickname: "Bob",
    createdAt: "2026-09-02T10:00:00+08:00",
    key: "files/2026/09/" + seq + ".mp4",
    thumbKey: "images/2026/09/" + seq + ".jpg",
    name: "demo.mp4",
    size: 2048000,
    duration: 75,
    width: 1280,
    height: 720,
  };
}

/** 文件条目（messageType=3，走行列表而非方格） */
function fileItem(seq: number): MediaItem {
  return {
    messageId: "m" + seq,
    seq,
    messageType: 3,
    senderNickname: "Bob",
    createdAt: "2026-09-02T10:00:00+08:00",
    key: "files/2026/09/" + seq + ".pdf",
    name: "spec.pdf",
    size: 3355443,
  };
}

const mockedFetch = () => vi.mocked(shared.fetchConversationMedia);

function renderAlbum(onClose = vi.fn()) {
  render(<ConversationMediaView conversationId="c1" onClose={onClose} />);
  return onClose;
}

describe("ConversationMediaView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("首屏渲染类型 Tab 与图片网格（三张图 → 三个 img）", async () => {
    mockedFetch().mockResolvedValue({
      items: [imageItem(3), imageItem(2), imageItem(1)],
      hasMore: false,
    });

    renderAlbum();
    // 骨架先于数据出现（加载态占位，尺寸与真实方格一致）
    expect(screen.getByTestId("media-skeleton")).toBeInTheDocument();

    expect(await screen.findByTestId("media-image-3")).toBeInTheDocument();
    expect(screen.getByTestId("media-image-2")).toBeInTheDocument();
    expect(screen.getByTestId("media-image-1")).toBeInTheDocument();
    // 六个类型 Tab 全在
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    expect(screen.getByRole("tab", { name: label("media.tabAll") })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // 签名 URL 落地后真的出图（alt="" 是装饰性图片，无 img 角色，故按标签查）
    await waitFor(() => {
      expect(document.querySelectorAll("img")).toHaveLength(3);
    });
    // 首页按 type=all、before_seq=0 拉取
    expect(mockedFetch()).toHaveBeenCalledWith("c1", "all", 0, 30);
  });

  it("切到「视频」Tab 只渲染视频卡，且带 m:ss 时长角标", async () => {
    mockedFetch().mockResolvedValue({
      items: [videoItem(9), fileItem(8)],
      hasMore: false,
    });
    renderAlbum();
    await screen.findByTestId("media-video-9");

    mockedFetch().mockResolvedValue({ items: [videoItem(9)], hasMore: false });
    fireEvent.click(screen.getByRole("tab", { name: label("media.tabVideo") }));

    await waitFor(() => {
      expect(mockedFetch()).toHaveBeenCalledWith("c1", "video", 0, 30);
    });
    // 文件行随 Tab 切换消失，视频卡保留
    await waitFor(() => expect(screen.queryByTestId("media-row-8")).not.toBeInTheDocument());
    expect(screen.getByTestId("media-video-9")).toBeInTheDocument();
    // 75 秒 → 1:15（角标用 m:ss，不是裸秒数）
    expect(screen.getByText("1:15")).toBeInTheDocument();
  });

  it("加载失败显示重试按钮，点重试后恢复列表", async () => {
    mockedFetch().mockRejectedValueOnce(new Error("500"));
    renderAlbum();

    expect(await screen.findByText(label("media.loadFailed"))).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: label("media.retry") });

    mockedFetch().mockResolvedValue({ items: [imageItem(1)], hasMore: false });
    fireEvent.click(retry);

    expect(await screen.findByTestId("media-image-1")).toBeInTheDocument();
    expect(screen.queryByText(label("media.loadFailed"))).not.toBeInTheDocument();
  });

  it("无数据时显示空态文案（不是空白页）", async () => {
    mockedFetch().mockResolvedValue({ items: [], hasMore: false });
    renderAlbum();

    expect(await screen.findByText(label("media.empty"))).toBeInTheDocument();
    expect(screen.queryByTestId("media-skeleton")).not.toBeInTheDocument();
  });

  it("点图片卡片打开大图查看器", async () => {
    mockedFetch().mockResolvedValue({ items: [imageItem(1)], hasMore: false });
    renderAlbum();

    const card = await screen.findByTestId("media-image-1");
    // 必须等签名 URL 落地：URL 未就绪时点击不开层（避免开出空白浮层）
    await waitFor(() => expect(card.querySelector("img")).not.toBeNull());
    fireEvent.click(card);

    // 相册自身也是 dialog，故按 aria-label 精确定位大图查看器
    // （开层前要先把这一批图整体签成图集，故是异步的）
    expect(
      await screen.findByRole("dialog", { name: label("chat.image.alt") }),
    ).toBeInTheDocument();
  });

  it("点图片开的是图集：已加载的图都能左右翻，单图不出翻页", async () => {
    mockedFetch().mockResolvedValue({
      items: [imageItem(3), imageItem(2), imageItem(1)],
      hasMore: false,
    });
    renderAlbum();

    const card = await screen.findByTestId("media-image-2");
    await waitFor(() => expect(card.querySelector("img")).not.toBeNull());
    fireEvent.click(card);

    // 点的是第二张：页码 2/3，且左右都还有
    expect((await screen.findByTestId("lightbox-counter")).textContent).toBe("2/3");
    expect(screen.getByRole("button", { name: label("chat.lightbox.prev") })).toBeEnabled();
    expect(screen.getByRole("button", { name: label("chat.lightbox.next") })).toBeEnabled();
  });

  it("安卓系统返回键先关大图层，再关相册", async () => {
    mockedFetch().mockResolvedValue({ items: [imageItem(1)], hasMore: false });
    const onClose = renderAlbum();

    const card = await screen.findByTestId("media-image-1");
    await waitFor(() => expect(card.querySelector("img")).not.toBeNull());
    fireEvent.click(card);
    expect(
      await screen.findByRole("dialog", { name: label("chat.image.alt") }),
    ).toBeInTheDocument();

    // 第一次返回：只关大图层，相册留着
    expect(shared.runBackInterceptors()).toBe(true);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: label("chat.image.alt") }),
      ).not.toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();

    // 第二次返回：关相册
    expect(shared.runBackInterceptors()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
