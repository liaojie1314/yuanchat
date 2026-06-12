import { ConversationList } from "@/components/chat/ConversationList";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatDetail } from "@/components/chat/ChatDetail";
import { useConversationStore } from "@/store/conversationStore";

export function ChatPage() {
  const activeConversationId = useConversationStore((s) => s.activeId);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 会话列表 */}
      <div className="w-72 shrink-0 border-r border-neutral-200 dark:border-neutral-800">
        <ConversationList />
      </div>

      {/* 聊天窗口 */}
      <div className="flex-1 min-w-0">
        {activeConversationId ? (
          <ChatWindow />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-400">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-sm">选择一条会话开始聊天</p>
            </div>
          </div>
        )}
      </div>

      {/* 右侧详情面板 */}
      {activeConversationId && (
        <div className="w-72 shrink-0 border-l border-neutral-200 dark:border-neutral-800">
          <ChatDetail />
        </div>
      )}
    </div>
  );
}
