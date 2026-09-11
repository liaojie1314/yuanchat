package ws

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// SetCallService 注入通话服务与「通话终结」回调（装配层调用一次）。
//
// onCallEnd 在房间终结时被调用，用于落一条通话记录系统消息。
// 它走回调而不是让 ws 直接依赖 ConversationService：ws 已经通过 MessageService
// 拿到了发送能力，再多一条 service 依赖会让这个包变成什么都认识的胖节点。
func (h *Handler) SetCallService(
	svc *service.CallService,
	onEnd func(ctx context.Context, room *service.Room, reason service.EndReason, duration int),
) {
	h.callSvc = svc
	h.onCallEnd = onEnd
}

// SetConversationMembers 注入「取会话成员并校验请求者是其中一员」的解析器。
func (h *Handler) SetConversationMembers(
	fn func(ctx context.Context, userID, convID uuid.UUID) ([]uuid.UUID, error),
) {
	h.callMembers = fn
}

// SetUserBriefs 注入批量用户摘要解析器（通话帧的参与者列表要带昵称与头像）。
func (h *Handler) SetUserBriefs(
	fn func(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]UserBrief, error),
) {
	h.callProfiles = fn
}

// callReady 通话依赖是否装配齐全。未装配时通话帧一律回错误，
// 而不是空指针崩掉整个连接的读协程。
func (h *Handler) callReady() bool {
	return h.callSvc != nil && h.callMembers != nil && h.callProfiles != nil
}

