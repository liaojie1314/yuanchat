/**
 * MomentComposeView 组件 — 发布朋友圈动态
 *
 * @description
 * 文本（≤1000 字，实时字数）+ 媒体（图片 ≤9 张 / 视频 1 个，二选一）+ 可见性。
 * 媒体选中即开始直传，逐项独立：某一项失败只在该项上显示重试，不作废整次发布；
 * 全部就绪前发布按钮禁用。提交成功后回信息流（信息流挂载时自行 `loadFeed`）。
 *
 * 上传链路复用既有直传：图片 `compressImage` → `getUploadUrl("images")` →
 * `uploadToTicket`；视频取 `extractVideoMeta` 的时长/宽高/封面，正片不传 category
 * （服务端 `resolveCategory` 把 `video/*` 归 `files/`），封面按 images 传。
 *
 * 兼容性：预览方格用内联 width/height，不用 CSS `aspect-ratio`（Chrome 88+）。
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Image as ImageIcon, Loader2, Lock, Users, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  captureException,
  compressImage,
  createPost,
  extractVideoMeta,
  getUploadUrl,
  showToast,
  uploadToTicket,
} from "@yuanchat/shared";
import type { MomentMediaItem, MomentMediaKind, MomentVisibility } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { useBackTo } from "../util/useBackTo";

/** 正文上限（与服务端 content 校验同口径） */
const MAX_CHARS = 1000;
/** 单帖最多九张图 */
const MAX_IMAGES = 9;
/** 视频上限，与聊天内发视频同口径（服务端仍会再校验一遍） */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_DURATION_SEC = 120;
/** 预览方格边长（像素；旧 WebView 不认 aspect-ratio，故显式给宽高） */
const THUMB_PX = 84;

/** 一项待发布媒体：选中即入列，上传完成后带上可提交的 `item` */
interface PendingMedia {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "done" | "failed";
  item?: MomentMediaItem;
}

/** 压缩并直传一张图片，返回可提交的媒体项 */
async function uploadImage(file: File): Promise<MomentMediaItem> {
  const compressed = await compressImage(file);
  const contentType = compressed.blob.type || "image/jpeg";
  const ticket = await getUploadUrl(
    file.name || "image.jpg",
    contentType,
    compressed.blob.size,
    "images",
  );
  await uploadToTicket(ticket, compressed.blob, contentType);
  return { key: ticket.objectKey, w: compressed.width, h: compressed.height };
}

/** 直传视频正片与封面，返回带 thumbKey/duration 的媒体项 */
async function uploadVideo(file: File): Promise<MomentMediaItem> {
  const meta = await extractVideoMeta(file);
  if (meta.duration > MAX_VIDEO_DURATION_SEC) throw new Error("video too long");
  const contentType = file.type || "video/mp4";
  // 正片不传 category：服务端按 video/* 归到 files/
  const videoTicket = await getUploadUrl(file.name || "video.mp4", contentType, file.size);
  await uploadToTicket(videoTicket, file, contentType);
  const thumbTicket = await getUploadUrl("thumb.jpg", "image/jpeg", meta.thumbnail.size, "images");
  await uploadToTicket(thumbTicket, meta.thumbnail, "image/jpeg");
  return {
    key: videoTicket.objectKey,
    thumbKey: thumbTicket.objectKey,
    duration: meta.duration,
    w: meta.width,
    h: meta.height,
  };
}

