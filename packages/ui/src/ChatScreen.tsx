/**
 * ChatScreen 组件 — 聊天主界面（三端响应式）
 *
 * @description
 * 会话列表 + 聊天窗口 + 详情面板的响应式编排，web / desktop 两端共用：
 *
 * - **desktop（≥1180px）**：列表（可拖拽调宽）｜聊天｜详情面板（可开关的第四栏）
 * - **tablet（768–1179px）**：列表｜聊天，详情以右侧抽屉 + 蒙层滑入
 * - **mobile（<768px）**：栈式单屏，列表 ↔ 聊天二选一（返回键切换），
 *   详情全屏覆盖
 *
 * 详情面板内部有 info / members 两态：ChatDetail 头像墙「全部」切到 members
 * （MembersView 全成员列表），返回切回 info。建群与添加好友由顶部「+」下拉触发，
 * 分别挂载 CreateGroupModal / AddContactModal。
 *
 * 未选中会话时聊天区显示空状态引导。
 *
 * @example
 * // apps/web 与 apps/desktop 的 ChatPage 直接渲染
 * <ChatScreen />
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  appointAdmin,
  fetchMembers,
  isMockEnabled,
  kickMember,
  revokeAdmin,
  showToast,
  transferOwner,
  useAuthStore,
  useBreakpoint,
  useConversationStore,
  useResizable,
} from "@yuanchat/shared";
import type { ConversationMember } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { AddContactModal } from "./AddContactModal";
import { ChatDetail } from "./ChatDetail";
import { ChatWindow } from "./ChatWindow";
import { ConversationList } from "./ConversationList";
import { CreateGroupModal } from "./CreateGroupModal";
import { MembersView } from "./MembersView";
import { ResizeHandle } from "./ResizeHandle";
import { UserProfileView } from "./UserProfileView";

/** mock 模式成员全列表回退数据（与 ChatDetail 头像墙一致，覆盖 owner/admin/member 三态） */
const MOCK_MEMBERS: ConversationMember[] = [
  { userId: "m1", nickname: "张伟", avatarUrl: null, role: 2 },
  { userId: "m2", nickname: "李四", avatarUrl: null, role: 1 },
  { userId: "m3", nickname: "王芳", avatarUrl: null, role: 0 },
  { userId: "m4", nickname: "陈曦", avatarUrl: null, role: 0 },
  { userId: "m5", nickname: "我", avatarUrl: null, role: 0 },
];

