package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
)

func newCallSvc(t *testing.T) *CallService {
	t.Helper()
	rdb, _ := testutil.NewRedis(t)
	return NewCallService(rdb, config.TurnConfig{
		Enabled: true, Host: "turn.test", Port: 3478,
		Realm: "yuanchat", StaticAuthSecret: "s3cret", CredentialTTL: time.Hour,
	}, zap.NewNop())
}

// countJoined 数房间里处于 joined 的参与者。
func countJoined(r *Room) int {
	n := 0
	for _, p := range r.Participants {
		if p.State == PartStateJoined {
			n++
		}
	}
	return n
}

// TestCreateThenJoinActivates 两人齐了房间才进 active，并记下应答时刻。
func TestCreateThenJoinActivates(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller, callee, conv := uuid.New(), uuid.New(), uuid.New()

	room, skipped, err := s.Create(ctx, caller, "conn-a", conv, CallMediaAudio, []uuid.UUID{callee})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if len(skipped) != 0 {
		t.Fatalf("skipped = %v, want empty", skipped)
	}
	if room.State != CallStateRinging {
		t.Fatalf("state = %s, want ringing", room.State)
	}
	if room.ConversationID != conv || room.CallerID != caller || room.Media != CallMediaAudio {
		t.Fatalf("房间快照字段错位: %+v", room)
	}
	if len(room.Participants) != 2 || countJoined(room) != 1 {
		t.Fatalf("参与者 = %+v，期望 caller joined + callee invited", room.Participants)
	}

	joined, err := s.Join(ctx, room.CallID, callee, "conn-b")
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	if joined.State != CallStateActive {
		t.Errorf("state = %s, want active", joined.State)
	}
	if joined.AnsweredAt == nil {
		t.Error("answered_at 应已写入")
	}
}

// TestBusyRejectsSecondCall 已在通话中的人不会被第二通电话拉进来。
// 这条必须靠 Lua 原子性：先读后写的实现下两个来电会双双成功。
func TestBusyRejectsSecondCall(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	a, b, c := uuid.New(), uuid.New(), uuid.New()

	r1, _, err := s.Create(ctx, a, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{b})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Join(ctx, r1.CallID, b, "conn-b"); err != nil {
		t.Fatal(err)
	}

	// b 已忙线：c 呼 b 时 b 应出现在 skipped 里
	r2, skipped, err := s.Create(ctx, c, "conn-c", uuid.New(), CallMediaAudio, []uuid.UUID{b})
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 1 || skipped[0] != b {
		t.Errorf("skipped = %v, want [%v]", skipped, b)
	}
	// 忙线者绝不能被写进第二个房间的参与者表
	for _, p := range r2.Participants {
		if p.UserID == b {
			t.Errorf("忙线者被写进了第二个房间: %+v", p)
		}
	}
	// 主叫本人忙线时整通电话都建不起来
	if _, _, err := s.Create(ctx, a, "conn-a2", uuid.New(), CallMediaAudio, []uuid.UUID{uuid.New()}); err != ErrCallBusy {
		t.Errorf("主叫忙线应返回 ErrCallBusy，得到 %v", err)
	}
}

// TestConcurrentJoinOnlyOnceCounted 同一用户多设备并发接听只占一个位置。
func TestConcurrentJoinOnlyOnceCounted(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller, callee := uuid.New(), uuid.New()
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{callee})
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func(i int) {
			_, e := s.Join(ctx, room.CallID, callee, "conn-"+string(rune('A'+i)))
			done <- e
		}(i)
	}
	for i := 0; i < 8; i++ {
		if e := <-done; e != nil {
			t.Fatalf("并发 join 不应失败: %v", e)
		}
	}
	got, err := s.Get(ctx, room.CallID)
	if err != nil {
		t.Fatal(err)
	}
	if n := countJoined(got); n != 2 {
		t.Errorf("joined 数 = %d，期望 2（caller + callee 各一）", n)
	}
}

// TestJoinRejectsWhenFull 房间满员后第 5 个人进不来。
// 满员判定必须在 Lua 里做：读人数与写参与者分成两步的话，并发接听会写超。
func TestJoinRejectsWhenFull(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller := uuid.New()
	invitees := []uuid.UUID{uuid.New(), uuid.New(), uuid.New()}
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaVideo, invitees)
	if err != nil {
		t.Fatal(err)
	}
	for i, id := range invitees {
		if _, err := s.Join(ctx, room.CallID, id, "conn-"+strconv.Itoa(i)); err != nil {
			t.Fatalf("第 %d 位接听失败: %v", i, err)
		}
	}
	if _, err := s.Join(ctx, room.CallID, uuid.New(), "conn-x"); err != ErrCallFull {
		t.Errorf("满员时应返回 ErrCallFull，得到 %v", err)
	}
}

