/**
 * 用户管理页 — 检索、封禁/解封
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@yuanchat/ui";
import { listUsers, banUser, unbanUser, type AdminUser } from "../api";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { SearchBox, DataTable, Pager, EmptyRow } from "../components/Table";

export function UsersPage() {
  const { t } = useTranslation();
  // 举报列表深链 /users?q=<target_id>：初始搜索词取 URL 参数（后端支持按 ID 精确匹配）
  const [searchParams] = useSearchParams();
  const { q, search, page, setPage, list, total, totalPages, loading, refresh } =
    usePagedQuery<AdminUser>((query, p) => listUsers(query, p), 20, 0, searchParams.get("q") ?? "");
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);

  const headers = [
    t("admin.users.colUser"),
    t("admin.users.colContact"),
    t("admin.users.colStatus"),
    t("admin.users.colCreated"),
    t("admin.users.colActions"),
  ];

  const handleToggleBan = async (u: AdminUser) => {
    if (u.status === 2) {
      await unbanUser(u.id);
      refresh();
    } else {
      setBanTarget(u);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-title-lg font-semibold text-on-surface">{t("admin.nav.users")}</h1>
        <SearchBox value={q} onChange={search} placeholder={t("admin.users.searchPlaceholder")} />
      </div>

      <DataTable headers={headers}>
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {list.map((u) => (
          <tr
            key={u.id}
            className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
          >
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-body-md font-medium text-on-surface">{u.nickname}</span>
                {u.role === 1 && (
                  <span className="rounded bg-primary-container px-1.5 py-0.5 text-label-sm text-primary-on-container">
                    {t("admin.users.roleAdmin")}
                  </span>
                )}
              </div>
              <span className="text-label-sm text-on-surface-variant">#{u.short_id}</span>
            </td>
            <td className="px-4 py-3 text-body-md text-on-surface-variant">
              {u.phone || u.email || "—"}
            </td>
            <td className="px-4 py-3">
              {u.status === 2 ? (
                <span className="rounded bg-error-container px-2 py-0.5 text-label-sm text-error-on-container">
                  {t("admin.users.statusBanned")}
                </span>
              ) : (
                <span className="rounded bg-green-100 px-2 py-0.5 text-label-sm text-green-800">
                  {t("admin.users.statusNormal")}
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-body-md text-on-surface-variant">
              {new Date(u.created_at).toLocaleDateString()}
            </td>
            <td className="px-4 py-3">
              {u.role !== 1 && (
                <button
                  onClick={() => void handleToggleBan(u)}
                  className={
                    u.status === 2
                      ? "text-label-lg text-primary hover:underline"
                      : "text-label-lg text-error hover:underline"
                  }
                >
                  {u.status === 2 ? t("admin.users.unban") : t("admin.users.ban")}
                </button>
              )}
            </td>
          </tr>
        ))}
      </DataTable>

      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />

      <ConfirmDialog
        open={banTarget !== null}
        title={t("admin.users.ban")}
        message={t("admin.users.banConfirm", { name: banTarget?.nickname ?? "" })}
        danger
        onConfirm={() => {
          const target = banTarget;
          setBanTarget(null);
          if (target) void banUser(target.id).then(refresh);
        }}
        onCancel={() => setBanTarget(null)}
      />
    </div>
  );
}
