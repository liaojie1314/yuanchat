/**
 * 内容审核队列页 — 敏感词命中消息 + 用户举报，双 tab
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listFlaggedMessages,
  clearMessageFlag,
  deleteMessage,
  listReports,
  handleReport,
  type AdminMessage,
  type AdminReport,
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
              <span className="font-mono text-xs">
                {r.target_type}:{r.target_id.slice(0, 8)}…
              </span>
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
                  {r.target_type === "message" && (
                    <button
                      onClick={() => void handleReport(r.id, "delete").then(refresh)}
                      className="text-label-lg text-error hover:underline"
                    >
                      {t("admin.moderation.deleteMsg")}
                    </button>
                  )}
                </>
              )}
            </td>
          </tr>
        ))}
      </DataTable>
      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />
    </>
  );
}

export function ModerationQueuePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"flagged" | "reports">("flagged");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-title-lg font-semibold text-on-surface">{t("admin.nav.moderation")}</h1>
        <div className="inline-flex rounded-lg bg-surface-container p-1">
          {(
            [
              { value: "flagged", label: t("admin.moderation.tabFlagged") },
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

      {tab === "flagged" ? <FlaggedTab /> : <ReportsTab />}
    </div>
  );
}
