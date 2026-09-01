/**
 * 内容审核队列页 — 敏感词命中消息 + UGC 命中 + 用户举报 + 表情包，多 tab
 */
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@yuanchat/ui";
import {
  listFlaggedMessages,
  clearMessageFlag,
  deleteMessage,
  listFlaggedPacks,
  takedownPack,
  clearPackFlag,
  listReports,
  handleReport,
  listFlaggedUGC,
  resetFlaggedUGC,
  dismissFlaggedUGC,
  type AdminMessage,
  type AdminStickerPack,
  type AdminReport,
  type FlaggedUGC,
} from "../api";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { DataTable, Pager, EmptyRow } from "../components/Table";
import { cn } from "@yuanchat/shared/utils";

function contentText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    return parsed.text ?? "";
  } catch {
    return raw;
  }
}

function FlaggedTab() {
  const { t } = useTranslation();
  const fetcher = useCallback((_q: string, p: number) => listFlaggedMessages(p), []);
  const { page, setPage, list, total, totalPages, loading, refresh } =
    usePagedQuery<AdminMessage>(fetcher);

  const headers = [
    t("admin.messages.colContent"),
    t("admin.messages.colSender"),
    t("admin.messages.colTime"),
    t("admin.users.colActions"),
  ];

  return (
    <>
      <DataTable headers={headers}>
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {list.map((m) => (
          <tr
            key={m.id}
            className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
          >
            <td className="max-w-md px-4 py-3 text-body-md text-on-surface">
              <p className="line-clamp-2">{contentText(m.content)}</p>
            </td>
            <td className="px-4 py-3 text-body-md text-on-surface-variant">{m.sender_nickname}</td>
            <td className="whitespace-nowrap px-4 py-3 text-body-md text-on-surface-variant">
              {new Date(m.created_at).toLocaleString()}
            </td>
            <td className="space-x-3 whitespace-nowrap px-4 py-3">
              <button
                onClick={() => void clearMessageFlag(m.id).then(refresh)}
                className="text-label-lg text-primary hover:underline"
              >
                {t("admin.moderation.approve")}
              </button>
              <button
                onClick={() => void deleteMessage(m.id).then(refresh)}
                className="text-label-lg text-error hover:underline"
              >
                {t("common.delete")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>
      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />
    </>
  );
}

/** 表情包审核队列：包名敏感词命中的包，可下架或放行 */
function FlaggedPacksTab() {
  const { t } = useTranslation();
  const fetcher = useCallback((_q: string, p: number) => listFlaggedPacks(p), []);
  const { page, setPage, list, total, totalPages, loading, refresh } =
    usePagedQuery<AdminStickerPack>(fetcher);

  const headers = [
    t("admin.moderation.colPack"),
    t("admin.moderation.colOwner"),
    t("admin.moderation.colStickers"),
    t("admin.messages.colTime"),
    t("admin.users.colActions"),
  ];

  return (
    <>
      <DataTable headers={headers}>
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {list.map((p) => (
          <tr
            key={p.id}
            className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
          >
            <td className="max-w-md px-4 py-3 text-body-md text-on-surface">
              <p className="line-clamp-2">{p.name}</p>
            </td>
            <td className="px-4 py-3 text-body-md text-on-surface-variant">
              {p.owner_name ??
                t(p.is_official ? "sticker.market.byOfficial" : "sticker.market.deletedUser")}
            </td>
            <td className="px-4 py-3 text-body-md text-on-surface-variant">{p.sticker_count}</td>
            <td className="whitespace-nowrap px-4 py-3 text-body-md text-on-surface-variant">
              {new Date(p.created_at).toLocaleString()}
            </td>
            <td className="space-x-3 whitespace-nowrap px-4 py-3">
              <button
                onClick={() => void clearPackFlag(p.id).then(refresh)}
                className="text-label-lg text-primary hover:underline"
              >
                {t("admin.moderation.approve")}
              </button>
              <button
                onClick={() => void takedownPack(p.id).then(refresh)}
                className="text-label-lg text-error hover:underline"
              >
                {t("admin.moderation.takedown")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>
      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />
    </>
  );
}

const REPORT_STATUS_KEY: Record<number, string> = {
  0: "admin.moderation.statusPending",
  1: "admin.moderation.statusKept",
  2: "admin.moderation.statusDeleted",
};

function ReportsTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(0);
  const fetcher = useCallback((_q: string, p: number) => listReports(status, p), [status]);
  const { page, setPage, list, total, totalPages, loading, refresh } = usePagedQuery<AdminReport>(
    fetcher,
    20,
    status,
  );
  // 封禁用户是破坏性动作，弹确认框；记录待封禁的举报条目
  const [banTarget, setBanTarget] = useState<AdminReport | null>(null);

  const headers = [
    t("admin.moderation.colReporter"),
    t("admin.moderation.colTarget"),
    t("admin.moderation.colReason"),
    t("admin.moderation.colStatus"),
    t("admin.users.colActions"),
  ];

  const STATUS_TABS = [
    { value: 0, label: t("admin.moderation.statusPending") },
    { value: -1, label: t("admin.conversations.typeAll") },
  ];

  return (
    <>
      <div className="mb-3 inline-flex rounded-lg bg-surface-container p-1">
        {STATUS_TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-label-lg font-medium transition-all",
              status === value
                ? "bg-surface text-on-surface shadow-elevation-1"
                : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <DataTable headers={headers}>
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {list.map((r) => (
          <tr
            key={r.id}
            className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
          >
            <td className="px-4 py-3 text-body-md font-medium text-on-surface">
              {r.reporter_nickname}
            </td>
            <td className="px-4 py-3 text-body-md text-on-surface-variant">
              {r.target_type === "user" ? (
                // user 举报：完整 target_id 可点，深链到用户检索（按 ID 精确匹配）
                <Link
                  to={`/users?q=${r.target_id}`}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {r.target_type}:{r.target_id}
                </Link>
              ) : (
                <span className="font-mono text-xs">
                  {r.target_type}:{r.target_id}
                </span>
              )}
            </td>
            <td className="max-w-xs px-4 py-3 text-body-md text-on-surface-variant">
              <p className="line-clamp-2">{r.reason || "—"}</p>
            </td>
            <td className="px-4 py-3">
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-label-sm",
                  r.status === 0
                    ? "bg-primary-container text-primary-on-container"
                    : "bg-surface-container text-on-surface-variant",
                )}
              >
                {t(REPORT_STATUS_KEY[r.status] ?? "admin.moderation.statusPending")}
              </span>
            </td>
            <td className="space-x-3 whitespace-nowrap px-4 py-3">
              {r.status === 0 && (
                <>
                  <button
                    onClick={() => void handleReport(r.id, "keep").then(refresh)}
                    className="text-label-lg text-primary hover:underline"
                  >
                    {t("admin.moderation.keep")}
                  </button>
                  {/* 删除消息 / 下架贴纸包：处置动作都是 handleReport(id, "delete")，
                      差异只在服务端落地语义（消息硬删 / 包置 taken_down） */}
                  {r.target_type === "message" && (
                    <button
                      onClick={() => void handleReport(r.id, "delete").then(refresh)}
                      className="text-label-lg text-error hover:underline"
                    >
                      {t("admin.moderation.deleteMsg")}
                    </button>
                  )}
                  {r.target_type === "sticker_pack" && (
                    <button
                      onClick={() => void handleReport(r.id, "delete").then(refresh)}
                      className="text-label-lg text-error hover:underline"
                    >
                      {t("admin.moderation.takedownPack")}
                    </button>
                  )}
                  {/* user 举报闭环：delete 处置在服务端落地为封禁（复用 BanUser + 踢下线） */}
                  {r.target_type === "user" && (
                    <button
                      onClick={() => setBanTarget(r)}
                      className="text-label-lg text-error hover:underline"
                    >
                      {t("admin.moderation.banUser")}
                    </button>
                  )}
                </>
              )}
            </td>
          </tr>
        ))}
      </DataTable>
      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />

      <ConfirmDialog
        open={banTarget !== null}
        title={t("admin.moderation.banUser")}
        message={t("admin.moderation.banUserConfirm")}
        danger
        onConfirm={() => {
          const target = banTarget;
          setBanTarget(null);
          if (target) void handleReport(target.id, "delete").then(refresh);
        }}
        onCancel={() => setBanTarget(null)}
      />
    </>
  );
}

/** UGC 审核队列 tab：昵称 / bio / 群名 / 群公告的敏感词命中记录，可强制重置或放行 */
function FlaggedUGCTab() {
  const { t } = useTranslation();
  const [handled, setHandled] = useState<"false" | "true" | "all">("false");
  const fetcher = useCallback((_q: string, p: number) => listFlaggedUGC(handled, p), [handled]);
  const { page, setPage, list, total, totalPages, loading, refresh } = usePagedQuery<FlaggedUGC>(
    fetcher,
    20,
    handled,
  );
  // 强制重置会改写用户 / 群的内容，弹确认框
  const [resetTarget, setResetTarget] = useState<FlaggedUGC | null>(null);

  const headers = [
    t("admin.ugc.colType"),
    t("admin.ugc.colContent"),
    t("admin.ugc.colHit"),
    t("admin.ugc.colOwner"),
    t("admin.messages.colTime"),
    t("admin.users.colActions"),
  ];

  const TYPE_KEY: Record<string, string> = {
    nickname: "admin.ugc.typeNickname",
    bio: "admin.ugc.typeBio",
    group_name: "admin.ugc.typeGroupName",
    announcement: "admin.ugc.typeAnnouncement",
  };

  const HANDLED_TABS = [
    { value: "false", label: t("admin.moderation.statusPending") },
    { value: "true", label: t("admin.moderation.statusHandled") },
    { value: "all", label: t("admin.conversations.typeAll") },
  ] as const;

  return (
    <>
      <div className="mb-3 inline-flex rounded-lg bg-surface-container p-1">
        {HANDLED_TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => {
              setHandled(value);
              setPage(1);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-label-lg font-medium transition-all",
              handled === value
                ? "bg-surface text-on-surface shadow-elevation-1"
                : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <DataTable headers={headers}>
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {list.map((u) => (
          <tr
            key={u.id}
            className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
          >
            <td className="px-4 py-3 text-body-md text-on-surface">
              {t(TYPE_KEY[u.ugc_type] ?? "admin.ugc.colType")}
            </td>
            <td className="max-w-xs px-4 py-3 text-body-md text-on-surface">
              <p className="line-clamp-2">{u.content}</p>
            </td>
            <td className="px-4 py-3">
              <span className="rounded bg-error-container px-2 py-0.5 text-label-sm text-error-on-container">
                {u.hit_word}
              </span>
            </td>
            <td className="max-w-[140px] truncate px-4 py-3 font-mono text-xs text-on-surface-variant">
              {u.user_id ?? "—"}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-body-md text-on-surface-variant">
              {new Date(u.created_at).toLocaleString()}
            </td>
            <td className="space-x-3 whitespace-nowrap px-4 py-3">
              {u.handled_at == null && (
                <>
                  <button
                    onClick={() => setResetTarget(u)}
                    className="text-label-lg text-error hover:underline"
                  >
                    {t("admin.ugc.reset")}
                  </button>
                  <button
                    onClick={() => void dismissFlaggedUGC(u.id).then(refresh)}
                    className="text-label-lg text-primary hover:underline"
                  >
                    {t("admin.moderation.approve")}
                  </button>
                </>
              )}
            </td>
          </tr>
        ))}
      </DataTable>
      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />

      <ConfirmDialog
        open={resetTarget !== null}
        title={t("admin.ugc.reset")}
        message={t("admin.ugc.resetConfirm")}
        danger
        onConfirm={() => {
          const target = resetTarget;
          setResetTarget(null);
          if (target) void resetFlaggedUGC(target.id).then(refresh);
        }}
        onCancel={() => setResetTarget(null)}
      />
    </>
  );
}
export function ModerationQueuePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"flagged" | "ugc" | "packs" | "reports">("flagged");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-title-lg font-semibold text-on-surface">{t("admin.nav.moderation")}</h1>
        <div className="inline-flex rounded-lg bg-surface-container p-1">
          {(
            [
              { value: "flagged", label: t("admin.moderation.tabFlagged") },
              { value: "ugc", label: t("admin.moderation.tabUGC") },
              { value: "packs", label: t("admin.moderation.tabPacks") },
              { value: "reports", label: t("admin.moderation.tabReports") },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-label-lg font-medium transition-all",
                tab === value
                  ? "bg-surface text-on-surface shadow-elevation-1"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "flagged" && <FlaggedTab />}
      {tab === "ugc" && <FlaggedUGCTab />}
      {tab === "packs" && <FlaggedPacksTab />}
      {tab === "reports" && <ReportsTab />}
    </div>
  );
}
