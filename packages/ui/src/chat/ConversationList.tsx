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
 * @param onScanQr - 顶部「+」下拉「扫一扫」回调；只有具备原生扫码能力的端会传，
 *   不传则该菜单项不渲染（组件自身不做端判定）
 *
 * @example
 * <ConversationList />
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Bell, BellOff, Pin, PinOff, Users, UserPlus, ScanLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { applyConversationSetting, useConversationStore } from "@yuanchat/shared";
import type { Conversation } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "../primitives/Avatar";
import { useLongPress } from "../util/useLongPress";
import type { UseLongPressResult } from "../util/useLongPress";

/** 列表滚动位移超过该像素才关闭快捷菜单，容忍「零位移」滚动事件与真机抖动 */
const SCROLL_CLOSE_DELTA = 8;

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
      return !!conv.mentionUnread || !!conv.mentionedMe;
    default:
      return true;
  }
}

/** 会话快捷菜单状态：目标会话 + 呼出点坐标（右键落点或长按触点） */
type ContextMenuState = {
  conv: Conversation;
  x: number;
  y: number;
};

/** 快捷菜单外框尺寸（两项 + 上下内边距），仅用于贴边时收敛位置 */
const CONTEXT_MENU_SIZE = { width: 144, height: 88 };

/**
 * 把呼出点收敛进视口，避免菜单在屏幕右侧 / 底部被裁掉。
 *
 * @param x - 呼出点横坐标（视口坐标系）
 * @param y - 呼出点纵坐标（视口坐标系）
 * @returns 可直接用作 fixed 定位的 left / top 像素值
 */
function menuPosition(x: number, y: number): { left: number; top: number } {
  const maxLeft = Math.max(8, window.innerWidth - CONTEXT_MENU_SIZE.width - 8);
  const maxTop = Math.max(8, window.innerHeight - CONTEXT_MENU_SIZE.height - 8);
  return { left: Math.min(x, maxLeft), top: Math.min(y, maxTop) };
}

