/**
 * ForwardModal 组件 — 消息转发弹窗
 *
 * @description
 * 从当前会话列表多选目标（最多 9 个）把 sourceMessageId 一次转发过去。
 * 视觉沿用 CreateGroupModal 模式（fixed 遮罩 + surface-container-low 卡片）。
 *
 * - 顶部已选目标横排（点击移除）
 * - 会话列表多选：只显示单聊/群聊，排除源会话本身；行内 checkbox 高亮
 * - 「转发」按钮：≥1 会话可点，busy 防重入；成功 toast 后 onClose
 *
 * 结果由后端各 target 会话独立推 `message.receive` 帧驱动更新（本 modal 不做乐观插入）。
 */
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { forwardMessage, showToast, useConversationStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";
import { Button } from "./Button";

interface ForwardModalProps {
  open: boolean;
  sourceMessageId: string | null;
  sourceConversationId: string | null;
  onClose: () => void;
}

/** 单次最多转发会话数（与后端 MaxForwardTargets 对齐） */
const MAX_TARGETS = 9;

export function ForwardModal({
  open,
  sourceMessageId,
  sourceConversationId,
  onClose,
}: ForwardModalProps) {
  const { t } = useTranslation();
  const conversations = useConversationStore((s) => s.conversations);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelected([]);
      setBusy(false);
    }
  }, [open]);

  const candidates = useMemo(
    () => conversations.filter((c) => c.id !== sourceConversationId),
    [conversations, sourceConversationId],
  );
  const selectedConvs = useMemo(
    () => selected.map((id) => conversations.find((c) => c.id === id)).filter((c) => c != null),
    [selected, conversations],
  );

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_TARGETS) {
        showToast("error", t("forward.limit", { max: MAX_TARGETS }));
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleSubmit = async () => {
    if (!sourceMessageId || selected.length === 0 || busy) return;
    setBusy(true);
    try {
      await forwardMessage(sourceMessageId, selected);
      showToast("info", t("forward.doneToast", { count: selected.length }));
      onClose();
    } catch {
      showToast("error", t("common.opFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-low shadow-elevation-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center justify-between px-5">
          <h2 className="text-title-md text-on-surface font-semibold">{t("forward.title")}</h2>
          <button
            onClick={onClose}
            className="md3-icon-btn text-on-surface-variant"
            aria-label={t("common.close")}
          >
            <X size={20} />
          </button>
        </header>

        {selectedConvs.length > 0 && (
          <div className="border-outline-variant flex flex-wrap gap-2 border-y px-4 py-2">
            {selectedConvs.map((c) => (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className="bg-primary-container/60 text-primary-on-container inline-flex items-center gap-1 rounded-full px-2 py-1"
              >
                <Avatar name={c.name} src={c.avatarUrl} size="sm" />
                <span className="text-label-md max-w-24 truncate">{c.name}</span>
                <X size={14} />
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {candidates.length === 0 && (
            <p className="text-body-md text-on-surface-variant px-4 py-8 text-center">
              {t("forward.empty")}
            </p>
          )}
          {candidates.map((c) => {
            const active = selected.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  active ? "bg-primary-container/60" : "hover:bg-surface-container",
                )}
              >
                <Avatar name={c.name} src={c.avatarUrl} size="md" />
                <span className="text-body-lg text-on-surface min-w-0 flex-1 truncate">
                  {c.name}
                </span>
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border",
                    active ? "border-primary bg-primary text-primary-on" : "border-outline-variant",
                  )}
                >
                  {active && <Check size={13} />}
                </span>
              </button>
            );
          })}
        </div>

        <footer className="border-outline-variant flex items-center justify-between border-t px-5 py-3">
          <span className="text-label-md text-on-surface-variant">
            {t("forward.selected", { count: selected.length, max: MAX_TARGETS })}
          </span>
          <Button
            variant="primary"
            disabled={selected.length === 0 || busy}
            onClick={() => void handleSubmit()}
          >
            {t("forward.submit")}
          </Button>
        </footer>
      </div>
    </div>
  );
}
