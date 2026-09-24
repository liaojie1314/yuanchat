package ws

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
)

// callFixture 一套装配齐全的通话测试环境：真 Hub + miniredis 上的真 CallService，
// 成员解析与用户摘要用桩（会话表不在本包的关注面内）。
type callFixture struct {
	h       *Handler
	hub     *Hub
	members []uuid.UUID
	ended   []endedRecord
}

type endedRecord struct {
	callID   uuid.UUID
	reason   service.EndReason
	duration int
}

func newCallFixture(t *testing.T, members ...uuid.UUID) *callFixture {
	t.Helper()
	rdb, _ := testutil.NewRedis(t)
	hub := NewHub(0, zap.NewNop())
	h := &Handler{hub: hub, logger: zap.NewNop(), cfg: config.WebSocketConfig{}}
	f := &callFixture{h: h, hub: hub, members: members}

	h.SetCallService(
		service.NewCallService(rdb, config.TurnConfig{Host: "h", Port: 3478}, zap.NewNop()),
		func(_ context.Context, room *service.Room, reason service.EndReason, dur int) {
			f.ended = append(f.ended, endedRecord{room.CallID, reason, dur})
		},
	)
	h.SetConversationMembers(func(_ context.Context, userID, _ uuid.UUID) ([]uuid.UUID, error) {
		for _, id := range f.members {
			if id == userID {
				return f.members, nil
			}
		}
		return nil, service.ErrCallNotFound // 非成员
	})
	h.SetUserBriefs(func(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]UserBrief, error) {
		out := map[uuid.UUID]UserBrief{}
		for _, id := range ids {
			out[id] = UserBrief{ID: id, Nickname: "U" + id.String()[:4]}
		}
		return out, nil
	})
	hub.SetDisconnectNotifier(h.HandleDisconnect)
	return f
}

// conn 造一条已注册的连接。
func (f *callFixture) conn(userID uuid.UUID) *Client {
	c := &Client{userID: userID, connID: uuid.New(), send: make(chan []byte, sendBufferSize), hub: f.hub}
	f.hub.Register(c)
	return c
}

// send 把一帧业务帧喂进 dispatch。
func (f *callFixture) send(c *Client, frameType string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	f.h.dispatch(c, &Envelope{Type: frameType, Payload: raw})
}

// drain 取出连接缓冲里的全部帧。
func drain(c *Client) []Envelope {
	out := []Envelope{}
	for {
		select {
		case data := <-c.send:
			var env Envelope
			if err := json.Unmarshal(data, &env); err == nil {
				out = append(out, env)
			}
		default:
			return out
		}
	}
}

// firstOf 返回缓冲里第一帧指定类型的帧，没有则返回 nil。
func firstOf(frames []Envelope, frameType string) *Envelope {
	for i := range frames {
		if frames[i].Type == frameType {
			return &frames[i]
		}
	}
	return nil
}

// startCall 让 caller 呼 callee 并接通，返回 call_id。
func (f *callFixture) startCall(t *testing.T, caller, callee *Client) uuid.UUID {
	t.Helper()
	f.send(caller, TypeCallInvite, CallInvitePayload{
		ConversationID: uuid.New(), Media: "audio",
		InviteeIDs: []uuid.UUID{callee.userID},
	})
	inc := firstOf(drain(callee), TypeCallIncoming)
	if inc == nil {
		t.Fatal("被叫应收到 call.incoming")
	}
	var p CallIncomingPayload
	if err := json.Unmarshal(inc.Payload, &p); err != nil {
		t.Fatal(err)
	}
	drain(caller)
	f.send(callee, TypeCallAnswer, CallAnswerPayload{CallID: p.CallID, Accept: true})
	return p.CallID
}

// TestCallSignalRoutesToTargetConn 信令只送给 to_conn 指定的那条连接。
//
// 用户级扇出会把发给 Bob 手机的 offer 也投到 Bob 的桌面端，
// 后者没有对应的 PeerConnection，mesh 直接乱套。
func TestCallSignalRoutesToTargetConn(t *testing.T) {
	alice, bobID := uuid.New(), uuid.New()
	f := newCallFixture(t, alice, bobID)
	a := f.conn(alice)
	b1 := f.conn(bobID)
	b2 := f.conn(bobID) // Bob 的第二台设备，不参与通话

	callID := f.startCall(t, a, b1)
	drain(a)
	drain(b1)
	drain(b2)

	f.send(a, TypeCallSignal, CallSignalPayload{
		CallID: callID, ToConn: b1.connID.String(),
		Data: json.RawMessage(`{"type":"offer","sdp":"v=0"}`),
	})

	if got := firstOf(drain(b1), TypeCallSignal); got == nil {
		t.Error("b1 应收到 call.signal")
	}
	if got := drain(b2); len(got) != 0 {
		t.Errorf("b2 不应收到任何帧，实收 %d 帧（首帧 %q）", len(got), got[0].Type)
	}
}

