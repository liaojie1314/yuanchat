// 通话房间状态机：建房 / 入房 / 离房三个动作全部走 Lua 原子脚本，
// 房间态只活在 Redis —— 进程内 map 在多实例部署下各存一份，且重启即丢掉全部进行中的通话。

package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/yuanchat/server/internal/config"
	"go.uber.org/zap"
)

// CallMedia 通话媒体形态。
type CallMedia string

// CallState 房间状态。ended 是终结中的短暂过渡态，用于挡住「离开与销毁之间挤进来的 join」。
type CallState string

// PartState 参与者在房间里的状态。
type PartState string

// EndReason 通话终结原因，由服务端按房间状态推导，客户端不上报。
type EndReason string

// 通话的媒体形态、房间状态、参与者状态与终结原因枚举。
const (
	CallMediaAudio CallMedia = "audio"
	CallMediaVideo CallMedia = "video"

	CallStateRinging CallState = "ringing"
	CallStateActive  CallState = "active"
	CallStateEnded   CallState = "ended"

	PartStateInvited PartState = "invited"
	PartStateJoined  PartState = "joined"

	EndCompleted EndReason = "completed"
	EndRejected  EndReason = "rejected"
	EndCanceled  EndReason = "canceled"
	EndTimeout   EndReason = "timeout"
	EndBusy      EndReason = "busy"
	EndFailed    EndReason = "failed"
)

// Result 把终结原因映射为通话记录里的 result 值（客户端据此选本地化文案）。
//
// failed 归到 canceled：从未接通的通话对用户就是「没打成」，
// 再给客户端多一个只能翻成同样文案的枚举值没有意义。
func (r EndReason) Result() string {
	switch r {
	case EndCompleted:
		return "answered"
	case EndTimeout:
		return "missed"
	case EndRejected:
		return "rejected"
	case EndBusy:
		return "busy"
	default:
		return "canceled"
	}
}

// MaxCallParticipants mesh 全连接的人数上限。
//
// 4 人时每端 3 条上行（视频 360p 约 1.5Mbps）、解码 3 路，旧 Android WebView 可承受；
// 6 人就是 5 条上行 + 5 路解码，低端机发热掉帧。上调这个数之前先换 SFU。
const MaxCallParticipants = 4

// callTTL 房间键的存活上限，纯属崩溃兜底 —— 正常终结走 Leave 主动删除。
const callTTL = 2 * time.Hour

// RingTimeout 无人应答的最长振铃时间。
const RingTimeout = 60 * time.Second

// 通话房间的哨兵错误（ws / handler 层据此映射帧错误码与 HTTP 状态）。
var (
	ErrCallNotFound = errors.New("call not found")
	ErrCallFull     = errors.New("call room is full")
	ErrCallBusy     = errors.New("user is busy in another call")
)

func roomKey(id uuid.UUID) string  { return "call:room:" + id.String() }
func partsKey(id uuid.UUID) string { return "call:room:" + id.String() + ":p" }
func busyKey(id uuid.UUID) string  { return "call:busy:" + id.String() }
func connKey(conn string) string   { return "call:conn:" + conn }

// decodePart 解析参与者值。
//
// 参与者值编码为 "connID|state"，刻意不用 cjson：Lua 侧只需按后缀判断状态，
// 字符串切分比 JSON 编解码少一层依赖，也不受 Redis 实现差异影响。
func decodePart(v string) (string, PartState) {
	i := strings.LastIndex(v, "|")
	if i < 0 {
		return "", PartStateInvited
	}
	return v[:i], PartState(v[i+1:])
}

// Participant 房间里的一名参与者。ConnID 在 state=invited（尚未接听）时为空串。
type Participant struct {
	UserID uuid.UUID
	ConnID string
	State  PartState
}

// Room 通话房间快照。
type Room struct {
	CallID         uuid.UUID
	ConversationID uuid.UUID
	CallerID       uuid.UUID
	Media          CallMedia
	State          CallState
	CreatedAt      time.Time
	AnsweredAt     *time.Time
	Participants   []Participant
}

