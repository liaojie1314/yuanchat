/**
 * MessageBubble 组件 — 单条聊天消息
 *
 * @description
 * 渲染消息流中的一条消息，覆盖 IM 的全部气泡形态：
 * - 文本（含 @提及 高亮 token、引用块）
 * - 图片（占位灰块，接入后端后换真实 URL）
 * - 文件卡片（扩展名徽标 + 名称 + 大小 + 下载按钮）
 * - 语音（播放按钮 + 波形 + 时长 + "查看文字" AI 转写入口）
 * - 系统消息（居中胶囊，如 "会话加密已开启"）
 *
 * 状态与元信息：
 * - 自己的消息右对齐、品牌渐变底；对方消息左对齐、表面色底
 * - meta 行：时间（tabular-nums）+ 发送状态（旋转/单勾/蓝双勾/失败重试）
 * - 表情回应（reactions）胶囊，含我参与的高亮态
 * - 已编辑标记
 *
 * @param msg - 消息数据
 * @param compact - 与上一条同一发送者且 1 分钟内：省略头像与群聊昵称行，缩小行距
 * @param onRetry - 发送失败点击重试回调
 * @param onReply - 引用回复回调（悬浮操作，暂通过双击触发）
 * @param onRecall - 撤回回调（右键 / 长按菜单触发，仅自己 2 分钟内的消息可用）
 */
