/**
 * ConversationMediaView 组件 — 会话媒体相册
 *
 * @description
 * 把一个会话里的图片 / 文件 / 语音 / 视频 / 贴纸按类型聚合成全屏浏览视图：
 * - 顶部类型 Tab（全部 / 图片 / 文件 / 语音 / 视频 / 贴纸），切 Tab 即重新拉第一页
 * - 图片、视频、贴纸走三列方格网格；文件、语音走行列表（信息量在文字上，方格放不下）
 * - seq 降序游标分页，滚动触底自动续页（游标 = 已加载的最小 seq）
 * - 四态齐全：骨架（首屏加载）/ 空态 / 错误态+重试 / 正常
 * - 点图片开 {@link ImageLightbox}，点视频开 {@link VideoPlaybackOverlay}，
 *   点文件下载，点语音就地播放（共用全局单例播放器，播新停旧）
 *
 * 可见性口径由服务端保证（成员校验 + 撤回排除 + 本人清空水位），故相册里出现的对象
 * 一定签得出下载 URL；前端只负责签名与渲染。
 *
 * 布局细节：
 * - 全屏浮层要顶到状态栏之下，故加 `--safe-area-top` 内边距（安卓沉浸式状态栏由原生下发）
 * - 方格用 `aspect-square`（配 `grid`，旧 WebView 有百分比 padding 兜底，见 global.css），
 *   不用 `aspect-video`：那个类没有兜底，Chrome 74 上会塌成 0 高
 *
 * @param conversationId - 会话 ID
 * @param onClose - 关闭回调（返回箭头 / 关闭按钮 / Esc / 安卓返回键触发）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, ImageOff, Pause, Play, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  fetchConversationMedia,
  formatFileMeta,
  formatListTime,
  formatMediaDuration,
  getDownloadUrl,
  registerBackInterceptor,
  showToast,
} from "@yuanchat/shared";
import type { MediaItem } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { ImageLightbox } from "./ImageLightbox";
import { StickerImage } from "../stickers/StickerImage";
import { VideoPlaybackOverlay } from "./VideoPlaybackOverlay";
import { fileIconOf } from "../util/fileIcon";
import { buildGallery } from "../util/imageGallery";
import { currentPlayingId, playVoice, subscribeVoicePlayer } from "./voicePlayer";

/** 每页条数（后端上限 100，30 与消息历史同口径） */
const PAGE_SIZE = 30;

/** 距底多少像素开始拉下一页 */
const LOAD_MORE_PX = 200;

/** 骨架方格数（首屏两行三列，与真实网格同尺寸，CLS 为 0） */
const SKELETON_CELLS = 6;

const TABS = ["all", "image", "file", "voice", "video", "sticker"] as const;

type MediaTab = (typeof TABS)[number];

/** Tab → i18n key（文案禁止硬编码，四语同步） */
const TAB_LABEL_KEYS: Record<MediaTab, string> = {
  all: "media.tabAll",
  image: "media.tabImage",
  file: "media.tabFile",
  voice: "media.tabVoice",
  video: "media.tabVideo",
  sticker: "media.tabSticker",
};

/** 走方格网格的消息类型：2=图片 5=视频 8=贴纸 */
const GRID_TYPES: MediaItem["messageType"][] = [2, 5, 8];

/**
 * 按对象 key 换取预签名下载 URL。
 *
 * @param key - 对象存储 key；缺失即视为失败（相册条目理论上恒有 key）
 * @returns url 就绪前为 null；签名失败置 failed（调用方渲染可点重试的占位）
 * @remarks 切 key / 卸载后忽略迟到的回包（alive 闸门），避免把上一格的图塞进这一格。
 */
function useMediaUrl(key: string | undefined): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!key) {
      setFailed(true);
      return;
    }
    let alive = true;
    setFailed(false);
    setUrl(null);
    getDownloadUrl(key)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return { url, failed };
}

