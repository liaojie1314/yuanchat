/**
 * OTA 版本分发页 — 登记新版本、发布、回滚、改灰度
 *
 * @description
 * 四个动作对应后端四条审计日志。两处刻意的设计：
 *
 *   - **登记与发布分成两步**：登记只落 draft，要再点一次「发布」才会下发。
 *     合成一步就没有复核的机会 —— 这个按钮能把任意字节推给全部客户端。
 *   - **回滚走二次确认**：回滚会让所有客户端立刻停止收到该版本。
 *
 * 签名字段只接收 release 流水线产出的 `.sig` 文本内容；**签名私钥不入库、
 * 不进管理端进程**，这个页面只做登记。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, captureException } from "@yuanchat/shared";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@yuanchat/ui";
import { cn } from "@yuanchat/shared/utils";
import {
  listReleases,
  createRelease,
  updateRelease,
  publishRelease,
  rollbackRelease,
  type AdminRelease,
  type CreateReleaseBody,
} from "../api";
import { usePagedQuery } from "../hooks/usePagedQuery";
import { DataTable, Pager, EmptyRow, SkeletonRows } from "../components/Table";

/** 状态徽标：published 用主色、rolled_back 用错误色、draft 中性。 */
function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 text-label-sm",
        status === "published" && "bg-primary-container text-primary-on-container",
        status === "rolled_back" && "bg-error-container text-error-on-container",
        status === "draft" && "bg-surface-container-highest text-on-surface-variant",
      )}
    >
      {label}
    </span>
  );
}