export function ChatScreen() {
  const { t } = useTranslation();
  const bp = useBreakpoint();
  const activeId = useConversationStore((s) => s.activeId);
  const setActive = useConversationStore((s) => s.setActive);

  const [showDetail, setShowDetail] = useState(false);
  const [detailView, setDetailView] = useState<"info" | "members">("info");
  // 资料页目标用户（点消息头像进入，null 表示未打开）
  const [profileTarget, setProfileTarget] = useState<{
    userId: string;
    name?: string;
    isSelf?: boolean;
  } | null>(null);
  // 进资料页前详情面板是否已打开：决定返回时回到详情还是回到聊天
  const detailWasOpen = useRef(false);
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const leftPanel = useResizable(300, 240, 380);
  const selfId = useAuthStore((s) => s.user?.id ?? "");
  const myRole = members.find((m) => m.userId === selfId)?.role ?? 0;
  // role_changed 帧递增 memberVersion → 成员列表打开时重拉
  const memberVersion = useConversationStore(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.memberVersion ?? 0,
  );

  // 切换会话时收起详情，避免面板残留上一个会话的信息
  useEffect(() => {
    setShowDetail(false);
    setDetailView("info");
  }, [activeId]);

  const refetchMembers = useCallback(() => {
    if (!activeId) return;
    if (isMockEnabled()) {
      setMembers(MOCK_MEMBERS);
      return;
    }
    setMembersLoading(true);
    void fetchMembers(activeId)
      .then((list) => {
        setMembers(list);
      })
      .catch(() => {
        setMembers([]);
      })
      .finally(() => setMembersLoading(false));
  }, [activeId]);

  // 切到成员全列表 / 角色变更帧到达时拉取成员（mock 模式回退静态数组）
  useEffect(() => {
    if (detailView !== "members" || !activeId) return;
    refetchMembers();
  }, [detailView, activeId, memberVersion, refetchMembers]);

  const handleKick = (userId: string) => {
    if (!activeId) return;
    kickMember(activeId, userId)
      .then(refetchMembers)
      .catch(() => showToast("error", t("detail.kickFailed")));
  };

  const handleAppointAdmin = (userId: string) => {
    if (!activeId) return;
    appointAdmin(activeId, userId)
      .then(refetchMembers)
      .catch(() => showToast("error", t("common.opFailed")));
  };

  const handleRevokeAdmin = (userId: string) => {
    if (!activeId) return;
    revokeAdmin(activeId, userId)
      .then(refetchMembers)
      .catch(() => showToast("error", t("common.opFailed")));
  };

  const handleTransferOwner = (userId: string) => {
    if (!activeId) return;
    transferOwner(activeId, userId)
      .then(() => {
        showToast("info", t("group.transferredToast"));
        refetchMembers();
      })
      .catch(() => showToast("error", t("common.opFailed")));
  };

  const modals = (
    <>
      <CreateGroupModal open={groupOpen} onClose={() => setGroupOpen(false)} />
      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );

  /** 点消息头像 → 在详情面板位置打开资料页 */
  const openProfile = useCallback(
    (target: { userId: string; name?: string; isSelf?: boolean }) => {
      detailWasOpen.current = showDetail;
      setProfileTarget(target);
      setShowDetail(true);
    },
    [showDetail],
  );

  /** 详情面板内容：profile（资料页）> members（成员列表）> info（会话详情） */
  const detailPanel = (onClose: () => void) =>
    profileTarget ? (
      <UserProfileView
        userId={profileTarget.userId}
        fallbackName={profileTarget.name}
        isSelf={profileTarget.isSelf}
        onBack={() => {
          setProfileTarget(null);
          // 从消息头像直接进来的（详情面板本来是关着的），返回即回到聊天
          if (!detailWasOpen.current) onClose();
        }}
      />
    ) : detailView === "members" ? (
      <MembersView
        members={members}
        loading={membersLoading}
        myRole={myRole}
        selfId={selfId}
        onKick={handleKick}
        onAppointAdmin={handleAppointAdmin}
        onRevokeAdmin={handleRevokeAdmin}
        onTransferOwner={handleTransferOwner}
        onBack={() => setDetailView("info")}
      />
    ) : (
      <ChatDetail onClose={onClose} onShowAllMembers={() => setDetailView("members")} />
    );

  const list = (
    <ConversationList onNewGroup={() => setGroupOpen(true)} onAddContact={() => setAddOpen(true)} />
  );

  // ── 手机端：栈式单屏 ──
  if (bp === "mobile") {
    if (activeId && showDetail) {
      return (
        <div className="bg-surface flex min-h-0 flex-1 flex-col">
          {detailPanel(() => setShowDetail(false))}
          {modals}
        </div>
      );
    }
    if (activeId) {
      return (
        <div className="bg-surface flex min-h-0 flex-1 flex-col">
          <ChatWindow
            onBack={() => setActive(null)}
            onShowDetail={() => setShowDetail(true)}
            onShowProfile={openProfile}
            compactComposer
          />
          {modals}
        </div>
      );
    }
    return (
      <div className="bg-surface flex min-h-0 flex-1 flex-col">
        {list}
        {modals}
      </div>
    );
  }

  const isDesktop = bp === "desktop";

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* 会话列表：桌面端可拖拽调宽，平板端固定 300px */}
      <div
        style={isDesktop ? { width: leftPanel.width } : undefined}
        className={cn(
          "border-outline-variant bg-surface shrink-0 overflow-hidden border-r",
          !isDesktop && "w-[300px]",
        )}
      >
        {list}
      </div>
      {isDesktop && <ResizeHandle {...leftPanel.handleProps} isDragging={leftPanel.isDragging} />}

      {/* 聊天窗口 */}
      <div className="bg-surface min-w-0 flex-1">
        {activeId ? (
          <ChatWindow onShowDetail={() => setShowDetail((v) => !v)} onShowProfile={openProfile} />
        ) : (
          <EmptyState
            title={t("chat.selectConversation")}
            hint={t("chat.selectConversationHint")}
          />
        )}
      </div>

      {/* 详情：桌面第四栏 / 平板右侧抽屉 */}
      {activeId && showDetail && isDesktop && (
        <aside className="border-outline-variant bg-surface-container-low animate-slide-left w-[280px] shrink-0 overflow-hidden border-l">
          {detailPanel(() => setShowDetail(false))}
        </aside>
      )}
      {activeId && showDetail && !isDesktop && (
        <>
          <div
            className="animate-fade-in absolute inset-0 z-30 bg-black/40"
            onClick={() => setShowDetail(false)}
            aria-hidden
          />
          <aside className="bg-surface-container-low shadow-elevation-4 animate-slide-left absolute top-0 right-0 bottom-0 z-40 w-[320px] overflow-hidden">
            {detailPanel(() => setShowDetail(false))}
          </aside>
        </>
      )}

      {modals}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="bg-surface-container-high text-on-surface-variant mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full">
          <MessageSquare size={40} strokeWidth={1.5} />
        </div>
        <p className="text-body-lg text-on-surface font-medium">{title}</p>
        <p className="text-body-sm text-on-surface-variant mt-1">{hint}</p>
      </div>
    </div>
  );
}
