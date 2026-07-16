/**
 * Composer 组件 — 消息输入区
 *
 * @description
 * 聊天窗口底部的统一输入面板（与原型 composer-box 一致的一体化卡片）：
 * - 引用回复条：显示被回复人与摘要，可取消
 * - 自适应高度 textarea（最高 160px），Enter 发送 / Shift+Enter 换行
 * - 工具条：图片 / 文件 / 表情 / 语音 / 更多
 * - 发送按钮：空内容禁用；聚焦时显示快捷键提示
 *
 * 移动端（compact 模式）收窄为单行圆角输入 + 环绕按钮，符合手机输入习惯。
 *
 * @param onSend - 发送回调，参数为去除首尾空白后的文本
 * @param compact - 移动端紧凑模式
 */
import { useRef, useState } from "react";
import { Image as ImageIcon, Mic, Paperclip, Plus, Send, Smile, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { chatSocket, useConversationStore, useMessageStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";

/** typing 帧节流间隔：输入期间最多每 3s 上报一次 */
const TYPING_THROTTLE_MS = 3000;

export function Composer({
  onSend,
  compact = false,
}: {
  onSend: (text: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentRef = useRef(0);
  const replyingTo = useMessageStore((s) => s.replyingTo);
  const setReplyingTo = useMessageStore((s) => s.setReplyingTo);
  const activeId = useConversationStore((s) => s.activeId);

  const canSend = value.trim().length > 0;

  const notifyTyping = () => {
    if (!activeId || !chatSocket.isOpen()) return;
    const nowMs = Date.now();
    if (nowMs - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = nowMs;
    chatSocket.send("typing", { conversation_id: activeId });
  };

  const send = () => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  /** 引用回复条（两种模式共用） */
  const replyBar = replyingTo && (
    <div className="border-primary bg-surface-container mb-2 flex items-center gap-2 rounded-lg border-l-[3px] px-3 py-2">
      <span className="text-body-sm min-w-0 flex-1 truncate">
        <span className="text-primary text-label-sm font-medium">
          {t("chat.reply.label", { name: replyingTo.senderName ?? "" })}
        </span>{" "}
        {replyingTo.text ?? replyingTo.file?.name ?? t("chat.message.image")}
      </span>
      <button
        onClick={() => setReplyingTo(null)}
        aria-label={t("chat.reply.cancel")}
        className="md3-icon-btn text-on-surface-variant !h-7 !w-7"
      >
        <X size={14} />
      </button>
    </div>
  );

  if (compact) {
    // 移动端：单行胶囊输入 + 附件/表情/发送
    return (
      <div className="bg-surface-container-low shrink-0 px-2.5 pt-2 pb-3">
        {replyBar}
        <div className="flex items-end gap-1.5">
          <button
            className="md3-icon-btn text-on-surface-variant"
            aria-label={t("chat.input.file")}
          >
            <Paperclip size={20} />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              autoGrow(e.target);
              notifyTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("chat.input.placeholder")}
            aria-label={t("chat.input.placeholder")}
            className="bg-surface-container-high text-body-lg text-on-surface placeholder:text-on-surface-variant/70 max-h-28 min-w-0 flex-1 resize-none rounded-3xl px-4 py-2.5 focus:outline-none"
          />
          <button
            className="md3-icon-btn text-on-surface-variant"
            aria-label={t("chat.input.emoji")}
          >
            <Smile size={20} />
          </button>
          {canSend ? (
            <button
              onClick={send}
              aria-label={t("chat.input.send")}
              className="brand-gradient grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition-transform active:scale-90"
            >
              <Send size={17} />
            </button>
          ) : (
            <button
              className="md3-icon-btn text-on-surface-variant"
              aria-label={t("chat.input.voice")}
            >
              <Mic size={20} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // 桌面 / 平板：一体化输入卡片
  return (
    <div className="border-outline-variant bg-surface-container-low shrink-0 border-t px-3 pt-2.5 pb-3">
      {replyBar}
      <div className="border-outline-variant focus-within:border-primary focus-within:ring-primary/15 bg-surface-bright dark:bg-surface-container group rounded-2xl border transition-shadow focus-within:ring-[3px]">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow(e.target);
            notifyTyping();
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("chat.input.placeholder")}
          aria-label={t("chat.input.placeholder")}
          className="text-body-lg text-on-surface placeholder:text-on-surface-variant/70 block max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 leading-relaxed focus:outline-none"
        />
        <div className="flex items-center gap-0.5 px-2 pb-1.5">
          <ToolButton label={t("chat.input.image")}>
            <ImageIcon size={19} />
          </ToolButton>
          <ToolButton label={t("chat.input.file")}>
            <Paperclip size={19} />
          </ToolButton>
          <ToolButton label={t("chat.input.emoji")}>
            <Smile size={19} />
          </ToolButton>
          <ToolButton label={t("chat.input.voice")}>
            <Mic size={19} />
          </ToolButton>
          <ToolButton label={t("chat.input.more")}>
            <Plus size={19} />
          </ToolButton>
          <span className="flex-1" />
          <span className="text-label-sm text-on-surface-variant mr-2 hidden opacity-0 transition-opacity duration-150 group-focus-within:opacity-70 sm:inline">
            {t("chat.input.hint")}
          </span>
          <button
            onClick={send}
            disabled={!canSend}
            aria-label={t("chat.input.send")}
            className={cn(
              "brand-gradient grid h-9 w-9 shrink-0 place-items-center rounded-full text-white transition-all",
              canSend
                ? "hover:brightness-105 active:scale-90"
                : "cursor-not-allowed opacity-40 grayscale-[0.3]",
            )}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      className="md3-icon-btn text-on-surface-variant !h-9 !w-9"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
