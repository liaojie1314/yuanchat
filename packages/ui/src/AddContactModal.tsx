/**
 * AddContactModal 组件 — 添加联系人弹窗
 *
 * @description
 * 输入手机号/元聊号/邮箱精确搜索 → 结果卡片按 relation 分流：
 * none → 填验证消息发申请；friend → 已是好友；pending_out → 等待验证；
 * pending_in → 提示去"新的朋友"处理；self → 是自己。
 *
 * 布局：搜索框回车/按钮触发；结果与状态都收纳在 surface-container 卡片内，
 * 避免元素漂浮；发送成功切换为独立确认视图。
 */
import { useState } from "react";
import { CheckCircle2, Info, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { searchUser, useContactStore, ApiError } from "@yuanchat/shared";
import type { SearchUserResult } from "@yuanchat/shared";
import { Avatar } from "./Avatar";
import { Button } from "./Button";

interface AddContactModalProps {
  open: boolean;
  onClose: () => void;
}

type Phase = "input" | "result" | "sent";

/** relation → 内嵌提示文案 key（none 走发申请表单，不在此表） */
const RELATION_HINT: Record<string, string> = {
  friend: "contacts.alreadyFriend",
  pending_out: "contacts.waiting",
  pending_in: "contacts.checkNewFriends",
  self: "contacts.isSelf",
};

export function AddContactModal({ open, onClose }: AddContactModalProps) {
  const { t } = useTranslation();
  const sendRequest = useContactStore((s) => s.sendRequest);

  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [result, setResult] = useState<SearchUserResult | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleClose = () => {
    setQuery("");
    setPhase("input");
    setResult(null);
    setMessage("");
    setError("");
    setBusy(false);
    onClose();
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await searchUser(q);
      setResult(res);
      setPhase("result");
    } catch (err) {
      // 清掉上一次结果，避免错误提示与旧卡片同屏
      setResult(null);
      setPhase("input");
      setError(
        err instanceof ApiError && err.code === 404
          ? t("contacts.userNotFound")
          : t("contacts.searchFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    if (!result || busy) return;
    setBusy(true);
    setError("");
    try {
      await sendRequest(result.user.id, message.trim());
      setPhase("sent");
    } catch {
      setError(t("contacts.sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("contacts.add")}
      onClick={handleClose}
    >
      <div
        className="bg-surface-container-low w-full max-w-sm rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <h2 className="text-title-md text-on-surface font-semibold">{t("contacts.add")}</h2>
          <button
            className="md3-icon-btn text-on-surface-variant -mr-2"
            onClick={handleClose}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        {phase === "sent" ? (
          /* 发送成功确认视图 */
          <div className="flex flex-col items-center px-5 pt-6 pb-6">
            <CheckCircle2 size={44} strokeWidth={1.5} className="text-primary" />
            <p className="text-body-lg text-on-surface mt-3">{t("contacts.requestSent")}</p>
            <Button variant="primary" className="mt-5 w-full" onClick={handleClose}>
              {t("common.ok")}
            </Button>
          </div>
        ) : (
          <div className="px-5 pb-5">
            {/* 搜索框：嵌入图标 + 回车触发，与通讯录面板同款视觉 */}
            <div className="relative mt-2">
              <Search
                size={16}
                className="text-on-surface-variant absolute top-1/2 left-3 -translate-y-1/2"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                }}
                placeholder={t("contacts.addPlaceholder")}
                aria-label={t("contacts.addPlaceholder")}
                autoFocus
                className="bg-surface-container-high text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:ring-primary/40 w-full rounded-lg py-2.5 pr-16 pl-9 transition-shadow focus:ring-2 focus:outline-none"
              />
              <button
                onClick={() => void handleSearch()}
                disabled={busy || !query.trim()}
                className="text-label-lg text-primary hover:bg-primary/10 absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-40"
              >
                {t("common.search")}
              </button>
            </div>

            {error && (
              <p className="text-body-md text-error mt-3 flex items-center gap-1.5">
                <Info size={14} className="shrink-0" />
                {error}
              </p>
            )}

            {/* 结果卡片 */}
            {phase === "result" && result && (
              <div className="bg-surface-container mt-4 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={result.user.nickname} src={result.user.avatarUrl} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="text-body-lg text-on-surface truncate font-semibold">
                      {result.user.nickname}
                    </div>
                    <div className="text-body-md text-on-surface-variant">
                      {t("contacts.yuanId")}: {result.user.shortId}
                    </div>
                  </div>
                </div>

                {result.relation === "none" ? (
                  <div className="mt-4">
                    <input
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder={t("contacts.verifyPlaceholder")}
                      aria-label={t("contacts.verifyPlaceholder")}
                      maxLength={200}
                      className="bg-surface-container-high text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:ring-primary/40 w-full rounded-lg px-3 py-2.5 transition-shadow focus:ring-2 focus:outline-none"
                    />
                    <Button
                      variant="primary"
                      className="mt-3 w-full"
                      disabled={busy}
                      onClick={() => void handleSend()}
                    >
                      {t("contacts.sendRequest")}
                    </Button>
                  </div>
                ) : (
                  <div className="border-outline-variant/60 text-body-md text-on-surface-variant mt-4 flex items-center gap-2 border-t pt-3">
                    <Info size={15} className="shrink-0" />
                    {t(RELATION_HINT[result.relation] ?? "contacts.searchFailed")}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