// callCreate 原子建房。
//
// 必须原子：忙线判定与写入分成两步的话，两个人同时呼同一个目标会双双通过，
// 被叫端弹出两个来电。
//
// KEYS[1]=room KEYS[2]=parts KEYS[3]=caller busy KEYS[4]=caller conn
// KEYS[5..]=每个 invitee 的 busy 键（与 ARGV[8..] 一一对应）
// ARGV: 1=call_id 2=conversation_id 3=media 4=caller_id 5=caller_conn
//
//	6=now(unix) 7=ttl(秒) 8..=invitee user id
//
// 返回 -1=主叫忙线；否则返回被跳过（忙线）的 invitee id 列表
var callCreate = redis.NewScript(`
if redis.call('EXISTS', KEYS[3]) == 1 then return -1 end
redis.call('HSET', KEYS[1], 'conversation_id', ARGV[2], 'media', ARGV[3],
  'caller_id', ARGV[4], 'state', 'ringing', 'created_at', ARGV[6], 'answered_at', '')
redis.call('EXPIRE', KEYS[1], ARGV[7])
redis.call('HSET', KEYS[2], ARGV[4], ARGV[5] .. '|joined')
redis.call('EXPIRE', KEYS[2], ARGV[7])
redis.call('SET', KEYS[3], ARGV[1], 'EX', ARGV[7])
redis.call('SET', KEYS[4], ARGV[1] .. '|' .. ARGV[4], 'EX', ARGV[7])
local skipped = {}
for i = 8, #ARGV do
  local bkey = KEYS[5 + (i - 8)]
  if redis.call('EXISTS', bkey) == 1 then
    table.insert(skipped, ARGV[i])
  else
    redis.call('HSET', KEYS[2], ARGV[i], '|invited')
  end
end
return skipped
`)

// callJoin 原子入房。
//
// 必须原子：同一用户多设备并发接听时，「查人数 → 判满 → 写入」的非原子实现
// 会让两台设备都写进去，房间瞬间超员。
//
// KEYS[1]=room KEYS[2]=parts KEYS[3]=user busy KEYS[4]=user conn
// ARGV: 1=user_id 2=conn_id 3=call_id 4=now 5=ttl 6=max
// 返回 {code, state, answered_at}；code 0=ok 1=房间不存在/已终结 2=满员 3=忙于别的通话
var callJoin = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 0 then return {1, '', ''} end
if redis.call('HGET', KEYS[1], 'state') == 'ended' then return {1, '', ''} end
local busy = redis.call('GET', KEYS[3])
if busy and busy ~= ARGV[3] then return {3, '', ''} end
local cur = redis.call('HGET', KEYS[2], ARGV[1])
local function countJoined()
  local n = 0
  local all = redis.call('HGETALL', KEYS[2])
  for i = 2, #all, 2 do
    if string.sub(all[i], -6) == 'joined' then n = n + 1 end
  end
  return n
end
if not cur or string.sub(cur, -6) ~= 'joined' then
  if countJoined() >= tonumber(ARGV[6]) then return {2, '', ''} end
end
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[5])
redis.call('SET', KEYS[4], ARGV[3] .. '|' .. ARGV[1], 'EX', ARGV[5])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2] .. '|joined')
redis.call('EXPIRE', KEYS[2], ARGV[5])
local st = redis.call('HGET', KEYS[1], 'state')
local at = redis.call('HGET', KEYS[1], 'answered_at')
if st == 'ringing' and countJoined() >= 2 then
  redis.call('HSET', KEYS[1], 'state', 'active', 'answered_at', ARGV[4])
  st = 'active'
  at = ARGV[4]
