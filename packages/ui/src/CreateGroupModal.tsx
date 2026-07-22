/**
 * CreateGroupModal 组件 — 发起群聊弹窗
 *
 * @description
 * 从好友列表多选成员创建群聊，视觉沿用 AddContactModal 模式
 * （fixed 遮罩 bg-black/40 + bg-surface-container-low rounded-2xl 卡片）：
 * - 可选群名输入（maxLength 100，留空由后端按成员昵称拼默认名）
 * - 顶部已选头像横排（点击移除）
 * - 好友字母分组多选列表（复用 groupFriends），行内 checkbox 选中态高亮
 * - 「创建」按钮：≥1 人可点，busy 防重入；成功后 setActive(新群) + onClose
 *
 * 进入 /chat 后好友列表可能尚未拉取，open 时按需 loadFriends（mock 模式已注入，跳过）。
 */
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  createGroup,
  groupFriends,
  isMockEnabled,
  showToast,
  useContactStore,
  useConversationStore,
} from "@yuanchat/shared";
import { cn } from "@yuanchat/shared/utils";
import { Avatar } from "./Avatar";
import { Button } from "./Button";

interface CreateGroupModalProps {
  open: boolean;
  onClose: () => void;
}

/** 群名长度上限（与后端约束一致） */
const NAME_MAX = 100;

export function CreateGroupModal({ open, onClose }: CreateGroupModalProps) {
  const { t } = useTranslation();
  const friends = useContactStore((s) => s.friends);
  const loadFriends = useContactStore((s) => s.loadFriends);
  const setActive = useConversationStore((s) => s.setActive);

  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // 进入聊天页可能未拉好友：open 时按需拉取（mock 模式数据已注入，跳过）
  useEffect(() => {
    if (open && !isMockEnabled()) void loadFriends();
  }, [open, loadFriends]);

  // 关闭时重置，下次打开是干净状态
  useEffect(() => {
    if (!open) {
      setName("");
      setSelected([]);
      setBusy(false);
    }
  }, [open]);

  const groups = useMemo(() => groupFriends(friends), [friends]);
  const selectedFriends = useMemo(
    () => selected.map((id) => friends.find((f) => f.id === id)).filter((f) => f != null),
    [selected, friends],
  );

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleClose = () => {
    onClose();
  };

  const handleCreate = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      const conv = await createGroup(name.trim() || undefined, selected);
      // REST 响应（发起者视角，unread=0）先插入本地，激活后列表与聊天区立即可用，
      // 不依赖 conversation.created 帧（帧是成员视角 unread=1，且可能丢失/迟到）；
      // 随后到达的帧由 bootstrap 按 id 去重吞掉。帧先到的罕见竞态在此处反向去重。
      const store = useConversationStore.getState();
      if (!store.conversations.some((c) => c.id === conv.id)) {
        store.addConversation(conv);
      }
      setActive(conv.id);
      // 帧先到竞态：conversation.created（成员视角 unread=1）可能抢先入库，
      // 创建者此刻正看着新群 → 清零未读（同 ConversationList.handleSelect）
      store.clearUnread(conv.id);
      onClose();
    } catch {
      // 建群失败：解除 busy 让用户重试
      showToast("error", t("chat.group.createFailed"));
      setBusy(false);
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("chat.menu.newGroup")}
      onClick={handleClose}
    >
      <div
        className="bg-surface-container-low flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          <h2 className="text-title-md text-on-surface font-semibold">{t("chat.menu.newGroup")}</h2>
          <button
            className="md3-icon-btn text-on-surface-variant -mr-2"
            onClick={handleClose}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 pt-2 pb-5">
          {/* 群名输入 */}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("chat.group.namePlaceholder")}
            aria-label={t("chat.group.namePlaceholder")}
            maxLength={NAME_MAX}
            className="bg-surface-container-high text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:ring-primary/40 mb-3 w-full shrink-0 rounded-lg px-3 py-2.5 transition-shadow focus:ring-2 focus:outline-none"
          />

          {/* 已选头像横排 */}
          {selectedFriends.length > 0 && (
            <div className="scrollbar-none mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
              {selectedFriends.map((f) => (
                <button
                  key={f.id}
                  onClick={() => toggle(f.id)}
                  className="relative shrink-0"
                  aria-label={t("chat.group.removeMember")}
                >
                  <Avatar name={f.nickname} src={f.avatarUrl} size="md" />
                  <span className="bg-error absolute -top-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full text-white">
                    <X size={11} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* 好友多选列表 */}
          <div className="text-label-md text-on-surface-variant mb-1 shrink-0 font-medium">
            {t("chat.group.selectMembers")}
          </div>
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            {groups.length === 0 ? (
              <p className="text-body-md text-on-surface-variant px-2 py-8 text-center">
                {t("chat.group.noFriends")}
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.letter}>
                  <div className="text-label-sm text-on-surface-variant px-2 pt-2 pb-1 font-medium">
                    {group.letter}
                  </div>
                  {group.friends.map((f) => {
                    const checked = selected.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        onClick={() => toggle(f.id)}
                        aria-pressed={checked}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                          checked ? "bg-primary-container/60" : "hover:bg-surface-container",
                        )}
                      >
                        <Avatar name={f.nickname} src={f.avatarUrl} size="md" />
                        <span className="text-body-lg text-on-surface min-w-0 flex-1 truncate">
                          {f.nickname}
                        </span>
                        <span
                          className={cn(
                            "grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors",
                            checked
                              ? "border-primary bg-primary text-primary-on"
                              : "border-outline",
                          )}
                        >
                          {checked && <Check size={13} strokeWidth={3} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* 创建按钮 */}
          <Button
            variant="primary"
            className="mt-4 w-full shrink-0"
            disabled={selected.length === 0 || busy}
            onClick={() => void handleCreate()}
          >
            {t("chat.group.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}
