/**
 * ContactsPanel 组件 — 通讯录左侧面板
 *
 * @description
 * 通讯录页的列表面板（desktop 双栏左列 / mobile 全屏首屏）：
 * - 顶部标题 + [+] 添加联系人
 * - 搜索框：按昵称/元聊号实时过滤本地好友
 * - 功能入口「新的朋友」（带待处理角标）
 * - 字母分组好友列表 + 右侧字母索引条（≥5 人启用快跳）
 */
import { useMemo, useRef, useState } from "react";
import { Ban, Search, UserPlus, UserRoundPlus, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useContactStore, usePresenceStore, groupFriends } from "@yuanchat/shared";
import type { Friend } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "../primitives/Avatar";

/** 字母索引启用阈值：好友数达到该值才显示快跳条 */
const INDEX_BAR_MIN_FRIENDS = 5;

interface ContactsPanelProps {
  /** 当前选中的好友 ID（desktop 高亮用） */
  selectedId: string | null;
  /** 点击好友 */
  onSelectFriend: (friend: Friend) => void;
  /** 点击"新的朋友" */
  onOpenRequests: () => void;
  /** 点击"黑名单" */
  onOpenBlocklist: () => void;
  /** 点击 [+] 添加联系人 */
  onOpenAdd: () => void;
  /** "新的朋友"入口是否处于选中态 */
  requestsActive?: boolean;
  /** "黑名单"入口是否处于选中态 */
  blocklistActive?: boolean;
}

export function ContactsPanel({
  selectedId,
  onSelectFriend,
  onOpenRequests,
  onOpenBlocklist,
  onOpenAdd,
  requestsActive = false,
  blocklistActive = false,
}: ContactsPanelProps) {
  const { t } = useTranslation();
  const friends = useContactStore((s) => s.friends);
  const requests = useContactStore((s) => s.requests);
  const onlineIds = usePresenceStore((s) => s.onlineIds);
  const pendingCount = useMemo(
    () => requests.filter((r) => r.direction === "in" && r.status === 0).length,
    [requests],
  );

  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const searching = query.trim().length > 0;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q
      ? friends.filter((f) => f.nickname.toLowerCase().includes(q) || String(f.shortId).includes(q))
      : friends;
    return groupFriends(visible);
  }, [friends, query]);

  const jumpTo = (letter: string) => {
    const el = groupRefs.current[letter];
    if (el && listRef.current) {
      listRef.current.scrollTo({ top: el.offsetTop - listRef.current.offsetTop });
    }
  };

  // 索引条是否显示：列表右内边距要据此让位，否则字母压在昵称上
  const showIndexBar = !searching && friends.length >= INDEX_BAR_MIN_FRIENDS && groups.length > 1;

  return (
    <div className="flex h-full flex-col">
      {/* 顶部栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
        <h1 className="text-title-lg text-on-surface font-semibold">{t("contacts.title")}</h1>
        <button
          className="md3-icon-btn text-on-surface-variant"
          aria-label={t("contacts.add")}
          onClick={onOpenAdd}
        >
          <UserRoundPlus size={20} />
        </button>
      </header>

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
            placeholder={t("contacts.search")}
            aria-label={t("common.search")}
            className="bg-surface-container-high text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:ring-primary/40 w-full rounded-md py-2 pr-3 pl-9 transition-shadow focus:ring-2 focus:outline-none"
          />
        </div>
      </div>

      {/* 功能入口：新的朋友 + 黑名单（搜索时隐藏） */}
      {!searching && (
        <div className="shrink-0 px-2 py-2">
          <button
            onClick={onOpenRequests}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
              requestsActive ? "bg-primary-container/60" : "hover:bg-surface-container",
            )}
          >
            <span className="bg-primary/90 flex h-10 w-10 items-center justify-center rounded-lg text-white">
              <UserPlus size={20} />
            </span>
            <span className="text-body-lg text-on-surface flex-1 font-semibold">
              {t("contacts.newFriend")}
            </span>
            {pendingCount > 0 && (
              <span
                className="bg-primary text-primary-on text-label-md flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-medium"
                aria-label={t("contacts.pendingBadge", { count: pendingCount })}
              >
                {pendingCount}
              </span>
            )}
            <ChevronRight size={16} className="text-on-surface-variant" />
          </button>
          <button
            onClick={onOpenBlocklist}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
              blocklistActive ? "bg-primary-container/60" : "hover:bg-surface-container",
            )}
          >
            <span className="bg-surface-container-high text-on-surface-variant flex h-10 w-10 items-center justify-center rounded-lg">
              <Ban size={20} />
            </span>
            <span className="text-body-lg text-on-surface flex-1 font-semibold">
              {t("contacts.blocked")}
            </span>
            <ChevronRight size={16} className="text-on-surface-variant" />
          </button>
        </div>
      )}

      {/* 字母分组列表 + 索引条 */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          className={cn("h-full overflow-y-auto px-2 pb-3", showIndexBar && "pr-10")}
        >
          {groups.length === 0 && (
            <p className="text-body-md text-on-surface-variant px-4 py-8 text-center">
              {searching ? t("contacts.searchEmpty") : t("contacts.empty")}
            </p>
          )}
          {groups.map((group) => (
            <div
              key={group.letter}
              ref={(el) => {
                groupRefs.current[group.letter] = el;
              }}
            >
              <div className="text-label-md text-on-surface-variant px-2 pt-3 pb-1.5 font-medium">
                {group.letter}
              </div>
              {group.friends.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onSelectFriend(f)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                    f.id === selectedId ? "bg-primary-container/60" : "hover:bg-surface-container",
                  )}
                >
                  <Avatar
                    name={f.nickname}
                    src={f.avatarUrl}
                    size="md"
                    online={onlineIds.includes(f.id)}
                  />
                  <span className="text-body-lg text-on-surface min-w-0 flex-1 truncate">
                    {f.nickname}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* 字母索引条：裸字母贴在面板分隔线上会被当成漏出的乱码，
            收进半透明胶囊内并给足点击区，才像一个可操作控件 */}
        {showIndexBar && (
          <nav
            className="border-outline-variant/60 bg-surface-container-high/90 absolute top-1/2 right-1.5 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 shadow-sm select-none"
            aria-label={t("contacts.indexBar")}
          >
            {groups.map((g) => (
              <button
                key={g.letter}
                onClick={() => jumpTo(g.letter)}
                className="text-label-sm text-on-surface-variant hover:bg-primary/10 hover:text-primary flex h-5 w-5 items-center justify-center rounded-full font-medium transition-colors"
              >
                {g.letter}
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
