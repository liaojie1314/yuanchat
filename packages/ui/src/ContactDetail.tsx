/**
 * ContactDetail 组件 — 好友资料视图
 *
 * @description
 * 通讯录内容区：头像 + 昵称 + 元聊号 + 「发消息」。
 * 好友必有会话（accept 时原子创建），点发消息直接以 conversationId 跳聊天页。
 */
import { ArrowLeft, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Friend } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { Button } from "./Button";

interface ContactDetailProps {
  friend: Friend;
  /** 点「发消息」（携带单聊会话 ID） */
  onMessage: (conversationId: string) => void;
  /** 移动端返回按钮 */
  onBack?: () => void;
}

export function ContactDetail({ friend, onMessage, onBack }: ContactDetailProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        {onBack && (
          <button
            className="md3-icon-btn text-on-surface-variant -ml-2"
            onClick={onBack}
            aria-label={t("chat.back")}
          >
            <ArrowLeft size={20} />
          </button>
        )}
      </header>

      <div className="flex flex-1 flex-col items-center px-6 pt-6">
        <Avatar name={friend.nickname} src={friend.avatarUrl} size="xl" />
        <h2 className="text-title-lg text-on-surface mt-4 font-semibold">{friend.nickname}</h2>
        <p className="text-body-md text-on-surface-variant mt-1">
          {t("contacts.yuanId")}: {friend.shortId}
        </p>

        {friend.conversationId && (
          <Button
            variant="primary"
            className="mt-8 w-full max-w-60"
            onClick={() => onMessage(friend.conversationId!)}
          >
            <MessageSquare size={16} className="mr-2" />
            {t("contacts.sendMessage")}
          </Button>
        )}
      </div>
    </div>
  );
}
