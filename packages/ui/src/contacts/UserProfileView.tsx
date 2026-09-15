/**
 * UserProfileView 组件 — 用户资料整页视图
 *
 * @description
 * 点消息头像后进入的只读资料页：顶部返回栏 + 头像、昵称、在线状态、个性签名、
 * 性别、元聊号（可复制）。资料按 userId 现拉 `fetchPublicProfile`，
 * 因此对非好友（群成员、陌生人）同样可用，不依赖本地好友列表。
 *
 * 走详情面板的位置（手机整屏 / 平板抽屉 / 桌面第四栏），不再用居中浮层：
 * 浮层在手机上盖住整块聊天区，返回手势也不通。
 *
 * 与 ContactDetail（好友资料页）分工：这里只做「看一眼是谁」，
 * 不含删除好友 / 拉黑等破坏性操作。
 *
 * @param userId - 目标用户 ID
 * @param fallbackName - 资料到达前先显示的昵称（消息自带的发送者昵称）
 * @param isSelf - 是否在看自己的资料（标题换成「我的资料」）
 * @param onBack - 返回回调
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchPublicProfile, usePresenceStore } from "@yuanchat/shared";
import type { PublicProfile } from "@yuanchat/shared";
import { Avatar } from "../primitives/Avatar";
import { copyText } from "../util/copyText";

/** 性别码 → i18n key（0 保密不展示该行） */
const GENDER_KEY: Record<1 | 2, string> = {
  1: "profile.genderMale",
  2: "profile.genderFemale",
};

export function UserProfileView({
  userId,
  fallbackName,
  isSelf = false,
  onBack,
}: {
  userId: string;
  fallbackName?: string;
  isSelf?: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const online = usePresenceStore((s) => s.onlineIds.includes(userId));

  useEffect(() => {
    let alive = true;
    setProfile(null);
    setFailed(false);
    void fetchPublicProfile(userId)
      .then((p) => {
        if (alive) setProfile(p);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const name = profile?.nickname ?? fallbackName ?? "";
  const genderKey =
    profile?.gender === 1 || profile?.gender === 2 ? GENDER_KEY[profile.gender] : null;

  const handleCopy = () => {
    if (!profile) return;
    void copyText(String(profile.shortId));
    setCopied(true);
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      role="region"
      aria-label={t("profile.viewProfile")}
    >
      {/* 标题栏 */}
      <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-1">
        <button
          onClick={onBack}
          className="md3-icon-btn text-on-surface-variant !h-8 !w-8"
          aria-label={t("chat.back")}
        >
          <ArrowLeft size={18} />
        </button>
        <h3 className="text-title-sm text-on-surface font-semibold">
          {isSelf ? t("profile.myProfile") : t("profile.viewProfile")}
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col items-center pt-2">
          <Avatar
            name={name || "?"}
            src={profile?.avatarUrl ?? undefined}
            size="xl"
            presence={online ? "online" : "offline"}
          />
          <h4 className="text-title-md text-on-surface mt-2.5 max-w-full truncate font-semibold">
            {name}
          </h4>
          <p className="text-label-md text-on-surface-variant mt-0.5">
            {online ? t("common.online") : t("common.offline")}
          </p>
          {profile?.bio && (
            <p className="text-body-sm text-on-surface-variant mt-2 line-clamp-3 text-center">
              {profile.bio}
            </p>
          )}
          {failed && (
            <p className="text-label-sm text-on-surface-variant mt-2">
              {t("contacts.loadDetailFailed")}
            </p>
          )}
        </div>

        {profile && (
          <div className="bg-surface-container mt-4 rounded-lg">
            {genderKey && <InfoRow label={t("profile.gender")} value={t(genderKey)} />}
            <div className="flex h-11 items-center justify-between gap-2 px-3">
              <span className="text-body-sm text-on-surface-variant shrink-0">
                {t("contacts.yuanId")}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                aria-label={t("profile.copy")}
                className="text-body-sm text-on-surface hover:text-primary flex min-w-0 items-center gap-1.5 transition-colors"
              >
                <span className="truncate tabular-nums">{profile.shortId}</span>
                {copied ? (
                  <Check size={14} className="shrink-0 text-emerald-500" />
                ) : (
                  <Copy size={14} className="shrink-0" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 信息行：左标签右值，等高 44px 与元聊号行对齐 */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-outline-variant flex h-11 items-center justify-between gap-2 border-b px-3">
      <span className="text-body-sm text-on-surface-variant shrink-0">{label}</span>
      <span className="text-body-sm text-on-surface truncate">{value}</span>
    </div>
  );
}
