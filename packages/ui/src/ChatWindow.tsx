/**
 * ChatWindow 组件 — 聊天消息窗口
 *
 * @description
 * IM 应用最主要的交互界面，位于三栏布局的中间。组成：
 * 1. **顶部标题栏**：头像 + 名称 + 成员/在线信息 + 通话/搜索/详情按钮，
 *    移动端显示返回按钮
 * 2. **置顶消息条**：会话存在 pinnedMessage 时显示
 * 3. **消息流**：日期分隔线、全形态气泡（MessageBubble）、正在输入指示，
 *    新消息自动滚动到底部
 * 4. **输入区**：Composer（引用回复 / 工具条 / 自适应输入）
 *
 * @param onBack - 移动端返回会话列表回调，非空时显示返回按钮
 * @param onShowDetail - 打开详情面板/抽屉回调，非空时显示详情按钮
 * @param compactComposer - 移动端使用紧凑输入区
 */
import { useCallback, useEffect, useRef } from "react";
import { ArrowLeft, Loader2, MoreHorizontal, Phone, Pin, Search, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConversationStore, useMessageStore } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { MessageBubble, TypingIndicator } from "./MessageBubble";

export function ChatWindow({
  onBack,
  onShowDetail,
  compactComposer = false,
}: {
  onBack?: () => void;
  onShowDetail?: () => void;
  compactComposer?: boolean;
}) {
  const { t } = useTranslation();
  // 从 Zustand Store 中读取当前活跃会话与消息流
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const conv = conversations.find((c) => c.id === activeId);

  const messages = useMessageStore((s) => (activeId ? s.messagesByConv[activeId] : undefined));
  const typingName = useMessageStore((s) => (activeId ? s.typingByConv[activeId] : undefined));
  const hasMore = useMessageStore((s) => (activeId ? s.hasMoreByConv[activeId] : false));
  const sendText = useMessageStore((s) => s.sendText);
  const retrySend = useMessageStore((s) => s.retrySend);
  const loadHistory = useMessageStore((s) => s.loadHistory);
  const loadMore = useMessageStore((s) => s.loadMore);
  const setReplyingTo = useMessageStore((s) => s.setReplyingTo);
  const replyingTo = useMessageStore((s) => s.replyingTo);

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  // 进入会话时按需加载历史（真实模式；mock 模式内部直接跳过）
  useEffect(() => {
    if (activeId) void loadHistory(activeId);
  }, [activeId, loadHistory]);

  // 消息变化 / 切换会话时滚动到底部（翻页加载不触发，避免跳动）
  useEffect(() => {
    if (loadingMoreRef.current) {
      loadingMoreRef.current = false;
      return;
    }
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length, activeId]);

  // 滚动到顶部时向上翻页
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !activeId || !hasMore || loadingMoreRef.current) return;
    if (el.scrollTop > 40) return;

    loadingMoreRef.current = true;
    const prevHeight = el.scrollHeight;
    const prevCount = useMessageStore.getState().messagesByConv[activeId]?.length ?? 0;
    void loadMore(activeId).then(() => {
      const nextCount = useMessageStore.getState().messagesByConv[activeId]?.length ?? 0;
      if (nextCount === prevCount) {
        // 没有新数据（到头/失败）：解除锁，否则滚动加载永久失效
        loadingMoreRef.current = false;
        return;
      }
      // 维持视口位置：滚动差 = 新增内容高度
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
        }
      });
    });
  }, [activeId, hasMore, loadMore]);

  // 防御：如果没找到会话（activeId 无效或为 null），不渲染
  if (!conv) return null;

  const subtitle =
    conv.type === "group"
      ? [
          conv.memberCount ? t("chat.members", { count: conv.memberCount }) : null,
          conv.onlineCount ? t("chat.onlineCount", { count: conv.onlineCount }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : conv.isOnline || conv.presence === "online"
        ? t("common.online")
        : t("common.offline");

  const handleSend = (text: string) => {
    if (!activeId) return;
    sendText(
      activeId,
      text,
      replyingTo
        ? {
            senderName: replyingTo.senderName ?? "我",
            excerpt: (replyingTo.text ?? replyingTo.file?.name ?? "").slice(0, 40),
          }
        : undefined,
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* 顶部标题栏 */}
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-3 border-b pr-2 pl-3">
        {onBack && (
          <button
            onClick={onBack}
            className="md3-icon-btn text-on-surface -ml-1"
            aria-label={t("chat.back")}
          >
            <ArrowLeft size={22} />
          </button>
        )}
        <Avatar name={conv.name} src={conv.avatarUrl} presence={conv.presence} />
        <div className="min-w-0 flex-1">
          <h2 className="text-title-md text-on-surface truncate font-semibold">{conv.name}</h2>
          <p className="text-label-sm text-on-surface-variant truncate">{subtitle}</p>
        </div>
        <button
          className="md3-icon-btn text-on-surface-variant"
          title={t("chat.voiceCall")}
          aria-label={t("chat.voiceCall")}
        >
          <Phone size={19} />
        </button>
        <button
          className="md3-icon-btn text-on-surface-variant"
          title={t("chat.videoCall")}
          aria-label={t("chat.videoCall")}
        >
          <Video size={19} />
        </button>
        <button
          className="md3-icon-btn text-on-surface-variant hidden sm:grid"
          title={t("chat.searchHistory")}
          aria-label={t("chat.searchHistory")}
        >
          <Search size={19} />
        </button>
        {onShowDetail && (
          <button
            onClick={onShowDetail}
            className="md3-icon-btn text-on-surface-variant"
            title={t("chat.details")}
            aria-label={t("chat.details")}
          >
            <MoreHorizontal size={19} />
          </button>
        )}
      </header>

      {/* 置顶消息条 */}
      {conv.pinnedMessage && (
        <div className="bg-primary-container text-primary-on-container flex h-9 shrink-0 items-center gap-2 px-4">
          <Pin size={13} className="shrink-0" />
          <span className="text-label-md font-semibold">{t("chat.pinnedLabel")}</span>
          <span className="text-body-sm min-w-0 flex-1 truncate">{conv.pinnedMessage}</span>
        </div>
      )}

      {/* 消息流 */}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col px-4 py-4">
          {/* 向上翻页加载指示 */}
          {hasMore && (
            <div className="text-on-surface-variant my-1 flex justify-center">
              <Loader2 size={16} className="animate-spin" />
            </div>
          )}

          {/* 日期分隔线（当前统一"今天"，后续按消息日期分组） */}
          <div className="text-label-md text-on-surface-variant my-2 flex items-center gap-3">
            <span className="bg-outline-variant h-px flex-1" />
            {t("chat.today")}
            <span className="bg-outline-variant h-px flex-1" />
          </div>

          {(messages ?? []).map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onRetry={
                msg.status === "failed" && activeId ? () => retrySend(activeId, msg.id) : undefined
              }
              onReply={() => setReplyingTo(msg)}
            />
          ))}

          {typingName && <TypingIndicator name={typingName} />}
        </div>
      </div>

      {/* 输入区 */}
      <Composer onSend={handleSend} compact={compactComposer} />
    </div>
  );
}
