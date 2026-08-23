/**
 * ChatDetail 组件 — 会话详情侧边面板
 *
 * @description
 * 位于三/四栏布局的最右侧（平板端以抽屉呈现），展示当前选中会话的：
 * - 头像、名称（群主/管理员可内联改名）、类别（群聊显示成员数）
 * - 快捷操作：邀请成员 / 群文件 / 群二维码（群聊），发消息 / 通话（单聊）
 * - 成员头像墙（群聊，+N 折叠）
 * - 设置行：消息免打扰、置顶会话（开关）
 * - 危险操作：清空聊天记录、退出群组（群主为解散群聊，二次确认）
 *
 * 群管理操作（改名/邀请/退群/解散）成功后不做本地乐观更新，
 * 由 conversation.updated / removed 帧统一驱动列表态。
 *
 * @param onClose - 关闭面板回调，非空时右上角显示关闭按钮
 * @param onShowAllMembers - 「查看全部」成员回调，非空时群聊头像墙显示该按钮
 */
import { useEffect, useState } from "react";
import {
  Check,
  Hash,
  LogOut,
  Paperclip,
  Pencil,
  Phone,
  Trash2,
  UserPlus,
  X,
  MessageCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  applyConversationSetting,
  clearHistory,
  dissolveGroup,
  fetchMembers,
  isMockEnabled,
  leaveGroup,
  renameGroup,
  showToast,
  updateAnnouncement,
  updateMyAlias,
  useAuthStore,
  useConversationStore,
  useMessageStore,
} from "@yuanchat/shared";
import type { ConversationMember } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";
import { ConfirmDialog } from "./ConfirmDialog";
import { InviteMembersModal } from "./InviteMembersModal";

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
  const clearConversation = useMessageStore((s) => s.clearConversation);
  const selfId = useAuthStore((s) => s.user?.id ?? "");
  const conv = conversations.find((c) => c.id === activeId);

  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmDanger, setConfirmDanger] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasDraft, setAliasDraft] = useState("");

  const convId = conv?.id;
  const isGroup = conv?.type === "group";
  const memberCount = conv?.memberCount;
  const memberVersion = conv?.memberVersion;
  const myRole = members.find((m) => m.userId === selfId)?.role ?? 0;

  // 群聊拉取真实成员；mock 模式回退静态数组。
  // memberCount（邀请/踢人/退群帧）或 memberVersion（角色变更帧）变化时重拉，
  // 头像墙与"我"的角色实时刷新。
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
  }, [isGroup, convId, memberCount, memberVersion]);

  // 防御：如果找不到对应会话（数据不一致），不渲染任何内容
  if (!conv) return null;

  const shownMembers = members.slice(0, WALL_LIMIT);
  const extraMembers = (conv.memberCount ?? members.length) - Math.min(members.length, WALL_LIMIT);
  const myAlias = members.find((m) => m.userId === selfId)?.alias;

  const saveName = () => {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!trimmed || trimmed === conv.name) return;
    // 成功由 conversation.updated 帧刷新，不做本地乐观更新
    renameGroup(conv.id, trimmed).catch(() => showToast("error", t("detail.renameFailed")));
  };

  const handleClear = () => {
    setConfirmClear(false);
    // 本人清空后本地即时生效（不推 WS 帧，多端另一设备需重连才见效）
    clearHistory(conv.id)
      .then(() => clearConversation(conv.id))
      .catch(() => showToast("error", t("common.opFailed")));
  };

  const saveAnnouncement = () => {
    const trimmed = announcementDraft.trim();
    setEditingAnnouncement(false);
    if (trimmed === (conv.announcement ?? "")) return;
    // 成功由 conversation.updated 帧刷新（系统消息 + 横幅联动）
    updateAnnouncement(conv.id, trimmed).catch(() =>
      showToast("error", t("detail.announcementFailed")),
    );
  };

  const saveAlias = () => {
    const trimmed = aliasDraft.trim();
    setEditingAlias(false);
    updateMyAlias(conv.id, trimmed)
      .then(() =>
        // 触发成员重拉：ChatDetail 的成员 effect 以 memberVersion 为依赖（现有机制）
        updateConversation(conv.id, { memberVersion: (conv.memberVersion ?? 0) + 1 }),
      )
      .catch(() => showToast("error", t("detail.aliasFailed")));
  };

  const isOwner = myRole === 2;
  const handleDanger = () => {
    setConfirmDanger(false);
    const action = isOwner ? dissolveGroup(conv.id) : leaveGroup(conv.id);
    // 成功由 conversation.removed 帧移除会话
    action.catch(() => showToast("error", t("common.opFailed")));
  };

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
        {/* 用块级 flex 居中而非 inline-flex：inline-flex 与下面的名称行都是行内级元素，
            面板够宽时两者会排在同一行（手机上详情页占满宽度，必然撞上） */}
        <div className="mb-2.5 flex justify-center">
          <Avatar name={conv.name} src={conv.avatarUrl} size="xl" presence={conv.presence} />
        </div>
        {editingName ? (
          <div className="mx-auto flex max-w-[220px] items-center gap-1">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") setEditingName(false);
              }}
              maxLength={100}
              autoFocus
              aria-label={t("detail.renameGroup")}
              className="bg-surface-container-high text-title-md text-on-surface focus:ring-primary/40 w-full min-w-0 rounded-lg px-2 py-1 text-center font-semibold transition-shadow focus:ring-2 focus:outline-none"
            />
            <button
              onClick={saveName}
              className="md3-icon-btn text-primary !h-8 !w-8 shrink-0"
              aria-label={t("common.confirm")}
            >
              <Check size={16} />
            </button>
          </div>
        ) : (
          <h3 className="text-title-md text-on-surface flex items-center justify-center gap-1.5 font-semibold">
            {/* 名称单独包一层：长名称截断不挤走改名按钮，也让间距兜底能命中（裸文本节点不参与选择器） */}
            <span className="truncate">{conv.name}</span>
            {isGroup && myRole >= 1 && (
              <button
                onClick={() => {
                  setNameDraft(conv.name);
                  setEditingName(true);
                }}
                className="text-on-surface-variant hover:text-primary shrink-0 transition-colors"
                aria-label={t("detail.renameGroup")}
              >
                <Pencil size={14} />
              </button>
            )}
          </h3>
        )}
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
            <QuickAction
              icon={<UserPlus size={19} />}
              label={t("detail.invite")}
              onClick={() => setInviteOpen(true)}
            />
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
              <span className="bg-surface-container-high text-on-surface-variant text-label-sm flex h-8 w-8 items-center justify-center rounded-full font-medium">
                +{extraMembers}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 群公告（群聊，管理员可编辑，普通成员只读） */}
      {isGroup && (
        <div className="border-outline-variant border-t px-4 py-3">
          <div className="text-label-md text-on-surface-variant mb-1.5 flex items-center justify-between font-medium">
            <span>{t("detail.announcement")}</span>
            {!editingAnnouncement && myRole >= 1 && (
              <button
                onClick={() => {
                  setAnnouncementDraft(conv.announcement ?? "");
                  setEditingAnnouncement(true);
                }}
                className="text-on-surface-variant hover:text-primary transition-colors"
                aria-label={t("detail.announcement")}
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
          {editingAnnouncement ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={announcementDraft}
                onChange={(e) => setAnnouncementDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditingAnnouncement(false);
                }}
                rows={3}
                placeholder={t("detail.announcementPlaceholder")}
                autoFocus
                aria-label={t("detail.announcement")}
                className="bg-surface-container-high text-body-md text-on-surface focus:ring-primary/40 w-full resize-none rounded-lg px-2 py-1.5 transition-shadow focus:ring-2 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  onClick={saveAnnouncement}
                  className="md3-icon-btn text-primary !h-8 !w-8"
                  aria-label={t("common.confirm")}
                >
                  <Check size={16} />
                </button>
              </div>
            </div>
          ) : (
            <p className="text-body-md text-on-surface whitespace-pre-wrap">
              {conv.announcement || t("detail.notSet")}
            </p>
          )}
        </div>
      )}

      {/* 我在本群的昵称（群聊，任意成员可编辑本人 alias） */}
      {isGroup && (
        <div className="border-outline-variant border-t px-4 py-3">
          {editingAlias ? (
            <div className="flex items-center gap-2">
              <span className="text-body-md text-on-surface shrink-0">{t("detail.myAlias")}</span>
              <input
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveAlias();
                  if (e.key === "Escape") setEditingAlias(false);
                }}
                maxLength={30}
                placeholder={t("detail.aliasPlaceholder")}
                autoFocus
                aria-label={t("detail.myAlias")}
                className="bg-surface-container-high text-body-md text-on-surface focus:ring-primary/40 min-w-0 flex-1 rounded-lg px-2 py-1 transition-shadow focus:ring-2 focus:outline-none"
              />
              <button
                onClick={saveAlias}
                className="md3-icon-btn text-primary !h-8 !w-8 shrink-0"
                aria-label={t("common.confirm")}
              >
                <Check size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-body-md text-on-surface">{t("detail.myAlias")}</span>
              <button
                onClick={() => {
                  setAliasDraft(myAlias ?? "");
                  setEditingAlias(true);
                }}
                className="text-on-surface-variant hover:text-primary flex items-center gap-1 transition-colors"
                aria-label={t("detail.myAlias")}
              >
                <span className="text-body-sm">{myAlias || t("detail.notSet")}</span>
                <Pencil size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 设置行 */}
      <div className="mt-1">
        <SettingRow
          label={t("detail.mute")}
          checked={conv.isMuted}
          onToggle={() => void applyConversationSetting(conv.id, { isMuted: !conv.isMuted })}
        />
        <SettingRow
          label={t("detail.pinConversation")}
          checked={!!conv.isPinned}
          onToggle={() => void applyConversationSetting(conv.id, { isPinned: !conv.isPinned })}
        />
      </div>

      {/* 危险操作 */}
      <div className="border-outline-variant mt-auto border-t p-2">
        <DangerRow
          icon={<Trash2 size={17} />}
          label={t("detail.clearHistory")}
          onClick={() => setConfirmClear(true)}
        />
        {isGroup && (
          <DangerRow
            icon={<LogOut size={17} />}
            label={isOwner ? t("detail.dissolveGroup") : t("detail.leaveGroup")}
            onClick={() => setConfirmDanger(true)}
          />
        )}
      </div>

      {isGroup && (
        <InviteMembersModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          convId={conv.id}
          existingMemberIds={members.map((m) => m.userId)}
        />
      )}
      <ConfirmDialog
        open={confirmDanger}
        title={isOwner ? t("detail.dissolveGroup") : t("detail.leaveGroup")}
        message={isOwner ? t("detail.dissolveConfirm") : t("detail.leaveConfirm")}
        danger
        onConfirm={handleDanger}
        onCancel={() => setConfirmDanger(false)}
      />
      <ConfirmDialog
        open={confirmClear}
        title={t("detail.clearHistory")}
        message={t("detail.clearHistoryConfirm")}
        danger
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-on-surface-variant hover:bg-surface-container-high hover:text-primary text-label-sm flex h-16 flex-1 flex-col items-center justify-center gap-1 font-medium transition-colors"
    >
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

function DangerRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-error hover:bg-error/10 text-body-md flex h-11 w-full items-center gap-2.5 rounded-lg px-3 font-medium transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}
