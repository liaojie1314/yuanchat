/**
 * BlocklistView 组件 — 黑名单列表
 *
 * @description
 * 通讯录内容区视图：展示已拉黑用户（头像 + 昵称 + 元聊号）+「解除拉黑」按钮。
 * 进入时拉取列表；解除走乐观更新（失败自动回滚 + toast）。
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Ban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isMockEnabled, showToast, useBlocklistStore } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { Button } from "./Button";

interface BlocklistViewProps {
  /** 移动端返回按钮 */
  onBack?: () => void;
}

export function BlocklistView({ onBack }: BlocklistViewProps) {
  const { t } = useTranslation();
  const items = useBlocklistStore((s) => s.items);
  const loading = useBlocklistStore((s) => s.loading);
  const fetch = useBlocklistStore((s) => s.fetch);
  const unblock = useBlocklistStore((s) => s.unblock);

  /** 正在解除中的用户 ID（防连点） */
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isMockEnabled()) void fetch();
  }, [fetch]);

  const handleUnblock = async (targetId: string) => {
    setBusyId(targetId);
    try {
      await unblock(targetId);
      showToast("info", t("contacts.unblockedToast"));
    } catch {
      showToast("error", t("common.opFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        {onBack && (
          <button
            className="md3-icon-btn text-on-surface-variant -ml-2"
            onClick={onBack}
            aria-label={t("chat.back")}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h2 className="text-title-md text-on-surface font-semibold">{t("contacts.blocked")}</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16">
            <span className="bg-surface-container-high text-on-surface-variant flex h-14 w-14 items-center justify-center rounded-lg">
              <Ban size={24} />
            </span>
            <p className="text-body-md text-on-surface-variant">{t("contacts.blockedEmpty")}</p>
          </div>
        )}

        {items.map((it) => (
          <div
            key={it.targetId}
            className="border-outline-variant flex items-center gap-3 border-b py-3 last:border-b-0"
          >
            <Avatar name={it.nickname} src={it.avatarUrl} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-body-lg text-on-surface truncate">{it.nickname}</p>
              <p className="text-label-md text-on-surface-variant">
                {t("contacts.yuanId")} {it.shortId}
              </p>
            </div>
            <Button
              variant="ghost"
              className="shrink-0 px-3 py-1.5"
              disabled={busyId === it.targetId}
              onClick={() => void handleUnblock(it.targetId)}
            >
              {t("contacts.unblock")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
