/**
 * MentionPicker 组件 — Composer 内的 @ 选择器
 *
 * @description
 * 用户在输入框敲 `@` 后 Composer 弹出的浮层：按当前 query 过滤群成员列表，
 * 键盘上下键选中 + Enter 提交，或直接点击行。选中后由 Composer 把光标处
 * 的 `@query` 段替换成 `@昵称 `，并把 userId+昵称收集到 pickedMentions。
 *
 * @param members - 已过滤的候选成员（Composer 侧根据 query 剪枝）
 * @param onPick - 选中回调（Composer 内完成文本替换与 mentions 累加）
 */
import { useEffect, useState } from "react";
import type { ConversationMember } from "@yuanchat/shared";
import { Avatar } from "./Avatar";

export function MentionPicker({
  members,
  onPick,
}: {
  members: ConversationMember[];
  onPick: (member: ConversationMember) => void;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
  }, [members]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (members.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % members.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + members.length) % members.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onPick(members[active]);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [members, active, onPick]);

  if (members.length === 0) return null;

  return (
    <div className="border-outline-variant bg-surface-container shadow-elevation-3 max-h-64 overflow-y-auto rounded-lg border p-1">
      {members.map((m, i) => (
        <button
          key={m.userId}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(m);
          }}
          className={
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors " +
            (i === active
              ? "bg-primary-container/60 text-primary-on-container"
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
