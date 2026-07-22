/**
 * ContactsScreen 组件 — 通讯录主界面（三端响应式）
 *
 * @description
 * 面板 + 内容区的响应式编排（对应 docs/design/03_CONTACTS_PAGE.md）：
 *
 * - **desktop / tablet（≥768px）**：双栏，左面板（desktop 可拖拽调宽）｜内容区
 *   （空状态 / 好友资料 / 新的朋友）
 * - **mobile（<768px）**：栈式单屏，面板 ↔ 内容 push/pop
 *
 * 「发消息」与「同意申请」都携带 conversationId 跳转 /chat 并激活该会话
 * （好友必有会话：accept 事务里原子创建）。
 */
import { useEffect, useState } from "react";
import { UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  isMockEnabled,
  useBreakpoint,
  useContactStore,
  useConversationStore,
  useResizable,
} from "@yuanchat/shared";
import type { Friend } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { AddContactModal } from "./AddContactModal";
import { BlocklistView } from "./BlocklistView";
import { ContactDetail } from "./ContactDetail";
import { ContactsPanel } from "./ContactsPanel";
import { NewFriendsView } from "./NewFriendsView";
import { ResizeHandle } from "./ResizeHandle";

/** 内容区视图：空 / 好友资料 / 新的朋友 / 黑名单 */
type ContentView =
  | { kind: "empty" }
  | { kind: "friend"; friend: Friend }
  | { kind: "requests" }
  | { kind: "blocklist" };

export function ContactsScreen() {
  const { t } = useTranslation();
  const bp = useBreakpoint();
  const navigate = useNavigate();
  const loadFriends = useContactStore((s) => s.loadFriends);
  const loadRequests = useContactStore((s) => s.loadRequests);
  const setActive = useConversationStore((s) => s.setActive);

  const [view, setView] = useState<ContentView>({ kind: "empty" });
  const [addOpen, setAddOpen] = useState(false);
  const leftPanel = useResizable(300, 240, 380);

  // 进入通讯录拉好友 + 申请列表（直接刷新进本页时 ChatScreen 的
  // bootstrap 未挂载，须自行拉取；mock 模式数据已由 bootstrap 注入）
  useEffect(() => {
    if (!isMockEnabled()) {
      void loadFriends();
      void loadRequests();
    }
  }, [loadFriends, loadRequests]);

  /** 跳转聊天页并激活会话 */
  const goChat = (conversationId: string) => {
    setActive(conversationId);
    navigate("/chat");
  };

  const panel = (
    <ContactsPanel
      selectedId={view.kind === "friend" ? view.friend.id : null}
      requestsActive={view.kind === "requests"}
      blocklistActive={view.kind === "blocklist"}
      onSelectFriend={(friend) => setView({ kind: "friend", friend })}
      onOpenRequests={() => setView({ kind: "requests" })}
      onOpenBlocklist={() => setView({ kind: "blocklist" })}
      onOpenAdd={() => setAddOpen(true)}
    />
  );

  const content = (showBack: boolean) =>
    view.kind === "friend" ? (
      <ContactDetail
        friend={view.friend}
        onMessage={goChat}
        onDeleted={() => setView({ kind: "empty" })}
        onBack={showBack ? () => setView({ kind: "empty" }) : undefined}
      />
    ) : view.kind === "requests" ? (
      <NewFriendsView
        onAccepted={goChat}
        onBack={showBack ? () => setView({ kind: "empty" }) : undefined}
      />
    ) : view.kind === "blocklist" ? (
      <BlocklistView onBack={showBack ? () => setView({ kind: "empty" }) : undefined} />
    ) : null;

  // ── 手机端：栈式单屏 ──
  if (bp === "mobile") {
    return (
      <div className="bg-surface flex min-h-0 flex-1 flex-col">
        {view.kind === "empty" ? panel : content(true)}
        <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
      </div>
    );
  }

  const isDesktop = bp === "desktop";

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* 面板：桌面端可拖拽调宽，平板端固定 300px */}
      <div
        style={isDesktop ? { width: leftPanel.width } : undefined}
        className={cn(
          "border-outline-variant bg-surface shrink-0 overflow-hidden border-r",
          !isDesktop && "w-[300px]",
        )}
      >
        {panel}
      </div>
      {isDesktop && <ResizeHandle {...leftPanel.handleProps} isDragging={leftPanel.isDragging} />}

      {/* 内容区 */}
      <div className="bg-surface min-w-0 flex-1">
        {view.kind === "empty" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <span className="bg-surface-container-high text-on-surface-variant flex h-16 w-16 items-center justify-center rounded-2xl">
              <UsersRound size={28} />
            </span>
            <p className="text-body-lg text-on-surface-variant">{t("contacts.selectHint")}</p>
          </div>
        ) : (
          content(false)
        )}
      </div>

      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
