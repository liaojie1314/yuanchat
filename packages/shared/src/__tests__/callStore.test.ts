/**
 * callStore 状态机单测
 *
 * @description
 * 通话状态是三端唯一真源，任何一条分支写错都会表现为「界面卡在某一态」——
 * 这类缺陷在真机上极难复现（要两端同时在线），故全部分支在这里钉死。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useCallStore } from "../store/callStore";

const P = (conn: string, state: "invited" | "joined" = "joined") => ({
  user_id: "u-" + conn,
  conn_id: conn,
  nickname: "N" + conn,
  avatar_url: null,
  state,
});

describe("callStore", () => {
  beforeEach(() => useCallStore.getState().reset());

  it("来电帧把 phase 推到 incoming 并记住主叫", () => {
    useCallStore.getState().applyIncoming({
      call_id: "c1",
      conversation_id: "v1",
      media: "video",
      caller: { id: "a", nickname: "Alice", avatar_url: null, short_id: 1 },
      participants: [P("ca")],
    });
    const s = useCallStore.getState();
    expect(s.phase).toBe("incoming");
    expect(s.callId).toBe("c1");
    expect(s.conversationId).toBe("v1");
    expect(s.media).toBe("video");
    expect(s.caller ? s.caller.nickname : null).toBe("Alice");
  });

  it("state 帧进 active 时记下开始时刻，重复帧不刷新它", () => {
    const st = useCallStore.getState();
    st.applyIncoming({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      caller: { id: "a", nickname: "A", avatar_url: null, short_id: 1 },
      participants: [P("ca")],
    });
    st.applyState({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      state: "active",
      self_conn: "cb",
      participants: [P("ca"), P("cb")],
    });
    const first = useCallStore.getState().startedAt;
    expect(useCallStore.getState().phase).toBe("active");
    expect(useCallStore.getState().selfConn).toBe("cb");
    expect(first).not.toBeNull();

    st.applyState({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      state: "active",
      self_conn: "cb",
      participants: [P("ca"), P("cb"), P("cc")],
    });
    // 通话时长必须从第一次接通算起：每来一帧就刷新会让计时器一直归零
    expect(useCallStore.getState().startedAt).toBe(first);
    expect(useCallStore.getState().participants).toHaveLength(3);
  });

  it("ended 帧无条件复位，并保留终结原因供 toast 用", () => {
    const st = useCallStore.getState();
    st.applyIncoming({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      caller: { id: "a", nickname: "A", avatar_url: null, short_id: 1 },
      participants: [P("ca")],
    });
    st.applyEnded({ call_id: "c1", reason: "rejected", duration: 0 });
    expect(useCallStore.getState().phase).toBe("idle");
    expect(useCallStore.getState().endReason).toBe("rejected");
    expect(useCallStore.getState().callId).toBeNull();
    expect(useCallStore.getState().participants).toEqual([]);
  });

  it("非当前通话的帧一律忽略", () => {
    const st = useCallStore.getState();
    st.applyIncoming({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      caller: { id: "a", nickname: "A", avatar_url: null, short_id: 1 },
      participants: [P("ca")],
    });
    // 通话中又来一路 ended：串号会把正在进行的通话直接挂掉
    st.applyEnded({ call_id: "OTHER", reason: "completed", duration: 9 });
    expect(useCallStore.getState().phase).toBe("incoming");
    // state 帧同理：另一路房间的成员表不能覆盖当前房间
    st.applyState({
      call_id: "OTHER",
      conversation_id: "v9",
      media: "video",
      state: "active",
      self_conn: "cx",
      participants: [P("cx")],
    });
    expect(useCallStore.getState().phase).toBe("incoming");
    expect(useCallStore.getState().conversationId).toBe("v1");
  });

  it("已在通话中时再来一路 incoming 不抢占当前通话", () => {
    const st = useCallStore.getState();
    st.startOutgoing("v1", "audio", ["u2"]);
    st.applyIncoming({
      call_id: "c9",
      conversation_id: "v9",
      media: "audio",
      caller: { id: "z", nickname: "Z", avatar_url: null, short_id: 9 },
      participants: [P("cz")],
    });
    // 忙线由服务端 Lua 兜底，客户端这里也不能让第二路来电顶掉正在呼出的那路
    expect(useCallStore.getState().phase).toBe("outgoing");
    expect(useCallStore.getState().conversationId).toBe("v1");
  });

  it("startOutgoing 记下会话/媒体/受邀人并清掉上一轮的终结原因", () => {
    const st = useCallStore.getState();
    st.startOutgoing("v1", "audio", []);
    st.applyState({
      call_id: "c0",
      conversation_id: "v1",
      media: "audio",
      state: "ringing",
      self_conn: "ca",
      participants: [P("ca")],
    });
    st.applyEnded({ call_id: "c0", reason: "busy", duration: 0 });
    expect(useCallStore.getState().endReason).toBe("busy");

    st.startOutgoing("v2", "video", ["u1", "u2"]);
    const s = useCallStore.getState();
    expect(s.phase).toBe("outgoing");
    expect(s.conversationId).toBe("v2");
    expect(s.media).toBe("video");
    expect(s.inviteeIds).toEqual(["u1", "u2"]);
    expect(s.callId).toBeNull();
    expect(s.endReason).toBeNull();
  });

  it("最小化/静音/摄像头开关是纯 UI 态，不影响 phase", () => {
    const st = useCallStore.getState();
    st.startOutgoing("v1", "video", []);
    st.setMinimized(true);
    st.toggleMute();
    st.toggleCamera();
    const s = useCallStore.getState();
    expect(s.minimized).toBe(true);
    expect(s.muted).toBe(true);
    expect(s.cameraOff).toBe(true);
    expect(s.phase).toBe("outgoing");
    st.toggleMute();
    expect(useCallStore.getState().muted).toBe(false);
  });

  it("呼出期收到本路 call.state 后 callId 就位，ringing 态仍停在 outgoing", () => {
    const st = useCallStore.getState();
    st.startOutgoing("v1", "audio", ["u2"]);
    st.applyState({
      call_id: "c5",
      conversation_id: "v1",
      media: "audio",
      state: "ringing",
      self_conn: "ca",
      participants: [P("ca"), P("cb", "invited")],
    });
    const s = useCallStore.getState();
    expect(s.callId).toBe("c5");
    expect(s.phase).toBe("outgoing");
    expect(s.startedAt).toBeNull();
  });

  it("会话内非参与者收到的 call.state（self_conn 为空）不把自己拖进通话", () => {
    const st = useCallStore.getState();
    st.applyState({
      call_id: "c7",
      conversation_id: "v7",
      media: "audio",
      state: "active",
      self_conn: "",
      participants: [P("ca"), P("cb")],
    });
    // 群里其他成员只用这帧渲染「通话中」横幅，phase 必须保持 idle
    const banner = useCallStore.getState().banner;
    expect(useCallStore.getState().phase).toBe("idle");
    expect(banner).not.toBeNull();
    expect(banner ? banner.conversationId : "").toBe("v7");
    expect(banner ? banner.callId : "").toBe("c7");

    // 该通话结束后横幅必须消失，否则群里永远挂着一条「加入通话」
    st.applyEnded({ call_id: "c7", reason: "completed", duration: 12 });
    expect(useCallStore.getState().banner).toBeNull();
  });
});

describe("同账号多设备顶替", () => {
  beforeEach(() => useCallStore.getState().reset());

  /** 让本端处于「已接通、self_conn = mine」的通话中 */
  function activeAs(mine: string) {
    const st = useCallStore.getState();
    st.applyState({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      state: "active",
      self_conn: mine,
      participants: [P(mine), P("peer")],
    });
    expect(useCallStore.getState().phase).toBe("active");
    expect(useCallStore.getState().selfConn).toBe(mine);
  }

  it("收到同一路通话但 self_conn 换成别的连接时自行退出", () => {
    activeAs("mine");

    // 同账号的另一台设备接了同一通电话，服务端那一格被它覆写
    useCallStore.getState().applyState({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      state: "active",
      self_conn: "other-device",
      participants: [P("other-device"), P("peer")],
    });

    const after = useCallStore.getState();
    // 不自退就是一个永远接不通的僵尸通话界面：本端的 offer 会被服务端 403 掉
    expect(after.phase).toBe("idle");
    expect(after.callId).toBeNull();
    expect(after.endReason).toBe("superseded");
    // 本端的连接不该被当成房间成员渲染
    expect(after.selfConn).toBe("");
  });

  it("顶替判定不会误伤正常的成员变更（self_conn 不变）", () => {
    activeAs("mine");

    useCallStore.getState().applyState({
      call_id: "c1",
      conversation_id: "v1",
      media: "audio",
      state: "active",
      self_conn: "mine",
      participants: [P("mine"), P("peer"), P("peer2")],
    });

    expect(useCallStore.getState().phase).toBe("active");
    expect(useCallStore.getState().participants).toHaveLength(3);
  });

  it("另一路通话的 state 不被误判为顶替", () => {
    activeAs("mine");

    useCallStore.getState().applyState({
      call_id: "OTHER",
      conversation_id: "v9",
      media: "video",
      state: "active",
      self_conn: "x",
      participants: [P("x")],
    });

    // 串号拦截优先：另一路房间的帧本就该被丢弃，不能顺手把当前通话退了
    expect(useCallStore.getState().phase).toBe("active");
    expect(useCallStore.getState().callId).toBe("c1");
  });
});
