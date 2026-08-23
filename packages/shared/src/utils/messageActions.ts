/**
 * 消息操作资格判定
 *
 * @description
 * 引用/转发/收藏/表情回应/举报都要把**服务端消息 id** 发给后端，因此只能作用于
 * 服务端已确认的消息。乐观插入的消息在收到 ack 前，`id` 还是本地 clientMsgId：
 *
 * - REST 路径（收藏/举报/表情回应）→ 服务端 404；
 * - WS 路径（引用回复）→ `reply_to_id` 填了 clientMsgId，Go 侧 `*uuid.UUID`
 *   解析失败 → **整帧 400**，且 error 帧的 `client_msg_id` 为空串 →
 *   这条消息永久发不出、重试原样再失败、前端连"哪条失败"都无法定位。
 *
 * 判定条件此前在 ChatWindow 里逐个菜单项手抄了 5 遍，`onReply` 恰好漏抄
 * （且双击气泡即触发，不需要打开菜单）。抽成一处后，新增菜单项不会再漏。
 */

/** 判定所需的最小消息形状（避免 utils 依赖 store 的完整类型）。 */
export interface ActionableMessage {
  /** 服务端序列号：仅 ack 后才有，是"服务端已确认"的唯一可靠标志 */
  seq?: number;
  kind?: string;
  recalled?: boolean;
}

/**
 * 该消息是否可参与需要服务端 id 的操作（引用/转发/收藏/表情回应/举报）。
 *
 * @param msg - 待判定消息
 * @returns 已被服务端确认（有 seq）且非撤回、非系统消息时为 true
 */
export function isServerConfirmed(msg: ActionableMessage): boolean {
  return !msg.recalled && msg.kind !== "system" && !!msg.seq;
}
