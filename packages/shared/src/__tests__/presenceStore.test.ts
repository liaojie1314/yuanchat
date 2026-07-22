/**
 * presenceStore 单元测试 — 好友在线状态集合
 */
import { describe, it, expect, beforeEach } from "vitest";
import { usePresenceStore } from "../store/presenceStore";

beforeEach(() => {
  usePresenceStore.setState({ onlineIds: [] });
});

describe("presenceStore", () => {
  it("applySnapshot replaces the online set", () => {
    usePresenceStore.getState().applySnapshot(["u1", "u2"]);
    expect(usePresenceStore.getState().onlineIds).toEqual(["u1", "u2"]);

    usePresenceStore.getState().applySnapshot(["u3"]);
    expect(usePresenceStore.getState().onlineIds).toEqual(["u3"]);
  });

  it("applyPresence online adds without duplicates", () => {
    usePresenceStore.getState().applyPresence("u1", true);
    usePresenceStore.getState().applyPresence("u1", true);
    expect(usePresenceStore.getState().onlineIds).toEqual(["u1"]);
  });

  it("applyPresence offline removes the user", () => {
    usePresenceStore.getState().applySnapshot(["u1", "u2"]);
    usePresenceStore.getState().applyPresence("u1", false);
    expect(usePresenceStore.getState().onlineIds).toEqual(["u2"]);
  });

  it("isOnline reflects current membership", () => {
    usePresenceStore.getState().applySnapshot(["u1"]);
    expect(usePresenceStore.getState().isOnline("u1")).toBe(true);
    expect(usePresenceStore.getState().isOnline("u2")).toBe(false);
  });
});
