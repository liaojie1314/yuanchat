/**
 * 会话列表预览文案 — WS 实时路径与 REST 列表路径的唯一来源
 *
 * @description
 * 同一条消息有两条到达前端的路径：`message.receive` 帧（实时）与
 * `GET /conversations` 的 `last_message`（刷新后）。两条路径此前各自造预览文案——
 * 服务端硬编码中文 `"[表情]"`，前端 WS 路径走 `i18n.t()` ——于是英/日/韩界面下
 * 实时收到显示 "Sticker"、刷新后变 "[表情]"。
 *
 * 现在服务端只给类型标记（`last_message.preview_kind`），文案一律由本模块产出。
 */
import i18n from "@yuanchat/design-system/i18n";

/**
 * 服务端 `preview_kind` 的取值（与 `server/internal/service/conversation_service.go`
 * 的 `previewKind*` 常量一一对应）。
 */
export type MessagePreviewKind =
  | "text"
  | "system"
  | "image"
  | "file"
  | "voice"
  | "video"
  | "sticker"
  | "encrypted"
  | "unknown";

/** 非文本类消息的类型标记 → i18n key。文本/系统消息用正文，不在此表内。 */
const PREVIEW_KEYS: Record<string, string> = {
  image: "chat.message.image",
  file: "chat.message.file",
  voice: "chat.message.voice",
  video: "chat.message.video",
  sticker: "chat.message.sticker",
  encrypted: "chat.message.encrypted",
};

/**
 * 产出一条消息的列表预览正文（不含群聊的 "昵称: " 前缀）。
 *
 * @param kind - 消息类型标记：服务端 `preview_kind`，或前端 `ChatMessage["kind"]`
 *   （两者取值刻意同名，故 WS 与 REST 两条路径可共用本函数）
 * @param text - 文本/系统消息的正文；其他类型忽略
 * @returns 当前语言下的预览文案；未知类型回退到 `text`（宁可显示正文也不显示空白）
 */
export function previewBodyOf(kind: string | undefined, text?: string | null): string {
  const key = kind ? PREVIEW_KEYS[kind] : undefined;
  if (key) return i18n.t(key);
  return text ?? "";
}

/** 引用摘要的最大长度（超出截断，气泡内的 quote 块只占一行） */
const QUOTE_EXCERPT_MAX = 40;

/**
 * 产出引用回复的摘要文案（气泡内 quote 块与输入框上方的引用条共用）。
 *
 * @remarks 原实现只取 `text ?? file?.name`，对图片/语音/贴纸恒为空串 ——
 *   引用条只剩昵称加一行空白。文件优先显示文件名（比 "[文件]" 信息量大），
 *   其余非文本类型退到本地化占位。
 */
export function quoteExcerptOf(msg: {
  kind?: string;
  text?: string | null;
  file?: { name?: string } | null;
}): string {
  const raw =
    msg.kind === "file"
      ? msg.file?.name || previewBodyOf("file")
      : previewBodyOf(msg.kind, msg.text);
  return raw.slice(0, QUOTE_EXCERPT_MAX);
}