/** 字节数格式化成 MB，表格里只看量级就够。 */
function humanSize(n: number): string {
  if (!n) return "—";
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 登记表单的初始值。灰度默认 100（全量）是安全的：登记只落 draft，
 * 还要再显式点一次「发布」才会下发。
 */
const EMPTY_FORM: CreateReleaseBody = {
  platform: "linux",
  arch: "x86_64",
  version: "",
  channel: "stable",
  notes: "",
  object_key: "",
  signature: "",
  sha256: "",
  min_version: "",
  mandatory: false,
  rollout: 100,
};

const PLATFORMS = ["linux", "windows", "darwin", "android"] as const;
const ARCHES = ["x86_64", "aarch64", "universal", "i686", "armv7"] as const;

/** 管理已登记的安装包；写操作收到成功响应才刷新，并显式展示失败。 */
export function ReleasesPage() {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");

  // usePagedQuery 的 q 这里用不上（版本列表没有关键词搜索），
  // 筛选经 version 信号驱动重载
  const fetcher = useCallback(
    (_q: string, p: number) => listReleases({ platform, status }, p),
    [platform, status],
  );
  const { page, setPage, list, total, totalPages, loading, refresh } = usePagedQuery<AdminRelease>(
    fetcher,
    20,
    `${platform}|${status}`,
  );

  const [form, setForm] = useState<CreateReleaseBody>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    rel: AdminRelease;
    action: "publish" | "rollback";
  } | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);
  const [rolloutDrafts, setRolloutDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    setRolloutDrafts({});
  }, [list]);

  // 同步闩锁阻止同一轮事件中连点提交；失败不会刷新或覆盖服务端状态。
  const runWrite = async (
    call: () => Promise<unknown>,
    onSuccess: () => void,
    onError: (err: unknown) => void = () => setActionError(t("admin.releases.actionFailed")),
  ) => {
    if (writing.current) return;
    writing.current = true;
    setSaving(true);
    setActionError(null);
    try {
      await call();
      onSuccess();
    } catch (err) {
      captureException(err, { context: "adminRelease.write" });
      onError(err);
    } finally {
      writing.current = false;
      setSaving(false);
    }
  };

  const headers = [
    t("admin.releases.platform"),
    t("admin.releases.arch"),
    t("admin.releases.version"),
    t("admin.releases.channel"),
    t("admin.releases.status"),
    t("admin.releases.rollout"),
    t("admin.releases.mandatory"),
    t("admin.releases.publishedAt"),
    t("admin.users.colActions"),
  ];

  const CONFIRM_KEYS = {
    publish: {
      title: t("admin.releases.publish"),
      message: t("admin.releases.publishConfirm"),
      danger: false,
    },
    rollback: {
      title: t("admin.releases.rollback"),
      message: t("admin.releases.rollbackConfirm"),
      danger: true,
    },
  } as const;
  const confirmMeta = pending ? CONFIRM_KEYS[pending.action] : null;

  const runPending = () => {
    if (!pending || writing.current) return;
    const { rel, action } = pending;
    setPending(null);
    void runWrite(
      () => (action === "publish" ? publishRelease(rel.id) : rollbackRelease(rel.id)),
      refresh,
    );
  };

  const submitForm = () => {
    setFormError(null);
    void runWrite(
      () =>
        createRelease({
          ...form,
          signature: form.signature || undefined,
          sha256: form.sha256 || undefined,
          min_version: form.min_version || undefined,
          notes: form.notes || undefined,
        }),
      () => {
        setForm(EMPTY_FORM);
        setFormOpen(false);
        refresh();
      },
      (err) => {
        setFormError(
          t(
            err instanceof ApiError && err.code === 409
              ? "admin.releases.duplicate"
              : err instanceof ApiError && err.code === 400
                ? "admin.releases.invalidForm"
                : "admin.releases.createFailed",
          ),
        );
      },
    );
  };

  /** 行内灰度只接受0至100的非空整数；失败清掉草稿，恢复服务端原值。 */
  const commitRollout = (rel: AdminRelease, raw: string) => {
    const reset = () =>
      setRolloutDrafts((drafts) => {
        const next = { ...drafts };
        delete next[rel.id];
        return next;
      });
    const next = Number(raw);
    if (!raw.trim() || !Number.isInteger(next) || next < 0 || next > 100) {
      reset();
      setActionError(t("admin.releases.rolloutInvalid"));
      return;
    }
    if (next === rel.rollout || writing.current) return;
    void runWrite(
      () => updateRelease(rel.id, { rollout: next }),
      refresh,
      () => {
        reset();
        setActionError(t("admin.releases.actionFailed"));
      },
    );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title-lg font-semibold text-on-surface">{t("admin.releases.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("admin.releases.platform")}
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
          >
            <option value="">{t("admin.releases.allPlatforms")}</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            aria-label={t("admin.releases.status")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
          >
            <option value="">{t("admin.releases.allStatuses")}</option>
            <option value="draft">{t("admin.releases.statusDraft")}</option>
            <option value="published">{t("admin.releases.statusPublished")}</option>
            <option value="rolled_back">{t("admin.releases.statusRolledBack")}</option>
          </select>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="h-9 rounded-lg bg-primary px-3 text-label-lg text-primary-on hover:opacity-90"
          >
            {t("admin.releases.create")}
          </button>
        </div>
      </div>

      {formOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitForm();
          }}
          className="mb-4 rounded-lg border border-outline-variant bg-surface-container-low p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant">
              {t("admin.releases.platform")}
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
                className="h-9 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant">
              {t("admin.releases.arch")}
              <select
                value={form.arch}
                onChange={(e) => setForm({ ...form, arch: e.target.value })}
                className="h-9 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
              >
                {ARCHES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant">
              {t("admin.releases.channel")}
              <select
                value={form.channel ?? ""}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
                className="h-9 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
              >
                <option value="stable">stable</option>
                <option value="beta">beta</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant">
              {t("admin.releases.version")}
              <input
                required
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                placeholder="0.8.0"
                className="h-9 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant lg:col-span-2">
              {t("admin.releases.objectKey")}
              <input
                required
                value={form.object_key}
                onChange={(e) => setForm({ ...form, object_key: e.target.value })}
                placeholder="releases/yuanchat-0.8.0-x86_64.AppImage"
                className="h-9 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant lg:col-span-3">
              {t("admin.releases.signature")}
              <textarea
                rows={2}
                value={form.signature ?? ""}
                onChange={(e) => setForm({ ...form, signature: e.target.value })}
                className="rounded-lg border border-outline-variant bg-surface px-2 py-1 font-mono text-body-sm text-on-surface"
              />
              <span className="text-label-sm text-on-surface-variant">
                {t("admin.releases.signatureHint")}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant">
              {t("admin.releases.sha256")}
              <input
                value={form.sha256 ?? ""}
                onChange={(e) => setForm({ ...form, sha256: e.target.value })}
                className="h-9 rounded-lg border border-outline-variant bg-surface px-2 font-mono text-body-sm text-on-surface"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant">
              {t("admin.releases.minVersion")}
              <input
                value={form.min_version ?? ""}
                onChange={(e) => setForm({ ...form, min_version: e.target.value })}
                placeholder="0.7.0"
                className="h-9 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant">
              {t("admin.releases.rollout")}
              <input
                type="number"
                min={0}
                max={100}
                value={form.rollout ?? 100}
                onChange={(e) => setForm({ ...form, rollout: Number(e.target.value) })}
                className="h-9 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface-variant lg:col-span-3">
              {t("admin.releases.notes")}
              <textarea
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="rounded-lg border border-outline-variant bg-surface px-2 py-1 text-body-md text-on-surface"
              />
            </label>
            <label className="flex items-center gap-2 text-label-md text-on-surface-variant">
              <input
                type="checkbox"
                checked={form.mandatory ?? false}
                onChange={(e) => setForm({ ...form, mandatory: e.target.checked })}
              />
              {t("admin.releases.mandatory")}
            </label>
          </div>

          {formError && (
            <p role="alert" className="mt-3 text-body-sm text-error">
              {formError}
            </p>
          )}

          <p className="mt-3 text-label-sm text-on-surface-variant">
            {t("admin.releases.createIsDraftHint")}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="h-9 rounded-lg bg-primary px-4 text-label-lg text-primary-on hover:opacity-90"
            >
              {t("admin.releases.submit")}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setFormError(null);
              }}
              className="h-9 rounded-lg border border-outline-variant px-4 text-label-lg text-on-surface hover:bg-surface-container-low"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      {actionError && (
        <p role="alert" className="mb-3 text-body-sm text-error">
          {actionError}
        </p>
      )}
      <DataTable headers={headers}>
        {/* 翻页 / 筛选时旧行留在原位，只有首屏才上骨架 */}
        {loading && list.length === 0 && <SkeletonRows cols={headers.length} />}
        {!loading && list.length === 0 && <EmptyRow colSpan={headers.length} />}
        {list.map((rel) => (
          <tr
            key={rel.id}
            className="border-b border-outline-variant last:border-0 hover:bg-surface-container-low"
          >
            <td className="px-4 py-3 text-body-md text-on-surface">{rel.platform}</td>
            <td className="px-4 py-3 text-body-md text-on-surface-variant">{rel.arch}</td>
            <td className="whitespace-nowrap px-4 py-3 text-body-md text-on-surface">
              {rel.version}
              <span className="ml-2 text-label-sm text-on-surface-variant">
                {humanSize(rel.size)}
              </span>
            </td>
            <td className="px-4 py-3 text-body-md text-on-surface-variant">{rel.channel}</td>
            <td className="whitespace-nowrap px-4 py-3">
              <StatusBadge
                status={rel.status}
                label={t(
                  rel.status === "published"
                    ? "admin.releases.statusPublished"
                    : rel.status === "rolled_back"
                      ? "admin.releases.statusRolledBack"
                      : "admin.releases.statusDraft",
                )}
              />
            </td>
            <td className="px-4 py-3">
              <input
                type="number"
                min={0}
                max={100}
                value={rolloutDrafts[rel.id] ?? String(rel.rollout)}
                disabled={saving}
                onChange={(e) =>
                  setRolloutDrafts((drafts) => ({ ...drafts, [rel.id]: e.target.value }))
                }
                aria-label={t("admin.releases.rollout")}
                onBlur={(e) => commitRollout(rel, e.target.value)}
                className="h-8 w-16 rounded-lg border border-outline-variant bg-surface px-2 text-body-md text-on-surface"
              />
            </td>
            {/* 强制更新用符号而非「是 / 否」文案：省四语两个 key，列窄也不换行 */}
            <td className="px-4 py-3 text-body-md text-on-surface-variant">
              {rel.mandatory ? "✓" : "—"}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-body-md text-on-surface-variant">
              {rel.published_at ? new Date(rel.published_at).toLocaleString() : "—"}
            </td>
            <td className="space-x-3 whitespace-nowrap px-4 py-3">
              {rel.status !== "published" && (
                <button
                  disabled={saving}
                  onClick={() => setPending({ rel, action: "publish" })}
                  className="text-label-lg text-primary hover:underline"
                >
                  {t("admin.releases.publish")}
                </button>
              )}
              {rel.status === "published" && (
                <button
                  disabled={saving}
                  onClick={() => setPending({ rel, action: "rollback" })}
                  className="text-label-lg text-error hover:underline"
                >
                  {t("admin.releases.rollback")}
                </button>
              )}
            </td>
          </tr>
        ))}
      </DataTable>
      <Pager page={page} totalPages={totalPages} total={total} onPage={setPage} />

      <ConfirmDialog
        open={pending !== null}
        title={confirmMeta?.title ?? ""}
        message={confirmMeta?.message ?? ""}
        danger={confirmMeta?.danger}
        onConfirm={runPending}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
