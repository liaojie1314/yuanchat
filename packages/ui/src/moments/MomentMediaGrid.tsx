/**
 * MomentMediaGrid 组件 — 朋友圈帖子的媒体区
 *
 * @description
 * 按媒体种类与张数分派三种形态：
 * - 单图：按 `w/h` 等比缩进 {@link SINGLE_MAX_EDGE} 盒内，显式内联宽高占位
 * - 多图：1 行等分（2-3 张）/ 2×2（4 张）/ 三列（5-9 张），方格裁切
 * - 视频：单卡 + 中心播放角标 + 时长，封面取 `thumbKey`
 *
 * 帖子里存了像素宽高，无需等图加载即可定尺寸，故加载骨架与真实图同尺寸（CLS = 0）。
 *
 * 兼容性：单图与视频不用 CSS `aspect-ratio`（Chrome 88+），改用内联 width/height；
 * 方格用 `aspect-square`（global.css 已备旧 WebView 的百分比 padding 兜底）。
 *
 * @param media - 媒体项列表（图片 0-9 张，视频恒 1 个）
 * @param mediaKind - 0 无媒体 / 1 图片 / 2 视频
 */
import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatMediaDuration, getDownloadUrl } from "@yuanchat/shared";
import type { MomentMediaItem, MomentMediaKind } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { ImageLightbox } from "../chat/ImageLightbox";
import { VideoPlaybackOverlay } from "../chat/VideoPlaybackOverlay";

/** 单图/视频封面盒的最长边；与多图网格同宽，让卡片左缘对齐 */
const SINGLE_MAX_EDGE = 240;
/** 多图网格的总宽上限（列数变化时格子大小随之变，网格外缘不动） */
const GRID_MAX_WIDTH = 240;
/** 尺寸缺失时的占位框（正常帖子都带宽高，仅极端兜底） */
const FALLBACK_BOX = { width: 180, height: 135 };

/** 图数 → 列数：1 张独占，2-3 张单行等分，4 张 2×2，5-9 张三列 */
function columnsOf(count: number): number {
  if (count <= 1) return 1;
  if (count <= 3) return count;
  if (count === 4) return 2;
  return 3;
}

/** 原始像素尺寸 → 展示盒尺寸：等比缩进方框内，小图保持原尺寸 */
function displayBox(w: number, h: number): { width: number; height: number } {
  if (!w || !h) return FALLBACK_BOX;
  const scale = Math.min(1, SINGLE_MAX_EDGE / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** 换取对象 key 的预签名 URL；失败保持 null 由调用方显示占位 */
function useObjectUrl(key: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    getDownloadUrl(key)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        // 签名失败不阻断卡片渲染：骨架底色留在原位，尺寸不变
      });
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}

export function MomentMediaGrid({
  media,
  mediaKind,
}: {
  media: MomentMediaItem[];
  mediaKind: MomentMediaKind;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  if (mediaKind === 0 || media.length === 0) return null;

  if (mediaKind === 2) return <MomentVideoCard item={media[0]} />;

  const cols = columnsOf(media.length);
  const single = cols === 1;
  const box = single ? displayBox(media[0].w, media[0].h) : null;

  return (
    <>
      <div
        data-grid-cols={cols}
        className={single ? "" : "grid gap-1"}
        style={
          single
            ? { width: box!.width }
            : { maxWidth: GRID_MAX_WIDTH, gridTemplateColumns: "repeat(" + cols + ", 1fr)" }
        }
      >
        {media.map((item, idx) => (
          <MomentImageCell
            key={item.key + idx}
            item={item}
            square={!single}
            box={single ? box! : null}
            onOpen={setLightboxUrl}
          />
        ))}
      </div>
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>
  );
}

/** 网格里的一格图片：签名前后同尺寸，点击开大图 */
function MomentImageCell({
  item,
  square,
  box,
  onOpen,
}: {
  item: MomentMediaItem;
  square: boolean;
  box: { width: number; height: number } | null;
  onOpen: (url: string) => void;
}) {
  const { t } = useTranslation();
  const url = useObjectUrl(item.key);

  return (
    <button
      type="button"
      data-media-cell
      disabled={!url}
      onClick={() => url && onOpen(url)}
      style={box ? { width: box.width, height: box.height } : undefined}
      className={cn(
        "bg-surface-container-high block overflow-hidden rounded-lg",
        square && "aspect-square w-full",
      )}
    >
      {url && (
        <img
          src={url}
          alt={t("chat.image.alt")}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      )}
    </button>
  );
}

/** 视频单卡：封面 + 中心播放角标 + 右下角时长，点击全屏播放 */
function MomentVideoCard({ item }: { item: MomentMediaItem }) {
  const { t } = useTranslation();
  const box = displayBox(item.w, item.h);
  const thumbUrl = useObjectUrl(item.thumbKey);
  const [playUrl, setPlayUrl] = useState<string | null>(null);

  const play = () => {
    getDownloadUrl(item.key)
      .then(setPlayUrl)
      .catch(() => {
        // 签不出播放地址就什么都不做：用户可再点一次重试
      });
  };

  return (
    <>
      <button
        type="button"
        data-testid="moment-video-card"
        data-media-cell
        aria-label={t("media.videoPlay")}
        onClick={play}
        style={{ width: box.width, height: box.height }}
        className="bg-surface-container-high relative block overflow-hidden rounded-lg"
      >
        {thumbUrl && (
          <img src={thumbUrl} alt={t("chat.image.alt")} className="h-full w-full object-cover" />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white">
            <Play size={18} fill="currentColor" />
          </span>
        </span>
        {item.duration ? (
          <span className="text-label-sm absolute right-1.5 bottom-1.5 rounded-lg bg-black/55 px-1.5 py-0.5 text-white">
            {formatMediaDuration(item.duration)}
          </span>
        ) : null}
      </button>
      {playUrl && <VideoPlaybackOverlay url={playUrl} onClose={() => setPlayUrl(null)} />}
    </>
  );
}
