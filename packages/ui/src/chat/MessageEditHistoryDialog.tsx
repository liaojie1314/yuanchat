/**
 * MessageEditHistoryDialog — 消息编辑历史弹层
 *
 * @description
 * 按版本升序列出一条消息的全部正文版本，末项为当前生效版本。四态齐全
 * （加载骨架 / 正常 / 空 / 错误 + 重试），骨架条固定高度，加载完成时卡片高度不跳变。
 *
 * 时间口径：`message_edits` 每行的 `editedAt` 语义是「该版本被替换掉的时刻」，
 * 不是「该版本被写下的时刻」——只编辑过一次的消息，version 1 与 version 2 的
 * `editedAt` 完全相同，逐行照搬会让首版时间看着不对。故首版显示消息的发送时间
 * （`createdAtMs`，历史端点不下发，由调用方从 store 里的当前消息给出），
 * 其余版本仍显示该行 `editedAt`。
 *
 * @remarks 时区表示随端点而异（PATCH 直出 `...Z`、本端点带 `+08:00` 偏移），
 *   同一时刻的两种合法 ISO8601，故时间一律先 `new Date(s).getTime()` 再用，
 *   不对时间字符串做大小或相等比较。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchMessageEdits, formatListTime, registerBackInterceptor } from "@yuanchat/shared";
import type { EditVersion } from "@yuanchat/shared";

/** 骨架条数量：与常见的「原始版 + 一次编辑」等高，避免加载完成时卡片抽动 */
const SKELETON_ROWS = 2;

/** 编辑历史弹层的属性 */
export interface MessageEditHistoryDialogProps {
  /** 目标消息的服务端 id */
  messageId: string;
  /** 是否打开；false 时不发请求 */
  open: boolean;
  /**
   * 消息的发送时间（epoch 毫秒）。
   *
   * 首版时间只能取自消息本身：历史端点每行的 `editedAt` 是该版本**被替换掉**的时刻，
   * 首版拿它会显示成第二版的生效时间。缺省（如乐观消息尚无发送时间）时首版退回显示该行 `editedAt`。
   */
  createdAtMs?: number;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 消息编辑历史弹层。
 *
 * @param props - 见 {@link MessageEditHistoryDialogProps}
 * @returns 弹层元素；`open` 为 false 时不渲染也不请求
 */
export function MessageEditHistoryDialog(props: MessageEditHistoryDialogProps) {
  const { messageId, open, createdAtMs, onClose } = props;
  const { t } = useTranslation();
  const [versions, setVersions] = useState<EditVersion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 请求序号：换消息 / 重试后旧请求的回包一律丢弃，防串数据 */
  const reqRef = useRef(0);

  const load = useCallback(() => {
    const token = reqRef.current + 1;
    reqRef.current = token;
    setLoading(true);
    setFailed(false);
    fetchMessageEdits(messageId)
      .then((list) => {
        if (token !== reqRef.current) return;
        setVersions(list);
        setLoading(false);
      })
      .catch(() => {
        if (token !== reqRef.current) return;
        setFailed(true);
        setLoading(false);
      });
  }, [messageId]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  // Esc 关闭：与仓内其他浮层一致的键盘可达性
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 安卓系统返回键：本层盖在会话之上，不拦截会被当成「已在标签根页面」而直接退出应用。
  // 拦截器倒序执行，本层比 ChatScreen / ChatWindow 注册得晚，故先关自己再轮到下层
  useEffect(() => {
    if (!open) return;
    return registerBackInterceptor(() => {
      onClose();
      return true;
    });
  }, [open, onClose]);

  if (!open) return null;

  const list = versions === null ? [] : versions;
  const showList = !loading && !failed && list.length > 0;
  const showEmpty = !loading && !failed && versions !== null && list.length === 0;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.message.editHistory")}
      onMouseDown={onClose}
    >
      <div
        className="bg-surface-container-low w-[380px] max-w-[90vw] rounded-lg p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-title-md text-on-surface font-semibold">
            {t("chat.message.editHistory")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="md3-icon-btn text-on-surface-variant !h-8 !w-8 shrink-0"
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div data-testid="edit-history-skeleton" className="flex flex-col gap-2" aria-hidden>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <span key={i} className="bg-surface-container-high h-14 animate-pulse rounded-lg" />
            ))}
          </div>
        )}

        {!loading && failed && (
          <div data-testid="edit-history-error" className="flex flex-col items-center gap-3 py-6">
            <p className="text-body-md text-on-surface-variant">
              {t("chat.message.editHistoryError")}
            </p>
            <button
              type="button"
              data-testid="edit-history-retry"
              onClick={load}
              className="text-label-lg bg-primary-container text-primary-on-container rounded-lg px-4 py-2 font-medium"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {showEmpty && (
          <p
            data-testid="edit-history-empty"
            className="text-body-md text-on-surface-variant py-6 text-center"
          >
            {t("common.empty")}
          </p>
        )}

        {showList && (
          <ol className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {list.map((v, i) => {
              // 首版用消息发送时间（该行 editedAt 是被替换掉的时刻，会显示成下一版的生效时间）
              const iso = i === 0 && createdAtMs ? new Date(createdAtMs).toISOString() : v.editedAt;
              const stamp = new Date(iso);
              const valid = !isNaN(stamp.getTime());
              return (
                <li
                  key={v.version}
                  data-testid={v.current ? "edit-history-current" : "edit-history-item"}
                  className="border-outline-variant rounded-lg border p-2"
                >
                  <div className="text-label-sm text-on-surface-variant mb-1 flex items-center gap-2">
                    <span>{t("chat.message.editVersion", { n: v.version })}</span>
                    {valid && (
                      <time
                        data-testid={"edit-history-time-" + v.version}
                        dateTime={stamp.toISOString()}
                        className="tabular-nums"
                      >
                        {formatListTime(iso)}
                      </time>
                    )}
                    {v.current && (
                      <span className="text-primary">{t("chat.message.editCurrent")}</span>
                    )}
                  </div>
                  <p className="text-body-md text-on-surface break-words whitespace-pre-wrap">
                    {v.text}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
