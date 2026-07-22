/**
 * ContactDetail 组件 — 好友资料视图
 *
 * @description
 * 对齐 docs/design/03_CONTACTS_PAGE.md §6 联系人详情：
 * - 顶部横幅：基于昵称哈希色的 135° 渐变（同 Avatar 色系），底部渐隐过渡
 * - 头像出血：80px Avatar 骑跨横幅下缘，4px surface 描边制造浮出感，
 *   右下角在线状态点（presenceStore 实时驱动）
 * - 昵称 + 元聊号（可复制）+ 签名 + 在线状态文字
 * - 快速操作区：发消息（primary）/ 语音 / 视频（后两者占位 toast）
 * - 信息卡：签名 / 性别 / 元聊号行
 * - 危险区卡片：加入黑名单 / 删除好友（error 色、二次确认）
 *
 * 挂载 / friend.id 变化时拉取 `fetchPublicProfile` 补全签名、性别等资料；
 * mock 模式跳过请求，失败时显示小字提示但不阻塞已有信息。
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Ban, Check, Copy, MessageSquare, Phone, UserRoundX, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  fetchPublicProfile,
  isMockEnabled,
  showToast,
  useBlocklistStore,
  useContactStore,
  usePresenceStore,
} from "@yuanchat/shared";
import type { Friend, PublicProfile } from "@yuanchat/shared";
import { getAvatarColor } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";
import { copyText } from "./copyText";

interface ContactDetailProps {
  friend: Friend;
  /** 点「发消息」（携带单聊会话 ID） */
  onMessage: (conversationId: string) => void;
  /** 删除好友成功后回调（上层退回空状态） */
  onDeleted?: () => void;
  /** 移动端返回按钮 */
  onBack?: () => void;
}

/** 性别码 → i18n key（0 保密不展示该行） */
const GENDER_KEY: Record<1 | 2, string> = {
  1: "profile.genderMale",
  2: "profile.genderFemale",
};

export function ContactDetail({ friend, onMessage, onDeleted, onBack }: ContactDetailProps) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const deleteFriend = useContactStore((s) => s.deleteFriend);
  const block = useBlocklistStore((s) => s.block);
  const online = usePresenceStore((s) => s.onlineIds.includes(friend.id));

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
  const bannerColor = getAvatarColor(friend.nickname);

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteFriend(friend.id);
      setConfirmDelete(false);
      showToast("info", t("contacts.deletedToast"));
      if (onDeleted) onDeleted();
    } catch {
      showToast("error", t("common.opFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleBlock = async () => {
    setBusy(true);
    try {
      await block(friend.id);
      showToast("info", t("contacts.blockedToast"));
    } catch {
      showToast("error", t("common.opFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 横幅区：昵称哈希色 135° 渐变，底部渐隐过渡到 surface */}
      <div
        className="relative h-32 shrink-0 md:h-36"
        style={{
          background: `linear-gradient(135deg, ${bannerColor}cc 0%, ${bannerColor}4d 100%)`,
          maskImage: "linear-gradient(to bottom, black calc(100% - 20px), transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 20px), transparent)",
        }}
      >
        {onBack && (
          <button
            className="absolute top-3 left-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-black/10"
            onClick={onBack}
            aria-label={t("chat.back")}
          >
            <ArrowLeft size={20} />
          </button>
        )}
      </div>

      {/* 头像出血：骑跨横幅下缘，surface 描边 + 在线状态点 */}
      <div className="z-10 -mt-11 flex shrink-0 justify-center">
        <span className="border-surface inline-flex rounded-full border-4">
          <Avatar
            name={friend.nickname}
            src={friend.avatarUrl}
            size="xl"
            presence={online ? "online" : "offline"}
          />
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center px-6 pt-3 pb-6">
        <h2 className="text-headline-sm text-on-surface font-semibold">{friend.nickname}</h2>
        <p className="text-label-md text-on-surface-variant mt-1">
          {online ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {t("common.online")}
            </span>
          ) : (
            t("common.offline")
          )}
        </p>
        {profile?.bio && (
          <p className="text-body-md text-on-surface-variant mt-2 line-clamp-2 max-w-96 text-center">
            {profile.bio}
          </p>
        )}
        {failed && (
          <p className="text-label-sm text-on-surface-variant mt-1">
            {t("contacts.loadDetailFailed")}
          </p>
        )}

        {/* 快速操作区：发消息 / 语音 / 视频 */}
        <div className="mt-5 flex w-full max-w-96 gap-2">
          {friend.conversationId && (
            <QuickAction
              icon={<MessageSquare size={22} />}
              label={t("contacts.sendMessage")}
              primary
              onClick={() => onMessage(friend.conversationId!)}
            />
          )}
          <QuickAction
            icon={<Phone size={22} />}
            label={t("chat.voiceCall")}
            onClick={() => showToast("info", t("common.comingSoon"))}
          />
          <QuickAction
            icon={<Video size={22} />}
            label={t("chat.videoCall")}
            onClick={() => showToast("info", t("common.comingSoon"))}
          />
        </div>

        {/* 信息卡：性别 / 元聊号（签名已在头部展示） */}
        <div className="bg-surface-container mt-4 w-full max-w-96 rounded-lg">
          {genderKey && <InfoRow label={t("profile.gender")} value={t(genderKey)} />}
          <InfoRow label={t("contacts.yuanId")} value={String(friend.shortId)} copyable />
        </div>

        {/* 危险区卡片：拉黑 / 删除好友 */}
        <div className="bg-surface-container mt-4 w-full max-w-96 overflow-hidden rounded-lg">
          <button
            className="text-error hover:bg-error/10 border-outline-variant text-body-md flex h-12 w-full items-center justify-center gap-2 border-b font-medium transition-colors disabled:opacity-50"
            disabled={busy}
            onClick={() => void handleBlock()}
          >
            <Ban size={16} />
            {t("contacts.blockUser")}
          </button>
          <button
            className="text-error hover:bg-error/10 text-body-md flex h-12 w-full items-center justify-center gap-2 font-medium transition-colors disabled:opacity-50"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <UserRoundX size={16} />
            {t("contacts.deleteFriend")}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t("contacts.confirmDeleteTitle")}
        message={t("contacts.confirmDeleteMessage", { name: friend.nickname })}
        confirmLabel={t("contacts.deleteFriend")}
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** 快速操作卡：图标 + 文字，primary 时品牌色强调 */
function QuickAction({
  icon,
  label,
  primary,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        primary
          ? "bg-primary-container text-primary-on-container hover:bg-primary-container/80 flex h-16 flex-1 flex-col items-center justify-center gap-1 rounded-lg transition-all active:scale-95"
          : "bg-surface-container text-on-surface hover:bg-surface-container-high flex h-16 flex-1 flex-col items-center justify-center gap-1 rounded-lg transition-all active:scale-95"
      }
    >
      <span className={primary ? "" : "text-primary"}>{icon}</span>
      <span className="text-label-md font-medium">{label}</span>
    </button>
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
