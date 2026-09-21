/**
 * MomentActivitiesView 组件 — 朋友圈互动消息
 *
 * @description
 * 每行：头像 + 昵称 + 「赞了你的动态」/ 评论预览 + 帖子缩略图（无图退文字摘要）+ 时间。
 * 挂载时拉列表并整批标记已读（红点消得跟手，失败不回滚，下次拉列表以服务端为准）。
 *
 * 点任一行回信息流：v1 不做定位到具体帖，信息流本就按时间倒序，互动都在近处。
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { captureException, formatListTime, useMomentsStore } from "@yuanchat/shared";
import type { MomentActivity } from "@yuanchat/shared";
import { Avatar } from "../primitives/Avatar";
import { useObjectUrl } from "../util/useObjectUrl";
import { useBackTo } from "../util/useBackTo";

/** 帖子缩略图边长（像素；不用 aspect-ratio，旧 WebView 会塌成 0 高） */
const THUMB_PX = 44;

/** 一条互动：整行可点，回信息流 */
function ActivityRow({ activity, onOpen }: { activity: MomentActivity; onOpen: () => void }) {
  const { t } = useTranslation();
  const thumbUrl = useObjectUrl(activity.postThumbKey || undefined);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-outline-variant hover:bg-surface-container flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors"
    >
      <Avatar name={activity.actor.nickname} src={activity.actor.avatarUrl || null} size="md" />
      <div className="min-w-0 flex-1">
        <span className="text-label-lg text-primary block truncate font-medium">
          {activity.actor.nickname}
        </span>
        <span className="text-body-sm text-on-surface-variant block truncate">
          {activity.kind === 1 ? t("moments.activityLike") : activity.commentPreview}
        </span>
        <span className="text-label-sm text-on-surface-variant/70 block">
          {formatListTime(activity.createdAt)}
        </span>
      </div>
      <span
        style={{ width: THUMB_PX, height: THUMB_PX }}
        className="bg-surface-container-high text-label-sm text-on-surface-variant flex shrink-0 items-center justify-center overflow-hidden rounded-lg px-1"
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="line-clamp-2 break-all">{activity.postPreview}</span>
        )}
      </span>
    </button>
  );
}

export function MomentActivitiesView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // 子页：系统返回键回信息流，与页内返回箭头同语义
  useBackTo("/moments");

  const activities = useMomentsStore((s) => s.activities);
  const loadActivities = useMomentsStore((s) => s.loadActivities);
  const markRead = useMomentsStore((s) => s.markRead);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    setState("loading");
    loadActivities()
      .then(() => setState("done"))
      .catch((err: unknown) => {
        captureException(err, { context: "MomentActivitiesView.load" });
        setState("error");
      });
    void markRead();
  }, [loadActivities, markRead, retryTick]);

  return (
    <div className="flex h-full flex-col">
      <header className="border-outline-variant bg-surface-container-low flex h-[60px] shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          onClick={() => navigate("/moments")}
          aria-label={t("chat.back")}
          className="md3-icon-btn text-on-surface"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-title-md text-on-surface min-w-0 flex-1 truncate font-semibold">
          {t("moments.activities")}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "error" ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm">
            <p className="text-on-surface-variant">{t("moments.loadFailed")}</p>
            <button
              type="button"
              onClick={() => setRetryTick((n) => n + 1)}
              className="text-primary rounded-lg px-3 py-1 transition-colors hover:opacity-80"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : state === "loading" && activities.length === 0 ? (
          <ActivitiesSkeleton />
        ) : activities.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-sm">
            <Bell size={32} className="text-on-surface-variant opacity-30" />
            <p className="text-on-surface-variant">{t("moments.activityEmpty")}</p>
          </div>
        ) : (
          activities.map((a) => (
            <ActivityRow key={a.id} activity={a} onOpen={() => navigate("/moments")} />
          ))
        )}
      </div>
    </div>
  );
}

/** 首屏骨架：与真实行同高，出数据时不跳动（CLS 0） */
function ActivitiesSkeleton() {
  return (
    <div aria-hidden data-testid="activities-skeleton">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="border-outline-variant flex h-[76px] items-center gap-3 border-b px-4"
        >
          <div className="bg-surface-container-high h-10 w-10 shrink-0 animate-pulse rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="bg-surface-container-high h-3 w-20 animate-pulse rounded-lg" />
            <div className="bg-surface-container-high h-3 w-32 animate-pulse rounded-lg" />
          </div>
          <div className="bg-surface-container-high h-[44px] w-[44px] shrink-0 animate-pulse rounded-lg" />
        </div>
      ))}
    </div>
  );
}