import {
  AlertCircle,
  Check,
  CheckCheck,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Play,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";
import { copyText } from "./copyText";

/** 把文本中的 @xxx 提及切分为高亮 token（简单前缀匹配，接入真实数据后按实体渲染） */
function renderTextWithMentions(text: string, mentions?: string[]) {
  if (!mentions?.length) return text;
  // 按提及词切分，保留分隔符
  const pattern = mentions.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "g"));
  return parts.map((part, i) =>
    mentions.includes(part) ? (
      <span
        key={i}
        className="bg-primary-container text-primary-on-container rounded px-1 font-medium"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function MessageBubble({
  msg,
  compact = false,
  onRetry,
  onReply,
  onRecall,
}: {
  msg: ChatMessage;
  compact?: boolean;
  onRetry?: () => void;
  onReply?: () => void;
  onRecall?: () => void;
}) {
  const { t } = useTranslation();
  // 气泡内联操作菜单（右键 / 长按弹出，点外部关闭）
  const [menuOpen, setMenuOpen] = useState(false);
  // 撤回项是否在 2 分钟窗口内——在打开菜单的事件里用 Date.now() 求值并存下，
  // 避免在 render 里调用 Date.now()（不纯，react-hooks/purity 禁止）
  const [recallInWindow, setRecallInWindow] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    // 捕获阶段监听，任何 document 点击都关闭（菜单根 onMouseDown 阻止冒泡自保）
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  // 系统消息：居中胶囊，无头像无气泡
  if (msg.kind === "system") {
    return (
      <div className="bg-surface-container text-label-md text-on-surface-variant mx-auto my-2.5 w-fit rounded-full px-3 py-1">
        {msg.text}
      </div>
    );
  }

  // 已撤回：整条走系统消息样式，忽略原 kind/text
  if (msg.recalled) {
    return (
      <div className="bg-surface-container text-label-md text-on-surface-variant mx-auto my-2.5 w-fit rounded-full px-3 py-1">
        {msg.isSelf
          ? t("chat.message.revokedBySelf")
          : t("chat.message.revokedBy", { name: msg.senderName ?? "" })}
      </div>
    );
  }

  const isSelf = msg.isSelf;
  // 撤回资格（render 纯判定）：仅自己且父层给了回调；实际的 2 分钟窗口在开菜单时判
  const recallEligible = !!onRecall && isSelf && !!msg.createdAtMs;
  // 文本消息才提供复制项
  const canCopy = msg.kind === "text" && !!msg.text;
  // 菜单当前展示的撤回项（资格 + 窗口内）
  const showRecall = recallEligible && recallInWindow;

  const openMenu = (e: { preventDefault: () => void }) => {
    // 窗口判定放事件里（Date.now 不纯，不能在 render 调用）
    const withinWindow = recallEligible && Date.now() - (msg.createdAtMs ?? 0) < 120_000;
    if (!withinWindow && !canCopy) return;
    e.preventDefault();
    setRecallInWindow(withinWindow);
    setMenuOpen(true);
  };

  const startLongPress = (e: { preventDefault: () => void }) => {
    if (!recallEligible && !canCopy) return;
    longPressTimer.current = setTimeout(() => openMenu(e), 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleCopy = () => {
    void copyText(msg.text ?? "");
    setMenuOpen(false);
  };

  const handleRecall = () => {
    setMenuOpen(false);
    onRecall?.();
  };

  return (
    <div
      className={cn(
        "flex items-end gap-2",
        compact ? "mt-0.5" : "mt-2",
        isSelf && "flex-row-reverse",
      )}
      onDoubleClick={onReply}
    >
      {compact ? (
        <div className="w-10 shrink-0" aria-hidden />
      ) : (
        <Avatar name={isSelf ? "我" : (msg.senderName ?? "?")} size="md" />
      )}

      <div className={cn("flex max-w-[70%] flex-col", isSelf && "items-end")}>
        {/* 群聊接收方显示发送者昵称（合并态省略） */}
        {!compact && !isSelf && msg.senderName && (
          <span className="text-label-sm text-primary mx-1 mb-1 font-medium">{msg.senderName}</span>
        )}

        <div className={cn("flex items-center gap-1.5", isSelf && "flex-row-reverse")}>
          {/* 失败重试按钮：贴在气泡外侧 */}
          {isSelf && msg.status === "failed" && (
            <button
              onClick={onRetry}
              aria-label={t("chat.status.failed")}
              className="text-error hover:bg-error/10 rounded-full p-1.5 transition-colors"
            >
              <AlertCircle size={16} />
            </button>
          )}

          <div
            className={cn(
              "relative w-fit max-w-full rounded-2xl break-words select-text",
              msg.kind === "image" ? "p-1.5" : "px-3.5 py-2.5",
              isSelf ? "msg-bubble-self rounded-br-md" : "msg-bubble-peer rounded-bl-md",
            )}
            onContextMenu={openMenu}
            onTouchStart={startLongPress}
            onTouchEnd={cancelLongPress}
            onTouchMove={cancelLongPress}
          >
            {/* 引用块 */}
            {msg.quote && (
              <div
                className={cn(
                  "mb-1.5 cursor-pointer rounded-md border-l-[3px] px-2 py-1",
                  isSelf
                    ? "border-white/80 bg-white/15"
                    : "border-primary bg-on-surface/5 dark:bg-white/5",
                )}
              >
                <div
                  className={cn(
                    "text-label-sm font-medium",
                    isSelf ? "text-white/95" : "text-primary",
                  )}
                >
                  {msg.quote.senderName}
                </div>
                <div className="text-body-sm truncate opacity-85">{msg.quote.excerpt}</div>
              </div>
            )}

            {msg.kind === "text" && (
              <span className="text-body-lg leading-relaxed whitespace-pre-wrap">
                {renderTextWithMentions(msg.text ?? "", msg.mentions)}
              </span>
            )}

            {msg.kind === "image" && msg.image && (
              <div
                className="bg-surface-container-high text-on-surface-variant flex items-center justify-center rounded-xl"
                style={{ width: msg.image.width, height: msg.image.height }}
                aria-label={t("chat.message.image")}
              >
                <ImageIcon size={36} strokeWidth={1.25} />
              </div>
            )}

            {msg.kind === "file" && msg.file && (
              <div className="flex min-w-[220px] items-center gap-2.5">
                <span className="text-label-sm flex h-11 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 font-bold text-white">
                  {msg.file.ext}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-body-md truncate font-semibold">{msg.file.name}</div>
                  <div className="text-label-sm mt-0.5 opacity-80">
                    {msg.file.size} · {msg.file.ext}
                  </div>
                </div>
                <button
                  aria-label={t("file.download")}
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                    isSelf
                      ? "bg-white/15 text-white hover:bg-white/25"
                      : "bg-primary-container text-primary-on-container hover:opacity-85",
                  )}
                >
                  <Download size={15} />
                </button>
              </div>
            )}

            {msg.kind === "voice" && msg.voice && (
              <div>
                <div className="flex min-w-[140px] items-center gap-2.5">
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                      isSelf
                        ? "bg-white/25 text-white"
                        : "bg-primary-container text-primary-on-container",
                    )}
                  >
                    <Play size={14} />
                  </span>
                  <span className="flex h-5 items-center gap-0.5" aria-hidden>
                    {msg.voice.wave.map((h, i) => (
                      <i
                        key={i}
                        className="w-0.5 rounded-sm bg-current opacity-50"
                        style={{ height: h }}
                      />
                    ))}
                  </span>
                  <span className="text-label-md tabular-nums">{msg.voice.seconds}&quot;</span>
                </div>
                <button
                  className={cn(
                    "text-label-sm mt-1 inline-flex items-center gap-1",
                    isSelf ? "text-white/90" : "text-primary",
                  )}
                >
                  <Sparkles size={12} /> {t("chat.voice.toText")}
                </button>
              </div>
            )}

            {/* 内联操作菜单：右键 / 长按弹出，复制 + 撤回（撤回仅自己 2 分钟内） */}
            {menuOpen && (
              <div
                role="menu"
                onMouseDown={(e) => e.stopPropagation()}
                className={cn(
                  "bg-surface-container-high border-outline-variant absolute bottom-full z-10 mb-1 min-w-[7rem] overflow-hidden rounded-xl border py-1 shadow-lg",
                  isSelf ? "right-0" : "left-0",
                )}
              >
                {canCopy && (
                  <button
                    role="menuitem"
                    onClick={handleCopy}
                    className="text-body-md text-on-surface hover:bg-surface-container-highest flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <Copy size={15} /> {t("chat.message.copy")}
                  </button>
                )}
                {showRecall && (
                  <button
                    role="menuitem"
                    onClick={handleRecall}
                    className="text-body-md text-error hover:bg-surface-container-highest flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <Undo2 size={15} /> {t("chat.message.revoke")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 表情回应 */}
        {msg.reactions && msg.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {msg.reactions.map((r) => (
              <button
                key={r.emoji}
                className={cn(
                  "text-label-md inline-flex h-6 items-center gap-1 rounded-full border px-2 transition-colors",
                  r.mine
                    ? "bg-primary-container text-primary-on-container border-transparent"
                    : "border-outline-variant bg-surface-container-high text-on-surface",
                )}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        )}

        {/* meta 行：时间 + 状态 */}
        <div
          className={cn(
            "text-label-sm text-on-surface-variant mt-1 flex items-center gap-1",
            isSelf && "justify-end",
          )}
        >
          {isSelf && msg.status === "failed" ? (
            <span className="text-error">{t("chat.status.failed")}</span>
          ) : (
            <>
              <span className="tabular-nums">{msg.time}</span>
              {msg.edited && <span className="opacity-65">· {t("chat.message.edited")}</span>}
              {isSelf && msg.status === "sending" && (
                <Loader2 size={12} className="animate-spin" aria-label={t("chat.status.sending")} />
              )}
              {isSelf && msg.status === "sent" && (
                <Check size={13} aria-label={t("chat.status.sent")} />
              )}
              {isSelf && msg.status === "read" && (
                <CheckCheck size={13} className="text-primary" aria-label={t("chat.status.read")} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * TypingIndicator — 正在输入指示气泡
 *
 * @description 三个跳动的圆点 + "xx 正在输入…" 提示，
 * 放在消息流末尾，prefers-reduced-motion 下动画自动关闭（全局样式接管）。
 */
export function TypingIndicator({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex items-end gap-2">
      <Avatar name={name} size="md" />
      <div className="flex flex-col">
        <div className="msg-bubble-peer w-fit rounded-2xl rounded-bl-md px-3 py-2">
          <span className="flex items-center gap-1" aria-hidden>
            <i className="typing-dot" />
            <i className="typing-dot [animation-delay:0.2s]" />
            <i className="typing-dot [animation-delay:0.4s]" />
          </span>
        </div>
        <span className="text-label-sm text-on-surface-variant mt-1">
          {t("chat.typing", { name })}
        </span>
      </div>
    </div>
  );
}
