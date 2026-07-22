/**
 * contactStore 单元测试
 *
 * 覆盖：字母分组（中文拼音/英文/符号归 #）、pendingInCount 角标、
 * WS 增量（applyIncomingRequest 置顶去重 / applyAccepted 翻状态+加好友）。
 * REST 动作（accept/reject/sendRequest）走 MSW 在 E2E 验证，此处不重复。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { groupFriends, indexLetterOf, useContactStore } from "../store/contactStore";
import { useConversationStore } from "../store/conversationStore";
import type { Friend, FriendRequestItem } from "../api/contacts";

const friend = (id: string, nickname: string): Friend => ({
  id,
  nickname,
  avatarUrl: null,
  shortId: 1,
  conversationId: null,
});

const request = (id: string, direction: "in" | "out", status: 0 | 1 | 2): FriendRequestItem => ({
  id,
  direction,
  status,
  message: "",
  peer: { id: "peer_" + id, nickname: "Peer", avatarUrl: null, shortId: 2 },
  updatedAt: "2026-07-16T10:00:00Z",
});

beforeEach(() => {
  useContactStore.setState({ friends: [], requests: [], loading: false });
  useConversationStore.setState({ conversations: [], activeId: null, loading: false });
});

describe("indexLetterOf", () => {
  it("uppercases latin initials", () => {
    expect(indexLetterOf("alice")).toBe("A");
    expect(indexLetterOf("Bob")).toBe("B");
  });

  it("converts chinese to pinyin initial", () => {
    expect(indexLetterOf("张伟")).toBe("Z");
    expect(indexLetterOf("陈曦")).toBe("C");
    expect(indexLetterOf("李娜")).toBe("L");
  });

  it("falls back to # for digits/symbols/empty", () => {
    expect(indexLetterOf("123")).toBe("#");
    expect(indexLetterOf("~wave")).toBe("#");
    expect(indexLetterOf("")).toBe("#");
  });
});

describe("groupFriends", () => {
  it("groups and sorts A-Z with # last", () => {
    const groups = groupFriends([
      friend("1", "张伟"),
      friend("2", "Amy"),
      friend("3", "陈曦"),
      friend("4", "123abc"),
      friend("5", "Alice"),
    ]);

    expect(groups.map((g) => g.letter)).toEqual(["A", "C", "Z", "#"]);
    expect(groups[0].friends.map((f) => f.nickname)).toEqual(["Alice", "Amy"]);
  });

  it("returns empty for no friends", () => {
    expect(groupFriends([])).toEqual([]);
  });
});

describe("pendingInCount", () => {
  it("counts only incoming pending requests", () => {
    useContactStore.setState({
      requests: [
        request("1", "in", 0),
        request("2", "in", 1), // 已同意不计
        request("3", "out", 0), // 我发出的不计
        request("4", "in", 0),
      ],
    });
    expect(useContactStore.getState().pendingInCount()).toBe(2);
  });
});

describe("applyIncomingRequest", () => {
  it("prepends new request", () => {
    useContactStore.setState({ requests: [request("old", "in", 0)] });
    useContactStore.getState().applyIncomingRequest(request("new", "in", 0));

    const ids = useContactStore.getState().requests.map((r) => r.id);
    expect(ids).toEqual(["new", "old"]);
  });

  it("dedupes re-application of the same request id", () => {
    useContactStore.setState({ requests: [request("dup", "in", 2)] });
    useContactStore
      .getState()
      .applyIncomingRequest({ ...request("dup", "in", 0), message: "again" });

    const requests = useContactStore.getState().requests;
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe(0);
    expect(requests[0].message).toBe("again");
  });
});

describe("applyAccepted", () => {
  it("flips outgoing request status and adds friend with conversation", () => {
    useContactStore.setState({ requests: [request("req1", "out", 0)] });

    useContactStore
      .getState()
      .applyAccepted(
        "req1",
        { id: "u9", nickname: "New Friend", avatarUrl: null, shortId: 9 },
        "conv9",
      );

    const s = useContactStore.getState();
    expect(s.requests[0].status).toBe(1);
    expect(s.friends).toHaveLength(1);
    expect(s.friends[0].conversationId).toBe("conv9");
  });

  it("does not duplicate an existing friend", () => {
    useContactStore.setState({
      friends: [friend("u9", "Existing")],
      requests: [request("req1", "out", 0)],
    });

    useContactStore
      .getState()
      .applyAccepted(
        "req1",
        { id: "u9", nickname: "Existing", avatarUrl: null, shortId: 9 },
        "conv9",
      );

    expect(useContactStore.getState().friends).toHaveLength(1);
  });
});
