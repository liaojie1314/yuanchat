/**
 * 审计日志页 — 按动作过滤，只读
 */
import { useTranslation } from "react-i18next";
import { listAuditLogs, type AuditLog } from "../api";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { DataTable, Pager, EmptyRow } from "../components/Table";
import { cn } from "@yuanchat/shared/utils";

const ACTIONS = ["", "ban_user", "unban_user", "dissolve_conversation", "delete_message"];

export function AuditLogsPage() {
  const { t } = useTranslation();
  // q 复用为 action 过滤值（该页无自由文本检索）
  const { q, search, page, setPage, list, total, totalPages, loading } = usePagedQuery<AuditLog>(
    (action, p) => listAuditLogs(action, p),
  );

  const headers = [
    t("admin.logs.colActor"),
    t("admin.logs.colAction"),
    t("admin.logs.colTarget"),
    t("admin.logs.colTime"),
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-title-lg font-semibold text-on-surface">{t("admin.nav.auditLogs")}</h1>
        <div className="inline-flex rounded-lg bg-surface-container p-1">
          {ACTIONS.map((a) => (
            <button
              key={a || "all"}
              onClick={() => search(a)}
              className={cn(
                "rounded-md px-3 py-1.5 text-label-lg font-medium transition-all",
                q === a
                  ? "bg-surface text-on-surface shadow-elevation-1"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
            >
              {a === "" ? t("admin.conversations.typeAll") : a}
            </button>
          ))}
        </div>
      </div>

      <DataTable headers={headers}>
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {list.map((log) => (
          <tr
            key={log.id}
            className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
          >
            <td className="px-4 py-3 text-body-md font-medium text-on-surface">
              {log.actor_nickname}
            </td>
            <td className="px-4 py-3">
              <span className="rounded bg-surface-container px-2 py-0.5 font-mono text-label-sm text-on-surface">
                {log.action}
              </span>
            </td>
            <td className="text-on-surface-variant px-4 py-3 text-body-md">
              <span className="font-mono text-xs">
                {log.target_type}:{log.target_id.slice(0, 8)}…
              </span>
            </td>
            <td className="text-on-surface-variant whitespace-nowrap px-4 py-3 text-body-md">
              {new Date(log.created_at).toLocaleString()}
            </td>
          </tr>
        ))}
      </DataTable>

      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />
    </div>
  );
}
