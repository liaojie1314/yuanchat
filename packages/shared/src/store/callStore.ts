/**
 * 通话状态机 Store — 三端唯一真源
 *
 * @description
 * 通话是本仓唯一「两端同时在线才能复现」的功能，界面卡在某一态的缺陷在真机上几乎
 * 无法复查，故全部状态迁移集中在这里、由单测钉死，UI 只读不判。
 *
 * ```
 * idle ──invite──> outgoing ──首个 joined──> active ──leave/ended──> idle
 *  │                  │                        │
 *  │                  └──ended(canceled/timeout/busy/rejected)──> idle
 *  └──call.incoming──> incoming ──accept──> active
 *                           └──reject/ended──> idle
 * ```
 *
 * 三条贯穿全部 `apply*` 的规则：
 * 1. **串号必须拦住**：不属于当前通话的帧一律忽略，否则另一路房间的 `call.ended`
 *    会把正在进行的通话直接挂掉
 * 2. **`startedAt` 只写一次**：每来一帧就刷新会让通话计时器一直归零
 * 3. **`minimized` / `muted` / `cameraOff` 与 phase 正交**，纯 UI 态
 *
 * 刻意**不**持有 `MediaStream` / `RTCPeerConnection`：它们不是可序列化状态，
 * 放进 store 会让 devtools 序列化与 React 比较双双出问题（见 webrtc/peerMesh.ts）。
 */
import { create } from "zustand";
import type { CallMedia, CallParticipant, ServerFrames } from "../ws/chatSocket";

/** 通话阶段。`idle` 表示本端不在任何通话里（会话横幅不算）。 */
export type CallPhase = "idle" | "outgoing" | "incoming" | "active";

/** 主叫简介（来电界面的大头像与昵称）。 */
export interface CallCaller {
  id: string;
  nickname: string;
  avatar_url?: string | null;
}

/**
 * 会话内「通话中」横幅所需信息。
 *
 * 只给**非参与者**用：群里其他成员收到的 `call.state` 里 `self_conn` 为空串，
 * 他们看到的是一条「%{name} 发起了通话 / 加入」横幅，而不是通话界面。
 */
export interface CallBanner {
  callId: string;
  conversationId: string;
  media: CallMedia;
  /** 横幅文案里的发起人昵称：取房间里首个已加入者（振铃期只有主叫是 joined） */
  callerName: string;
  /** 已加入人数：点「加入」前据此前置拦住满员，不必等服务端回「人数已满」 */
  joinedCount: number;
}

/** mesh 全连接的人数上限（与服务端 `MaxCallParticipants` 一致，上调前先换 SFU） */
export const MAX_CALL_PARTICIPANTS = 4;

interface CallState {
  phase: CallPhase;
  callId: string | null;
  conversationId: string | null;
  media: CallMedia;
  /** 本端在房间里的连接 id，mesh 的 glare 消解按它与对端做字典序比较 */
  selfConn: string;
  participants: CallParticipant[];
  caller: CallCaller | null;
  /** 本端发起时选中的受邀人（呼出界面显示「正在呼叫…」的对象） */
  inviteeIds: string[];
  minimized: boolean;
  muted: boolean;
  cameraOff: boolean;
  /** 首次接通时刻（epoch ms），通话时长从这里算起 */
  startedAt: number | null;
  /** 上一通电话的终结原因，供 toast 展示；下一次 startOutgoing 时清掉 */
  endReason: string | null;
  banner: CallBanner | null;

  /** `call.incoming` 帧：推到振铃态并记住主叫 */
  applyIncoming: (p: ServerFrames["call.incoming"]) => void;
  /** `call.state` 帧：成员表增量、接通判定、以及非参与者的横幅 */
  applyState: (p: ServerFrames["call.state"]) => void;
  /** `call.ended` 帧：复位全部通话字段，只留 `endReason` */
  applyEnded: (p: ServerFrames["call.ended"]) => void;
  /** 本端发起呼叫（`call.invite` 发出前调用，此时还没有 call_id） */
  startOutgoing: (conversationId: string, media: CallMedia, inviteeIds: string[]) => void;
  setMinimized: (v: boolean) => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  /** 复位到 idle（挂断/拒接后本端立即出画，不等服务端帧回来） */
  reset: () => void;
}