/** 方格占位：加载骨架与破图占位共用同一尺寸，出图时不跳动 */
function CellPlaceholder({ failed }: { failed?: boolean }) {
  if (failed) {
    return (
      <span className="bg-surface-container-high text-on-surface-variant grid h-full w-full place-items-center">
        <ImageOff size={20} strokeWidth={1.25} />
      </span>
    );
  }
  return <span className="bg-surface-container-high h-full w-full animate-pulse" aria-hidden />;
}

/** 图片方格：点开大图查看器（URL 未就绪时不响应点击，避免开出空白层） */
function MediaImageCard({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  const { t } = useTranslation();
  const { url, failed } = useMediaUrl(item.key);
  return (
    <button
      type="button"
      data-testid={"media-image-" + item.seq}
      aria-label={t("chat.image.open")}
      onClick={() => url && onOpen(item)}
      className="bg-surface-container-low grid aspect-square overflow-hidden rounded-lg"
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <CellPlaceholder failed={failed} />
      )}
    </button>
  );
}

/** 视频方格：缩略图 + 时长角标 + 播放钮；正片 URL 点击时才签（30 格不预签正片） */
function MediaVideoCard({ item, onPlay }: { item: MediaItem; onPlay: (url: string) => void }) {
  const { t } = useTranslation();
  const { url: thumbUrl, failed } = useMediaUrl(item.thumbKey);

  const handlePlay = () => {
    void getDownloadUrl(item.key)
      .then(onPlay)
      .catch(() => showToast("error", t("chat.video.playFailed")));
  };

  return (
    <button
      type="button"
      data-testid={"media-video-" + item.seq}
      aria-label={t("media.videoPlay")}
      onClick={handlePlay}
      className="bg-surface-container-low relative grid aspect-square overflow-hidden rounded-lg"
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <CellPlaceholder failed={failed} />
      )}
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white">
          {/* lucide 的 Play 只有描边，小尺寸下细到看不见，必须填充 */}
          <Play size={16} fill="currentColor" />
        </span>
      </span>
      <span className="text-label-sm absolute right-1 bottom-1 rounded bg-black/60 px-1 py-0.5 text-white tabular-nums">
        {formatMediaDuration(item.duration ?? 0)}
      </span>
    </button>
  );
}

/** 贴纸方格：复用消息气泡的贴纸渲染（含骨架与破图重试） */
function MediaStickerCard({ item }: { item: MediaItem }) {
  return (
    <div
      data-testid={"media-sticker-" + item.seq}
      className="bg-surface-container-low grid aspect-square place-items-center overflow-hidden rounded-lg p-1.5"
    >
      <StickerImage sticker={{ key: item.key, width: item.width ?? 0, height: item.height ?? 0 }} />
    </div>
  );
}

/** 文件行：类型徽标 + 文件名 + 大小/发送者/时间 + 下载 */
function MediaFileRow({ item }: { item: MediaItem }) {
  const { t } = useTranslation();
  const name = item.name ?? "";
  const meta = formatFileMeta(name, item.size ?? 0);
  const { Icon, bg } = fileIconOf(meta.ext);

  const handleDownload = () => {
    void getDownloadUrl(item.key)
      .then((url) => window.open(url, "_blank"))
      .catch(() => showToast("error", t("chat.file.downloadFailed")));
  };

  return (
    <div
      data-testid={"media-row-" + item.seq}
      className="border-outline-variant flex items-center gap-3 border-b py-2.5 last:border-b-0"
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white",
          bg,
        )}
      >
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-body-md text-on-surface truncate font-medium">{name}</div>
        <div className="text-label-sm text-on-surface-variant mt-0.5 truncate">
          {meta.size} · {item.senderNickname} · {formatListTime(item.createdAt)}
        </div>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        aria-label={t("media.fileDownload")}
        className="md3-icon-btn text-on-surface-variant shrink-0"
      >
        <Download size={17} />
      </button>
    </div>
  );
}

