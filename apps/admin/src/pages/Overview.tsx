/**
 * 概览页 — 管理后台默认首页：运营指标卡片网格 + 待处理治理项深链 +
 * 推送订阅分页表格。全部只读，数据来自 GET /admin/stats 与
 * GET /admin/push-subscriptions。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw, Users, MessagesSquare, ShieldAlert, Bell } from "lucide-react";
import {
  getStats,
  listPushSubscriptions,
  type AdminStats,
  type AdminPushSubscription,
} from "../api";
import { DataTable, Pager, EmptyRow } from "../components/Table";
import { cn } from "@yuanchat/shared/utils";

/** 指标卡片：标签 + 数值（tabular-nums 保证数字对齐）。 */
function MetricCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 shadow-elevation-1">
      <p className="text-label-md text-on-surface-variant">{label}</p>
      <p className="mt-1 text-title-lg font-semibold tabular-nums text-on-surface">
        {value.toLocaleString()}
      </p>
      {hint !== undefined && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
    </div>
  );
}

/** 指标卡片骨架（固定高度，CLS 为零）。 */
function MetricCardSkeleton() {
  return (
    <div className="h-[84px] animate-pulse rounded-xl bg-surface-container" aria-hidden="true" />
  );
}

/** 分区标题行：图标 + 标题。 */
function SectionTitle({ icon: Icon, label }: { icon: typeof Users; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon size={16} className="text-on-surface-variant" />
      <h2 className="text-title-md font-semibold text-on-surface">{label}</h2>
    </div>
  );
}

