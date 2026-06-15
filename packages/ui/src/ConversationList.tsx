/**
 * ConversationList 组件 — 会话列表
 *
 * @description
 * IM 应用的核心导航组件，位于三栏布局的最左侧。
 * 显示当前用户的所有会话（单聊和群聊混合排列），每条会话展示：
 * - 头像（含在线状态指示）
 * - 会话名称（单聊是对方昵称，群聊是群名）
 * - 最后一条消息的预览文本
 * - 时间标签
 * - 未读消息计数角标（红色圆形，超过99显示 "99+"）
 *
 * 包含顶部搜索栏（搜索功能待实现）和创建新会话按钮。
 * 点击会话条目后，通过 Zustand Store 的 `setActive` 切换到该会话。
 *
 * @example
 * <ConversationList />
 */
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
    <div className="flex flex-col h-full">
      {/* 搜索栏 */}
      <div className="p-3 border-b border-outline-variant">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
            <input
              placeholder="搜索会话..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-surface-container-high text-body-md
                         placeholder:text-on-surface-variant focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
            />
          </div>
          <button className="md3-icon-btn text-on-surface-variant">
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

/**
 * ConversationItem — 单条会话条目
 *
 * @description 内部私有组件，不对外导出。接收会话数据和交互回调。
 * 当前选中项有蓝色高亮背景。
 */
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
      className={cn(
        "flex items-center gap-3 w-full px-3 py-3 text-left transition-colors",
        isActive
          ? "bg-primary-container/30"
          : "hover:bg-surface-container-high",
      )}
    >
      <Avatar name={conv.name} src={conv.avatarUrl} online={conv.isOnline} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-body-lg font-medium text-on-surface truncate">
            {conv.name}
          </span>
          <span className="text-label-sm text-on-surface-variant shrink-0 ml-2">
            {conv.lastTime}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-body-sm text-on-surface-variant truncate">
            {conv.lastMessage || "暂无消息"}
          </span>
          {conv.unreadCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-on text-[11px] font-medium ml-2 shrink-0">
              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