// handleCallInvite 发起通话：校验会话成员关系与邀请人数 → 建房 → 推来电与房间态。
func (h *Handler) handleCallInvite(c *Client, env *Envelope) {
	if !h.callReady() {
		c.sendError(503, "call service unavailable", "")
		return
	}
	var p CallInvitePayload
	if err := unmarshalPayload(env, &p); err != nil {
		c.sendError(400, "invalid call.invite payload", "")
		return
	}
	if p.Media != string(service.CallMediaAudio) && p.Media != string(service.CallMediaVideo) {
		c.sendError(400, "media must be audio or video", "")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	// 成员校验：非会话成员不得对该会话发起通话（否则知道 conversation_id
	// 就能让群里所有人的手机响起来）
	members, err := h.callMembers(ctx, c.userID, p.ConversationID)
	if err != nil {
		c.sendError(403, "not a conversation member", "")
		return
	}

	invitees, ok := h.resolveInvitees(c, members, p.InviteeIDs)
	if !ok {
		return
	}

	room, skipped, err := h.callSvc.Create(ctx, c.userID, c.connID.String(), p.ConversationID,
		service.CallMedia(p.Media), invitees)
	if err != nil {
		if errors.Is(err, service.ErrCallBusy) {
			c.sendError(409, "you are already in a call", "")
			return
		}
		h.logger.Error("创建通话房间失败", zap.Error(err), zap.String("user_id", c.userID.String()))
		c.sendError(500, "failed to start call", "")
		return
	}

	// 全部被邀请者都忙线：立刻终结，主叫收到 busy 而不是干等 60 秒振铃
	if len(invitees) > 0 && len(skipped) == len(invitees) {
		h.endCall(ctx, room.CallID, service.EndBusy)
		return
	}

	briefs := h.briefsFor(ctx, room)
	// 来电只推给真正被邀请上的人（忙线者已被 Create 跳过，不在 participants 里）
	ring := make([]uuid.UUID, 0, len(room.Participants))
	for _, part := range room.Participants {
		if part.UserID != c.userID {
			ring = append(ring, part.UserID)
		}
	}
	if frame, err := Encode(TypeCallIncoming, CallIncomingPayload{
		CallID:         room.CallID,
		ConversationID: room.ConversationID,
		Media:          string(room.Media),
		Caller:         briefs[c.userID],
		Participants:   callParticipants(room, briefs),
	}); err == nil && len(ring) > 0 {
		h.hub.SendToUsers(ring, frame)
	}

	h.broadcastState(ctx, room, members)
	h.scheduleRingTimeout(room.CallID)
}

// resolveInvitees 定出本次要邀请的人，并校验全部是会话成员、人数不超房间上限。
//
// 单聊可省略 invitee_ids（取另一方）；群聊必须显式勾选 —— 几十人的群里全员振铃
// 既是骚扰，也超过 mesh 的 4 人上限，第 4 个之后接听的人只会被拒。
func (h *Handler) resolveInvitees(c *Client, members, requested []uuid.UUID) ([]uuid.UUID, bool) {
	if len(requested) == 0 {
		if len(members) != 2 {
			c.sendError(400, "invitee_ids required for group call", "")
			return nil, false
		}
		for _, id := range members {
			if id != c.userID {
				return []uuid.UUID{id}, true
			}
		}
		c.sendError(400, "no invitee found", "")
		return nil, false
	}
	if len(requested) > service.MaxCallParticipants-1 {
		c.sendError(400, "too many invitees", "")
		return nil, false
	}
	member := make(map[uuid.UUID]struct{}, len(members))
	for _, id := range members {
		member[id] = struct{}{}
	}
	for _, id := range requested {
		if _, ok := member[id]; !ok || id == c.userID {
			c.sendError(403, "invitee is not a conversation member", "")
			return nil, false
		}
	}
	return requested, true
}

// handleCallAnswer 接听或拒绝。accept=true 同时是群通话「主动加入」的入口。
func (h *Handler) handleCallAnswer(c *Client, env *Envelope) {
	if !h.callReady() {
		c.sendError(503, "call service unavailable", "")
		return
	}
	var p CallAnswerPayload
	if err := unmarshalPayload(env, &p); err != nil {
		c.sendError(400, "invalid call.answer payload", "")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	if !p.Accept {
		h.leaveCall(ctx, p.CallID, c.userID)
		return
	}

	// 加入前再校验一次会话成员关系：群通话允许未被邀请的成员主动加入，
	// 但「未被邀请」不等于「谁都能进」—— 不校验的话知道 call_id 即可旁听。
	room, err := h.callSvc.Get(ctx, p.CallID)
	if err != nil {
		c.sendError(404, "call not found", "")
		return
	}
	if _, err := h.callMembers(ctx, c.userID, room.ConversationID); err != nil {
		c.sendError(403, "not a conversation member", "")
		return
	}

	joined, err := h.callSvc.Join(ctx, p.CallID, c.userID, c.connID.String())
	if err != nil {
		switch {
		case errors.Is(err, service.ErrCallFull):
			c.sendError(409, "call is full", "")
		case errors.Is(err, service.ErrCallBusy):
			c.sendError(409, "you are already in a call", "")
		case errors.Is(err, service.ErrCallNotFound):
			c.sendError(404, "call not found", "")
		default:
			h.logger.Error("加入通话失败", zap.Error(err), zap.String("call_id", p.CallID.String()))
			c.sendError(500, "failed to join call", "")
		}
		return
	}

	members, err := h.callMembers(ctx, c.userID, joined.ConversationID)
	if err != nil {
		members = nil
	}
	h.broadcastState(ctx, joined, members)
}

// handleCallLeave 挂断 / 取消 / 退出（同一语义：离开房间）。
func (h *Handler) handleCallLeave(c *Client, env *Envelope) {
	if !h.callReady() {
		c.sendError(503, "call service unavailable", "")
		return
	}
	var p CallLeavePayload
	if err := unmarshalPayload(env, &p); err != nil {
		c.sendError(400, "invalid call.leave payload", "")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	h.leaveCall(ctx, p.CallID, c.userID)
}

// handleCallSignal 转发 SDP / ICE。
//
// 双向校验「发送方与目标都在房间里」是必需的：不校验就等于把服务器变成
// 任意连接之间的转发器，任何登录用户都能凭一个猜到的 conn_id 往别人连接上塞帧。
func (h *Handler) handleCallSignal(c *Client, env *Envelope) {
	if !h.callReady() {
		c.sendError(503, "call service unavailable", "")
		return
	}
	var p CallSignalPayload
	if err := unmarshalPayload(env, &p); err != nil {
		c.sendError(400, "invalid call.signal payload", "")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	room, err := h.callSvc.Get(ctx, p.CallID)
	if err != nil {
		c.sendError(404, "call not found", "")
		return
	}
	self := c.connID.String()
	var target *service.Participant
	inRoom := false
	for i := range room.Participants {
		part := &room.Participants[i]
		if part.ConnID == self {
			inRoom = true
		}
		if part.ConnID == p.ToConn && p.ToConn != "" {
			target = part
		}
	}
	if !inRoom || target == nil {
		c.sendError(403, "not a call participant", "")
		return
	}

	from := c.userID
	frame, err := Encode(TypeCallSignal, CallSignalPayload{
		CallID:   p.CallID,
		ToConn:   "",
		FromConn: self,
		FromUser: &from,
		Data:     p.Data,
	})
	if err != nil {
		return
	}
	// 目标连接不在本实例时（多实例部署）退回按用户扇出，由客户端凭 from_conn
	// 与自己的 participants 判断是否该收 —— 同一用户的其他设备收到也无害。
	if !h.hub.SendToConn(uuid.MustParse(orZeroUUID(target.ConnID)), frame) {
		h.hub.SendToUsers([]uuid.UUID{target.UserID}, frame)
	}
}

// HandleDisconnect 连接断开时把它从所属通话房间里摘掉。
//
// 关窗口、拔网线、杀进程、手机被系统回收都会走到这里。没有它，一方掉线后
// 另一方会永远停在「通话中」，只能等 Redis 的 2 小时 TTL 到期。
func (h *Handler) HandleDisconnect(userID, connID uuid.UUID) {
	if !h.callReady() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	callID, owner, ok := h.callSvc.CallIDForConn(ctx, connID.String())
	if !ok || owner != userID {
		return
	}
	h.leaveCall(ctx, callID, userID)
}

// leaveCall 执行离开并广播结果：终结则推 call.ended 给离开前的全体参与者，
// 未终结则推新的房间态。
func (h *Handler) leaveCall(ctx context.Context, callID, userID uuid.UUID) {
	room, ended, reason, duration, err := h.callSvc.Leave(ctx, callID, userID)
	if err != nil {
		// 房间已不存在属正常竞态（双方同时挂断），不记错误日志
		if !errors.Is(err, service.ErrCallNotFound) {
			h.logger.Warn("离开通话失败", zap.Error(err), zap.String("call_id", callID.String()))
		}
		return
	}
	if !ended {
		members := participantIDs(room)
		h.broadcastState(ctx, mustRefresh(ctx, h.callSvc, callID, room), members)
		return
	}
	h.publishEnded(ctx, room, reason, duration)
}

// endCall 以指定原因强制终结房间（振铃超时、全员忙线）。
func (h *Handler) endCall(ctx context.Context, callID uuid.UUID, reason service.EndReason) {
	room, ended, err := h.callSvc.EndWithReason(ctx, callID, reason)
	if err != nil || !ended {
		return
	}
	h.publishEnded(ctx, room, reason, 0)
}

// publishEnded 推送终结帧并落通话记录。
func (h *Handler) publishEnded(
	ctx context.Context, room *service.Room, reason service.EndReason, duration int,
) {
	if frame, err := Encode(TypeCallEnded, CallEndedPayload{
		CallID:   room.CallID,
		Reason:   string(reason),
		Duration: duration,
	}); err == nil {
		h.hub.SendToUsers(participantIDs(room), frame)
	}
	if h.onCallEnd != nil {
		h.onCallEnd(ctx, room, reason, duration)
	}
}

// scheduleRingTimeout 起一个进程内定时器，到点仍在振铃就按「未接」终结。
//
// 进程内定时器在多实例下不会迁移（创建房间的实例挂掉就没人收尾），
// Redis 的 2 小时 TTL 是那种情形下的兜底。这是本批次有意留的债。
func (h *Handler) scheduleRingTimeout(callID uuid.UUID) {
	time.AfterFunc(service.RingTimeout, func() {
		ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
		defer cancel()
		h.endCall(ctx, callID, service.EndTimeout)
	})
}

// broadcastState 给房间内每条已接听的连接各推一帧（self_conn 各不相同），
// 再给会话内其余成员推一帧 self_conn 为空的，供他们渲染「通话中」横幅。
func (h *Handler) broadcastState(ctx context.Context, room *service.Room, members []uuid.UUID) {
	if room == nil {
		return
	}
	briefs := h.briefsFor(ctx, room)
	parts := callParticipants(room, briefs)
	base := CallStatePayload{
		CallID:         room.CallID,
		ConversationID: room.ConversationID,
		Media:          string(room.Media),
		State:          string(room.State),
		Participants:   parts,
	}

	inRoom := make(map[uuid.UUID]struct{}, len(room.Participants))
	for _, part := range room.Participants {
		inRoom[part.UserID] = struct{}{}
		if part.ConnID == "" {
			continue
		}
		// self_conn 逐条不同：收帧方据它与对端 conn_id 比字典序决定谁发 offer
		p := base
		p.SelfConn = part.ConnID
		frame, err := Encode(TypeCallState, p)
		if err != nil {
			continue
		}
		connID, err := uuid.Parse(part.ConnID)
		if err != nil {
			continue
		}
		if !h.hub.SendToConn(connID, frame) {
			h.hub.SendToUsers([]uuid.UUID{part.UserID}, frame)
		}
	}

	// 会话内的旁观成员：只给横幅用，不给 self_conn（他们不在房间里）
	watchers := make([]uuid.UUID, 0, len(members))
	for _, id := range members {
		if _, ok := inRoom[id]; !ok {
			watchers = append(watchers, id)
		}
	}
	if len(watchers) == 0 {
		return
	}
	if frame, err := Encode(TypeCallState, base); err == nil {
		h.hub.SendToUsers(watchers, frame)
	}
}

// briefsFor 取房间全部参与者的昵称与头像。查不到时退化为空摘要，
// 不让一次用户表查询失败把整通电话打挂。
func (h *Handler) briefsFor(ctx context.Context, room *service.Room) map[uuid.UUID]UserBrief {
	ids := participantIDs(room)
	if room.CallerID != uuid.Nil {
		ids = append(ids, room.CallerID)
	}
	briefs, err := h.callProfiles(ctx, ids)
	if err != nil {
		h.logger.Warn("取通话参与者资料失败", zap.Error(err))
		return map[uuid.UUID]UserBrief{}
	}
	return briefs
}

// callParticipants 把房间参与者拼成帧里的列表（按 user_id 排序，保证各端顺序一致）。
func callParticipants(room *service.Room, briefs map[uuid.UUID]UserBrief) []CallParticipant {
	out := make([]CallParticipant, 0, len(room.Participants))
	for _, part := range room.Participants {
		b := briefs[part.UserID]
		out = append(out, CallParticipant{
			UserID:    part.UserID,
			ConnID:    part.ConnID,
			Nickname:  b.Nickname,
			AvatarURL: b.AvatarURL,
			State:     string(part.State),
		})
	}
	sortParticipants(out)
	return out
}

// sortParticipants 按 user_id 字符串升序排，避免同一房间在不同端渲染出不同顺序。
func sortParticipants(list []CallParticipant) {
	for i := 1; i < len(list); i++ {
		for j := i; j > 0 && list[j].UserID.String() < list[j-1].UserID.String(); j-- {
			list[j], list[j-1] = list[j-1], list[j]
		}
	}
}

func participantIDs(room *service.Room) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(room.Participants))
	for _, part := range room.Participants {
		ids = append(ids, part.UserID)
	}
	return ids
}

// mustRefresh 重新读一次房间快照；读不到就退回传入的旧快照。
// Leave 返回的是【离开前】的状态，广播新状态必须重读。
func mustRefresh(
	ctx context.Context, svc *service.CallService, callID uuid.UUID, fallback *service.Room,
) *service.Room {
	if room, err := svc.Get(ctx, callID); err == nil {
		return room
	}
	return fallback
}

// orZeroUUID 把非法的 conn_id 归一成全零 UUID，使 SendToConn 必然落空并走扇出兜底。
func orZeroUUID(s string) string {
	if _, err := uuid.Parse(s); err != nil {
		return uuid.Nil.String()
	}
	return s
}