export function ConversationList({
  hideHeader = false,
  onNewGroup,
  onAddContact,
  onScanQr,
}: {
  hideHeader?: boolean;
  onNewGroup?: () => void;
  onAddContact?: () => void;
  onScanQr?: () => void;
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
  // 会话快捷菜单的状态提到列表层：菜单全列表只有一个（再次呼出即替换），
  // 位置按呼出坐标 fixed 定位。原来每个条目各自持有开关，
  // 于是能同时挂出多个菜单，且只会贴在条目自身右上角，与右键位置无关。
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // 按住的是哪一条：条目在 touchstart 时登记，长按达成时据此开菜单
  const pressedConv = useRef<Conversation | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // 开菜单瞬间列表的滚动位置，用于判断后续滚动是否真的把条目带走了
  const scrollTopAtOpen = useRef(0);
  /**
   * 在呼出点开会话菜单。
   * 必须声明在 useLongPress 之前：长按回调要引用它，
   * 放在后面就是「先访问后声明」，回调拿的还是旧闭包
   */
  const openContextMenu = (conv: Conversation, x: number, y: number) => {
    scrollTopAtOpen.current = scrollerRef.current?.scrollTop ?? 0;
    setContextMenu({ conv, x, y });
  };

  // 长按手势放在列表层：位移容差 + 抬手后的合成事件豁免详见 useLongPress。
  // 同一时刻只可能按住一个条目，refs 共享无冲突，且关闭监听正好要读同一份手势状态
  const { handlers: longPressHandlers, isTouchEcho } = useLongPress((x, y) => {
    const conv = pressedConv.current;
    if (conv) openContextMenu(conv, x, y);
  });

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
      pinned: visible
        .filter((c) => c.isPinned)
        // 置顶组内按 pinned_at 倒序；rest 保持 store 序（最新消息在前）。
        // 必须按时间戳数值比较：乐观更新写的是 toISOString()（Z 格式），
        // 服务端回的是 +08:00 偏移格式，同一时刻的两种写法字典序并不等价。
        // 无效/缺失时间（NaN）统一排到有效值之后，两个都无效则视为相等。
        .sort((a, b) => {
          const ta = Date.parse(a.pinnedAt ?? "");
          const tb = Date.parse(b.pinnedAt ?? "");
          if (isNaN(ta) && isNaN(tb)) return 0;
          if (isNaN(ta)) return 1;
          if (isNaN(tb)) return -1;
          return tb - ta;
        }),
      rest: visible.filter((c) => !c.isPinned),
    };
  }, [conversations, query, filter]);

  const handleSelect = (id: string) => {
    setActive(id);
    clearUnread(id);
  };

  /** 条目按下时登记长按目标 */
  const markPressed = (conv: Conversation) => {
    pressedConv.current = conv;
  };

  // 点菜单之外的任意处关闭；菜单自身用 stopPropagation 挡住这层监听。
  // 唯一例外是长按余波：抬手时浏览器会在长按目标上补发一整套合成鼠标事件
  // （mousedown → mouseup → click），无差别关闭会让菜单在弹出的同一帧被自己的
  // 合成 mousedown 秒关（真机上一闪而过），判定见 useLongPress。桌面右键没有余波，
  // 右键后左键点同一条目仍照常关闭菜单并切换会话。
  // 菜单是 fixed 定位在呼出点上的，页面滚动 / 窗口尺寸变化后位置就失真了，一并关掉。
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeUnlessEcho = () => {
      if (isTouchEcho()) return;
      setContextMenu(null);
    };
    // 滚动只在列表真的滚走后才关：浏览器会在右键/长按落点上补发一次位移为零的
    // scroll（菜单弹出的同一毫秒就到），真机上手指的细微移动也会让列表抖动一两像素
    const closeIfScrolledAway = () => {
      const top = scrollerRef.current?.scrollTop;
      if (top === undefined || Math.abs(top - scrollTopAtOpen.current) > SCROLL_CLOSE_DELTA) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", closeUnlessEcho);
    document.addEventListener("touchstart", closeUnlessEcho);
    document.addEventListener("scroll", closeIfScrolledAway, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", closeUnlessEcho);
      document.removeEventListener("touchstart", closeUnlessEcho);
      document.removeEventListener("scroll", closeIfScrolledAway, true);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu, isTouchEcho]);

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
                  className="bg-surface-container-high shadow-elevation-2 animate-fade-in absolute top-full right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg p-1"
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
                  {onScanQr && (
                    <MenuItem
                      icon={<ScanLine size={17} />}
                      label={t("auth.scanQrCode")}
                      onClick={() => {
                        setShowMenu(false);
                        onScanQr();
                      }}
                    />
                  )}
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
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-2 pb-3">
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
                    onOpenMenu={openContextMenu}
                    longPress={longPressHandlers}
                    onPressStart={markPressed}
                    isTouchEcho={isTouchEcho}
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
                    onOpenMenu={openContextMenu}
                    longPress={longPressHandlers}
                    onPressStart={markPressed}
                    isTouchEcho={isTouchEcho}
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

      {/* 会话快捷菜单：整个列表共用一个，落点即呼出点 */}
      {contextMenu && (
        <div
          role="menu"
          style={menuPosition(contextMenu.x, contextMenu.y)}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="bg-surface-container-high shadow-elevation-2 animate-fade-in fixed z-40 w-36 overflow-hidden rounded-lg py-1"
        >
          <MenuItem
            icon={contextMenu.conv.isPinned ? <PinOff size={17} /> : <Pin size={17} />}
            label={t(contextMenu.conv.isPinned ? "chat.menu.unpin" : "chat.menu.pin")}
            onClick={() => {
              const { id, isPinned } = contextMenu.conv;
              setContextMenu(null);
              void applyConversationSetting(id, { isPinned: !isPinned });
            }}
          />
          <MenuItem
            icon={contextMenu.conv.isMuted ? <Bell size={17} /> : <BellOff size={17} />}
            label={t(contextMenu.conv.isMuted ? "chat.menu.unmute" : "chat.menu.mute")}
            onClick={() => {
              const { id, isMuted } = contextMenu.conv;
              setContextMenu(null);
              void applyConversationSetting(id, { isMuted: !isMuted });
            }}
          />
        </div>
      )}
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
      className="text-body-md text-on-surface hover:bg-surface-container-highest flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors"
    >
      <span className="text-on-surface-variant shrink-0">{icon}</span>
      {/* 文案单独包一层：旧 WebView 的 gap 兜底靠相邻兄弟选择器，
          裸文本节点是匿名 flex item，`* + *` 命中不到，图标与文字会紧贴 */}
      <span className="truncate">{label}</span>
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
 * 右键（桌面）/ 长按 500ms（触屏）呼出置顶、免打扰快捷菜单。
 */
function ConversationItem({
  conv,
  isActive,
  onClick,
  onOpenMenu,
  longPress,
  onPressStart,
  isTouchEcho,
}: {
  conv: Conversation;
  isActive: boolean;
  onClick: () => void;
  onOpenMenu: (conv: Conversation, x: number, y: number) => void;
  longPress: UseLongPressResult["handlers"];
  onPressStart: (conv: Conversation) => void;
  isTouchEcho: UseLongPressResult["isTouchEcho"];
}) {
  const { t } = useTranslation();
  const hasDraft = !!conv.draft;

  const handleClick = () => {
    // 条目本身可点，长按抬手后浏览器补发的那次合成 click 必须吞掉，
    // 否则开菜单的同时会误切会话（MessageBubble 的长按目标没有 onClick，不涉及）
    if (isTouchEcho()) return;
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu(conv, e.clientX, e.clientY);
      }}
      onTouchStart={(e) => {
        // 手势状态在列表层共享，按下时先登记按的是哪一条
        onPressStart(conv);
        longPress.onTouchStart(e);
      }}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
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
                {(conv.mentionedMe || conv.mentionUnread) && (
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
