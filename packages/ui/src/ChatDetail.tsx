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
      {/* 标题 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          详情
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 头像和名称 */}
        <div className="flex flex-col items-center py-6 px-4 border-b border-neutral-200 dark:border-neutral-800">
          <Avatar name={conv.name} src={conv.avatarUrl} size="lg" online={conv.isOnline} />
          <h3 className="mt-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {conv.name}
          </h3>
          <p className="text-xs text-neutral-400 mt-1">
            {conv.type === "group" ? "群聊" : "联系人"}
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="p-4 space-y-3 border-b border-neutral-200 dark:border-neutral-800">
          <button
            onClick={() => updateConversation(conv.id, { isMuted: !conv.isMuted })}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm transition-colors"
          >
            {conv.isMuted ? <BellOff size={18} /> : <Bell size={18} />}
            <span>{conv.isMuted ? "取消免打扰" : "消息免打扰"}</span>
          </button>
          <button className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm transition-colors">
            <Search size={18} />
            <span>搜索聊天记录</span>
          </button>
          {conv.type === "group" && (
            <button className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm transition-colors">
              <UserPlus size={18} />
              <span>邀请成员</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
