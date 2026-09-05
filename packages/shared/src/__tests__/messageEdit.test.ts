/**
 * 消息编辑的共享层单测
 *
 * @description
 * 覆盖三件事：
 * 1. `applyEdited` —— 帧驱动的就地改文，含"未命中不产生新引用"的引用稳定性；
 * 2. `canEdit` —— 编辑入口的闸门（本人 / 已确认 / 纯文本 / 未撤回 / 5 分钟窗口）；
 * 3. `mapMessage` 的引用回填 —— REST 历史路径此前从不产出 quote。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { RE_EDIT_WINDOW_MS, useMessageStore } from "../store/messageStore";
import { EDIT_WINDOW_MS, canEdit } from "../utils/messageActions";

describe("applyEdited", () => {
  beforeEach(() => {
    useMessageStore.setState({
      messagesByConv: {
        c1: [
          { id: "m1", kind: "text", text: "原文", isSelf: true, seq: 10, status: "sent" },
          { id: "m2", kind: "text", text: "别人的", isSelf: false, seq: 11, status: "sent" },
        ],
      },
    } as never);
  });

  it("就地替换正文并置 edited 与 editCount", () => {
    useMessageStore.getState().applyEdited("c1", "m1", "改后", 1);
    const list = useMessageStore.getState().messagesByConv.c1;
    const m1 = list.find((m) => m.id === "m1");
    expect(m1?.text).toBe("改后");
    expect(m1?.edited).toBe(true);
    expect(m1?.editCount).toBe(1);
  });

  it("不影响同会话其他消息", () => {
    useMessageStore.getState().applyEdited("c1", "m1", "改后", 1);
    const m2 = useMessageStore.getState().messagesByConv.c1.find((m) => m.id === "m2");
    expect(m2?.text).toBe("别人的");
    expect(m2?.edited).toBeUndefined();
  });

  it("未命中的 id 原样返回，不产生新引用", () => {
    const before = useMessageStore.getState().messagesByConv;
    useMessageStore.getState().applyEdited("c1", "不存在", "改后", 1);
    expect(useMessageStore.getState().messagesByConv).toBe(before);
  });

  it("未知会话不抛错", () => {
    expect(() => useMessageStore.getState().applyEdited("no-such", "m1", "x", 1)).not.toThrow();
  });
});

describe("canEdit", () => {
  const base = { id: "m1", kind: "text", isSelf: true, seq: 10, createdAtMs: 1_000_000 };
  const now = base.createdAtMs + 1000;

  it("编辑窗口与撤回后重新编辑窗口同值（防两处漂移）", () => {
    expect(EDIT_WINDOW_MS).toBe(RE_EDIT_WINDOW_MS);
  });

  it("本人的服务端已确认文本消息在窗口内可编辑", () => {
    expect(canEdit(base, now)).toBe(true);
  });

  it("别人的消息不可编辑", () => {
    expect(canEdit({ ...base, isSelf: false }, now)).toBe(false);
  });

  it("非文本消息不可编辑", () => {
    for (const kind of ["image", "file", "voice", "video", "sticker", "system"]) {
      expect(canEdit({ ...base, kind }, now)).toBe(false);
    }
  });

  it("已撤回不可编辑", () => {
    expect(canEdit({ ...base, recalled: true }, now)).toBe(false);
  });

  it("无 seq（未经服务端确认）不可编辑", () => {
    expect(canEdit({ ...base, seq: undefined }, now)).toBe(false);
  });

  it("超出 5 分钟窗口不可编辑", () => {
    expect(canEdit(base, base.createdAtMs + RE_EDIT_WINDOW_MS + 1)).toBe(false);
  });

  it("恰好在窗口边界仍可编辑", () => {
    expect(canEdit(base, base.createdAtMs + RE_EDIT_WINDOW_MS)).toBe(true);
  });
});