// TestCallSignalRejectsOutsider 不在房间里的人不能凭 conn_id 往别人连接上塞帧。
// 不校验的话服务器就成了任意连接之间的转发器。
func TestCallSignalRejectsOutsider(t *testing.T) {
	alice, bobID, mallory := uuid.New(), uuid.New(), uuid.New()
	f := newCallFixture(t, alice, bobID, mallory)
	a := f.conn(alice)
	b := f.conn(bobID)
	m := f.conn(mallory)

	callID := f.startCall(t, a, b)
	drain(a)
	drain(b)
	drain(m)

	f.send(m, TypeCallSignal, CallSignalPayload{
		CallID: callID, ToConn: b.connID.String(), Data: json.RawMessage(`{"type":"offer"}`),
	})

	if got := firstOf(drain(m), TypeError); got == nil {
		t.Error("局外人发信令应收到 error 帧")
	}
	if got := firstOf(drain(b), TypeCallSignal); got != nil {
		t.Error("b 不应收到局外人转发来的信令")
	}
}

// TestCallInviteRejectsNonMember 非会话成员不能对该会话发起通话。
func TestCallInviteRejectsNonMember(t *testing.T) {
	f := newCallFixture(t, uuid.New(), uuid.New())
	outsider := f.conn(uuid.New())

	f.send(outsider, TypeCallInvite, CallInvitePayload{
		ConversationID: uuid.New(), Media: "audio",
	})

	got := firstOf(drain(outsider), TypeError)
	if got == nil {
		t.Fatal("应回一帧 error")
	}
	var p ErrorPayload
	if err := json.Unmarshal(got.Payload, &p); err != nil {
		t.Fatal(err)
	}
	if p.Code != 403 {
		t.Errorf("code = %d, want 403", p.Code)
	}
}

// TestCallInviteRejectsTooManyInvitees mesh 上限 4 人，最多只能邀请 3 个。
func TestCallInviteRejectsTooManyInvitees(t *testing.T) {
	caller := uuid.New()
	invitees := []uuid.UUID{uuid.New(), uuid.New(), uuid.New(), uuid.New()}
	f := newCallFixture(t, append([]uuid.UUID{caller}, invitees...)...)
	c := f.conn(caller)

	f.send(c, TypeCallInvite, CallInvitePayload{
		ConversationID: uuid.New(), Media: "video", InviteeIDs: invitees,
	})

	if got := firstOf(drain(c), TypeError); got == nil {
		t.Error("邀请 4 人应被拒")
	}
}

// TestCallInviteRejectsBadMedia media 只认 audio / video。
func TestCallInviteRejectsBadMedia(t *testing.T) {
	caller := uuid.New()
	f := newCallFixture(t, caller, uuid.New())
	c := f.conn(caller)

	f.send(c, TypeCallInvite, CallInvitePayload{ConversationID: uuid.New(), Media: "hologram"})

	if got := firstOf(drain(c), TypeError); got == nil {
		t.Error("非法 media 应被拒")
	}
}

// TestCallAnswerRejectFinishesCall 被叫拒接 → 双方收到 call.ended(rejected)，并落一条记录。
func TestCallAnswerRejectFinishesCall(t *testing.T) {
	alice, bobID := uuid.New(), uuid.New()
	f := newCallFixture(t, alice, bobID)
	a := f.conn(alice)
	b := f.conn(bobID)

	f.send(a, TypeCallInvite, CallInvitePayload{
		ConversationID: uuid.New(), Media: "audio", InviteeIDs: []uuid.UUID{bobID},
	})
	inc := firstOf(drain(b), TypeCallIncoming)
	if inc == nil {
		t.Fatal("被叫应收到 call.incoming")
	}
	var p CallIncomingPayload
	if err := json.Unmarshal(inc.Payload, &p); err != nil {
		t.Fatal(err)
	}
	drain(a)

	f.send(b, TypeCallAnswer, CallAnswerPayload{CallID: p.CallID, Accept: false})

	ended := firstOf(drain(a), TypeCallEnded)
	if ended == nil {
		t.Fatal("主叫应收到 call.ended")
	}
	var e CallEndedPayload
	if err := json.Unmarshal(ended.Payload, &e); err != nil {
		t.Fatal(err)
	}
	if e.Reason != string(service.EndRejected) {
		t.Errorf("reason = %q, want rejected", e.Reason)
	}
	if len(f.ended) != 1 || f.ended[0].reason != service.EndRejected {
		t.Errorf("应落一条 rejected 通话记录，实得 %+v", f.ended)
	}
}

