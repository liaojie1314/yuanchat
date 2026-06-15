import { Search, Plus } from "lucide-react";
import { useConversationStore } from "@yuanchat/shared";
import type { Conversation } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";

export function ConversationList() {
  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const setActive = useConversationStore((s) => s.setActive);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-800">
      {/* 搜索栏 */}
      <div className="p-3 border-b border-surface-200 dark:border-slate-700">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="搜索会话…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-100 dark:bg-slate-700 text-body-md
                       text-slate-700 dark:text-slate-200 placeholder:text-slate-400
                       focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/30"
          />
        </div>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => setActive(conv.id)}
            className={cn(
              "flex items-center gap-3 w-full px-3 py-3 text-left transition-colors",
              conv.id === activeId
                ? "bg-brand-50 dark:bg-brand-900/30"
                : "hover:bg-surface-50 dark:hover:bg-slate-700/50",
            )}
          >
            <Avatar name={conv.name} src={conv.avatarUrl} online={conv.isOnline} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-body-md font-medium text-slate-800 dark:text-slate-100 truncate">
                  {conv.name}
                </span>
                <span className="text-body-sm text-slate-400 shrink-0 ml-2">
                  {conv.lastTime}
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-body-sm text-slate-500 truncate">
                  {conv.lastMessage || "暂无消息"}
                </span>
                {conv.unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand-500 text-white text-[11px] font-semibold ml-2 shrink-0">
                    {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
