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
import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Pin,
  Search,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  formatDateDivider,
  recallMessage,
  RE_EDIT_WINDOW_MS,
  showToast,
  toggleReaction,
  useConversationStore,
  useMessageStore,
} from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import type { MentionRef } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { ForwardModal } from "./ForwardModal";
import { ImageLightbox } from "./ImageLightbox";
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
  // 全屏查看的图片 URL（null 表示未打开）
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // 转发弹窗当前源消息 ID（null 表示关闭）
  const [forwardMsgId, setForwardMsgId] = useState<string | null>(null);

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

  const handleSend = (text: string, mentions: MentionRef[]) => {
    if (!activeId) return;
    sendText(activeId, text, {
      mentions,
      quote: replyingTo
        ? {
            messageId: replyingTo.id,
            senderName: replyingTo.senderName ?? "我",
            excerpt: (replyingTo.text ?? replyingTo.file?.name ?? "").slice(0, 40),
          }
        : undefined,
    });
  };

  const handleForward = (messageId: string) => setForwardMsgId(messageId);

  // 撤回：调服务端（用服务端 id）→ 成功靠 message.recalled 帧统一 applyRecall，不乐观翻转。
  const handleRecall = (messageId: string) => {
    recallMessage(messageId).catch((err) => {
      if (err instanceof ApiError && err.code === 4031) {
        showToast("error", t("chat.message.recallExpired"));
      } else {
        showToast("error", t("common.opFailed"));
      }
    });
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
        {messages === undefined ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <EmptyMessages />
        ) : (
          <div className="flex flex-col px-4 py-4">
            {/* 向上翻页加载指示 */}
            {hasMore && (
              <div className="text-on-surface-variant my-1 flex justify-center">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}

            {messages.map((msg, i) => {
              const prev = i > 0 ? messages[i - 1] : undefined;
              const showDivider = !!msg.dateKey && msg.dateKey !== prev?.dateKey;
              const compact =
                !showDivider &&
                !!prev &&
                prev.kind !== "system" &&
                msg.kind !== "system" &&
                prev.isSelf === msg.isSelf &&
                prev.senderName === msg.senderName &&
                minutesBetween(prev.time, msg.time) < 1;
              return (
                <Fragment key={msg.id}>
                  {showDivider && <DateDivider label={formatDateDivider(msg.dateKey!)} />}
                  <MessageBubble
                    msg={msg}
                    compact={compact}
                    onRetry={
                      msg.status === "failed" && activeId
                        ? () => retrySend(activeId, msg.id)
                        : undefined
                    }
                    onReply={() => setReplyingTo(msg)}
                    onImageClick={setLightboxUrl}
                    onRecall={
                      // 仅自己且已送达（sent/read）的消息可撤回：sending/failed 只有本地
                      // client id、无服务端 id，撤回需用服务端 id，故不提供
                      msg.isSelf && (msg.status === "sent" || msg.status === "read")
                        ? () => handleRecall(msg.id)
                        : undefined
                    }
                    onReEdit={
                      msg.recalled && msg.isSelf && msg.recalledText
                        ? () => {
                            if (Date.now() - (msg.recalledAtMs ?? 0) > RE_EDIT_WINDOW_MS) {
                              showToast("info", t("chat.message.reEditExpired"));
                              return;
                            }
                            useMessageStore.getState().setComposerInsert(msg.recalledText ?? "");
                          }
                        : undefined
                    }
                    onReact={
                      // 排除撤回/系统消息/未 ack 乐观消息（其 id 还是 client id，服务端 404）
                      msg.recalled || msg.kind === "system" || !msg.seq
                        ? undefined
                        : (emoji) => {
                            void toggleReaction(msg.id, emoji).catch(() =>
                              showToast("error", t("common.opFailed")),
                            );
                          }
                    }
                    onForward={
                      msg.recalled || msg.kind === "system" || !msg.seq
                        ? undefined
                        : () => handleForward(msg.id)
                    }
                  />
                </Fragment>
              );
            })}

            {typingName && <TypingIndicator name={typingName} />}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <Composer onSend={handleSend} compact={compactComposer} />

      {/* 图片全屏查看器（点击气泡内图片打开） */}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

      <ForwardModal
        open={forwardMsgId !== null}
        sourceMessageId={forwardMsgId}
        sourceConversationId={activeId}
        onClose={() => setForwardMsgId(null)}
      />
    </div>
  );
}

/** 解析两条消息 "HH:mm" 标签的分钟差；跨天由 showDivider 拦住，此处只需同日比较 */
function minutesBetween(a: string, b: string): number {
  const pa = a.split(":");
  const pb = b.split(":");
  if (pa.length !== 2 || pb.length !== 2) return Infinity;
  const ma = Number(pa[0]) * 60 + Number(pa[1]);
  const mb = Number(pb[0]) * 60 + Number(pb[1]);
  if (isNaN(ma) || isNaN(mb)) return Infinity;
  return Math.abs(mb - ma);
}

/** 日期分隔线：居中胶囊 + 两侧分隔线 */
function DateDivider({ label }: { label: string }) {
  return (
    <div className="text-label-md text-on-surface-variant my-2 flex items-center gap-3">
      <span className="bg-outline-variant h-px flex-1" />
      {label}
      <span className="bg-outline-variant h-px flex-1" />
    </div>
  );
}

/** 空消息态：图标 + 文案，居中（复用 ChatScreen EmptyState 风格） */
function EmptyMessages() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="text-center">
        <div className="bg-surface-container-high text-on-surface-variant mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full">
          <MessageSquare size={40} strokeWidth={1.5} />
        </div>
        <p className="text-body-md text-on-surface-variant">{t("chat.emptyMessages")}</p>
      </div>
    </div>
  );
}

/** 消息加载骨架：4 条左右交替的气泡占位（pulse，固定高度防 CLS） */
function MessageSkeleton() {
  const rows = [false, true, false, true];
  return (
    <div className="flex flex-col gap-4 px-4 py-4" aria-hidden>
      {rows.map((isSelf, i) => (
        <div
          key={i}
          className={cn("flex animate-pulse items-end gap-2", isSelf && "flex-row-reverse")}
        >
          <span className="bg-surface-container-high h-10 w-10 shrink-0 rounded-full" />
          <span
            className={cn(
              "bg-surface-container-high h-10 rounded-2xl",
              i % 2 === 0 ? "w-48" : "w-32",
            )}
          />
        </div>
      ))}
    </div>
  );
}
