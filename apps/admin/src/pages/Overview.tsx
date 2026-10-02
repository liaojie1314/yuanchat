/**
 * 概览页 — 管理后台默认首页：四层看板布局
 *   1. 指标卡片（含 Sparkline）
 *   2. 时间序列折线图
 *   3. 治理深链
 *   4. 次要区块（存储统计 + 推送订阅）
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  RefreshCw,
  Users,
  MessagesSquare,
  ShieldAlert,
  Bell,
  HardDrive,
} from "lucide-react";
import {
  getStats,
  getTimeseries,
  listPushSubscriptions,
  getStorageStats,
  type AdminStats,
  type AdminPushSubscription,
  type StorageStats,
  type StatsTimeseriesResult,
} from "../api";
import { DataTable, Pager, EmptyRow } from "../components/Table";
import { Sparkline, LineChart, DonutChart } from "@yuanchat/ui/charts";
import type { SparklinePoint, LineSeries, DonutSlice } from "@yuanchat/ui/charts";
import { cn } from "@yuanchat/shared/utils";

/** 指标卡片：标签 + 数值 + 可选趋势 Sparkline（tabular-nums 保证数字对齐）。 */
function MetricCard({
  label,
  value,
  hint,
  sparkline,
  sparklineLabel,
}: {
  label: string;
  value: number;
  hint?: string;
  sparkline?: SparklinePoint[];
  sparklineLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 shadow-elevation-1">
      <div className="min-w-0">
        <p className="text-label-md text-on-surface-variant">{label}</p>
        <p className="mt-1 text-title-lg font-semibold tabular-nums text-on-surface">
          {value.toLocaleString()}
        </p>
        {hint !== undefined && <p className="text-label-sm text-on-surface-variant">{hint}</p>}
      </div>
      {sparkline && sparkline.length > 0 && (
        <Sparkline
          data={sparkline}
          aria-label={sparklineLabel ?? label}
          className="mt-1 shrink-0 text-primary opacity-70"
        />
      )}
    </div>
  );
}