end
redis.call('EXPIRE', KEYS[1], ARGV[5])
return {0, st, at or ''}
`)

// callLeave 原子离房，并在剩余 joined < 2 时把房间打上 ended 标记。
//
// 打标记而不是直接删：删除后到 Go 侧清理完 busy 之间有个窗口，
// 若此时有人 join 会建出一个「幽灵房间」。ended 态让 callJoin 直接拒绝。
//
// KEYS[1]=room KEYS[2]=parts KEYS[3]=离开者 busy
// ARGV[1]=user_id
// 返回 {ended, state, answered_at, caller_id, conversation_id, media, 剩余 user_id...}
var callLeave = redis.NewScript(`
if redis.call('EXISTS', KEYS[1]) == 0 then return {0,'','','','',''} end
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[3])
local st = redis.call('HGET', KEYS[1], 'state') or ''
local out = {0, st, redis.call('HGET', KEYS[1], 'answered_at') or '',
  redis.call('HGET', KEYS[1], 'caller_id') or '',
  redis.call('HGET', KEYS[1], 'conversation_id') or '',
  redis.call('HGET', KEYS[1], 'media') or ''}
local n, rest = 0, {}
local all = redis.call('HGETALL', KEYS[2])
for i = 1, #all, 2 do
  table.insert(rest, all[i])
  if string.sub(all[i + 1], -6) == 'joined' then n = n + 1 end
end
if n < 2 then
  out[1] = 1
  redis.call('HSET', KEYS[1], 'state', 'ended')
  for _, uid in ipairs(rest) do table.insert(out, uid) end