/** 治理深链卡片：计数 + 去处理箭头，整卡可点。 */
function GovernanceCard({ label, value, to }: { label: string; value: number; to: string }) {
  const urgent = value > 0;
  return (
    <Link
      to={to}
      className={cn(
        "group flex items-center justify-between rounded-xl border px-4 py-3 shadow-elevation-1 transition-colors",
        urgent
          ? "border-error/40 bg-error-container/40 hover:bg-error-container/70"
          : "border-outline-variant bg-surface-container-low hover:bg-surface-container",
      )}
    >
      <div>
        <p className="text-label-md text-on-surface-variant">{label}</p>
        <p
          className={cn(
            "mt-1 text-title-md font-semibold tabular-nums",
            urgent ? "text-error" : "text-on-surface",
          )}
        >
          {value.toLocaleString()}
        </p>
      </div>
      <ChevronRight
        size={16}
        className="text-on-surface-variant transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/** 消息类型徽标的展示顺序与对应 i18n key（check-i18n 要求字面量 key）。 */
const TYPE_KEYS = [
  { type: "text", labelKey: "admin.overview.typeText" },
  { type: "image", labelKey: "admin.overview.typeImage" },
  { type: "file", labelKey: "admin.overview.typeFile" },
  { type: "voice", labelKey: "admin.overview.typeVoice" },
  { type: "sticker", labelKey: "admin.overview.typeSticker" },
] as const;

/** 概览页组件：一次拉取聚合指标，订阅表格独立分页加载。 */
export function OverviewPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    getStats()
      .then(setStats)
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  // 推送订阅分页区块（独立于概览指标刷新）
  const [subs, setSubs] = useState<AdminPushSubscription[]>([]);
  const [subsTotal, setSubsTotal] = useState(0);
  const [subsPage, setSubsPage] = useState(1);
  const [subsLoading, setSubsLoading] = useState(true);
  const subsTotalPages = Math.max(1, Math.ceil(subsTotal / 10));
  useEffect(() => {
    let cancelled = false;
    setSubsLoading(true);
    listPushSubscriptions(subsPage)
      .then((res) => {
        if (!cancelled) {
          setSubs(res.list);
          setSubsTotal(res.total);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSubs([]);
          setSubsTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setSubsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subsPage]);

  const m = stats?.moderation;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-title-lg font-semibold text-on-surface">{t("admin.nav.overview")}</h1>
        <button
          onClick={load}
          aria-label={t("admin.overview.refresh")}
          className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-1.5 text-label-lg text-on-surface hover:bg-surface-container"
        >
          <RefreshCw size={14} />
          {t("admin.overview.refresh")}
        </button>
      </div>

      {failed && <p className="mb-4 text-body-md text-error">{t("admin.overview.loadFailed")}</p>}

      {/* 用户与运行时 */}
      <SectionTitle icon={Users} label={t("admin.overview.sectionUsers")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {!stats ? (
          Array.from({ length: 5 }, (_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard label={t("admin.overview.usersTotal")} value={stats.users.total} />
            <MetricCard label={t("admin.overview.usersBanned")} value={stats.users.banned} />
            <MetricCard label={t("admin.overview.usersNewToday")} value={stats.users.new_today} />
            <MetricCard
              label={t("admin.overview.usersNewWeek")}
              value={stats.users.new_week}
              hint={t("admin.overview.last7days")}
            />
            <MetricCard
              label={t("admin.overview.online")}
              value={stats.runtime.online_connections}
            />
          </>
        )}
      </div>

      {/* 会话与消息 */}
      <div className="mt-6">
        <SectionTitle icon={MessagesSquare} label={t("admin.overview.sectionMessages")} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {!stats ? (
          Array.from({ length: 4 }, (_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard
              label={t("admin.overview.conversationsTotal")}
              value={stats.conversations.total}
            />
            <MetricCard label={t("admin.overview.messagesTotal")} value={stats.messages.total} />
            <MetricCard label={t("admin.overview.messagesToday")} value={stats.messages.today} />
            <MetricCard
              label={t("admin.overview.friendRequestsToday")}
              value={stats.growth.friend_requests_today}
              hint={t("admin.overview.weekCount", {
                count: stats.growth.friend_requests_week,
              })}
            />
          </>
        )}
      </div>

      {/* 各消息类型计数 */}
      {stats && (
        <div className="mt-3 flex flex-wrap gap-2">
          {TYPE_KEYS.map(({ type, labelKey }) => (
            <span
              key={type}
              className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-1.5 text-label-md text-on-surface-variant"
            >
              {t(labelKey)}
              <span className="ml-2 font-semibold tabular-nums text-on-surface">
                {(stats.messages.by_type[type] ?? 0).toLocaleString()}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* 待处理治理项深链 */}
      <div className="mt-6">
        <SectionTitle icon={ShieldAlert} label={t("admin.overview.sectionModeration")} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {!m ? (
          Array.from({ length: 5 }, (_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <GovernanceCard
              label={t("admin.overview.pendingReports")}
              value={m.pending_reports}
              to="/moderation"
            />
            <GovernanceCard
              label={t("admin.overview.flaggedMessages")}
              value={m.flagged_messages}
              to="/moderation"
            />
            <GovernanceCard
              label={t("admin.overview.pendingUGC")}
              value={m.pending_ugc}
              to="/moderation"
            />
            <GovernanceCard
              label={t("admin.overview.flaggedPacks")}
              value={m.flagged_packs}
              to="/sticker-packs"
            />
            <GovernanceCard
              label={t("admin.overview.takenDownPacks")}
              value={m.taken_down_packs}
              to="/sticker-packs"
            />
          </>
        )}
      </div>

      {/* 推送订阅 */}
      <div className="mt-6">
        <SectionTitle icon={Bell} label={t("admin.overview.pushSubs")} />
      </div>
      <DataTable
        headers={[
          t("admin.overview.colEndpoint"),
          t("admin.overview.colUser"),
          t("admin.overview.colCreated"),
        ]}
      >
        {subsLoading && (
          <tr aria-hidden="true">
            <td colSpan={3} className="px-4 py-3">
              <div className="h-6 animate-pulse rounded bg-surface-container" />
            </td>
          </tr>
        )}
        {!subsLoading && subs.length === 0 && <EmptyRow colSpan={3} />}
        {!subsLoading &&
          subs.map((s) => (
            <tr
              key={s.id}
              className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
            >
              <td className="max-w-md truncate px-4 py-3 font-mono text-xs text-on-surface-variant">
                {s.endpoint}
              </td>
              <td className="px-4 py-3 text-body-md text-on-surface">
                {s.user_nickname ?? t("admin.overview.unknownUser")}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-body-md text-on-surface-variant">
                {new Date(s.created_at).toLocaleString()}
              </td>
            </tr>
          ))}
      </DataTable>
      <Pager page={subsPage} totalPages={subsTotalPages} total={subsTotal} onPage={setSubsPage} />
    </div>
  );
}
