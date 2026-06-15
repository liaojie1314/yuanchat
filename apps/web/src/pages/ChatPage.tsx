import { ConversationList, ChatWindow, ChatDetail } from "@yuanchat/ui";
import { useConversationStore } from "@yuanchat/shared";

export function ChatPage() {
  const activeConversationId = useConversationStore((s) => s.activeId);

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-72 shrink-0 border-r border-outline-variant bg-surface-container-low">
        <ConversationList />
      </div>
      <div className="flex-1 min-w-0">
        {activeConversationId ? (
          <ChatWindow />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-surface-container-high flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-body-md text-on-surface-variant">选择一条会话开始聊天</p>
            </div>
          </div>
        )}
      </div>
      {activeConversationId && (
        <div className="w-72 shrink-0 border-l border-outline-variant bg-surface-container-low">
          <ChatDetail />
        </div>
      )}
    </div>
  );
}