/** 语音行：播放钮（全局单例播放器，播新停旧）+ 时长 + 发送者/时间 */
function MediaVoiceRow({ item, playingId }: { item: MediaItem; playingId: string | null }) {
  const { t } = useTranslation();
  const playing = playingId === item.messageId;

  const handlePlay = () => {
    void getDownloadUrl(item.key)
      .then((url) => playVoice(item.messageId, url))
      .catch(() => showToast("error", t("chat.voice.playFailed")));
  };

  return (
    <div
      data-testid={"media-row-" + item.seq}
      className="border-outline-variant flex items-center gap-3 border-b py-2.5 last:border-b-0"
    >
      <button
        type="button"
        onClick={handlePlay}
        aria-label={t("chat.input.voice")}
        className="bg-primary-container text-primary-on-container flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90"
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-body-md text-on-surface tabular-nums">
          {formatMediaDuration(item.duration ?? 0)}
        </div>
        <div className="text-label-sm text-on-surface-variant mt-0.5 truncate">
          {item.senderNickname} · {formatListTime(item.createdAt)}
        </div>
      </div>
    </div>
  );
}

/** 首屏骨架：与真实方格同尺寸的六宫格，防出图时布局跳动 */
function MediaGridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2" aria-hidden data-testid="media-skeleton">
      {Array.from({ length: SKELETON_CELLS }, (_, i) => (
        <div
          key={i}
          className="bg-surface-container-high grid aspect-square animate-pulse rounded-lg"
        />
      ))}
    </div>
  );
}

