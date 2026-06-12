import { Send, Paperclip, Image, Smile } from "lucide-react";
import { useConversationStore } from "@/store/conversationStore";
import { Avatar } from "@/components/ui/Avatar";
import { clsx } from "clsx";

/** 临时消息数据 */
const DEMO_MESSAGES = [
  { id: "1", senderId: "user1", text: "你好，明天的会议准备得怎么样了？", time: "14:15", isSelf: false },
  { id: "2", senderId: "me", text: "已经准备差不多了，PPT 还在完善", time: "14:18", isSelf: true },
  { id: "3", senderId: "user1", text: "好的，下班前发给我看一下", time: "14:20", isSelf: false },
  { id: "4", senderId: "me", text: "没问题 👍", time: "14:22", isSelf: true },
  { id: "5", senderId: "user1", text: "对了，新版本的设计稿你看了吗？我觉得侧边栏的颜色可以再调整一下", time: "14:32", isSelf: false },
];

export function ChatWindow() {
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const conv = conversations.find((c) => c.id === activeId);

  if (!conv) return null;

  return (
    <div className="flex flex-col h-full">
      {/* 顶部标题栏 */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <Avatar name={conv.name} src={conv.avatarUrl} online={conv.isOnline} />
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {conv.name}
          </h2>
          <p className="text-xs text-neutral-400">
            {conv.type === "group" ? "群聊" : conv.isOnline ? "在线" : "离线"}
          </p>
        </div>
      </header>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-neutral-50/50 dark:bg-neutral-950/30">
        {DEMO_MESSAGES.map((msg, i) => {
          // 判断是否显示时间分隔（与上一条消息间隔超过5分钟时显示）
          const showTime = i === 0; // 简化处理

          return (
            <div key={msg.id}>
              {showTime && (
                <div className="text-center mb-4">
                  <span className="inline-block px-3 py-1 rounded-full bg-neutral-200/60 dark:bg-neutral-800/60 text-xs text-neutral-500">
                    {msg.time}
                  </span>
                </div>
              )}
              <div
                className={clsx(
                  "flex gap-3",
                  msg.isSelf ? "flex-row-reverse" : "flex-row",
                )}
              >
                {!msg.isSelf && (
                  <Avatar name={conv.name} src={conv.avatarUrl} size="sm" />
                )}
                <div
                  className={clsx(
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
      <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="flex items-center gap-1 mb-2">
          <button className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
            <Image size={18} />
          </button>
          <button className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
            <Paperclip size={18} />
          </button>
          <button className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
            <Smile size={18} />
          </button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            rows={3}
            placeholder="输入消息..."
            className="flex-1 resize-none rounded-xl bg-neutral-100 dark:bg-neutral-800 px-4 py-2.5 text-sm
                       placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          />
          <button className="shrink-0 p-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition-colors">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
