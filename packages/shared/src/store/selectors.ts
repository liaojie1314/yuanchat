/**
 * 会话列表的派生选择器。
 *
 * @description
 * 单独成文件是为了让「未读总数怎么算」只有一份实现：侧栏角标、底栏角标、
 * 桌面托盘与系统角标全从这里取。两处各算一遍必然漂移 ——
 * navItems.ts 那条注释记的就是同一个形状的事故（底栏清单先前两处各写一份，
 * 换成朋友圈时有一处没跟上）。
 */
import type { Conversation } from "./conversationStore";

/**
 * 未读消息总数。免打扰会话**不计入** —— 用户把它静音就是表示不想被它提醒，
 * 托盘角标为它亮起来等于绕过了免打扰。
 */
export function selectTotalUnread(convs: Conversation[]): number {
  return convs.reduce((sum, c) => sum + (c.isMuted ? 0 : c.unreadCount), 0);
}

/**
 * 列表顺序里第一个「有未读且非免打扰」的会话 id。
 *
 * 供托盘左键「直达未读」用。没有未读时返回 null，调用方应当只聚焦窗口
 * 而不做跳转 —— 强行跳到一个已读会话会把用户正在看的位置顶掉。
 */
export function selectFirstUnreadId(convs: Conversation[]): string | null {
  const hit = convs.find((c) => !c.isMuted && c.unreadCount > 0);
  return hit ? hit.id : null;
}