// TestJoinUnknownRoom 房间不存在时接听返回 ErrCallNotFound（而不是凭空建房）。
func TestJoinUnknownRoom(t *testing.T) {
	s := newCallSvc(t)
	if _, err := s.Join(context.Background(), uuid.New(), uuid.New(), "conn-z"); err != ErrCallNotFound {
		t.Errorf("= %v，期望 ErrCallNotFound", err)
	}
}

// TestLeaveEndsRoomWhenFewerThanTwo 剩余 joined < 2 即终结房间并算出时长。
func TestLeaveEndsRoomWhenFewerThanTwo(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller, callee := uuid.New(), uuid.New()
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{callee})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Join(ctx, room.CallID, callee, "conn-b"); err != nil {
		t.Fatal(err)
	}

	before, ended, reason, _, err := s.Leave(ctx, room.CallID, callee)
	if err != nil {
		t.Fatal(err)
	}
	if !ended {
		t.Fatal("两人房间走掉一个应终结")
	}
	if reason != EndCompleted {
		t.Errorf("reason = %s, want completed", reason)
	}
	// 终结时要拿离开前的快照给全员发 call.ended，此刻 Redis 里房间已被删
	if before == nil || len(before.Participants) != 2 {
		t.Errorf("离开前快照应含全部参与者，得到 %+v", before)
	}
	if _, err := s.Get(ctx, room.CallID); err != ErrCallNotFound {
		t.Errorf("终结后 Get 应返回 ErrCallNotFound，得到 %v", err)
	}
	// 忙线标记必须一并清掉，否则两人此后都再也拨不出电话
	if _, _, err := s.Create(ctx, caller, "conn-a2", uuid.New(), CallMediaAudio, []uuid.UUID{callee}); err != nil {
		t.Errorf("终结后应能重新发起通话，得到 %v", err)
	}
}

// TestLeaveKeepsRoomWhenTwoRemain 三人房间走掉一个，通话继续。
func TestLeaveKeepsRoomWhenTwoRemain(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller := uuid.New()
	b, c := uuid.New(), uuid.New()
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{b, c})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Join(ctx, room.CallID, b, "conn-b"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Join(ctx, room.CallID, c, "conn-c"); err != nil {
		t.Fatal(err)
	}

	if _, ended, _, _, err := s.Leave(ctx, room.CallID, c); err != nil || ended {
		t.Fatalf("三人走掉一个不应终结: ended=%v err=%v", ended, err)
	}
	after, err := s.Get(ctx, room.CallID)
	if err != nil {
		t.Fatalf("房间应仍在: %v", err)
	}
	if countJoined(after) != 2 {
		t.Errorf("剩余 joined = %d，期望 2", countJoined(after))
	}
}

// TestLeaveBeforeAnswerIsCanceled 主叫在振铃期挂断 = canceled（不是 completed）。
func TestLeaveBeforeAnswerIsCanceled(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller := uuid.New()
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{uuid.New()})
	if err != nil {
		t.Fatal(err)
	}

	_, ended, reason, dur, err := s.Leave(ctx, room.CallID, caller)
	if err != nil {
		t.Fatal(err)
	}
	if !ended || reason != EndCanceled || dur != 0 {
		t.Errorf("ended=%v reason=%s dur=%d，期望 true/canceled/0", ended, reason, dur)
	}
}

// TestLeaveByCalleeBeforeAnswerIsRejected 振铃期被叫离开 = 拒接。
// call.answer{accept:false} 走的正是这条路径，两者不能混为 canceled。
func TestLeaveByCalleeBeforeAnswerIsRejected(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller, callee := uuid.New(), uuid.New()
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaVideo, []uuid.UUID{callee})
	if err != nil {
		t.Fatal(err)
	}

	_, ended, reason, _, err := s.Leave(ctx, room.CallID, callee)
	if err != nil {
		t.Fatal(err)
	}
	if !ended || reason != EndRejected {
		t.Errorf("ended=%v reason=%s，期望 true/rejected", ended, reason)
	}
}

// TestEndWithReasonSkipsActiveRoom 已接通的房间不该被振铃超时定时器终结。
func TestEndWithReasonSkipsActiveRoom(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller, callee := uuid.New(), uuid.New()
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{callee})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Join(ctx, room.CallID, callee, "conn-b"); err != nil {
		t.Fatal(err)
	}

	if _, ended, err := s.EndWithReason(ctx, room.CallID, EndTimeout); err != nil || ended {
		t.Fatalf("active 房间不应被超时终结: ended=%v err=%v", ended, err)
	}
	if _, err := s.Get(ctx, room.CallID); err != nil {
		t.Errorf("房间应仍在: %v", err)
	}
}

