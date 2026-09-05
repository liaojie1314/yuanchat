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
  /** 是否本人发出（编辑判定用） */
  isSelf?: boolean;
  /** 发送时间戳毫秒（编辑窗口判定用） */
  createdAtMs?: number;
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

/**
 * 可编辑窗口：5 分钟。
 *
 * @remarks 与 `messageStore` 的 `RE_EDIT_WINDOW_MS`（撤回后「重新编辑」窗口）同值，
 *   也与服务端 `service.EditWindow` 同值。这里不从 store 导入，是因为本文件刻意不
 *   依赖 store（见文件头的分层说明）；两处漂移由 `messageEdit.test.ts` 的相等断言兜住。
 */
export const EDIT_WINDOW_MS = 5 * 60_000;

/**
 * 该消息能否编辑。
 *
 * @param msg - 待判定消息
 * @param nowMs - 当前时间戳毫秒，由调用方在事件回调里传入
 * @returns 本人发出、服务端已确认、未撤回的纯文本且在 5 分钟窗口内时为 true
 * @remarks 判定含时间比较，结果随时间变化，**不能在 render 期缓存** ——
 *   必须在事件回调（右键 / 长按）里现算，同 MessageBubble 的 recallStillOpen。
 *   仅纯文本可编辑：媒体消息 content 无 caption 字段，E2EE 服务端无明文。
 *   本判定只是前置体验优化，最终以服务端闸门为准（超窗返业务码 4032）。
 */
export function canEdit(msg: ActionableMessage, nowMs: number): boolean {
  if (!isServerConfirmed(msg)) return false;
  if (!msg.isSelf) return false;
  if (msg.kind !== "text") return false;
  const created = msg.createdAtMs;
  if (!created) return false;
  return nowMs - created <= EDIT_WINDOW_MS;
}
