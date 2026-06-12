import { Search, Plus } from "lucide-react";
import { useConversationStore, type Conversation } from "@/store/conversationStore";
import { Avatar } from "@/components/ui/Avatar";
import { clsx } from "clsx";

export function ConversationList() {
  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const setActive = useConversationStore((s) => s.setActive);

  return (
    <div className="flex flex-col h-full">
      {/* 搜索栏 */}
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              placeholder="搜索会话..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-sm
                         placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </div>
          <button className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 transition-colors">
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            isActive={conv.id === activeId}
            onClick={() => setActive(conv.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ConversationItem({
  conv,
  isActive,
  onClick,
}: {
  conv: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-3 w-full px-3 py-3 text-left transition-colors",
        isActive
          ? "bg-primary-50 dark:bg-primary-900/20"
          : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
      )}
    >
      <Avatar name={conv.name} src={conv.avatarUrl} online={conv.isOnline} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
            {conv.name}
          </span>
          <span className="text-xs text-neutral-400 shrink-0 ml-2">
            {conv.lastTime}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs text-neutral-500 truncate">
            {conv.lastMessage || "暂无消息"}
          </span>
          {conv.unreadCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary-500 text-white text-[11px] font-medium ml-2 shrink-0">
              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
