import { ConversationList, ChatWindow, ResizeHandle } from "@yuanchat/ui";
import { useConversationStore, useResizable } from "@yuanchat/shared";

export function ChatPage() {
  const activeConversationId = useConversationStore((s) => s.activeId);

  const leftPanel = useResizable(260, 200, 360);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 左侧会话列表 — 白色底 + 灰色右边线，暗色模式适配 */}
      <div
        style={{ width: leftPanel.width }}
        className="shrink-0 overflow-hidden border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
      >
        <ConversationList />
      </div>

      <ResizeHandle {...leftPanel.handleProps} isDragging={leftPanel.isDragging} />

      {/* 聊天窗口 — 弹性填充剩余空间，bg-surface 与气泡区分 */}
      <div className="min-w-0 flex-1 bg-surface">
        {activeConversationId ? (
          <ChatWindow />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-surface-container-high">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-on-surface-variant text-body-md">选择一条会话开始聊天</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
