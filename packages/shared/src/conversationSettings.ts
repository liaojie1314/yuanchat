/**
 * 会话个人设置（置顶/免打扰）变更协调器
 *
 * 策略：乐观更新本地 store → 调 REST；失败回滚 + error toast。
 * 与群管理「帧驱动」不同：设置开关要求即时反馈，服务端
 * conversation.updated 帧（推本人多端）到达时以服务端值校正
 *（本端幂等覆盖，其他端首次生效）。mock 模式只改本地。
 */
import i18n from "@yuanchat/design-system/i18n";
import { updateConversationSettings } from "./api/chat";
import { isMockEnabled } from "./hooks/useChatBootstrap";
import type { Conversation } from "./store/conversationStore";
import { useConversationStore } from "./store/conversationStore";
import { showToast } from "./store/toastStore";

/** 更新本人会话置顶/免打扰（乐观 + 失败回滚） */
export async function applyConversationSetting(
  convId: string,
  partial: { isPinned?: boolean; isMuted?: boolean },
): Promise<void> {
  const store = useConversationStore.getState();
  const conv = store.conversations.find((c) => c.id === convId);
  if (!conv) return;

  const prev: Partial<Conversation> = {
    isPinned: conv.isPinned,
    pinnedAt: conv.pinnedAt,
    isMuted: conv.isMuted,
  };
  const optimistic: Partial<Conversation> = { ...partial };
  if (partial.isPinned !== undefined) {
    // 本地临时 pinned_at；服务端帧到达后校正为权威值
    optimistic.pinnedAt = partial.isPinned ? new Date().toISOString() : undefined;
  }
  store.updateConversation(convId, optimistic);

  if (isMockEnabled()) return;
  try {
    await updateConversationSettings(convId, {
      is_pinned: partial.isPinned,
      is_muted: partial.isMuted,
    });
  } catch {
    useConversationStore.getState().updateConversation(convId, prev);
    showToast("error", i18n.t("detail.settingsFailed"));
  }
}
