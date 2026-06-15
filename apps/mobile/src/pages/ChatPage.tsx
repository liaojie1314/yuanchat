/**
 * ChatPage — 三栏聊天布局（绚丽版）
 */
import { ConversationList, ChatWindow, ChatDetail } from "@yuanchat/ui";
import { useConversationStore } from "@yuanchat/shared";
import { MessageCircle, Sparkles, Zap } from "lucide-react";

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full relative overflow-hidden">
      {/* 装饰光斑 */}
      <div className="absolute top-1/3 left-1/3 w-64 h-64 rounded-full blur-3xl opacity-20"
        style={{ background: "rgb(var(--md-sys-color-primary))", animation: "float 5s ease-in-out infinite" }} />
      <div className="absolute bottom-1/3 right-1/3 w-48 h-48 rounded-full blur-3xl opacity-15"
        style={{ background: "rgb(var(--md-sys-color-tertiary))", animation: "float 7s ease-in-out infinite 1s" }} />

      <div className="relative text-center animate-msg-in">
        {/* 悬浮大图标 — 光环旋转 */}
        <div className="mb-6 flex justify-center">
          <div className="relative">
            <div className="avatar-glow-ring">
              <div className="relative z-10 inline-flex items-center justify-center w-28 h-28 rounded-3xl bg-primary text-primary-on shadow-elevation-4">
                <Sparkles size={48} />
              </div>
            </div>
          </div>
        </div>

        <h2 className="text-headline-sm font-bold text-on-surface mb-3">
          欢迎使用元聊
        </h2>
        <p className="text-body-md text-on-surface-variant max-w-xs mx-auto leading-relaxed">
          选择左侧会话开始聊天，或点击
          <span className="inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-full bg-primary-container text-primary-on-container text-label-md font-medium">
            <Zap size={14} /> 新建
          </span>
          开启新的对话
        </p>
      </div>
    </div>
  );
}

export function ChatPage() {
  const activeConversationId = useConversationStore((s) => s.activeId);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 会话列表 — 玻璃态侧边栏 */}
      <div className="w-72 shrink-0 border-r border-outline-variant/30 glass">
        <ConversationList />
      </div>

      {/* 主区域 */}
      <div className="flex-1 min-w-0 bg-surface/50">
        {activeConversationId ? <ChatWindow /> : <EmptyState />}
      </div>

      {/* 详情面板 */}
      {activeConversationId && (
        <div className="w-72 shrink-0 border-l border-outline-variant/30 glass">
          <ChatDetail />
        </div>
      )}
    </div>
  );
}
