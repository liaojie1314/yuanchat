/**
 * 会话管理页 — 检索、类型过滤、强制解散
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@yuanchat/ui";
import { listConversations, dissolveConversation, type AdminConversation } from "../api";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { SearchBox, DataTable, Pager, EmptyRow } from "../components/Table";
import { cn } from "@yuanchat/shared/utils";

export function ConversationsPage() {
  const { t } = useTranslation();
  const [convType, setConvType] = useState(0);
  const { q, search, page, setPage, list, total, totalPages, loading, refresh } =
    usePagedQuery<AdminConversation>(
      (query, p) => listConversations(query, convType, p),
      20,
      convType,
    );
  const [dissolveTarget, setDissolveTarget] = useState<AdminConversation | null>(null);

  const headers = [
    t("admin.conversations.colName"),
    t("admin.conversations.colType"),
    t("admin.conversations.colMembers"),
    t("admin.conversations.colCreated"),
    t("admin.users.colActions"),
  ];

  const TYPE_TABS = [
    { value: 0, label: t("admin.conversations.typeAll") },
    { value: 1, label: t("admin.conversations.typePrivate") },
    { value: 2, label: t("admin.conversations.typeGroup") },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-title-lg font-semibold text-on-surface">
          {t("admin.nav.conversations")}
        </h1>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg bg-surface-container p-1">
            {TYPE_TABS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => {
                  setConvType(value);
                  setPage(1);
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-label-lg font-medium transition-all",
                  convType === value
                    ? "bg-surface text-on-surface shadow-elevation-1"
                    : "text-on-surface-variant hover:text-on-surface",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <SearchBox
            value={q}
            onChange={search}
            placeholder={t("admin.conversations.searchPlaceholder")}
          />
        </div>
      </div>

      <DataTable headers={headers}>
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {list.map((cv) => (
          <tr
            key={cv.id}
            className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
          >
            <td className="px-4 py-3 text-body-md font-medium text-on-surface">{cv.name || "—"}</td>
            <td className="text-on-surface-variant px-4 py-3 text-body-md">
              {cv.type === 2
                ? t("admin.conversations.typeGroup")
                : t("admin.conversations.typePrivate")}
            </td>
            <td className="text-on-surface-variant px-4 py-3 text-body-md">{cv.member_count}</td>
            <td className="text-on-surface-variant px-4 py-3 text-body-md">
              {new Date(cv.created_at).toLocaleDateString()}
            </td>
            <td className="px-4 py-3">
              <button
                onClick={() => setDissolveTarget(cv)}
                className="text-label-lg text-error hover:underline"
              >
                {t("admin.conversations.dissolve")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>

      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />

      <ConfirmDialog
        open={dissolveTarget !== null}
        title={t("admin.conversations.dissolve")}
        message={t("admin.conversations.dissolveConfirm", { name: dissolveTarget?.name ?? "" })}
        danger
        onConfirm={() => {
          const target = dissolveTarget;
          setDissolveTarget(null);
          if (target) void dissolveConversation(target.id).then(refresh);
        }}
        onCancel={() => setDissolveTarget(null)}
      />
    </div>
  );
}
