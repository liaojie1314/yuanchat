/**
 * 消息媒体预览组件 — 管理端专用
 *
 * @description
 * 非文本消息（图片 / 语音 / 文件 / 贴纸）在审核页的预览：
 * - 据消息 content JSONB 提取对象 key，经 /admin/messages/:id/media
 *   换取短期预签名 URL（管理端专用读通道，不依赖举报人上下文）
 * - 图片 / 贴纸渲染 <img>（固定宽高占位防 CLS，加载中显示骨架）
 * - 语音渲染 <audio controls>
 * - 文件显示下载按钮（打开预签名 URL）
 *
 * @param message - 管理端消息条目（content 为 JSONB 原文）
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { getMessageMedia, type AdminMessage } from "../api";

/** 图片缩略固定展示盒（不放大原图，缺尺寸时兜底），宽高写死防 CLS */
const THUMB_BOX = { width: 160, height: 120 };
/** 贴纸固定展示盒 */
const STICKER_BOX = { width: 96, height: 96 };

/** content JSONB 解析出的媒体字段（四类消息共用的子集） */
interface ParsedMedia {
  key: string;
  name: string;
  width: number;
  height: number;
  duration: number;
}

/**
 * 解析消息 content JSONB 为媒体字段；解析失败或无 key 返回 null。
 * 文本 / 系统消息天然无 key，直接归入 null 由调用方回退文本渲染。
 */
function parseMedia(raw: string): ParsedMedia | null {
  try {
    const p = JSON.parse(raw) as Partial<ParsedMedia>;
    if (!p.key) return null;
    return {
      key: p.key,
      name: p.name ?? "",
      width: p.width ?? 0,
      height: p.height ?? 0,
      duration: p.duration ?? 0,
    };
  } catch {
    return null;
  }
}

/** 骨架占位盒（固定宽高，列表滚动时零布局抖动） */
function MediaSkeleton({ w, h }: { w: number; h: number }) {
  return (
    <div
      style={{ width: w, height: h }}
      className="animate-pulse rounded bg-surface-container-high"
    />
  );
}

/** 图片 / 贴纸缩略：换取预签名 URL 后渲染，加载失败可点击重试 */
function ImagePreview({
  messageId,
  box,
}: {
  messageId: string;
  box: { width: number; height: number };
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [url, setUrl] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    getMessageMedia(messageId)
      .then((m) => {
        if (alive) setUrl(m.url);
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [messageId, tick]);

  if (state === "error") {
    return (
      <button
        onClick={() => setTick((n) => n + 1)}
        style={{ width: box.width, height: box.height }}
        className="flex items-center justify-center rounded bg-surface-container-high text-label-md text-on-surface-variant hover:bg-surface-container-highest"
      >
        {t("admin.messages.mediaFailed")}
      </button>
    );
  }

  return (
    <div
      style={{ width: box.width, height: box.height }}
      className="overflow-hidden rounded bg-surface-container-high"
    >
      {state === "loading" || !url ? (
        <MediaSkeleton w={box.width} h={box.height} />
      ) : (
        <img
          src={url}
          alt=""
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}

/** 语音预览：换取预签名 URL 后渲染原生播放控件 */
function VoicePreview({ messageId }: { messageId: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    getMessageMedia(messageId)
      .then((m) => setUrl(m.url))
      .catch(() => setFailed(true));
  }, [messageId]);

  if (failed) {
    return <span className="text-label-md text-error">{t("admin.messages.mediaFailed")}</span>;
  }
  if (!url) {
    return <MediaSkeleton w={200} h={40} />;
  }
  return <audio controls src={url} className="h-10 max-w-[240px]" />;
}

/** 文件预览：显示原始文件名 + 下载按钮（点击时换取新预签名 URL） */
function FilePreview({ messageId, fileName }: { messageId: string; fileName: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const m = await getMessageMedia(messageId);
      window.open(m.url, "_blank", "noopener");
    } catch {
      // 签名失败静默结束：按钮回到可点状态，审核员可重试
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="max-w-[180px] truncate text-label-md text-on-surface-variant">
        {fileName || "—"}
      </span>
      <button
        onClick={() => void download()}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded border border-outline-variant px-2 py-1 text-label-md text-primary hover:bg-surface-container-low disabled:opacity-50"
      >
        <Download size={14} />
        {t("admin.messages.fileDownload")}
      </button>
    </div>
  );
}

/**
 * 消息内容渲染入口：按消息类型分发到媒体预览或文本渲染。
 * 媒体类型（image/file/voice/sticker）走预签名通道，其余回退文本展示。
 */
export function MessageMediaCell({ message }: { message: AdminMessage }) {
  const { t } = useTranslation();
  const media = parseMedia(message.content);

  if (media) {
    switch (message.message_type) {
      case 2: // image
        return <ImagePreview messageId={message.id} box={THUMB_BOX} />;
      case 8: // sticker
        return <ImagePreview messageId={message.id} box={STICKER_BOX} />;
      case 4: // voice
        return <VoicePreview messageId={message.id} />;
      case 3: // file
        return <FilePreview messageId={message.id} fileName={media.name} />;
    }
  }

  // 非媒体类型 / 媒体消息缺 key（坏数据）：回退文本渲染
  const label = TYPE_LABEL[message.message_type];
  return (
    <p className="line-clamp-2">
      {label && <span className="text-on-surface-variant">{t(label)} </span>}
      {contentText(message.content)}
    </p>
  );
}

/** 消息类型 → i18n key（与用户端文案共用） */
const TYPE_LABEL: Record<number, string> = {
  2: "chat.message.image",
  3: "chat.message.file",
  4: "chat.message.voice",
  8: "chat.message.sticker",
};

/** content JSONB 原文 → 展示文本（text 消息取 text 字段，解析失败回退原文） */
function contentText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    return parsed.text ?? "";
  } catch {
    return raw;
  }
}
