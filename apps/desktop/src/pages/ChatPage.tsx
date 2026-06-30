import { ConversationList, ChatWindow, ResizeHandle } from "@yuanchat/ui";
import { useConversationStore, useResizable } from "@yuanchat/shared";
import { MessageSquare } from "lucide-react";

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
                <MessageSquare size={40} strokeWidth={1.5} />
              </div>
              <p className="text-on-surface-variant text-body-md">选择一条会话开始聊天</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