/** 通话相关字段的初值（`reset` 与 `applyEnded` 共用，避免两处各漏一个字段） */
const IDLE = {
  phase: "idle" as CallPhase,
  callId: null,
  conversationId: null,
  media: "audio" as CallMedia,
  selfConn: "",
  participants: [] as CallParticipant[],
  caller: null,
  inviteeIds: [] as string[],
  minimized: false,
  muted: false,
  cameraOff: false,
  startedAt: null,
};

/** 房间里首个已加入者的昵称（横幅文案用；空房间回退空串） */
function firstJoinedName(participants: CallParticipant[]): string {
  for (let i = 0; i < participants.length; i++) {
    if (participants[i].state === "joined") return participants[i].nickname;
  }
  return "";
}

export const useCallStore = create<CallState>()((set, get) => ({
  ...IDLE,
  endReason: null,
  banner: null,

  applyIncoming: (p) => {
    // 已在通话中时第二路来电不抢占：忙线本该由服务端 Lua 兜底，但呼出期
    // （callId 尚未就位）服务端还不知道本端占线，客户端必须自己挡一次
    if (get().phase !== "idle") return;
    set({
      ...IDLE,
      phase: "incoming",
      callId: p.call_id,
      conversationId: p.conversation_id,
      media: p.media,
      participants: p.participants,
      caller: { id: p.caller.id, nickname: p.caller.nickname, avatar_url: p.caller.avatar_url },
      endReason: null,
    });
  },

  applyState: (p) => {
    const s = get();

    // self_conn 为空串 = 本端不是这一路的参与者（会话内的旁观成员）：
    // 只更新横幅，phase 必须保持原样，否则群里每个人都会被拖进通话界面
    if (!p.self_conn) {
      if (s.callId === p.call_id) return;
      set({
        banner: {
          callId: p.call_id,
          conversationId: p.conversation_id,
          media: p.media,
          callerName: firstJoinedName(p.participants),
          joinedCount: p.participants.filter((x) => x.state === "joined").length,
        },
      });
      return;
    }

    // 串号拦截：本端已有 call_id 且与帧不符 → 另一路房间的成员表，不能覆盖当前房间。
    // callId 为空的例外只有一个：呼出期本路的首帧（此时按 conversation_id 认亲）
    if (s.callId !== null) {
      if (s.callId !== p.call_id) return;
    } else if (s.phase !== "idle" && s.conversationId !== p.conversation_id) {
      return;
    }

    const active = p.state === "active";
    // idle 态收到带 self_conn 的帧 = 通话窗口重开/刷新后的恢复路径（桌面独立窗口）
    const phase: CallPhase = active ? "active" : s.phase === "idle" ? "outgoing" : s.phase;
    set({
      phase,
      callId: p.call_id,
      conversationId: p.conversation_id,
      media: p.media,
      selfConn: p.self_conn,
      participants: p.participants,
      // 通话时长必须从第一次接通算起：重复的 active 帧（有人加入/离开）不得刷新它
      startedAt: active && s.startedAt === null ? Date.now() : s.startedAt,
    });
  },

  applyEnded: (p) => {
    const s = get();
    // 该通话的横幅必须跟着消失，否则群里永远挂着一条「加入通话」
    const banner = s.banner !== null && s.banner.callId === p.call_id ? null : s.banner;
    if (s.callId !== p.call_id) {
      if (banner !== s.banner) set({ banner });
      return;
    }
    set({ ...IDLE, endReason: p.reason, banner });
  },

  startOutgoing: (conversationId, media, inviteeIds) =>
    set({
      ...IDLE,
      phase: "outgoing",
      conversationId,
      media,
      inviteeIds,
      // 上一轮的终结原因留着会让新通话刚开始就弹「对方忙线」
      endReason: null,
    }),

  setMinimized: (v) => set({ minimized: v }),

  toggleMute: () => set((s) => ({ muted: !s.muted })),

  toggleCamera: () => set((s) => ({ cameraOff: !s.cameraOff })),

  reset: () => set({ ...IDLE, endReason: null, banner: null }),
}));
