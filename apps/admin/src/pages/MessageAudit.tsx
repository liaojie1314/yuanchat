/**
 * 消息审核页 — 内容关键词检索、删除、非文本消息媒体预览
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@yuanchat/ui";
import { listMessages, deleteMessage, type AdminMessage } from "../api";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { SearchBox, DataTable, Pager, EmptyRow } from "../components/Table";
import { MessageMediaCell } from "../components/MessageMedia";

export function MessageAuditPage() {
  const { t } = useTranslation();
  const { q, search, page, setPage, list, total, totalPages, loading, refresh } =
    usePagedQuery<AdminMessage>((query, p) => listMessages(query, p));
  const [deleteTarget, setDeleteTarget] = useState<AdminMessage | null>(null);

  const headers = [
    t("admin.messages.colContent"),
    t("admin.messages.colSender"),
    t("admin.messages.colTime"),
    t("admin.users.colActions"),
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-title-lg font-semibold text-on-surface">{t("admin.nav.messages")}</h1>
        <SearchBox
          value={q}
          onChange={search}
          placeholder={t("admin.messages.searchPlaceholder")}
        />
      </div>

      <DataTable headers={headers}>
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {list.map((m) => (
          <tr
            key={m.id}
            className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
          >
            <td className="max-w-md px-4 py-3 text-body-md text-on-surface">
              <MessageMediaCell message={m} />
            </td>
            <td className="px-4 py-3 text-body-md text-on-surface-variant">{m.sender_nickname}</td>
            <td className="whitespace-nowrap px-4 py-3 text-body-md text-on-surface-variant">
              {new Date(m.created_at).toLocaleString()}
            </td>
            <td className="px-4 py-3">
              <button
                onClick={() => setDeleteTarget(m)}
                className="text-label-lg text-error hover:underline"
              >
                {t("common.delete")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>

      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("common.delete")}
        message={t("admin.messages.deleteConfirm")}
        danger
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void deleteMessage(target.id).then(refresh);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
