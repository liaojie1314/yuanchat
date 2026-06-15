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
    <div className="flex h-full flex-col">
      {/* 搜索栏 */}
      <div className="border-outline-variant border-b p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="text-on-surface-variant absolute top-1/2 left-3 -translate-y-1/2"
            />
            <input
              placeholder="搜索会话..."
              className="bg-surface-container-high text-body-md placeholder:text-on-surface-variant w-full rounded-xl py-2.5 pr-3 pl-9 focus:outline-none"
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
        "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors",
        isActive ? "bg-primary-container/30" : "hover:bg-surface-container-high",
      )}
    >
      <Avatar name={conv.name} src={conv.avatarUrl} online={conv.isOnline} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-body-lg text-on-surface truncate font-medium">{conv.name}</span>
          <span className="text-label-sm text-on-surface-variant ml-2 shrink-0">
            {conv.lastTime}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between">
          <span className="text-body-sm text-on-surface-variant truncate">
            {conv.lastMessage || "暂无消息"}
          </span>
          {conv.unreadCount > 0 && (
            <span className="bg-primary text-primary-on ml-2 inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-medium">
              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
