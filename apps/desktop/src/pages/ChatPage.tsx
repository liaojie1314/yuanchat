import { ConversationList, ChatWindow, ChatDetail } from "@yuanchat/ui";
import { useConversationStore } from "@yuanchat/shared";

export function ChatPage() {
  const activeConversationId = useConversationStore((s) => s.activeId);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 会话列表 — 微弱分割线代替 border */}
      <div className="w-72 shrink-0 border-r divider-subtle">
        <ConversationList />
      </div>
      <div className="flex-1 min-w-0">
        {activeConversationId ? (
          <ChatWindow />
        ) : (
          <div className="flex items-center justify-center h-full text-on-surface-variant">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-5 rounded-full bg-primary-container flex items-center justify-center shadow-elevation-1">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-body-lg">选择一条会话开始聊天</p>
            </div>
          </div>
        )}
      </div>
      {activeConversationId && (
        <div className="w-80 shrink-0 border-l divider-subtle">
          <ChatDetail />
        </div>
      )}
    </div>
  );
}
