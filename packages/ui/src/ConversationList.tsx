/**
 * ConversationList 组件 — 会话列表
 *
 * @description
 * IM 应用的核心导航组件，位于三栏布局的左列。功能：
 * - 顶部标题栏（消息 + 新建按钮）
 * - 搜索框：按会话名 / 最后消息实时过滤
 * - 过滤 chips：全部 / 未读 / 群聊 / 单聊 / @我
 * - 置顶分组：置顶会话带左侧主题色竖条，单独分组靠前
 * - 会话条目：头像（presence 状态点）、名称、时间（tabular-nums）、
 *   预览（[草稿]/[@你] 前缀高亮）、未读角标 / 免打扰铃铛
 *
 * 点击会话条目后，通过 Zustand Store 的 `setActive` 切换会话并清零未读。
 *
 * @param hideHeader - 隐藏标题栏（移动端由外层 app bar 承担标题时使用）
 * @param onNewGroup - 顶部「+」下拉「发起群聊」回调（由 ChatScreen 挂 CreateGroupModal）
 * @param onAddContact - 顶部「+」下拉「添加好友」回调（由 ChatScreen 挂 AddContactModal）
 *
 * @example
 * <ConversationList />
 */
import { useMemo, useState } from "react";
import { Search, Plus, BellOff, Pin, Users, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConversationStore } from "@yuanchat/shared";
import type { Conversation } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";

/** 过滤器类别，对应顶部 chips */
type Filter = "all" | "unread" | "group" | "private" | "mentions";

const FILTERS: { key: Filter; labelKey: string }[] = [
  { key: "all", labelKey: "chat.filter.all" },
  { key: "unread", labelKey: "chat.filter.unread" },
  { key: "group", labelKey: "chat.filter.group" },
  { key: "private", labelKey: "chat.filter.private" },
  { key: "mentions", labelKey: "chat.filter.mentions" },
];

function matchFilter(conv: Conversation, filter: Filter): boolean {
  switch (filter) {
    case "unread":
      return conv.unreadCount > 0;
    case "group":
      return conv.type === "group";
    case "private":
      return conv.type === "private";
    case "mentions":
      return !!conv.mentionedMe;
    default:
      return true;
  }
}

export function ConversationList({
  hideHeader = false,
  onNewGroup,
  onAddContact,
}: {
  hideHeader?: boolean;
  onNewGroup?: () => void;
  onAddContact?: () => void;
}) {
  const { t } = useTranslation();
  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const setActive = useConversationStore((s) => s.setActive);
  const clearUnread = useConversationStore((s) => s.clearUnread);
  const loading = useConversationStore((s) => s.loading);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showMenu, setShowMenu] = useState(false);

  const hasUnread = conversations.some((c) => c.unreadCount > 0);

  // 搜索 + 过滤 + 置顶分组，一次 memo 完成
  const { pinned, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = conversations.filter(
      (c) =>
        matchFilter(c, filter) &&
        (!q || c.name.toLowerCase().includes(q) || c.lastMessage?.toLowerCase().includes(q)),
    );
    return {
      pinned: visible.filter((c) => c.isPinned),
      rest: visible.filter((c) => !c.isPinned),
    };
  }, [conversations, query, filter]);

  const handleSelect = (id: string) => {
    setActive(id);
    clearUnread(id);
  };

  return (
    <div className="flex h-full flex-col">
      {!hideHeader && (
        <header className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
          <h1 className="text-title-lg text-on-surface font-semibold">{t("chat.title")}</h1>
          <div className="relative">
            <button
              className="md3-icon-btn text-on-surface-variant"
              aria-label={t("chat.newChat")}
              aria-haspopup="menu"
              aria-expanded={showMenu}
              onClick={() => setShowMenu((v) => !v)}
            >
              <Plus size={20} />
            </button>
            {showMenu && (
              <>
                {/* 点击外部关闭：透明全屏遮罩兜底 */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                  aria-hidden
                />
                <div
                  role="menu"
                  className="bg-surface-container-high shadow-elevation-2 animate-fade-in absolute top-full right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl py-1"
                >
                  <MenuItem
                    icon={<Users size={17} />}
                    label={t("chat.menu.newGroup")}
                    onClick={() => {
                      setShowMenu(false);
                      onNewGroup?.();
                    }}
                  />
                  <MenuItem
                    icon={<UserPlus size={17} />}
                    label={t("chat.menu.addContact")}
                    onClick={() => {
                      setShowMenu(false);
                      onAddContact?.();
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </header>
      )}

      {/* 搜索框 */}
      <div className="shrink-0 px-3 pb-1">
        <div className="relative">
          <Search
            size={16}
            className="text-on-surface-variant absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chat.searchConversation")}
            aria-label={t("common.search")}
            className="bg-surface-container-high text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:ring-primary/40 w-full rounded-md py-2 pr-3 pl-9 transition-shadow focus:ring-2 focus:outline-none"
          />
        </div>
      </div>

      {/* 过滤 chips */}
      <div
        className="scrollbar-none flex shrink-0 gap-2 overflow-x-auto px-3 py-2"
        role="tablist"
        aria-label={t("chat.title")}
      >
        {FILTERS.map(({ key, labelKey }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "text-label-md inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 whitespace-nowrap transition-colors",
              filter === key
                ? "bg-primary-container text-primary-on-container font-medium"
                : "bg-surface-container-high text-on-surface hover:bg-surface-container",
            )}
          >
            {t(labelKey)}
            {key === "unread" && hasUnread && (
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            )}
          </button>
        ))}
      </div>

      {/* 会话列表（置顶分组 + 全部） */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loading && conversations.length === 0 ? (
          <ConversationSkeleton />
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <SectionLabel>{t("chat.section.pinned")}</SectionLabel>
                {pinned.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conv={conv}
                    isActive={conv.id === activeId}
                    onClick={() => handleSelect(conv.id)}
                  />
                ))}
              </>
            )}
            {rest.length > 0 && (
              <>
                {pinned.length > 0 && <SectionLabel>{t("chat.section.all")}</SectionLabel>}
                {rest.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conv={conv}
                    isActive={conv.id === activeId}
                    onClick={() => handleSelect(conv.id)}
                  />
                ))}
              </>
            )}
            {pinned.length === 0 && rest.length === 0 && (
              <p className="text-body-md text-on-surface-variant px-4 py-8 text-center">
                {t("chat.searchEmpty")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-label-md text-on-surface-variant px-2 pt-3 pb-1.5 font-medium">
      {children}
    </div>
  );
}

/** 新建下拉菜单项 */
function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="text-body-md text-on-surface hover:bg-surface-container flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
    >
      <span className="text-on-surface-variant shrink-0">{icon}</span>
      {label}
    </button>
  );
}

