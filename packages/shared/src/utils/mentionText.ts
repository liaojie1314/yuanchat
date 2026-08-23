/**
 * @提及文本工具
 *
 * @description
 * 输入框里的 `@昵称` 在语义上是一个整体，但 textarea 存的只是纯文本：
 * 退格默认一次删一个字符——删一个 @提及要按十几次退格，中途还会留下
 * `@李` 这种残片（发送时被过滤掉，用户却以为提及还在）；方向键同理，
 * 光标会停在昵称中间。这里把「光标紧邻的提及片段」算成一个下标区间，
 * 交给输入框整体删除 / 整体跨越。
 *
 * 两类区间的区别：
 * - token：只覆盖 `@昵称` 本身，用于方向键移动（空格仍是独立字符）
 * - span：token 再吃掉紧邻的一个空格，用于删除（不留孤立空格）
 *
 * 桌面端在 keydown 里拦下退格即可整体删除；安卓输入法拦不住（见
 * {@link repairMentionDeletion}），只能等删除发生后再把残片补删掉。
 */

/** 一个 @提及片段在正文里的下标区间（`end` 不含） */
export interface MentionSpan {
  /** 片段起始下标（指向 `@`） */
  start: number;
  /** 片段结束下标（不含） */
  end: number;
}

/**
 * 昵称按长度倒序：短昵称是长昵称前缀时（`@李` / `@李雷`），必须让长的先命中
 *
 * @param names - 候选昵称（不含 `@`）
 * @returns 去空后按长度倒序的昵称
 */
function sortedNames(names: string[]): string[] {
  return names.filter((n) => n.length > 0).sort((a, b) => b.length - a.length);
}

/**
 * 光标前紧邻的 `@昵称` 本身（不含尾随空格）
 *
 * @param text - 输入框全文
 * @param caret - 光标下标
 * @param names - 候选昵称（已选提及 + 会话成员）
 * @returns 命中的区间；光标前不是提及则为 null
 *
 * @example
 * mentionTokenBefore("hi @Bob", 7, ["Bob"]); // { start: 3, end: 7 }
 */
export function mentionTokenBefore(
  text: string,
  caret: number,
  names: string[],
): MentionSpan | null {
  if (caret <= 0) return null;
  for (const name of sortedNames(names)) {
    const token = "@" + name;
    const start = caret - token.length;
    if (start >= 0 && text.slice(start, caret) === token) return { start, end: caret };
  }
  return null;
}

/**
 * 光标后紧邻的 `@昵称` 本身（不含尾随空格）
 *
 * @param text - 输入框全文
 * @param caret - 光标下标
 * @param names - 候选昵称（已选提及 + 会话成员）
 * @returns 命中的区间；光标后不是提及则为 null
 *
 * @example
 * mentionTokenAfter("hi @Bob 在吗", 3, ["Bob"]); // { start: 3, end: 7 }
 */
export function mentionTokenAfter(
  text: string,
  caret: number,
  names: string[],
): MentionSpan | null {
  if (caret < 0 || caret >= text.length) return null;
  for (const name of sortedNames(names)) {
    const token = "@" + name;
    if (text.slice(caret, caret + token.length) === token) {
      return { start: caret, end: caret + token.length };
    }
  }
  return null;
}

/**
 * 光标前紧邻的 @提及片段（退格方向，含尾随空格）
 *
 * @description
 * 插入提及时写入的是 `@昵称 `（带一个尾随空格），所以光标停在空格后面也算
 * 紧邻——删除时空格跟着一起消失，不会留下孤立空格。
 *
 * @param text - 输入框全文
 * @param caret - 光标下标（须为折叠光标）
 * @param names - 候选昵称（已选提及 + 会话成员）
 * @returns 命中的区间；光标前不是提及则为 null
 *
 * @example
 * mentionSpanBefore("hi @Bob ", 8, ["Bob"]); // { start: 3, end: 8 }
 */
export function mentionSpanBefore(
  text: string,
  caret: number,
  names: string[],
): MentionSpan | null {
  if (caret <= 0) return null;
  const tokenEnd = text[caret - 1] === " " ? caret - 1 : caret;
  const token = mentionTokenBefore(text, tokenEnd, names);
  return token ? { start: token.start, end: caret } : null;
}

/**
 * 光标后紧邻的 @提及片段（Delete 键方向，含尾随空格）
 *
 * @param text - 输入框全文
 * @param caret - 光标下标（须为折叠光标）
 * @param names - 候选昵称（已选提及 + 会话成员）
 * @returns 命中的区间；光标后不是提及则为 null
 *
 * @example
 * mentionSpanAfter("hi @Bob 在吗", 3, ["Bob"]); // { start: 3, end: 8 }
 */
export function mentionSpanAfter(text: string, caret: number, names: string[]): MentionSpan | null {
  const token = mentionTokenAfter(text, caret, names);
  if (!token) return null;
  return { start: token.start, end: text[token.end] === " " ? token.end + 1 : token.end };
}

/**
 * 修补被逐字符啃掉的 @提及
 *
 * @description
 * 安卓输入法的退格不产生可识别的 keydown（key 为 `Unidentified`、keyCode 229），
 * 而 WebView 74 派发的 beforeinput 是 `cancelable: false`——两条路都拦不下删除动作，
 * 键盘按下时的整体删除在手机上必然失效。于是改成事后修补：一次删除只吃掉一个字符时，
 * 若这个字符正好是某个 `@昵称` 片段的首/末字符，就把该片段余下的部分一并删掉，
 * 结果与桌面端「一次退格清整段」完全一致。
 *
 * @param prev - 删除前的文本
 * @param next - 输入法删除后的文本
 * @param caret - 删除后的光标下标
 * @param names - 候选昵称（已选提及 + 会话成员）
 * @returns 需要改写时返回目标文本与光标；无需改写返回 null
 *
 * @example
 * // 安卓退格把 "@Bob " 啃成 "@Bob"，修补为整段删除
 * repairMentionDeletion("@Bob ", "@Bob", 4, ["Bob"]); // { value: "", caret: 0 }
 */
export function repairMentionDeletion(
  prev: string,
  next: string,
  caret: number,
  names: string[],
): { value: string; caret: number } | null {
  // 只认「正好少了一个字符」：粘贴、整段替换、输入法候选上屏等一律交回正常流程
  if (next.length !== prev.length - 1) return null;
  // 被删字符落在光标处：向前删（退格）与向后删（Delete）删完光标都停在同一下标
  if (prev.slice(0, caret) !== next.slice(0, caret)) return null;
  if (prev.slice(caret + 1) !== next.slice(caret)) return null;

  // 退格：被删的是提及片段的末字符
  const before = mentionSpanBefore(prev, caret + 1, names);
  if (before && before.end === caret + 1) {
    return { value: prev.slice(0, before.start) + prev.slice(before.end), caret: before.start };
  }
  // Delete：被删的是提及片段的首字符（`@`）
  const after = mentionSpanAfter(prev, caret, names);
  if (after && after.start === caret) {
    return { value: prev.slice(0, after.start) + prev.slice(after.end), caret: after.start };
  }
  return null;
}