export function MomentComposeView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // 子页：系统返回键回信息流，与页内返回箭头同语义
  useBackTo("/moments");

  const [text, setText] = useState("");
  const [kind, setKind] = useState<MomentMediaKind>(0);
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [visibility, setVisibility] = useState<MomentVisibility>(0);
  const [posting, setPosting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  // 离开页面时撤销本地预览地址，避免 blob 泄漏
  useEffect(() => {
    return () => media.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (id: string, next: Partial<PendingMedia>) =>
    setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...next } : m)));

  /** 起一次上传：失败只落该项的 failed 态，由该项自己的重试按钮再来一次 */
  const runUpload = (entry: PendingMedia, mediaKind: MomentMediaKind) => {
    patch(entry.id, { status: "uploading" });
    void (mediaKind === 2 ? uploadVideo(entry.file) : uploadImage(entry.file))
      .then((item) => patch(entry.id, { status: "done", item }))
      .catch((err: unknown) => {
        captureException(err, { context: "MomentComposeView.upload" });
        patch(entry.id, { status: "failed" });
      });
  };

  const addFiles = (files: FileList | null, mediaKind: MomentMediaKind) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, mediaKind === 2 ? 1 : MAX_IMAGES - media.length);
    if (mediaKind === 2 && picked[0].size > MAX_VIDEO_BYTES) {
      showToast("error", t("chat.video.tooLarge"));
      return;
    }
    const entries: PendingMedia[] = picked.map((file) => ({
      id: "m" + ++seqRef.current,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));
    setKind(mediaKind);
    setMedia((prev) => prev.concat(entries));
    entries.forEach((e) => runUpload(e, mediaKind));
  };

  const removeAt = (id: string) => {
    setMedia((prev) => {
      const left = prev.filter((m) => m.id !== id);
      if (left.length === 0) setKind(0);
      return left;
    });
  };

  const uploading = media.some((m) => m.status !== "done");
  const canPublish = (text.trim() !== "" || media.length > 0) && !uploading && !posting;

  const submit = async () => {
    if (!canPublish) return;
    setPosting(true);
    try {
      await createPost({
        content: text.trim(),
        media: media.map((m) => m.item as MomentMediaItem),
        mediaKind: kind,
        visibility,
      });
      navigate("/moments");
    } catch (err) {
      captureException(err, { context: "MomentComposeView.publish" });
      showToast("error", t("moments.publishFailed"));
      setPosting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          onClick={() => navigate("/moments")}
          aria-label={t("chat.back")}
          className="md3-icon-btn text-on-surface"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-title-md text-on-surface min-w-0 flex-1 truncate font-semibold">
          {t("moments.title")}
        </h1>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canPublish}
          className="bg-primary text-on-primary text-label-lg rounded-lg px-4 py-1.5 font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {t("moments.publish")}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <textarea
          value={text}
          maxLength={MAX_CHARS}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("moments.compose.placeholder")}
          className="border-outline-variant bg-surface text-body-md text-on-surface h-[120px] w-full resize-none rounded-lg border p-3"
        />
        <p className="text-label-sm text-on-surface-variant mt-1 text-right tabular-nums">
          {text.length}/{MAX_CHARS}
        </p>

        {media.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {media.map((m) => (
              <div
                key={m.id}
                style={{ width: THUMB_PX, height: THUMB_PX }}
                className="bg-surface-container-high relative overflow-hidden rounded-lg"
              >
                <img src={m.previewUrl} alt="" className="h-full w-full object-cover" />
                {m.status !== "done" && (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-white">
                    {m.status === "uploading" ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => runUpload(m, kind)}
                        className="text-label-sm rounded-lg bg-white/20 px-2 py-0.5"
                      >
                        {t("common.retry")}
                      </button>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeAt(m.id)}
                  aria-label={t("moments.compose.removeMedia")}
                  className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={kind === 2 || media.length >= MAX_IMAGES || posting}
            aria-label={t("moments.compose.addImage")}
            className="border-outline-variant text-on-surface-variant hover:bg-surface-container inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <ImageIcon size={16} />
            <span className="text-label-md">{t("moments.compose.addImage")}</span>
          </button>
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={kind === 1 || posting}
            aria-label={t("moments.compose.addVideo")}
            className="border-outline-variant text-on-surface-variant hover:bg-surface-container inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <Video size={16} />
            <span className="text-label-md">{t("moments.compose.addVideo")}</span>
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {([0, 1] as MomentVisibility[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVisibility(v)}
              className={cn(
                "text-label-md inline-flex items-center gap-1 rounded-lg px-3 py-1.5 transition-colors",
                visibility === v
                  ? "bg-primary-container text-primary-on-container font-medium"
                  : "text-on-surface-variant hover:bg-surface-container",
              )}
            >
              {v === 0 ? <Users size={15} /> : <Lock size={15} />}
              {v === 0 ? t("moments.visibility.friends") : t("moments.visibility.private")}
            </button>
          ))}
        </div>

        {media.some((m) => m.status === "failed") && (
          <p className="text-label-md text-error mt-3">{t("moments.compose.uploadFailed")}</p>
        )}

        {/* 原生选择器藏起来，入口由上面自绘的按钮代理（与聊天输入区同范式） */}
        <input
          ref={imageInputRef}
          data-testid="moment-image-input"
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files, 1);
            e.target.value = "";
          }}
        />
        <input
          ref={videoInputRef}
          data-testid="moment-video-input"
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            addFiles(e.target.files, 2);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
