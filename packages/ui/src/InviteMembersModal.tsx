/**
 * InviteMembersModal 组件 — 邀请好友入群弹窗
 *
 * @description
 * CreateGroupModal 的裁剪版：无群名输入，好友列表剔除已在群成员。
 * 确认调 inviteMembers；成功仅关闭弹窗——成员数/系统消息由
 * conversation.updated / message.receive[system] 帧驱动，不做本地乐观更新。
 */
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { groupFriends, inviteMembers, showToast, useContactStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";
import { Button } from "./Button";

export function InviteMembersModal({
  open,
  onClose,
  convId,
  existingMemberIds,
}: {
  open: boolean;
  onClose: () => void;
  convId: string;
  existingMemberIds: string[];
}) {
  const { t } = useTranslation();
  const friends = useContactStore((s) => s.friends);
  const loadFriends = useContactStore((s) => s.loadFriends);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // 打开时重置选择并确保好友列表已加载
  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setBusy(false);
    if (friends.length === 0) void loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const invitable = useMemo(
    () => friends.filter((f) => !existingMemberIds.includes(f.id)),
    [friends, existingMemberIds],
  );
  const groups = useMemo(() => groupFriends(invitable), [invitable]);
  const selectedFriends = useMemo(
    () => selected.map((id) => invitable.find((f) => f.id === id)).filter((f) => f != null),
    [selected, invitable],
  );

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleInvite = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      await inviteMembers(convId, selected);
      onClose();
    } catch {
      showToast("error", t("detail.inviteFailed"));
      setBusy(false);
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("detail.inviteTitle")}
      onClick={onClose}
    >
      <div
        className="bg-surface-container-low flex max-h-[80vh] w-full max-w-sm flex-col rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <h2 className="text-title-md text-on-surface font-semibold">{t("detail.inviteTitle")}</h2>
          <button
            className="md3-icon-btn text-on-surface-variant -mr-2"
            onClick={onClose}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 pt-2 pb-5">
          {selectedFriends.length > 0 && (
            <div className="scrollbar-none mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
              {selectedFriends.map((f) => (
                <button
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  className="relative shrink-0"
                  aria-label={t("chat.group.removeMember")}
                >
                  <Avatar name={f.nickname} src={f.avatarUrl} size="md" />
                  <span className="bg-error absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white">
                    <X size={11} />
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="text-label-md text-on-surface-variant mb-1 shrink-0 font-medium">
            {t("chat.group.selectMembers")}
          </div>
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            {groups.length === 0 ? (
              <p className="text-body-md text-on-surface-variant px-2 py-8 text-center">
                {t("detail.noInvitable")}
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.letter}>
                  <div className="text-label-sm text-on-surface-variant px-2 pt-2 pb-1 font-medium">
                    {group.letter}
                  </div>
                  {group.friends.map((f) => {
                    const checked = selected.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        onClick={() => toggle(f.id)}
                        aria-pressed={checked}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                          checked ? "bg-primary-container/60" : "hover:bg-surface-container",
                        )}
                      >
                        <Avatar name={f.nickname} src={f.avatarUrl} size="md" />
                        <span className="text-body-lg text-on-surface min-w-0 flex-1 truncate">
                          {f.nickname}
                        </span>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                            checked
                              ? "border-primary bg-primary text-primary-on"
                              : "border-outline",
                          )}
                        >
                          {checked && <Check size={13} strokeWidth={3} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <Button
            variant="primary"
            className="mt-4 w-full shrink-0"
            disabled={selected.length === 0 || busy}
            onClick={() => void handleInvite()}
          >
            {t("detail.invite")}
          </Button>
        </div>
      </div>
    </div>
  );
}
