/**
 * ContactDetail 组件 — 好友资料视图
 *
 * @description
 * 通讯录内容区：头像 + 昵称 + 信息卡（签名 / 性别 / 元聊号可复制）+ 「发消息」。
 * 好友必有会话（accept 时原子创建），点发消息直接以 conversationId 跳聊天页。
 *
 * 挂载 / friend.id 变化时拉取 `fetchPublicProfile` 补全签名、性别等资料；
 * mock 模式跳过请求，失败时显示小字提示但不阻塞已有信息。
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Copy, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchPublicProfile, isMockEnabled } from "@yuanchat/shared";
import type { Friend, PublicProfile } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { copyText } from "./copyText";

interface ContactDetailProps {
  friend: Friend;
  /** 点「发消息」（携带单聊会话 ID） */
  onMessage: (conversationId: string) => void;
  /** 移动端返回按钮 */
  onBack?: () => void;
}

/** 性别码 → i18n key（0 保密不展示该行） */
const GENDER_KEY: Record<1 | 2, string> = {
  1: "profile.genderMale",
  2: "profile.genderFemale",
};

export function ContactDetail({ friend, onMessage, onBack }: ContactDetailProps) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [failed, setFailed] = useState(false);

  // 拉取公开资料补全签名 / 性别；mock 模式跳过（数据已由 bootstrap 注入）
  useEffect(() => {
    if (isMockEnabled()) return;
    let alive = true;
    setProfile(null);
    setFailed(false);
    void fetchPublicProfile(friend.id)
      .then((p) => {
        if (alive) setProfile(p);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [friend.id]);

  const gender = profile?.gender;
  const genderKey = gender === 1 || gender === 2 ? GENDER_KEY[gender] : null;

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

        {failed && (
          <p className="text-label-sm text-on-surface-variant mt-1">
            {t("contacts.loadDetailFailed")}
          </p>
        )}

        {/* 信息卡：签名 / 性别 / 元聊号 */}
        <div className="bg-surface-container mt-6 w-full max-w-80 rounded-xl">
          {profile?.bio && <InfoRow label={t("profile.bio")} value={profile.bio} />}
          {genderKey && <InfoRow label={t("profile.gender")} value={t(genderKey)} />}
          <InfoRow label={t("contacts.yuanId")} value={String(friend.shortId)} copyable />
        </div>

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

/** 信息卡行：左标签 + 右值，可选复制按钮 */
function InfoRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    void copyText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="border-outline-variant flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2 last:border-b-0">
      <span className="text-body-md text-on-surface-variant shrink-0">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-body-md text-on-surface truncate">{value}</span>
        {copyable && (
          <button
            onClick={onCopy}
            className="md3-icon-btn text-on-surface-variant !h-8 !w-8 shrink-0"
            aria-label={copied ? t("profile.copied") : t("profile.copy")}
          >
            {copied ? <Check size={16} className="text-primary" /> : <Copy size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
