/**
 * MessageVideo 组件 — 视频气泡内的封面与播放入口
 *
 * @description
 * 与 {@link MessageImage} 同构，承载乐观发送与历史/接收两条路径：
 * - 封面用 `thumbKey` 签下载 URL 渲染（服务端不生成缩略图，该对象由发送端 canvas 抽帧上传）
 * - 乐观发送阶段还没有 thumbKey，显示灰底占位 + 播放钮，点开即可播本地 blob
 * - 点击播放：优先本地 blob（未 ack 时），否则按 `key` 签下载 URL，交
 *   {@link VideoPlaybackOverlay} 全屏播放
 *
 * 尺寸：按元数据 width/height 等比缩进 {@link MAX_DISPLAY_EDGE} 盒内，元数据缺失
 * （乐观阶段）回退 16:9 占位框。显式内联 width/height 而不用 `aspect-video`：
 * 后者依赖 aspect-ratio（Chrome 88+），旧 WebView 上会塌成 0 高，且 global.css
 * 只给 `aspect-square` 备了兜底。
 *
 * @param video - 视频载荷（时长/尺寸/对象 key/缩略图 key/本地 blob URL）
 */
import { useEffect, useState } from "react";
import { Play, Video as VideoIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatMediaDuration, getDownloadUrl, showToast } from "@yuanchat/shared";
import type { VideoPayload } from "@yuanchat/shared";
import { VideoPlaybackOverlay } from "./VideoPlaybackOverlay";

/** 气泡内视频封面盒的最长边（比图片的 280 小一档，视频信息量在播放而非静帧） */
const MAX_DISPLAY_EDGE = 240;

/** 元数据未知时的占位框（16:9，乐观发送阶段尚未读出宽高） */
const FALLBACK_BOX = { width: 224, height: 126 };

/** 原始像素尺寸 → 展示盒尺寸：等比缩进 MAX_DISPLAY_EDGE 方框内，小图保持原尺寸 */
function displayBox(w: number, h: number): { width: number; height: number } {
  if (!w || !h) return FALLBACK_BOX;
  const scale = Math.min(1, MAX_DISPLAY_EDGE / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function MessageVideo({ video }: { video: VideoPayload }) {
  const { t } = useTranslation();
  const box = displayBox(video.width, video.height);
  const thumbKey = video.thumbKey;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);

  // 封面：签一次下载 URL（getDownloadUrl 自带进程内缓存）；失败保持灰底占位
  useEffect(() => {
    if (!thumbKey) return;
    let alive = true;
    getDownloadUrl(thumbKey)
      .then((u) => {
        if (alive) setThumbUrl(u);
      })
      .catch(() => {
        // 封面签不出来不影响播放：占位 + 播放钮照旧可点
      });
    return () => {
      alive = false;
    };
  }, [thumbKey]);

  /** 播放：未 ack 时用本地 blob，其余按对象 key 现签（不预签，省一次请求） */
  const handlePlay = () => {
    const local = video.localUrl;
    if (local) {
      setPlayUrl(local);
      return;
    }
    const key = video.key;
    if (!key) {
      showToast("error", t("chat.video.playFailed"));
      return;
    }
    void getDownloadUrl(key)
      .then(setPlayUrl)
      .catch(() => showToast("error", t("chat.video.playFailed")));
  };

  return (
    <div className="overflow-hidden rounded-lg" style={box}>
      <div className="bg-surface-container-high relative h-full w-full">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-on-surface-variant grid h-full w-full place-items-center">
            <VideoIcon size={28} strokeWidth={1.25} />
          </span>
        )}
        <button
          type="button"
          onClick={handlePlay}
          aria-label={t("media.videoPlay")}
          data-testid="video-play"
          className="absolute inset-0 grid place-items-center"
        >
          <span className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white">
            {/* lucide 的 Play 只有描边，小尺寸下细到看不见，必须填充 */}
            <Play size={20} fill="currentColor" />
          </span>
        </button>
        {video.duration > 0 && (
          <span className="text-label-sm absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 text-white tabular-nums">
            {formatMediaDuration(video.duration)}
          </span>
        )}
      </div>
      {playUrl && <VideoPlaybackOverlay url={playUrl} onClose={() => setPlayUrl(null)} />}
    </div>
  );
}
