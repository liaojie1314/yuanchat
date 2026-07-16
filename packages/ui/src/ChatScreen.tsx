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
 * 未选中会话时聊天区显示空状态引导。
 *
 * @example
 * // apps/web 与 apps/desktop 的 ChatPage 直接渲染
 * <ChatScreen />
 */
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useBreakpoint,
  useChatBootstrap,
  useConversationStore,
  useResizable,
} from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { ChatDetail } from "./ChatDetail";
import { ChatWindow } from "./ChatWindow";
import { ConversationList } from "./ConversationList";
import { ResizeHandle } from "./ResizeHandle";

export function ChatScreen() {
  const { t } = useTranslation();
  const bp = useBreakpoint();
  const activeId = useConversationStore((s) => s.activeId);
  const setActive = useConversationStore((s) => s.setActive);

  // 数据源接线：mock 注入 demo 数据 / 真实模式拉列表 + 建 WS 连接
  useChatBootstrap();

  const [showDetail, setShowDetail] = useState(false);
  const leftPanel = useResizable(300, 240, 380);

  // 切换会话时收起详情，避免面板残留上一个会话的信息
  useEffect(() => {
    setShowDetail(false);
  }, [activeId]);

  // ── 手机端：栈式单屏 ──
  if (bp === "mobile") {
    if (activeId && showDetail) {
      return (
        <div className="bg-surface flex min-h-0 flex-1 flex-col">
          <ChatDetail onClose={() => setShowDetail(false)} />
        </div>
      );
    }
    if (activeId) {
      return (
        <div className="bg-surface flex min-h-0 flex-1 flex-col">
          <ChatWindow
            onBack={() => setActive(null)}
            onShowDetail={() => setShowDetail(true)}
            compactComposer
          />
        </div>
      );
    }
    return (
      <div className="bg-surface flex min-h-0 flex-1 flex-col">
        <ConversationList />
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
        <ConversationList />
      </div>
      {isDesktop && <ResizeHandle {...leftPanel.handleProps} isDragging={leftPanel.isDragging} />}

      {/* 聊天窗口 */}
      <div className="bg-surface min-w-0 flex-1">
        {activeId ? (
          <ChatWindow onShowDetail={() => setShowDetail((v) => !v)} />
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
          <ChatDetail onClose={() => setShowDetail(false)} />
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
            <ChatDetail onClose={() => setShowDetail(false)} />
          </aside>
        </>
      )}
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