// TestDisconnectLeavesRoom 连接断开等价于挂断：另一端应收到 call.ended。
//
// 关窗口、拔网线、杀进程、手机被系统回收都走这条路径。没有它，
// 一方掉线后另一方会永远停在「通话中」，只能等 Redis 的 2 小时 TTL。
func TestDisconnectLeavesRoom(t *testing.T) {
	alice, bobID := uuid.New(), uuid.New()
	f := newCallFixture(t, alice, bobID)
	a := f.conn(alice)
	b := f.conn(bobID)
	f.startCall(t, a, b)
	drain(a)

	f.hub.Unregister(b) // 模拟关窗口 / 拔网线

	ended := firstOf(drain(a), TypeCallEnded)
	if ended == nil {
		t.Fatal("对端掉线后主叫应收到 call.ended")
	}
	var e CallEndedPayload
	if err := json.Unmarshal(ended.Payload, &e); err != nil {
		t.Fatal(err)
	}
	if e.Reason != string(service.EndCompleted) {
		t.Errorf("reason = %q, want completed（已接通后掉线算正常结束）", e.Reason)
	}
}

// TestCallStateCarriesPerConnSelfConn 每条连接收到的 self_conn 必须是它自己的。
//
// mesh 靠 self_conn 与对端 conn_id 比字典序决定谁发 offer：发错了会导致
// 双方同时 offer（glare）或双方都在等对方。
func TestCallStateCarriesPerConnSelfConn(t *testing.T) {
	alice, bobID := uuid.New(), uuid.New()
	f := newCallFixture(t, alice, bobID)
	a := f.conn(alice)
	b := f.conn(bobID)
	f.startCall(t, a, b)

	for _, tc := range []struct {
		name string
		c    *Client
	}{{"caller", a}, {"callee", b}} {
		frames := drain(tc.c)
		var last *CallStatePayload
		for _, fr := range frames {
			if fr.Type != TypeCallState {
				continue
			}
			var p CallStatePayload
			if err := json.Unmarshal(fr.Payload, &p); err == nil {
				last = &p
			}
		}
		if last == nil {
			t.Fatalf("%s 应收到 call.state", tc.name)
		}
		if last.SelfConn != tc.c.connID.String() {
			t.Errorf("%s 的 self_conn = %q, want %q", tc.name, last.SelfConn, tc.c.connID)
		}
		if last.State != string(service.CallStateActive) {
			t.Errorf("%s 收到的 state = %q, want active", tc.name, last.State)
		}
	}
}