// TestEndWithReasonClearsRingingRoom 振铃中的房间超时终结后键全清。
func TestEndWithReasonClearsRingingRoom(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller, callee := uuid.New(), uuid.New()
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, []uuid.UUID{callee})
	if err != nil {
		t.Fatal(err)
	}

	snapshot, ended, err := s.EndWithReason(ctx, room.CallID, EndTimeout)
	if err != nil || !ended {
		t.Fatalf("ringing 房间应被终结: ended=%v err=%v", ended, err)
	}
	if len(snapshot.Participants) != 2 {
		t.Errorf("终结快照应含全部参与者，得到 %+v", snapshot.Participants)
	}
	if _, err := s.Get(ctx, room.CallID); err != ErrCallNotFound {
		t.Errorf("终结后 Get 应返回 ErrCallNotFound，得到 %v", err)
	}
	// 主叫的忙线标记与连接索引都要清掉
	if _, _, ok := s.CallIDForConn(ctx, "conn-a"); ok {
		t.Error("终结后连接反向索引应已清除")
	}
}

// TestCallIDForConn 连接反向索引：断连时靠它一次查到房间，不必遍历。
func TestCallIDForConn(t *testing.T) {
	s := newCallSvc(t)
	ctx := context.Background()
	caller := uuid.New()
	room, _, err := s.Create(ctx, caller, "conn-a", uuid.New(), CallMediaAudio, nil)
	if err != nil {
		t.Fatal(err)
	}

	gotCall, gotUser, ok := s.CallIDForConn(ctx, "conn-a")
	if !ok || gotCall != room.CallID || gotUser != caller {
		t.Errorf("= (%v,%v,%v)，期望 (%v,%v,true)", gotCall, gotUser, ok, room.CallID, caller)
	}
	if _, _, ok := s.CallIDForConn(ctx, "nope"); ok {
		t.Error("未知 conn 应返回 false")
	}
}

// TestICEServersHMAC 凭据按 coturn REST 口径签发：username=<expiry>:<uid>，
// credential=base64(HMAC-SHA1(secret, username))。
func TestICEServersHMAC(t *testing.T) {
	s := newCallSvc(t)
	uid := uuid.New()
	dto := s.ICEServers(uid)
	if len(dto.ICEServers) != 2 {
		t.Fatalf("应有 STUN + TURN 两项，得到 %d", len(dto.ICEServers))
	}
	if dto.TTL != 3600 {
		t.Errorf("ttl = %d, want 3600", dto.TTL)
	}
	if len(dto.ICEServers[0].URLs) != 1 || dto.ICEServers[0].URLs[0] != "stun:turn.test:3478" {
		t.Errorf("STUN 项 = %+v", dto.ICEServers[0])
	}
	turn := dto.ICEServers[1]
	parts := strings.SplitN(turn.Username, ":", 2)
	if len(parts) != 2 || parts[1] != uid.String() {
		t.Fatalf("username = %q，期望 <expiry>:%s", turn.Username, uid)
	}
	// 过期时间必须真的在未来，否则 coturn 会当场拒掉这份凭据
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || exp <= time.Now().Unix() {
		t.Errorf("expiry = %q 应是未来的 unix 秒", parts[0])
	}
	mac := hmac.New(sha1.New, []byte("s3cret"))
	mac.Write([]byte(turn.Username))
	want := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if turn.Credential != want {
		t.Errorf("credential = %q, want %q", turn.Credential, want)
	}
	if len(turn.URLs) != 2 {
		t.Errorf("TURN 应同时给 udp/tcp 两条 URL，得到 %v", turn.URLs)
	}
}

// TestICEServersDisabled 关掉 TURN 时只回 STUN，不泄露空凭据。
func TestICEServersDisabled(t *testing.T) {
	rdb, _ := testutil.NewRedis(t)
	s := NewCallService(rdb, config.TurnConfig{Enabled: false, Host: "h", Port: 3478}, zap.NewNop())
	dto := s.ICEServers(uuid.New())
	if len(dto.ICEServers) != 1 {
		t.Fatalf("应只有 STUN 一项，得到 %d", len(dto.ICEServers))
	}
}

// TestICEServersNoSecret enabled=true 但密钥留空（生产忘配环境变量）时同样只回 STUN。
// 否则会下发一份 credential 为空串的 TURN 项，客户端拿它去认证必然失败且毫无提示。
func TestICEServersNoSecret(t *testing.T) {
	rdb, _ := testutil.NewRedis(t)
	s := NewCallService(rdb, config.TurnConfig{Enabled: true, Host: "h", Port: 3478}, zap.NewNop())
	if dto := s.ICEServers(uuid.New()); len(dto.ICEServers) != 1 {
		t.Fatalf("密钥为空时应只回 STUN，得到 %+v", dto.ICEServers)
	}
}

// TestEndReasonResult 终结原因到通话记录 result 的映射（客户端按 result 选文案）。
func TestEndReasonResult(t *testing.T) {
	cases := map[EndReason]string{
		EndCompleted: "answered",
		EndTimeout:   "missed",
		EndRejected:  "rejected",
		EndCanceled:  "canceled",
		EndFailed:    "canceled",
		EndBusy:      "busy",
	}
	for reason, want := range cases {
		if got := reason.Result(); got != want {
			t.Errorf("%s.Result() = %q, want %q", reason, got, want)
		}
	}
}
