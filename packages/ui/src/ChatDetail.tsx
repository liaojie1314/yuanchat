import { useConversationStore } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { Bell, BellOff, Search, UserPlus } from "lucide-react";

export function ChatDetail() {
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const conv = conversations.find((c) => c.id === activeId);
  if (!conv) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col items-center py-6 border-b border-surface-200 dark:border-slate-700">
        <Avatar name={conv.name} src={conv.avatarUrl} size="lg" online={conv.isOnline} />
        <h3 className="mt-3 text-title-md font-semibold text-slate-800 dark:text-slate-100">{conv.name}</h3>
        <p className="text-body-sm text-slate-400">{conv.type === "group" ? "群聊" : "联系人"}</p>
      </div>
      <div className="flex-1 p-3 space-y-1">
        <button
          onClick={() => updateConversation(conv.id, { isMuted: !conv.isMuted })}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-body-md text-slate-600 dark:text-slate-300
                     hover:bg-surface-100 dark:hover:bg-slate-700 transition-colors"
        >
          {conv.isMuted ? <BellOff size={18} /> : <Bell size={18} />}
          <span>{conv.isMuted ? "取消免打扰" : "消息免打扰"}</span>
        </button>
        <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-body-md text-slate-600 dark:text-slate-300
                           hover:bg-surface-100 dark:hover:bg-slate-700 transition-colors">
          <Search size={18} />
          <span>搜索聊天记录</span>
        </button>
        {conv.type === "group" && (
          <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-body-md text-slate-600 dark:text-slate-300
                             hover:bg-surface-100 dark:hover:bg-slate-700 transition-colors">
            <UserPlus size={18} />
            <span>邀请成员</span>
          </button>
        )}
      </div>
    </div>
  );
}
