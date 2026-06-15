import { ConversationList, ChatWindow, ChatDetail } from "@yuanchat/ui";
import { useConversationStore } from "@yuanchat/shared";

export function ChatPage() {
  const activeId = useConversationStore((s) => s.activeId);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 会话列表面板 */}
      <div className="w-72 shrink-0 border-r border-surface-200 dark:border-slate-700">
        <ConversationList />
      </div>

      {/* 聊天主区域 */}
      <div className="flex-1 min-w-0 bg-surface-50 dark:bg-slate-900">
        {activeId ? (
          <ChatWindow />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400">
            <p className="text-body-md">选择一条会话开始聊天</p>
          </div>
        )}
      </div>

      {/* 详情面板 */}
      {activeId && (
        <div className="w-72 shrink-0 border-l border-surface-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <ChatDetail />
        </div>
      )}
    </div>
  );
}
