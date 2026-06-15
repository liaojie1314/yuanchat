import { ConversationList, ChatWindow, ChatDetail } from "@yuanchat/ui";
import { useConversationStore } from "@yuanchat/shared";

export function ChatPage() {
  const activeConversationId = useConversationStore((s) => s.activeId);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 移动端：会话列表占满，点击后聊天窗口占满 */}
      <div className="w-full sm:w-72 shrink-0 border-r border-neutral-200 dark:border-neutral-800">
        {activeConversationId ? (
          <>
            <div className="flex-1 min-w-0">
              <ChatWindow />
            </div>
          </>
        ) : (
          <ConversationList />
        )}
      </div>
    </div>
  );
}
