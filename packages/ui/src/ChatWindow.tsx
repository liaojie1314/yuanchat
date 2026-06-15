/**
 * ChatWindow 组件 — 聊天消息窗口
 *
 * @description
 * IM 应用最主要的交互界面，位于三栏布局的中间。
 * 由三个区域组成：
 * 1. **顶部标题栏**：显示对方/群聊名称和在线状态
 * 2. **消息列表**：滚动显示历史消息，
 *    - 自己发送的消息靠右（蓝色气泡，msg-bubble-sent）
 *    - 对方的消息靠左（白色/深色气泡，msg-bubble-received）
 * 3. **底部输入区**：工具栏按钮（图片/文件/表情）+ 文本输入框 + 发送按钮
 *
 * 气泡样式由 `@yuanchat/design-system` 的 `.msg-bubble-sent` 和
 * `.msg-bubble-received` CSS 类定义。
 *
 * @example
 * <ChatWindow />
 */
import { Send, Paperclip, Image, Smile } from "lucide-react";
import { useConversationStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";

/** 开发阶段使用的模拟消息数据，后续替换为 API 获取 */
const DEMO_MESSAGES = [
  { id: "1", senderId: "user1", text: "你好，明天的会议准备得怎么样了？", time: "14:15", isSelf: false },
  { id: "2", senderId: "me", text: "已经准备差不多了，PPT 还在完善", time: "14:18", isSelf: true },
  { id: "3", senderId: "user1", text: "好的，下班前发给我看一下", time: "14:20", isSelf: false },
  { id: "4", senderId: "me", text: "没问题 👍", time: "14:22", isSelf: true },
  { id: "5", senderId: "user1", text: "对了，新版本的设计稿你看了吗？我觉得侧边栏的颜色可以再调整一下", time: "14:32", isSelf: false },
];

export function ChatWindow() {
  // 从 Zustand Store 中读取当前活跃会话 ID 和会话列表
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  // 根据 activeId 找到对应的会话对象
  const conv = conversations.find((c) => c.id === activeId);

  // 防御：如果没找到会话（activeId 无效或为 null），不渲染
  if (!conv) return null;

  return (
    <div className="flex flex-col h-full">
      {/* 顶部标题栏 — 品牌渐变 */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant brand-gradient-soft">
        <Avatar name={conv.name} src={conv.avatarUrl} online={conv.isOnline} />
        <div>
          <h2 className="text-title-md font-semibold text-on-surface">
            {conv.name}
          </h2>
          <p className="text-label-sm text-on-surface-variant">
            {conv.type === "group" ? "群聊" : conv.isOnline ? "在线" : "离线"}
          </p>
        </div>
      </header>

      {/* 消息列表 — 微渐变背景 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 surface-gradient">
        {DEMO_MESSAGES.map((msg, i) => {
          // TODO: 根据与上一条消息的时间差判断是否显示时间分隔
          // 当前简化处理：仅第一条消息显示时间
          const showTime = i === 0;

          return (
            <div key={msg.id}>
              {showTime && (
                <div className="text-center mb-4">
                  <span className="inline-block px-3 py-1 rounded-full bg-surface-container-high text-label-sm text-on-surface-variant">
                    {msg.time}
                  </span>
                </div>
              )}
              <div
                className={cn(
                  "flex gap-3",
                  msg.isSelf ? "flex-row-reverse" : "flex-row",
                )}
              >
                {!msg.isSelf && (
                  <Avatar name={conv.name} src={conv.avatarUrl} size="sm" />
                )}
                <div
                  className={cn(
                    msg.isSelf ? "msg-bubble-sent" : "msg-bubble-received",
                  )}
                >
                  {msg.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部输入区 */}
      <div className="px-4 py-3 border-t border-outline-variant bg-surface">
        <div className="flex items-center gap-1 mb-2">
          <button className="md3-icon-btn text-on-surface-variant">
            <Image size={18} />
          </button>
          <button className="md3-icon-btn text-on-surface-variant">
            <Paperclip size={18} />
          </button>
          <button className="md3-icon-btn text-on-surface-variant">
            <Smile size={18} />
          </button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            rows={3}
            placeholder="输入消息..."
            className="flex-1 resize-none rounded-xl bg-surface-container-high px-4 py-2.5 text-body-md
                       placeholder:text-on-surface-variant focus:outline-none"
          />
          <button className="shrink-0 p-2.5 rounded-xl bg-primary text-primary-on hover:opacity-90 transition-opacity shadow-elevation-2">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
