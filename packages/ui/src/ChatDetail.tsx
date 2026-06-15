/**
 * ChatDetail 组件 — 聊天详情侧边面板
 *
 * @description
 * 位于三栏布局的最右侧，展示当前选中会话的：
 * - 头像和名称（大尺寸展示）
 * - 操作按钮：免打扰切换、搜索聊天记录、邀请成员（群聊专属）
 *
 * 仅在 activeId 非空时渲染（由父组件 ChatPage 控制显示/隐藏）。
 * 菜单项点击后直接操作 Zustand Store 更新状态。
 *
 * @example
 * <ChatDetail />
 */
import { useConversationStore } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { Bell, BellOff, Search, UserPlus } from "lucide-react";

export function ChatDetail() {
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const conv = conversations.find((c) => c.id === activeId);

  // 防御：如果找不到对应会话（数据不一致），不渲染任何内容
  if (!conv) return null;

  return (
    <div className="flex h-full flex-col">
      {/* 标题 */}
      <div className="border-outline-variant flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-title-sm text-on-surface font-medium">详情</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 头像和名称 */}
        <div className="border-outline-variant flex flex-col items-center border-b px-4 py-6">
          <Avatar name={conv.name} src={conv.avatarUrl} size="lg" online={conv.isOnline} />
          <h3 className="text-title-md text-on-surface mt-3 font-semibold">{conv.name}</h3>
          <p className="text-label-sm text-on-surface-variant mt-1">
            {conv.type === "group" ? "群聊" : "联系人"}
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="border-outline-variant space-y-0.5 border-b p-1.5">
          <button
            onClick={() => updateConversation(conv.id, { isMuted: !conv.isMuted })}
            className="hover:bg-surface-container-high text-body-md text-on-surface flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
          >
            {conv.isMuted ? <BellOff size={18} /> : <Bell size={18} />}
            <span>{conv.isMuted ? "取消免打扰" : "消息免打扰"}</span>
          </button>
          <button className="hover:bg-surface-container-high text-body-md text-on-surface flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors">
            <Search size={18} />
            <span>搜索聊天记录</span>
          </button>
          {conv.type === "group" && (
            <button className="hover:bg-surface-container-high text-body-md text-on-surface flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors">
              <UserPlus size={18} />
              <span>邀请成员</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