// TestCallSameUserTwoConnsShareOneSeat 同一账号两条连接同时接听时共占一席。
//
// 这条用例把「多设备」的实际行为钉死，因为它决定三件用户可见的事：
// 房间人数怎么算（上限 4 是 mesh 的硬约束）、两端会不会互相把对方当成对端
// 去建 PeerConnection（同一个人连自己是连不通的）、通话记录记几个参与者。
//
// 行为：参与者表按 **user_id** 存放、格子里记的是 conn_id（`callJoin` 脚本的
// KEYS[2] 以 userID 为 field），所以同一账号的第二条连接会**覆写**第一条那一格，
// 房间人数按「人」算而不是按「连接」算 —— mesh 的 4 人上限因此不会被同账号
// 多设备撑爆。代价是旧连接的 conn_id 从房间里消失，那一端必须自行退出
// （前端 callStore 的顶替检测；注意它只能本地复位、不能补发 call.leave）。
func TestCallSameUserTwoConnsShareOneSeat(t *testing.T) {
	alice, bobID := uuid.New(), uuid.New()
	f := newCallFixture(t, alice, bobID)

	aliceConn := f.conn(alice)
	bobPhone := f.conn(bobID)
	bobDesktop := f.conn(bobID)

	f.send(aliceConn, TypeCallInvite, CallInvitePayload{
		ConversationID: uuid.New(), Media: "audio",
		InviteeIDs: []uuid.UUID{bobID},
	})

	// 两条连接都该收到来电（服务端按 user 扇出到全部连接）
	for _, c := range []*Client{bobPhone, bobDesktop} {
		if firstOf(drain(c), TypeCallIncoming) == nil {
			t.Fatal("Bob 的每条连接都应收到 call.incoming")
		}
	}
	var inc CallIncomingPayload
	if err := json.Unmarshal(firstOf(drain(aliceConn), TypeCallState).Payload, &inc); err != nil {
		t.Fatal(err)
	}

	// 两条连接先后接听
	f.send(bobPhone, TypeCallAnswer, CallAnswerPayload{CallID: inc.CallID, Accept: true})
	f.send(bobDesktop, TypeCallAnswer, CallAnswerPayload{CallID: inc.CallID, Accept: true})

	room, err := f.h.callSvc.Get(context.Background(), inc.CallID)
	if err != nil {
		t.Fatalf("取房间失败: %v", err)
	}

	joined := 0
	bobEntries := 0
	for _, p := range room.Participants {
		if p.State == service.PartStateJoined {
			joined++
		}
		if p.UserID == bobID {
			bobEntries++
		}
	}
	t.Logf("参与者 %d 人，其中 Bob 占 %d 席（joined=%d）", len(room.Participants), bobEntries, joined)

	// 一个 2 人通话，参与者总数应当就是 2
	if len(room.Participants) != 2 {
		t.Errorf("参与者数 = %d, want 2（同一账号的多条连接不该各占一席）", len(room.Participants))
	}
	if bobEntries != 1 {
		t.Errorf("Bob 占了 %d 席, want 1", bobEntries)
	}
}

// TestCallLeaveFromSupersededConn 被顶替的旧连接若发 call.leave，会不会拆掉新连接的通话。
//
// 这是前端「旧的第二台设备自退」逻辑的安全前提：离开按 **user_id** 定位参与者格，
// 而那一格此时归新连接所有 —— 旧连接发一帧 leave 就会把新设备踢出通话。
// 前端因此只能本地复位、什么都不发（见 packages/shared/src/store/callStore.ts
// 的 leaveEvicted）。本用例把服务端这一行为钉死，避免有人日后「顺手」让旧连接补发 leave。
func TestCallLeaveFromSupersededConn(t *testing.T) {
	alice, bobID := uuid.New(), uuid.New()
	f := newCallFixture(t, alice, bobID)

	aliceConn := f.conn(alice)
	bobPhone := f.conn(bobID)
	bobDesktop := f.conn(bobID)

	f.send(aliceConn, TypeCallInvite, CallInvitePayload{
		ConversationID: uuid.New(), Media: "audio",
		InviteeIDs: []uuid.UUID{bobID},
	})
	var st CallStatePayload
	if err := json.Unmarshal(firstOf(drain(aliceConn), TypeCallState).Payload, &st); err != nil {
		t.Fatal(err)
	}
	drain(bobPhone)
	drain(bobDesktop)

	// 手机先接，桌面后接（桌面把手机那一格覆写掉）
	f.send(bobPhone, TypeCallAnswer, CallAnswerPayload{CallID: st.CallID, Accept: true})
	f.send(bobDesktop, TypeCallAnswer, CallAnswerPayload{CallID: st.CallID, Accept: true})
	drain(aliceConn)

	// 被顶替的手机发一帧 leave
	f.send(bobPhone, TypeCallLeave, CallLeavePayload{CallID: st.CallID})

	room, err := f.h.callSvc.Get(context.Background(), st.CallID)
	if err != nil {
		// 房间被整个终结也是「旧连接的 leave 拆掉了新通话」的一种表现
		t.Logf("房间已被终结: %v", err)
		return
	}
	joined := 0
	for _, p := range room.Participants {
		if p.State == service.PartStateJoined {
			joined++
		}
	}
	// 服务端按 user_id 删格，所以旧连接这一帧会连带删掉新连接的参与者格；
	// 房间随之只剩主叫一人 → 脚本把房间置 ended 并回收全部键。
	t.Logf("旧连接 leave 之后：参与者 %d，joined=%d，state=%s", len(room.Participants), joined, room.State)
	if joined != 0 {
		t.Errorf("joined = %d, want 0（同一 user_id 的格被一并删除）", joined)
	}
}
