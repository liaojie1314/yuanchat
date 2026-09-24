/**
 * MomentPostCard 组件 — 朋友圈单条动态卡片
 *
 * @description
 * 自上而下：头像 + 昵称（带个人状态 emoji）→ 正文（超长折叠）→ 媒体区
 * → 时间与操作条（赞 / 评论 / 删除）→ 点赞行 → 评论列表 → 行内评论输入。
 *
 * 点赞与删除只上抛回调，乐观更新与回滚统一由 `useMomentsStore` 负责，
 * 卡片本身不持有帖子数据，避免同一条帖子在列表与卡片里出现两份状态。
 *
 * @param post - 帖子数据（含内嵌的点赞人与评论）
 * @param onLike - 点赞/取消点赞
 * @param onComment - 提交评论；`replyToUserId` 非空即「回复某人」
 * @param onDelete - 删除本人动态（`post.deletable` 为 false 时不渲染入口）
 * @param onOpenUser - 点头像/昵称进对方的动态主页
 */
import { useState } from "react";
import { Heart, MessageSquare, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatListTime } from "@yuanchat/shared";
import type { MomentPost } from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "../primitives/Avatar";
import { MomentMediaGrid } from "./MomentMediaGrid";

/** 折叠阈值：超过这么多行或这么多字才给「全文」按钮 */
const FOLD_LINES = 6;
const FOLD_CHARS = 120;

/**
 * 是否需要折叠。
 *
 * 按字数与换行数估算而非量真实渲染行高：行高依赖字体与容器宽度，
 * 读 scrollHeight 要等布局稳定且在测试环境里恒为 0。估偏一两行只影响
 * 「全文」按钮出不出，代价远小于一次强制同步布局。
 */
function needsFold(content: string): boolean {
  return content.split("\n").length > FOLD_LINES || content.length > FOLD_CHARS;
}

export function MomentPostCard({
  post,
  onLike,
  onComment,
  onDelete,
  onOpenUser,
}: {
  post: MomentPost;
  onLike?: (postId: string) => void;
  onComment?: (postId: string, content: string, replyToUserId?: string) => void;
  onDelete?: (postId: string) => void;
  onOpenUser?: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; nickname: string } | null>(null);

  const foldable = needsFold(post.content);

  const submit = () => {
    const text = draft.trim();
    if (!text || !onComment) return;
    onComment(post.id, text, replyTo ? replyTo.id : undefined);
    setDraft("");
    setReplyTo(null);
    setComposing(false);
  };

  const openComposer = (target: { id: string; nickname: string } | null) => {
    setReplyTo(target);
    setComposing(true);
  };

  return (
    <article className="border-outline-variant flex gap-3 border-b px-4 py-4">
      {/* self-start 不能省：article 是 flex 容器，默认 align-items:stretch 会把这个
          button 拉成整卡高度，而原生 button 又会把内容垂直居中，头像就掉到图片中间去了 */}
      <button
        type="button"
        onClick={() => onOpenUser && onOpenUser(post.user.id)}
        className="self-start"
      >
        <Avatar name={post.user.nickname} src={post.user.avatarUrl || null} size="md" />
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpenUser && onOpenUser(post.user.id)}
          className="text-label-lg text-primary flex items-center gap-1 font-medium"
        >
          {post.user.nickname}
          {post.user.statusEmoji ? <span>{post.user.statusEmoji}</span> : null}
        </button>

        {post.content ? (
          <p
            data-testid="moment-post-text"
            data-expanded={expanded ? "true" : "false"}
            className={cn(
              "text-body-md text-on-surface mt-1 break-words whitespace-pre-wrap",
              foldable && !expanded && "line-clamp-6",
            )}
          >
            {post.content}
          </p>
        ) : null}

        {foldable && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-label-md text-primary mt-0.5"
          >
            {expanded ? t("moments.collapse") : t("moments.expand")}
          </button>
        )}

        {post.mediaKind !== 0 && (
          <div className="mt-2">
            <MomentMediaGrid media={post.media} mediaKind={post.mediaKind} />
          </div>
        )}

        <div className="mt-2 flex items-center gap-1">
          <span className="text-label-sm text-on-surface-variant">
            {formatListTime(post.createdAt)}
          </span>
          <div className="flex-1" />
          {post.deletable && (
            <button
              type="button"
              aria-label={t("common.delete")}
              onClick={() => onDelete && onDelete(post.id)}
              className="text-on-surface-variant hover:text-error inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            type="button"
            aria-label={t("moments.comment")}
            onClick={() => openComposer(null)}
            className="text-on-surface-variant hover:bg-surface-container inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          >
            <MessageSquare size={16} />
          </button>
          <button
            type="button"
            data-testid="moment-like-btn"
            data-liked={post.likedByMe ? "true" : "false"}
            aria-label={t("moments.like")}
            onClick={() => onLike && onLike(post.id)}
            className={cn(
              "hover:bg-surface-container inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              post.likedByMe ? "text-error" : "text-on-surface-variant",
            )}
          >
            <Heart size={16} fill={post.likedByMe ? "currentColor" : "none"} />
          </button>
        </div>

        {(post.likes.length > 0 || post.comments.length > 0) && (
          <div className="bg-surface-container-low mt-2 flex flex-col gap-1 rounded-lg px-3 py-2">
            {post.likes.length > 0 && (
              <p className="text-label-md text-primary flex items-center gap-1">
                <Heart size={13} className="text-error shrink-0" fill="currentColor" />
                <span className="min-w-0 break-words">
                  {post.likes.map((u) => u.nickname).join("、")}
                </span>
              </p>
            )}
            {post.comments.map((c) => (
              <p key={c.id} className="text-body-sm text-on-surface break-words">
                <button
                  type="button"
                  className="text-primary font-medium"
                  onClick={() => openComposer({ id: c.user.id, nickname: c.user.nickname })}
                >
                  {c.user.nickname}
                </button>
                {c.replyToUser ? (
                  <>
                    <span className="text-on-surface-variant"> {t("moments.replyTo")} </span>
                    <span className="text-primary font-medium">{c.replyToUser.nickname}</span>
                  </>
                ) : null}
                <span>：{c.content}</span>
              </p>
            ))}
          </div>
        )}

        {composing && (
          <div className="mt-2 flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={
                replyTo
                  ? t("moments.replyPlaceholder", { name: replyTo.nickname })
                  : t("moments.commentPlaceholder")
              }
              className="border-outline-variant bg-surface text-body-md text-on-surface min-w-0 flex-1 rounded-lg border px-3 py-1.5"
            />
            <button
              type="button"
              onClick={submit}
              disabled={draft.trim() === ""}
              className="bg-primary text-on-primary text-label-md rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
            >
              {t("moments.send")}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