end
return out
`)

// CallService 管理通话房间的生命周期。
//
// 房间态全部落 Redis：进程内 map 会在多实例部署下各存一份，
// 且进程重启即丢掉全部进行中的通话。
type CallService struct {
	rdb    *redis.Client
	turn   config.TurnConfig
	logger *zap.Logger
}

// NewCallService 构造通话服务。
func NewCallService(rdb *redis.Client, turn config.TurnConfig, logger *zap.Logger) *CallService {
	return &CallService{rdb: rdb, turn: turn, logger: logger}
}

// Create 建房并邀请。返回房间快照与被跳过的忙线 invitee。
// 主叫本人忙线时返回 ErrCallBusy。
func (s *CallService) Create(
	ctx context.Context, callerID uuid.UUID, callerConn string,
	convID uuid.UUID, media CallMedia, invitees []uuid.UUID,
) (*Room, []uuid.UUID, error) {
	callID := uuid.New()
	now := time.Now().UTC()
	keys := []string{roomKey(callID), partsKey(callID), busyKey(callerID), connKey(callerConn)}
	args := []any{callID.String(), convID.String(), string(media), callerID.String(),
		callerConn, now.Unix(), int(callTTL.Seconds())}
	for _, id := range invitees {
		keys = append(keys, busyKey(id))
		args = append(args, id.String())
	}
	res, err := callCreate.Run(ctx, s.rdb, keys, args...).Result()
	if err != nil {
		return nil, nil, fmt.Errorf("call create: %w", err)
	}
	if n, ok := res.(int64); ok && n == -1 {
		return nil, nil, ErrCallBusy
	}
	skipped := make([]uuid.UUID, 0)
	if list, ok := res.([]any); ok {
		for _, v := range list {
			if id, err := uuid.Parse(fmt.Sprint(v)); err == nil {
				skipped = append(skipped, id)
			}
		}
	}
	room, err := s.Get(ctx, callID)
	if err != nil {
		return nil, nil, err
	}
	return room, skipped, nil
}

// Join 让 userID 以 connID 这条连接加入房间。
// 群通话的「主动加入」复用本方法 —— 会话成员校验在 ws 层做，这里只管房间容量与忙线。
func (s *CallService) Join(ctx context.Context, callID, userID uuid.UUID, connID string) (*Room, error) {
	res, err := callJoin.Run(ctx, s.rdb,
		[]string{roomKey(callID), partsKey(callID), busyKey(userID), connKey(connID)},
		userID.String(), connID, callID.String(),
		time.Now().UTC().Unix(), int(callTTL.Seconds()), MaxCallParticipants,
	).Slice()
	if err != nil {
		return nil, fmt.Errorf("call join: %w", err)
	}
	switch toInt(res[0]) {
	case 1:
		return nil, ErrCallNotFound
	case 2:
		return nil, ErrCallFull
	case 3:
		return nil, ErrCallBusy
	}
	return s.Get(ctx, callID)
}

// Leave 让 userID 离开房间。剩余 joined < 2 时终结房间并推导终结原因。
//
// 返回的 room 是【离开前】的快照：终结时要用它给全体成员发 call.ended，
// 而此时 Redis 里的房间已被删掉。
func (s *CallService) Leave(
	ctx context.Context, callID, userID uuid.UUID,
) (*Room, bool, EndReason, int, error) {
	before, err := s.Get(ctx, callID)
	if err != nil {
		return nil, false, "", 0, err
	}
	res, err := callLeave.Run(ctx, s.rdb,
		[]string{roomKey(callID), partsKey(callID), busyKey(userID)},
		userID.String(),
	).Slice()
	if err != nil {
		return nil, false, "", 0, fmt.Errorf("call leave: %w", err)
	}
	if toInt(res[0]) == 0 {
		return before, false, "", 0, nil
	}

	state := CallState(fmt.Sprint(res[1]))
	answeredAt := parseUnix(fmt.Sprint(res[2]))
	duration := 0
	reason := EndCanceled
	switch {
	case state == CallStateActive && answeredAt != nil:
		reason = EndCompleted
		duration = int(time.Since(*answeredAt).Seconds())
	case userID == before.CallerID:
		reason = EndCanceled
	default:
		// 振铃期间被叫离开 = 拒接（call.answer{accept:false} 也走这条路径）
		reason = EndRejected
	}

	// 清理：房间、参与者表、剩余成员的 busy 与连接索引
	del := []string{roomKey(callID), partsKey(callID)}
	for _, v := range res[6:] {
		if id, err := uuid.Parse(fmt.Sprint(v)); err == nil {
			del = append(del, busyKey(id))
		}
	}
	for _, p := range before.Participants {
		if p.ConnID != "" {
			del = append(del, connKey(p.ConnID))
		}
	}
	if err := s.rdb.Del(ctx, del...).Err(); err != nil {
		s.logger.Warn("清理通话房间键失败", zap.Error(err), zap.String("call_id", callID.String()))
	}
	return before, true, reason, duration, nil
}

// EndWithReason 以指定原因强制终结房间（振铃超时、全员忙线）。
// 已接通的房间不受影响，返回 ended=false。
func (s *CallService) EndWithReason(
	ctx context.Context, callID uuid.UUID, reason EndReason,
) (*Room, bool, error) {
	room, err := s.Get(ctx, callID)
	if err != nil {
		return nil, false, err
	}
	if room.State == CallStateActive {
		return room, false, nil // 已接通，不该被超时终结
	}
	del := []string{roomKey(callID), partsKey(callID)}
	for _, p := range room.Participants {
		del = append(del, busyKey(p.UserID))
		if p.ConnID != "" {
			del = append(del, connKey(p.ConnID))
		}
	}
	if err := s.rdb.Del(ctx, del...).Err(); err != nil {
		return nil, false, fmt.Errorf("call end (%s): %w", reason, err)
	}
	return room, true, nil
}

// Get 读房间快照。房间不存在或已进入 ended 过渡态时返回 ErrCallNotFound。
func (s *CallService) Get(ctx context.Context, callID uuid.UUID) (*Room, error) {
	h, err := s.rdb.HGetAll(ctx, roomKey(callID)).Result()
	if err != nil {
		return nil, fmt.Errorf("read call room: %w", err)
	}
	if len(h) == 0 || h["state"] == string(CallStateEnded) {
		return nil, ErrCallNotFound
	}
	parts, err := s.rdb.HGetAll(ctx, partsKey(callID)).Result()
	if err != nil {
		return nil, fmt.Errorf("read call participants: %w", err)
	}
	room := &Room{
		CallID:    callID,
		Media:     CallMedia(h["media"]),
		State:     CallState(h["state"]),
		CreatedAt: derefTime(parseUnix(h["created_at"])),
	}
	room.ConversationID, _ = uuid.Parse(h["conversation_id"])
	room.CallerID, _ = uuid.Parse(h["caller_id"])
	room.AnsweredAt = parseUnix(h["answered_at"])
	for uidStr, v := range parts {
		id, err := uuid.Parse(uidStr)
		if err != nil {
			continue
		}
		conn, st := decodePart(v)
		room.Participants = append(room.Participants, Participant{UserID: id, ConnID: conn, State: st})
	}
	return room, nil
}

// CallIDForConn 由连接反查其所属通话与所属用户（断连清理用）。
func (s *CallService) CallIDForConn(ctx context.Context, connID string) (uuid.UUID, uuid.UUID, bool) {
	v, err := s.rdb.Get(ctx, connKey(connID)).Result()
	if err != nil || v == "" {
		return uuid.Nil, uuid.Nil, false
	}
	i := strings.Index(v, "|")
	if i < 0 {
		return uuid.Nil, uuid.Nil, false
	}
	callID, err1 := uuid.Parse(v[:i])
	userID, err2 := uuid.Parse(v[i+1:])
	if err1 != nil || err2 != nil {
		return uuid.Nil, uuid.Nil, false
	}
	return callID, userID, true
}

// ICEServer 一组 ICE 服务器配置（RTCIceServer 的 JSON 形状）。
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// ICEServersDTO ice-servers 端点的响应体。
type ICEServersDTO struct {
	ICEServers []ICEServer `json:"ice_servers"`
	TTL        int         `json:"ttl"`
}

// ICEServers 按 coturn 的 use-auth-secret（REST API）口径签发临时凭据。
//
// username = "<过期unix时间戳>:<用户ID>"，credential = base64(HMAC-SHA1(密钥, username))。
// coturn 侧用同一密钥复算校验，因此双方都不需要 TURN 用户表，凭据自带过期时间。
// HMAC-SHA1 是该协议规定的算法，不是安全强度上的选择。
func (s *CallService) ICEServers(userID uuid.UUID) ICEServersDTO {
	ttl := s.turn.CredentialTTL
	if ttl <= 0 {
		ttl = time.Hour
	}
	out := ICEServersDTO{
		ICEServers: []ICEServer{{URLs: []string{fmt.Sprintf("stun:%s:%d", s.turn.Host, s.turn.Port)}}},
		TTL:        int(ttl.Seconds()),
	}
	// 密钥为空等价于关闭：下发 credential 为空串的 TURN 项只会让客户端
	// 拿着一份必然认证失败的凭据反复重试，比没有 TURN 更难排查
	if !s.turn.Enabled || s.turn.StaticAuthSecret == "" {
		return out
	}
	username := fmt.Sprintf("%d:%s", time.Now().Add(ttl).Unix(), userID)
	mac := hmac.New(sha1.New, []byte(s.turn.StaticAuthSecret))
	mac.Write([]byte(username))
	out.ICEServers = append(out.ICEServers, ICEServer{
		URLs: []string{
			fmt.Sprintf("turn:%s:%d?transport=udp", s.turn.Host, s.turn.Port),
			fmt.Sprintf("turn:%s:%d?transport=tcp", s.turn.Host, s.turn.Port),
		},
		Username:   username,
		Credential: base64.StdEncoding.EncodeToString(mac.Sum(nil)),
	})
	return out
}

// toInt 把 Lua 回传的数值（可能是 int64 或字符串）转成 int64。
func toInt(v any) int64 {
	if n, ok := v.(int64); ok {
		return n
	}
	n, _ := strconv.ParseInt(fmt.Sprint(v), 10, 64)
	return n
}

// parseUnix 把 unix 秒字符串解析为时间；空串、非法值与 0 都返回 nil。
func parseUnix(s string) *time.Time {
	if s == "" {
		return nil
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n == 0 {
		return nil
	}
	t := time.Unix(n, 0).UTC()
	return &t
}

// derefTime 解引用时间指针，nil 取零值。
func derefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}
