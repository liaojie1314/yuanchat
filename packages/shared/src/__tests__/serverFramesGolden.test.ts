/**
 * 服务端 → 客户端 WS 帧的黄金契约测试（前端侧）
 *
 * @description
 * 把 `contracts/server-frames.golden.json` 里的 payload 原样喂给前端消费逻辑，
 * 断言 `messageStore` 按契约语义变化。Go 侧
 * （`server/internal/ws/golden_server_frames_test.go`）用 `DisallowUnknownFields`
 * 反序列化**同一份 JSON**，因此任一端改字段名/类型都会双红。
 *
 * @remarks 除了「喂进去能跑通」，这里还显式断言每个 payload 的**字段集合完全相等**——
 *   只断言若干字段存在的话，契约新增字段时前端会静默漏接。
 *   另：本文件读的是帧上的 `edited_at`（这一次编辑发生的时刻），与
 *   `GET /messages/:id/edits` 每个版本上的 `edited_at`（该版本**被替换**的时刻）
 *   语义不同，勿混用；两者都只能 `new Date(s).getTime()` 后比较，
 *   PATCH 直出 UTC 而历史端点带 +08:00 偏移，字符串比较必错。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { useMessageStore } from "../store/messageStore";
import type { ChatMessage } from "../store/messageStore";
import type { ServerFrames } from "../ws/chatSocket";

const GOLDEN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../contracts/server-frames.golden.json",
);

interface GoldenCase {
  name: string;
  frame: { type: string; payload: Record<string, unknown> };
}

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as { cases: GoldenCase[] };

/** 按帧类型取用例；契约里没有该类型立即失败（而不是静默跳过一条契约）。 */
function frameOf(type: string): Record<string, unknown> {
  const found = golden.cases.find((c) => c.frame.type === type);
  if (!found) throw new Error("golden case not found for frame type: " + type);
  return found.frame.payload;
}

/** 往 store 塞一条待改动的消息，返回该会话 id。 */
function seed(convId: string, msg: Partial<ChatMessage> & { id: string }): void {
  const full: ChatMessage = {
    conversationId: convId,
    kind: "text",
    isSelf: true,
    status: "sent",
    ...msg,
  };
  useMessageStore.setState({ messagesByConv: { [convId]: [full] } });
}

describe("server-frames golden 契约", () => {
  it("契约含 message.edited 与 message.recalled 两个用例", () => {
    const types = golden.cases.map((c) => c.frame.type);
    expect(types).toContain("message.edited");
    expect(types).toContain("message.recalled");
  });

  describe("message.edited", () => {
    const raw = frameOf("message.edited");

    it("字段集合与前端类型声明完全一致（多一个或少一个都红）", () => {
      expect(Object.keys(raw).sort()).toEqual(
        ["conversation_id", "edit_count", "edited_at", "message_id", "seq", "text"].sort(),
      );
    });

    it("字段类型正确，且 edited_at 可被 Date 解析", () => {
      expect(typeof raw.message_id).toBe("string");
      expect(typeof raw.conversation_id).toBe("string");
      expect(typeof raw.seq).toBe("number");
      expect(typeof raw.text).toBe("string");
      expect(typeof raw.edited_at).toBe("string");
      expect(typeof raw.edit_count).toBe("number");
      expect(Number.isFinite(new Date(String(raw.edited_at)).getTime())).toBe(true);
    });

    it("喂进 applyEdited 后正文被替换、edited 置位、editCount 同步", () => {
      // 逐字段搬进前端类型：契约或类型任一侧改名，这段就编译不过 / 断言变 undefined
      const p: ServerFrames["message.edited"] = {
        message_id: raw.message_id as string,
        conversation_id: raw.conversation_id as string,
        seq: raw.seq as number,
        text: raw.text as string,
        edited_at: raw.edited_at as string,
        edit_count: raw.edit_count as number,
      };
      seed(p.conversation_id, { id: p.message_id, text: "编辑前", seq: p.seq });

      useMessageStore.getState().applyEdited(p.conversation_id, p.message_id, p.text, p.edit_count);

      const m = useMessageStore.getState().messagesByConv[p.conversation_id][0];
      expect(m.text).toBe(p.text);
      expect(m.text).not.toBe("编辑前");
      expect(m.edited).toBe(true);
      expect(m.editCount).toBe(p.edit_count);
    });
  });

  describe("message.recalled", () => {
    const raw = frameOf("message.recalled");

    it("字段集合与前端类型声明完全一致（多一个或少一个都红）", () => {
      expect(Object.keys(raw).sort()).toEqual(
        ["conversation_id", "message_id", "operator_id", "operator_nickname", "seq"].sort(),
      );
    });

    it("字段类型正确", () => {
      expect(typeof raw.message_id).toBe("string");
      expect(typeof raw.conversation_id).toBe("string");
      expect(typeof raw.seq).toBe("number");
      expect(typeof raw.operator_id).toBe("string");
      expect(typeof raw.operator_nickname).toBe("string");
    });

    it("喂进 applyRecall 后 recalled 置位、正文清空并留底供重新编辑", () => {
      const p: ServerFrames["message.recalled"] = {
        message_id: raw.message_id as string,
        conversation_id: raw.conversation_id as string,
        seq: raw.seq as number,
        operator_id: raw.operator_id as string,
        operator_nickname: raw.operator_nickname as string,
      };
      seed(p.conversation_id, { id: p.message_id, text: "撤回前", seq: p.seq });

      useMessageStore.getState().applyRecall(p.conversation_id, p.message_id, p.operator_nickname);

      const m = useMessageStore.getState().messagesByConv[p.conversation_id][0];
      expect(m.recalled).toBe(true);
      expect(m.text).toBeUndefined();
      // 本人的文本消息撤回后留底，5 分钟内可"重新编辑"
      expect(m.recalledText).toBe("撤回前");
    });
  });
});
