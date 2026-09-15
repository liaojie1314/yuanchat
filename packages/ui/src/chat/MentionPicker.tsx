/**
 * MentionPicker 组件 — Composer 内的 @ 选择器
 *
 * @description
 * 用户在输入框敲 `@` 后 Composer 弹出的浮层：按当前 query 过滤群成员列表，
 * 高亮项与键盘导航一律由 Composer 掌管（受控组件），本组件只负责渲染与鼠标交互。
 *
 * 键盘不在这里监听是刻意的：早先版本自己在 document 上挂捕获阶段 keydown，
 * 和 Composer 的 onKeyDown 分属两个监听器，Composer 那侧读到的是上一次渲染的
 * 闭包状态，Enter 于是既选人又把消息发了出去。选中态上提到 Composer 后，
 * Enter 只走一条代码路径，不再有先后顺序之争。
 *
 * @param members - 已过滤的候选成员（Composer 侧根据 query 剪枝）
 * @param activeIndex - 当前高亮下标（由 Composer 持有）
 * @param onActiveChange - 鼠标移入时上报高亮下标
 * @param onPick - 选中回调（Composer 内完成文本替换与 mentions 累加）
 */
import { useTranslation } from "react-i18next";
import type { ConversationMember } from "@yuanchat/shared";
import { Avatar } from "../primitives/Avatar";

export function MentionPicker({
  members,
  activeIndex,
  onActiveChange,
  onPick,
}: {
  members: ConversationMember[];
  activeIndex: number;
  onActiveChange: (index: number) => void;
  onPick: (member: ConversationMember) => void;
}) {
  const { t } = useTranslation();

  if (members.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label={t("chat.mention.trigger")}
      className="border-outline-variant bg-surface-container shadow-elevation-3 max-h-64 overflow-y-auto rounded-lg border p-1"
    >
      {members.map((m, i) => (
        <button
          key={m.userId}
          role="option"
          aria-selected={i === activeIndex}
          onMouseEnter={() => onActiveChange(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(m);
          }}
          className={
            // 行圆角取面板圆角(16px)减去内边距(4px)=12px，同心才不显得方
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors " +
            // 高亮项是 Enter 的作用对象：主色浅底 + 主色描边 + 主色文字，
            // 既一眼看得出选中，又不像实心色块那样压住头像
            (i === activeIndex
              ? "bg-primary/10 ring-primary/30 text-primary font-medium ring-1 ring-inset"
              : "hover:bg-surface-container-high")
          }
        >
          <Avatar name={m.nickname} src={m.avatarUrl} size="sm" />
          <span className="text-body-md truncate">{m.nickname}</span>
        </button>
      ))}
    </div>
  );
}
