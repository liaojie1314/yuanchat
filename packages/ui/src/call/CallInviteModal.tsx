/**
 * CallInviteModal 组件 — 群通话选人（≤3）
 *
 * @description
 * 群会话点通话按钮先开这个弹窗：mesh 全连接的人数上限是 4（服务端
 * `MaxCallParticipants`），自己占一席，故最多再选 3 人。上限在这里**前置拦住**
 * 而不是等服务端回「通话人数已满」—— 那时通话已经发起、被跳过的人却在响铃。
 *
 * 成员来源是群成员表（不是好友表）：群里可能有非好友，通话照样能打。
 */
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchMembers, useAuthStore } from "@yuanchat/shared";
import type { CallMedia, ConversationMember } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "../primitives/Avatar";
import { Button } from "../primitives/Button";

/** mesh 上限 4 人 = 自己 + 3 名受邀人 */
export const MAX_CALL_INVITEES = 3;

/** 列表行的触控高度：本仓根字号 14px，`min-h-11` 只有 38.5px */
const TOUCH_ROW = "min-h-[44px]";

export function CallInviteModal({
  open,
  convId,
  media,
  onClose,
  onConfirm,
  /** 预置成员表：桌面详情面板已经拉过一次，传进来可省掉重复请求（也便于单测） */
  members: presetMembers,
}: {
  open: boolean;
  convId: string;
  media: CallMedia;
  onClose: () => void;
  /** 确认发起：把选中的成员 id 交给调用方（由它发 `call.invite`） */
  onConfirm: (media: CallMedia, inviteeIds: string[]) => void;
  members?: ConversationMember[];
}) {
  const { t } = useTranslation();
  const selfId = useAuthStore((s) => s.user?.id);
  const [members, setMembers] = useState<ConversationMember[]>(presetMembers ? presetMembers : []);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    if (presetMembers && presetMembers.length > 0) {
      setMembers(presetMembers);
      return;
    }
    let alive = true;
    void fetchMembers(convId)
      .then((list) => {
        if (alive) setMembers(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, convId]);

  const candidates = useMemo(() => members.filter((m) => m.userId !== selfId), [members, selfId]);

  if (!open) return null;

  const remaining = MAX_CALL_INVITEES - selected.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.indexOf(id) >= 0) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_CALL_INVITEES) return prev;
      return [...prev, id];
    });
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("call.inviteTitle")}
      onClick={onClose}
    >
      <div
        className="bg-surface-container-low flex max-h-[80vh] w-full max-w-sm flex-col rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <h2 className="text-title-md text-on-surface font-semibold">{t("call.inviteTitle")}</h2>
          <button
            className="md3-icon-btn text-on-surface-variant -mr-2"
            onClick={onClose}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 pt-2 pb-5">
          <div className="text-label-md text-on-surface-variant mb-1 shrink-0 font-medium">
            {t("call.inviteHint", { n: remaining })}
          </div>
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            {candidates.length === 0 ? (
              <p className="text-body-md text-on-surface-variant px-2 py-8 text-center">
                {t("common.noData")}
              </p>
            ) : (
              candidates.map((m) => {
                const checked = selected.indexOf(m.userId) >= 0;
                // 选满后其余项禁用：让「为什么点不动」在视觉上有解释，
                // 而不是静静地无响应
                const blocked = !checked && remaining <= 0;
                return (
                  <button
                    key={m.userId}
                    onClick={() => toggle(m.userId)}
                    disabled={blocked}
                    aria-pressed={checked}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                      TOUCH_ROW,
                      checked ? "bg-primary-container/60" : "hover:bg-surface-container",
                      blocked && "opacity-40",
                    )}
                  >
                    <Avatar name={m.alias ? m.alias : m.nickname} src={m.avatarUrl} size="md" />
                    <span className="text-body-lg text-on-surface min-w-0 flex-1 truncate">
                      {m.alias ? m.alias : m.nickname}
                    </span>
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        checked ? "border-primary bg-primary text-primary-on" : "border-outline",
                      )}
                    >
                      {checked && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <Button
            variant="primary"
            className="mt-4 w-full shrink-0"
            disabled={selected.length === 0}
            onClick={() => {
              onConfirm(media, selected);
              onClose();
            }}
          >
            {media === "video" ? t("chat.videoCall") : t("chat.voiceCall")}
          </Button>
        </div>
      </div>
    </div>
  );
}