/** 会话列表加载骨架：6 行 pulse 占位，行高与真实条目一致（防 CLS） */
function ConversationSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-3 py-2.5">
          <span className="bg-surface-container-high h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <span className="bg-surface-container-high block h-3.5 w-28 rounded-full" />
            <span className="bg-surface-container-high mt-2 block h-3 w-40 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * ConversationItem — 单条会话条目
 *
 * @description 内部私有组件，不对外导出。
 * 置顶会话左侧显示 3px 主题色竖条；当前选中项 primary-container 高亮；
 * 未读会话名称加粗，角标 99+ 截断；免打扰会话未读角标降级为灰色。
 */
function ConversationItem({
  conv,
  isActive,
  onClick,
}: {
  conv: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const hasDraft = !!conv.draft;

  return (
    <button
      onClick={onClick}
      aria-current={isActive || undefined}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
        isActive
          ? "bg-primary-container"
          : "hover:bg-surface-container-high active:bg-surface-container",
      )}
    >
      {/* 置顶标记：左侧主题色短竖条 */}
      {conv.isPinned && (
        <span className="bg-primary absolute top-1/2 left-0.5 h-5 w-[3px] -translate-y-1/2 rounded-full" />
      )}

      <Avatar
        name={conv.name}
        src={conv.avatarUrl}
        presence={conv.presence}
        online={conv.presence ? undefined : conv.isOnline}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "text-body-lg text-on-surface truncate",
              conv.unreadCount > 0 ? "font-bold" : "font-medium",
            )}
          >
            {conv.name}
          </span>
          <span className="text-label-sm text-on-surface-variant shrink-0 tabular-nums">
            {conv.lastTime}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-body-sm text-on-surface-variant truncate">
            {hasDraft ? (
              <>
                <span className="text-error font-medium">{t("chat.preview.draft")} </span>
                {conv.draft}
              </>
            ) : (
              <>
                {conv.mentionedMe && (
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {t("chat.preview.mentionYou")}{" "}
                  </span>
                )}
                {conv.lastMessage || t("chat.preview.empty")}
              </>
            )}
          </span>
          {conv.unreadCount > 0 ? (
            <span
              className={cn(
                "text-label-sm inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 font-bold text-white",
                conv.isMuted ? "bg-outline" : "bg-red-500",
              )}
            >
              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
            </span>
          ) : conv.isMuted ? (
            <BellOff size={14} className="text-on-surface-variant/60 shrink-0" />
          ) : conv.isPinned ? (
            <Pin size={12} className="text-on-surface-variant/40 shrink-0" />
          ) : null}
        </div>
      </div>
    </button>
  );
}