export function ConversationMediaView({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MediaTab>("all");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // 语音播放态：模块级单例播放器广播当前播放的消息 ID
  const [playingId, setPlayingId] = useState<string | null>(() => currentPlayingId());
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 已加载的最小 seq（下一页游标）；未加载过时为 Infinity */
  const minSeqRef = useRef(Infinity);
  /** 请求序号：切 Tab / 重试后旧请求的回包一律丢弃，防串页 */
  const reqRef = useRef(0);

  // 订阅载荷含倍速，但相册行只用 playingId 高亮（倍速按钮在消息气泡上）
  useEffect(() => subscribeVoicePlayer((st) => setPlayingId(st.playingId)), []);

  const load = useCallback(
    (type: MediaTab, beforeSeq: number, append: boolean) => {
      const token = reqRef.current + 1;
      reqRef.current = token;
      setLoading(true);
      setFailed(false);
      fetchConversationMedia(conversationId, type, beforeSeq, PAGE_SIZE)
        .then((res) => {
          if (token !== reqRef.current) return;
          if (res.items.length > 0) {
            minSeqRef.current = Math.min(minSeqRef.current, res.items[res.items.length - 1].seq);
          }
          setItems((prev) => (append ? [...prev, ...res.items] : res.items));
          setHasMore(res.hasMore);
          setLoading(false);
        })
        .catch(() => {
          if (token !== reqRef.current) return;
          setFailed(true);
          setLoading(false);
        });
    },
    [conversationId],
  );

  // 首次进入与切 Tab：游标复位后拉第一页
  useEffect(() => {
    minSeqRef.current = Infinity;
    load(tab, 0, false);
  }, [tab, load]);

  /**
   * 点开大图：把**已加载的这一批**图片整体交给查看器，可左右翻。
   *
   * @remarks 相册是 seq 降序游标分页的，翻到最后一张不会去触发「加载更多」——
   *   超出已加载范围即视为到头（查看器的按钮到头即禁用）。各方格已各自签过名，
   *   `getDownloadUrl` 的进程内缓存让这里基本是命中缓存。
   */
  const openLightbox = (item: MediaItem) => {
    const imgs = items.filter((i) => i.messageType === 2);
    void buildGallery(
      imgs.map((i) => i.key),
      imgs.findIndex((i) => i.messageId === item.messageId),
    ).then(setLightbox);
  };

  // Esc 关闭相册（键盘用户无需先 Tab 到关闭按钮）。
  // 大图层/播放层各自也监听 Esc，而 keydown 会同时命中所有监听器——不加这道闸门，
  // 一次 Esc 会把浮层和相册一起关掉（E2E 实测：关播放层后相册也没了）。
  useEffect(() => {
    if (lightbox !== null || videoUrl !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, videoUrl, onClose]);

  // 安卓系统返回键：本层盖在会话之上，须先关自己再轮到会话
  // （视频播放层自带更上层的拦截器，故此处只需处理大图层与本层）
  useEffect(() => {
    return registerBackInterceptor(() => {
      if (lightbox !== null) {
        setLightbox(null);
        return true;
      }
      onClose();
      return true;
    });
  }, [lightbox, onClose]);

  /** 滚动触底续页：游标为已加载最小 seq；加载中/错误态/无更多时不触发 */
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || loading || failed || !hasMore) return;
    if (!isFinite(minSeqRef.current)) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_PX) {
      load(tab, minSeqRef.current, true);
    }
  };

  const gridItems = items.filter((i) => GRID_TYPES.indexOf(i.messageType) >= 0);
  const rowItems = items.filter((i) => GRID_TYPES.indexOf(i.messageType) < 0);
  const firstLoad = loading && items.length === 0;

  return (
    <div
      className="bg-surface fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={t("media.title")}
      // 安卓沉浸式状态栏：原生下发 --safe-area-top，Web/桌面回退 0
      style={{ paddingTop: "var(--safe-area-top, 0px)" }}
    >
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-2 border-b px-2">
        <button
          onClick={onClose}
          aria-label={t("chat.back")}
          className="md3-icon-btn text-on-surface"
        >
          <ArrowLeft size={22} />
        </button>
        <h2 className="text-title-md text-on-surface min-w-0 flex-1 truncate font-semibold">
          {t("media.title")}
        </h2>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="md3-icon-btn text-on-surface-variant"
        >
          <X size={20} />
        </button>
      </header>

      <div
        role="tablist"
        aria-label={t("media.title")}
        className="border-outline-variant scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5"
      >
        {TABS.map((tb) => (
          <button
            key={tb}
            role="tab"
            aria-selected={tab === tb}
            onClick={() => setTab(tb)}
            className={cn(
              "text-label-md shrink-0 rounded-lg px-3 py-1.5 transition-colors",
              tab === tb
                ? "bg-primary-container text-primary-on-container font-medium"
                : "text-on-surface-variant hover:bg-surface-container",
            )}
          >
            {t(TAB_LABEL_KEYS[tb])}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="tabpanel"
        className="min-h-0 flex-1 overflow-y-auto p-3"
      >
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-body-md text-on-surface-variant">{t("media.loadFailed")}</p>
            <button
              type="button"
              onClick={() => load(tab, 0, false)}
              className="text-label-lg bg-primary-container text-primary-on-container rounded-lg px-4 py-2 font-medium"
            >
              {t("media.retry")}
            </button>
          </div>
        ) : firstLoad ? (
          <MediaGridSkeleton />
        ) : items.length === 0 ? (
          <p className="text-body-md text-on-surface-variant mt-16 text-center">
            {t("media.empty")}
          </p>
        ) : (
          <>
            {gridItems.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {gridItems.map((item) =>
                  item.messageType === 2 ? (
                    <MediaImageCard key={item.messageId} item={item} onOpen={openLightbox} />
                  ) : item.messageType === 5 ? (
                    <MediaVideoCard key={item.messageId} item={item} onPlay={setVideoUrl} />
                  ) : (
                    <MediaStickerCard key={item.messageId} item={item} />
                  ),
                )}
              </div>
            )}
            {rowItems.length > 0 && (
              <div className={cn(gridItems.length > 0 && "mt-3")}>
                {rowItems.map((item) =>
                  item.messageType === 3 ? (
                    <MediaFileRow key={item.messageId} item={item} />
                  ) : (
                    <MediaVoiceRow key={item.messageId} item={item} playingId={playingId} />
                  ),
                )}
              </div>
            )}
            {/* 续页指示：不占固定高度，避免触底判定被自己撑走 */}
            {loading && (
              <p className="text-label-md text-on-surface-variant py-3 text-center">
                {t("common.loading")}
              </p>
            )}
          </>
        )}
      </div>

      {lightbox && (
        <ImageLightbox
          urls={lightbox.urls}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
      {videoUrl && <VideoPlaybackOverlay url={videoUrl} onClose={() => setVideoUrl(null)} />}
    </div>
  );
}
