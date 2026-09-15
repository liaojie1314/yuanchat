/**
 * NewFriendsView 组件 — "新的朋友"申请列表
 *
 * @description
 * 通讯录内容区视图：收到的申请（同意/拒绝按钮）+ 我发出的申请（状态标签）。
 * 同意成功后回调 onAccepted(conversationId) 供上层跳转聊天。
 */
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useContactStore } from "@yuanchat/shared";
import type { FriendRequestItem } from "@yuanchat/shared";
import { Avatar } from "../primitives/Avatar";
import { Button } from "../primitives/Button";

interface NewFriendsViewProps {
  /** 同意后回调（携带新会话 ID） */
  onAccepted?: (conversationId: string) => void;
  /** 移动端返回按钮 */
  onBack?: () => void;
}

export function NewFriendsView({ onAccepted, onBack }: NewFriendsViewProps) {
  const { t } = useTranslation();
  const requests = useContactStore((s) => s.requests);
  const accept = useContactStore((s) => s.accept);
  const reject = useContactStore((s) => s.reject);

  /** 正在处理中的申请 ID（防连点） */
  const [busyId, setBusyId] = useState<string | null>(null);

  const incoming = requests.filter((r) => r.direction === "in");
  const outgoing = requests.filter((r) => r.direction === "out");

  const handleAccept = async (req: FriendRequestItem) => {
    setBusyId(req.id);
    try {
      const convId = await accept(req.id);
      if (onAccepted) onAccepted(convId);
    } catch {
      // 失败保持 pending，可重试（错误提示由后续全局 toast 统一处理）
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: FriendRequestItem) => {
    setBusyId(req.id);
    try {
      await reject(req.id);
    } catch {
      // 同上
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-outline-variant flex h-14 shrink-0 items-center gap-2 border-b px-4">
        {onBack && (
          <button
            className="md3-icon-btn text-on-surface-variant -ml-2"
            onClick={onBack}
            aria-label={t("chat.back")}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h2 className="text-title-md text-on-surface font-semibold">{t("contacts.newFriend")}</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {incoming.length === 0 && outgoing.length === 0 && (
          <p className="text-body-md text-on-surface-variant py-8 text-center">
            {t("contacts.noRequests")}
          </p>
        )}

        {incoming.length > 0 && (
          <>
            <SectionLabel>{t("contacts.received")}</SectionLabel>
            {incoming.map((req) => (
              <RequestRow key={req.id} req={req}>
                {req.status === 0 ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="primary"
                      className="h-8 px-3 text-sm"
                      disabled={busyId === req.id}
                      onClick={() => void handleAccept(req)}
                    >
                      {t("contacts.accept")}
                    </Button>
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-sm"
                      disabled={busyId === req.id}
                      onClick={() => void handleReject(req)}
                    >
                      {t("contacts.reject")}
                    </Button>
                  </div>
                ) : (
                  <StatusLabel status={req.status} />
                )}
              </RequestRow>
            ))}
          </>
        )}

        {outgoing.length > 0 && (
          <>
            <SectionLabel>{t("contacts.sent")}</SectionLabel>
            {outgoing.map((req) => (
              <RequestRow key={req.id} req={req}>
                <StatusLabel status={req.status} pendingKey="contacts.waiting" />
              </RequestRow>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function RequestRow({ req, children }: { req: FriendRequestItem; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Avatar name={req.peer.nickname} src={req.peer.avatarUrl} size="md" />
      <div className="min-w-0 flex-1">
        <div className="text-body-lg text-on-surface truncate font-medium">{req.peer.nickname}</div>
        {req.message && (
          <div className="text-body-md text-on-surface-variant truncate">{req.message}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function StatusLabel({
  status,
  pendingKey = "contacts.waiting",
}: {
  status: number;
  pendingKey?: string;
}) {
  const { t } = useTranslation();
  const key = status === 1 ? "contacts.accepted" : status === 2 ? "contacts.rejected" : pendingKey;
  return <span className="text-body-md text-on-surface-variant shrink-0">{t(key)}</span>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-label-md text-on-surface-variant pt-3 pb-1.5 font-medium">{children}</div>
  );
}