/** 指标卡片骨架（固定高度，CLS 为零）。 */
function MetricCardSkeleton() {
  return (
    <div className="h-[84px] animate-pulse rounded-lg bg-surface-container" aria-hidden="true" />
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
        "group flex items-center justify-between rounded-lg border px-4 py-3 shadow-elevation-1 transition-colors",
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

/** 存储类别行顺序与对应 i18n key（check-i18n 要求字面量 key）。 */
const STORAGE_KEYS = [
  { category: "avatar", labelKey: "admin.storage.avatar" },
  { category: "sticker", labelKey: "admin.storage.sticker" },
  { category: "sticker_cover", labelKey: "admin.storage.stickerCover" },
  { category: "message_image", labelKey: "admin.storage.messageImage" },
  { category: "message_file", labelKey: "admin.storage.messageFile" },
  { category: "message_voice", labelKey: "admin.storage.messageVoice" },
] as const;

/** 字节数人性化显示（未知为 null →「—」）。 */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}

/** 把时间序列点转成 Sparkline 所需格式。 */
function toSparkline(
  points: StatsTimeseriesResult["points"],
  key: keyof Omit<StatsTimeseriesResult["points"][0], "date">,
): SparklinePoint[] {
  return points.map((p) => ({ date: p.date, value: p[key] }));
}

/** 概览页组件：四层看板布局 — 指标卡片、折线图、治理深链、次要区块。 */
export function OverviewPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [timeseries, setTimeseries] = useState<StatsTimeseriesResult | null>(null);

  // 存储统计区块（独立于指标刷新）
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [storageFailed, setStorageFailed] = useState(false);

  const load = () => {
    setFailed(false);
    getStats()
      .then(setStats)
      .catch(() => setFailed(true));
    getTimeseries(30)
      .then(setTimeseries)
      .catch(() => {
        // 时间序列加载失败只影响图表区域，不影响指标卡片
      });
    setStorageFailed(false);
    setStorageLoading(true);
    getStorageStats()
      .then(setStorage)
      .catch(() => setStorageFailed(true))
      .finally(() => setStorageLoading(false));
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

  // 时间序列折线图数据
  const tsLabels = timeseries?.points.map((p) => p.date) ?? [];
  const tsSeries: LineSeries[] = timeseries
    ? [
        {
          key: "messages",
          label: t("admin.overview.messagesTotal"),
          values: timeseries.points.map((p) => p.messages),
          color: "var(--color-primary, #5B9BD5)",
        },
        {
          key: "new_users",
          label: t("admin.overview.usersNewToday"),
          values: timeseries.points.map((p) => p.new_users),
          color: "var(--color-secondary, #72A98F)",
        },
      ]
    : [];

  // 消息类型环形图数据
  const donutSlices: DonutSlice[] = stats
    ? TYPE_KEYS.map(({ type, labelKey }) => ({
        key: type,
        label: t(labelKey),
        value: stats.messages.by_type[type] ?? 0,
      })).filter((s) => s.value > 0)
    : [];

  return (
    <div>
      {/* 页头 */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-title-lg font-semibold text-on-surface">{t("admin.nav.overview")}</h1>
        <button
          onClick={load}
          aria-label={t("admin.overview.refresh")}
          className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-1.5 text-label-lg text-on-surface hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <RefreshCw size={14} />
          {t("admin.overview.refresh")}
        </button>
      </div>

      {failed && <p className="mb-4 text-body-md text-error">{t("admin.overview.loadFailed")}</p>}

      {/* ── 第一层：指标卡片 ── */}
      <SectionTitle icon={Users} label={t("admin.overview.sectionUsers")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {!stats ? (
          Array.from({ length: 5 }, (_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard
              label={t("admin.overview.usersTotal")}
              value={stats.users.total}
              sparkline={timeseries ? toSparkline(timeseries.points, "new_users") : undefined}
              sparklineLabel={t("admin.overview.usersNewToday")}
            />
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
            <MetricCard
              label={t("admin.overview.messagesTotal")}
              value={stats.messages.total}
              sparkline={timeseries ? toSparkline(timeseries.points, "messages") : undefined}
              sparklineLabel={t("admin.overview.messagesTotal")}
            />
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

      {/* ── 第二层：折线图 + 环形图 ── */}
      {(timeseries || stats) && (
        <div className="mt-6 flex flex-col gap-4 md:flex-row">
          {timeseries && (
            <div className="flex-1 rounded-lg border border-outline-variant bg-surface-container-low p-4 shadow-elevation-1">
              <p className="mb-2 text-label-md text-on-surface-variant">
                {t("admin.overview.trend30days")}
              </p>
              <LineChart
                xLabels={tsLabels}
                series={tsSeries}
                width={560}
                height={160}
                aria-label={t("admin.overview.trend30days")}
                className="w-full text-on-surface-variant"
                maxXTicks={8}
              />
            </div>
          )}
          {stats && donutSlices.length > 0 && (
            <div className="flex shrink-0 flex-col items-center justify-center gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-6 py-4 shadow-elevation-1">
              <p className="text-label-md text-on-surface-variant">
                {t("admin.overview.msgTypeDistribution")}
              </p>
              <DonutChart
                slices={donutSlices}
                size={100}
                aria-label={t("admin.overview.msgTypeDistribution")}
              />
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
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
            </div>
          )}
        </div>
      )}

      {/* ── 第三层：治理深链 ── */}
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

      {/* ── 第四层：次要区块（存储 + 推送订阅） ── */}
      <div className="mt-6">
        <SectionTitle icon={HardDrive} label={t("admin.storage.title")} />
      </div>
      {storageFailed && (
        <p className="mb-2 text-body-md text-error">{t("admin.storage.loadFailed")}</p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {storageLoading && Array.from({ length: 6 }, (_, i) => <MetricCardSkeleton key={i} />)}
        {!storageLoading &&
          STORAGE_KEYS.map(({ category, labelKey }) => {
            const row = storage?.categories.find((c) => c.category === category);
            return (
              <div
                key={category}
                className="rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 shadow-elevation-1"
              >
                <p className="text-label-md text-on-surface-variant">{t(labelKey)}</p>
                <p className="mt-1 text-title-md font-semibold tabular-nums text-on-surface">
                  {(row?.object_count ?? 0).toLocaleString()}
                </p>
                <p className="text-label-sm text-on-surface-variant">
                  {formatBytes(row?.total_bytes ?? null)}
                </p>
              </div>
            );
          })}
      </div>

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
