/**
 * MembersView 组件 — 群成员全列表
 *
 * @description
 * ChatDetail 头像墙「全部」的展开视图：完整成员列表，每行头像 + 昵称 +
 * 角色徽标（role===2 群主 Crown、role===1 管理员 Shield，普通成员无徽标）。
 * 操作者 role 高于目标且非本人时行尾出现移出按钮（二次确认后回调 onKick）。
 * 成员数据由父级（ChatScreen）经 fetchMembers 拉取后透传；loading 时渲染骨架行。
 *
 * @param members - 成员列表（含 role）
 * @param loading - 拉取中显示骨架屏
 * @param myRole - 当前用户在群内的角色（踢人权限判定）
 * @param selfId - 当前用户 ID（不能踢自己）
 * @param onKick - 移出成员回调（确认后触发）
 * @param onBack - 返回详情面板回调
 */
import { useState } from "react";
import { ArrowLeft, Crown, Shield, UserMinus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConversationMember } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";

export function MembersView({
  members,
  loading = false,
  myRole = 0,
  selfId = "",
  onKick,
  onBack,
}: {
  members: ConversationMember[];
  loading?: boolean;
  myRole?: number;
  selfId?: string;
  onKick?: (userId: string, nickname: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [kickTarget, setKickTarget] = useState<{ userId: string; nickname: string } | null>(null);

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
          {t("detail.members", { count: members.length })}
        </h3>
      </div>

      {/* 成员列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading
          ? [0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg px-2 py-2">
                <span className="bg-surface-container-high h-10 w-10 shrink-0 rounded-full" />
                <span className="bg-surface-container-high h-4 w-24 rounded" />
              </div>
            ))
          : members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <Avatar name={m.nickname} src={m.avatarUrl} size="md" />
                <span className="text-body-lg text-on-surface min-w-0 flex-1 truncate">
                  {m.nickname}
                </span>
                {m.role === 2 && (
                  <span className="text-label-sm inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">
                    <Crown size={12} />
                    {t("detail.roleOwner")}
                  </span>
                )}
                {m.role === 1 && (
                  <span className="text-primary text-label-sm bg-primary-container/60 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium">
                    <Shield size={12} />
                    {t("detail.roleAdmin")}
                  </span>
                )}
                {onKick && myRole > m.role && m.userId !== selfId && (
                  <button
                    onClick={() => setKickTarget({ userId: m.userId, nickname: m.nickname })}
                    className="md3-icon-btn text-error !h-8 !w-8 shrink-0"
                    aria-label={t("detail.kickMember")}
                  >
                    <UserMinus size={15} />
                  </button>
                )}
              </div>
            ))}
      </div>

      <ConfirmDialog
        open={kickTarget !== null}
        title={t("detail.kickMember")}
        message={t("detail.kickConfirm", { name: kickTarget?.nickname ?? "" })}
        danger
        onConfirm={() => {
          if (kickTarget) onKick?.(kickTarget.userId, kickTarget.nickname);
          setKickTarget(null);
        }}
        onCancel={() => setKickTarget(null)}
      />
    </div>
  );
}
