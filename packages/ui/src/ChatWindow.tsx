import { Send, Paperclip, Image, Smile } from "lucide-react";
import { useConversationStore } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";

const DEMO_MESSAGES = [
  { id: "1", senderId: "user1", text: "你好，明天的会议准备得怎么样了？", time: "14:15", isSelf: false },
  { id: "2", senderId: "me", text: "已经准备差不多了，PPT 还在完善", time: "14:18", isSelf: true },
  { id: "3", senderId: "user1", text: "好的，下班前发给我看一下", time: "14:20", isSelf: false },
  { id: "4", senderId: "me", text: "没问题 👍", time: "14:22", isSelf: true },
  { id: "5", senderId: "user1", text: "新版本的设计稿你看了吗？我觉得侧边栏的颜色可以再调整一下", time: "14:32", isSelf: false },
];

export function ChatWindow() {
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const conv = conversations.find((c) => c.id === activeId);
  if (!conv) return null;

  return (
    <div className="flex flex-col h-full">
      {/* 顶部标题栏 */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-slate-800 border-b border-surface-200 dark:border-slate-700">
        <Avatar name={conv.name} src={conv.avatarUrl} online={conv.isOnline} size="sm" />
        <div>
          <h2 className="text-title-md font-semibold text-slate-800 dark:text-slate-100">{conv.name}</h2>
          <p className="text-body-sm text-slate-400">
            {conv.type === "group" ? "群聊" : conv.isOnline ? "在线" : "离线"}
          </p>
        </div>
      </header>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {DEMO_MESSAGES.map((msg) => (
          <div key={msg.id} className={cn("flex gap-2", msg.isSelf ? "flex-row-reverse" : "flex-row")}>
            {!msg.isSelf && <Avatar name={conv.name} src={conv.avatarUrl} size="sm" />}
            <div className={msg.isSelf ? "msg-bubble-sent" : "msg-bubble-received"}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      {/* 输入区 */}
      <div className="px-4 py-3 bg-white dark:bg-slate-800 border-t border-surface-200 dark:border-slate-700">
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            placeholder="输入消息…"
            className="flex-1 resize-none rounded-xl bg-surface-100 dark:bg-slate-700 px-4 py-2.5 text-body-md
                       text-slate-700 dark:text-slate-200 placeholder:text-slate-400
                       focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/30"
          />
          <button className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-brand-500 text-white
                             hover:bg-brand-600 active:bg-brand-700 transition-colors">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
