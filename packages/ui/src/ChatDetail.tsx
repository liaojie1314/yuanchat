/**
 * ChatDetail 组件 — 会话详情侧边面板
 *
 * @description
 * 位于三/四栏布局的最右侧（平板端以抽屉呈现），展示当前选中会话的：
 * - 头像、名称、类别（群聊显示成员数）
 * - 快捷操作：邀请成员 / 群文件 / 群二维码（群聊），发消息 / 通话（单聊）
 * - 成员头像墙（群聊，+N 折叠）
 * - 设置行：消息免打扰、置顶会话（开关）
 * - 危险操作：清空聊天记录、退出群组
 *
 * 菜单项点击后直接操作 Zustand Store 更新状态。
 *
 * @param onClose - 关闭面板回调，非空时右上角显示关闭按钮
 * @param onShowAllMembers - 「查看全部」成员回调，非空时群聊头像墙显示该按钮
 */
import { useEffect, useState } from "react";
import { Hash, LogOut, Paperclip, Phone, Trash2, UserPlus, X, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchMembers, isMockEnabled, useConversationStore } from "@yuanchat/shared";
import type { ConversationMember } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";

/** 群成员头像墙 mock 数据，mock 模式下回退使用 */
const MOCK_MEMBERS: ConversationMember[] = [
  { userId: "m1", nickname: "张伟", avatarUrl: null, role: 2 },
  { userId: "m2", nickname: "李四", avatarUrl: null, role: 0 },
  { userId: "m3", nickname: "王芳", avatarUrl: null, role: 0 },
  { userId: "m4", nickname: "陈曦", avatarUrl: null, role: 0 },
  { userId: "m5", nickname: "我", avatarUrl: null, role: 0 },
];

/** 头像墙最多展示的成员数，超出部分折叠为 +N */
const WALL_LIMIT = 8;

export function ChatDetail({
  onClose,
  onShowAllMembers,
}: {
  onClose?: () => void;
  onShowAllMembers?: () => void;
}) {
  const { t } = useTranslation();
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const conv = conversations.find((c) => c.id === activeId);

  const [members, setMembers] = useState<ConversationMember[]>([]);

  const convId = conv?.id;
  const isGroup = conv?.type === "group";

  // 群聊拉取真实成员；mock 模式回退静态数组
  useEffect(() => {
    if (!isGroup || !convId) {
      setMembers([]);
      return;
    }
    if (isMockEnabled()) {
      setMembers(MOCK_MEMBERS);
      return;
    }
    let alive = true;
    void fetchMembers(convId)
      .then((list) => {
        if (alive) setMembers(list);
      })
      .catch(() => {
        if (alive) setMembers([]);
      });
    return () => {
      alive = false;
    };
  }, [isGroup, convId]);

  // 防御：如果找不到对应会话（数据不一致），不渲染任何内容
  if (!conv) return null;

  const shownMembers = members.slice(0, WALL_LIMIT);
  const extraMembers = (conv.memberCount ?? members.length) - Math.min(members.length, WALL_LIMIT);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 标题 */}
      <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
        <h3 className="text-title-sm text-on-surface font-semibold">
          {isGroup ? t("detail.groupInfo") : t("detail.contactInfo")}
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="md3-icon-btn text-on-surface-variant !h-8 !w-8"
            aria-label={t("detail.close")}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* 头像和名称 */}
      <div className="px-4 pt-2 pb-5 text-center">
        <div className="mb-2.5 inline-flex">
          <Avatar name={conv.name} src={conv.avatarUrl} size="xl" presence={conv.presence} />
        </div>
        <h3 className="text-title-md text-on-surface font-semibold">{conv.name}</h3>
        <p className="text-label-sm text-on-surface-variant mt-1">
          {isGroup
            ? `${t("chat.groupChat")}${conv.memberCount ? ` · ${t("chat.members", { count: conv.memberCount })}` : ""}`
            : t("chat.privateChat")}
        </p>
      </div>

      {/* 快捷操作 */}
      <div className="border-outline-variant flex border-t border-b">
        {isGroup ? (
          <>
            <QuickAction icon={<UserPlus size={19} />} label={t("detail.invite")} />
            <QuickAction icon={<Paperclip size={19} />} label={t("detail.groupFiles")} />
            <QuickAction icon={<Hash size={19} />} label={t("detail.groupQrcode")} />
          </>
        ) : (
          <>
            <QuickAction icon={<MessageCircle size={19} />} label={t("detail.sendMessage")} />
            <QuickAction icon={<Phone size={19} />} label={t("chat.voiceCall")} />
          </>
        )}
      </div>

      {/* 成员头像墙（群聊） */}
      {isGroup && (
        <div className="px-4 pt-3 pb-2">
          <div className="text-label-md text-on-surface-variant mb-2 flex items-center justify-between font-medium">
            <span>{t("detail.members", { count: conv.memberCount ?? members.length })}</span>
            {onShowAllMembers && (
              <button onClick={onShowAllMembers} className="text-primary text-label-md font-medium">
                {t("detail.seeAll")}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2.5">
            {shownMembers.map((m) => (
              <Avatar key={m.userId} name={m.nickname} src={m.avatarUrl} size="sm" />
            ))}
            {extraMembers > 0 && (
              <span className="bg-surface-container-high text-on-surface-variant text-label-sm grid h-8 w-8 place-items-center rounded-full font-medium">
                +{extraMembers}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 设置行 */}
      <div className="mt-1">
        <SettingRow
          label={t("detail.mute")}
          checked={conv.isMuted}
          onToggle={() => updateConversation(conv.id, { isMuted: !conv.isMuted })}
        />
        <SettingRow
          label={t("detail.pinConversation")}
          checked={!!conv.isPinned}
          onToggle={() => updateConversation(conv.id, { isPinned: !conv.isPinned })}
        />
      </div>

      {/* 危险操作 */}
      <div className="border-outline-variant mt-auto border-t p-2">
        <DangerRow icon={<Trash2 size={17} />} label={t("detail.clearHistory")} />
        {isGroup && <DangerRow icon={<LogOut size={17} />} label={t("detail.leaveGroup")} />}
      </div>
    </div>
  );
}

function QuickAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="text-on-surface-variant hover:bg-surface-container-high hover:text-primary text-label-sm flex h-16 flex-1 flex-col items-center justify-center gap-1 font-medium transition-colors">
      {icon}
      {label}
    </button>
  );
}

function SettingRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="hover:bg-surface-container-high flex h-12 w-full items-center justify-between gap-3 px-4 transition-colors"
    >
      <span className="text-body-md text-on-surface">{label}</span>
      {/* M3 风格开关 */}
      <span
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-outline",
        )}
      >
        <span
          className={cn(
            "shadow-elevation-1 absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}

function DangerRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="text-error hover:bg-error/10 text-body-md flex h-11 w-full items-center gap-2.5 rounded-lg px-3 font-medium transition-colors">
      {icon}
      {label}
    </button>
  );
}
