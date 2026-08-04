package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// ErrNotMember 用户不是会话成员。
var ErrNotMember = errors.New("not a conversation member")

// ErrSearchQueryTooShort 搜索关键词少于 3 个字符。
var ErrSearchQueryTooShort = errors.New("search query too short")

// 撤回相关错误。
var (
	// ErrMessageNotFound 目标消息不存在（或已软删）。
	ErrMessageNotFound = errors.New("message not found")
	// ErrNotSender 撤回者非消息发送者本人。
	ErrNotSender = errors.New("only the sender can recall the message")
	// ErrRecallWindowExpired 已超出可撤回时间窗口。
	ErrRecallWindowExpired = errors.New("recall window expired")
	// ErrInvalidEmoji 回应 emoji 为空或超长。
	ErrInvalidEmoji = errors.New("invalid emoji")
	// ErrInvalidMention @ 目标不在群成员内 / 非群会话尝试 @。
	ErrInvalidMention = errors.New("invalid mention target")
	// ErrInvalidQuote 引用消息不属于同一会话或不存在。
	ErrInvalidQuote = errors.New("invalid quote target")
	// ErrForwardTargetInvalid 转发目标会话中存在非成员会话。
	ErrForwardTargetInvalid = errors.New("forward target not accessible")
	// ErrForwardTooMany 单次转发超过最大目标数。
	ErrForwardTooMany = errors.New("too many forward targets")
	// ErrForwardNoTarget 转发未提供任何目标会话。
	ErrForwardNoTarget = errors.New("no forward target")
)

// RecallWindow 消息可撤回的时间窗口（自发送起 2 分钟）。
const RecallWindow = 2 * time.Minute

// MaxForwardTargets 单次转发最多目标会话数（UI 侧对应 CreateGroupModal 复用限制）。
const MaxForwardTargets = 9

// SendResult 消息落库后的结果，供 WS 层构造 ack / receive 推送。
type SendResult struct {
	Message           *model.Message
	SenderNickname    string
	MemberIDs         []uuid.UUID
	MentionedMembers  []uuid.UUID // SendContent 校验后回填，供 WS 层构造帧
}

// RecallResult 撤回结果，供 handler 构造 message.recalled 推送。
// Idempotent 为 true 时表示消息已处于撤回态，MemberIDs 为空，handler 跳过推送。
type RecallResult struct {
	Message          *model.Message
	OperatorNickname string
	MemberIDs        []uuid.UUID
	Idempotent       bool
}

// MessageService 消息核心服务：发送、历史、已读、撤回、表情回应。
type MessageService struct {
	msgRepo       *repository.MessageRepository
	convRepo      *repository.ConversationRepository
	userRepo      *repository.UserRepository
	reactionRepo  *repository.ReactionRepository
	blocklistRepo *repository.BlocklistRepository
	moderation    *ModerationService // 可为 nil（未配置词库时跳过审核）
	logger        *zap.Logger
}

// SetModeration 注入敏感词审核服务（router 装配时调用，避免改构造函数签名破坏现有测试）。
func (s *MessageService) SetModeration(m *ModerationService) {
	s.moderation = m
}

func NewMessageService(
	msgRepo *repository.MessageRepository,
	convRepo *repository.ConversationRepository,
	userRepo *repository.UserRepository,
	reactionRepo *repository.ReactionRepository,
	blocklistRepo *repository.BlocklistRepository,
	logger *zap.Logger,
) *MessageService {
	return &MessageService{
		msgRepo:       msgRepo,
		convRepo:      convRepo,
		userRepo:      userRepo,
		reactionRepo:  reactionRepo,
		blocklistRepo: blocklistRepo,
		logger:        logger,
	}
}

// SendText 校验成员身份后持久化文本消息（seq 事务内原子分配）。
//
// 文本内容序列化为 model.MessageContentText 后委托 SendContent，与图片等类型共用落库/推送骨架。
func (s *MessageService) SendText(
	ctx context.Context,
	senderID, convID uuid.UUID,
	text, clientMsgID string,
	replyTo *uuid.UUID,
) (*SendResult, error) {
	content, err := json.Marshal(model.MessageContentText{Text: text})
	if err != nil {
		return nil, fmt.Errorf("marshal content: %w", err)
	}
	return s.SendContent(ctx, senderID, convID, model.MessageTypeText, string(content), clientMsgID, replyTo, nil)
}

// SendContent 校验成员身份后持久化任意类型消息（content 为已序列化的 JSON 串，seq 事务内原子分配）。
//
// 调用方负责按 messageType 组装并序列化 content（文本、图片等），本方法只保证落库与成员/发送者信息装配一致。
//
// mentions 为群消息 @ 的用户 ID 列表：必须全部为当前会话成员且不含发送者自己。
// 校验通过后落入 messages.mentions（uuid[]）+ 事务里把命中的成员 conversation_members.mention_unread 置 true。
//
// replyTo 为引用回复的目标消息 ID：必须是同一会话内的历史消息，否则返回 ErrInvalidQuote。
func (s *MessageService) SendContent(
	ctx context.Context,
	senderID, convID uuid.UUID,
	messageType int16,
	contentJSON string,
	clientMsgID string,
	replyTo *uuid.UUID,
	mentions []uuid.UUID,
) (*SendResult, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, senderID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	// 单聊会话：任一方拉黑另一方即拒发（群聊不受成员间拉黑影响）
	conv, err := s.convRepo.FindByID(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load conversation: %w", err)
	}
	if conv != nil && conv.Type == model.ConversationTypePrivate {
		peer, err := s.convRepo.GetPeerUser(ctx, convID, senderID)
		if err != nil {
			return nil, fmt.Errorf("load peer: %w", err)
		}
		if peer != nil {
			blocked, err := s.blocklistRepo.IsBlockedEitherDirection(ctx, senderID, peer.ID)
			if err != nil {
				return nil, fmt.Errorf("check blocklist: %w", err)
			}
			if blocked {
				return nil, ErrBlocked
			}
		}
	}

	// 引用消息校验：必须同会话历史消息
	if replyTo != nil {
		quoted, err := s.msgRepo.FindByID(ctx, *replyTo)
		if err != nil {
			return nil, fmt.Errorf("load quoted message: %w", err)
		}
		if quoted == nil || quoted.ConversationID != convID {
			return nil, ErrInvalidQuote
		}
	}

	// @ 提及校验（仅群聊有意义）：所有目标都必须是当前群成员且非发送者本人
	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}
	validMentions := make([]uuid.UUID, 0, len(mentions))
	if len(mentions) > 0 {
		if conv == nil || conv.Type != model.ConversationTypeGroup {
			return nil, ErrInvalidMention
		}
		memberSet := make(map[uuid.UUID]struct{}, len(memberIDs))
		for _, id := range memberIDs {
			memberSet[id] = struct{}{}
		}
		seen := make(map[uuid.UUID]struct{}, len(mentions))
		for _, id := range mentions {
			if id == senderID {
				continue
			}
			if _, dup := seen[id]; dup {
				continue
			}
			if _, in := memberSet[id]; !in {
				return nil, ErrInvalidMention
			}
			seen[id] = struct{}{}
			validMentions = append(validMentions, id)
		}
	}

	msg := &model.Message{
		ConversationID: convID,
		SenderID:       senderID,
		MessageType:    messageType,
		Content:        contentJSON,
		Status:         model.MessageStatusNormal,
		ReplyToID:      replyTo,
	}
	// 敏感词审核：命中标记 flagged 进审核队列，消息正常发送（不阻塞）
	if s.moderation != nil && messageType == model.MessageTypeText {
		var tc model.MessageContentText
		if err := json.Unmarshal([]byte(contentJSON), &tc); err == nil {
			if hit := s.moderation.Check(tc.Text); hit != "" {
				msg.Flagged = true
				s.logger.Info("message flagged by moderation",
					zap.String("word", hit), zap.String("sender", senderID.String()))
			}
		}
	}
	if len(validMentions) > 0 {
		strs := make(pq.StringArray, len(validMentions))
		for i, id := range validMentions {
			strs[i] = id.String()
		}
		msg.Mentions = strs
	}
	if clientMsgID != "" {
		msg.ClientMsgID = &clientMsgID
	}

	if err := s.msgRepo.CreateWithSeq(ctx, msg); err != nil {
		return nil, fmt.Errorf("persist message: %w", err)
	}

	// mention_unread 打标：命中成员的会话面板红点
	if len(validMentions) > 0 {
		if err := s.convRepo.SetMentionUnread(ctx, convID, validMentions); err != nil {
			s.logger.Warn("set mention_unread failed", zap.Error(err))
		}
	}

	sender, err := s.userRepo.FindByID(ctx, senderID)
	if err != nil || sender == nil {
		return nil, fmt.Errorf("load sender: %w", err)
	}

	return &SendResult{
		Message:          msg,
		SenderNickname:   sender.Nickname,
		MemberIDs:        memberIDs,
		MentionedMembers: validMentions,
	}, nil
}

// Forward 一次转发到多个目标会话：source 与所有 target 都必须是 actor 参与的会话。
//
// 逐个会话独立走 SendContent 骨架（含拉黑/@校验/seq 分配），任何一个失败立即回错、
// 已成功的目标已产生独立消息不做回滚（转发本身是"广播"语义，容忍部分成功由前端顺序发起时反馈）。
func (s *MessageService) Forward(
	ctx context.Context,
	actorID, sourceMsgID uuid.UUID,
	targetConvIDs []uuid.UUID,
) ([]*SendResult, error) {
	if len(targetConvIDs) == 0 {
		return nil, ErrForwardNoTarget
	}
	if len(targetConvIDs) > MaxForwardTargets {
		return nil, ErrForwardTooMany
	}

	src, err := s.msgRepo.FindByID(ctx, sourceMsgID)
	if err != nil {
		return nil, fmt.Errorf("load source message: %w", err)
	}
	if src == nil || src.Status != model.MessageStatusNormal {
		return nil, ErrMessageNotFound
	}
	// 系统消息不允许转发
	if src.MessageType == model.MessageTypeSystem {
		return nil, ErrMessageNotFound
	}
	// actor 必须是 source 会话成员，且必须是每个 target 会话成员
	if ok, err := s.convRepo.IsMember(ctx, src.ConversationID, actorID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrNotMember
	}
	for _, tid := range targetConvIDs {
		if ok, err := s.convRepo.IsMember(ctx, tid, actorID); err != nil {
			return nil, err
		} else if !ok {
			return nil, ErrForwardTargetInvalid
		}
	}

	results := make([]*SendResult, 0, len(targetConvIDs))
	for _, tid := range targetConvIDs {
		res, err := s.SendContent(ctx, actorID, tid, src.MessageType, src.Content, "", nil, nil)
		if err != nil {
			return results, err
		}
		results = append(results, res)
	}
	return results, nil
}

// GetHistory 校验成员身份后按 seq 降序分页取历史消息。
// 返回的切片仍为降序，由 handler/前端决定展示顺序。
// 成员行的 cleared_before_seq 作为下界：单侧清空后旧消息对本人不可见（对方不受影响）。
func (s *MessageService) GetHistory(
	ctx context.Context,
	userID, convID uuid.UUID,
	beforeSeq int64,
	limit int,
) ([]repository.MessageWithSender, error) {
	member, ok, err := s.convRepo.GetMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	if limit <= 0 || limit > 100 {
		limit = 30
	}
	messages, err := s.msgRepo.ListBefore(ctx, convID, beforeSeq, member.ClearedBeforeSeq, limit)
	if err != nil {
		return nil, err
	}

	// 回填表情回应聚合（Mine 相对当前用户）
	if len(messages) > 0 {
		ids := make([]uuid.UUID, 0, len(messages))
		for _, m := range messages {
			ids = append(ids, m.ID)
		}
		aggs, err := s.reactionRepo.AggregateFor(ctx, ids, userID)
		if err != nil {
			s.logger.Warn("load reactions failed", zap.Error(err))
			return messages, nil
		}
		for i := range messages {
			messages[i].Reactions = aggs[messages[i].ID]
		}
	}
	return messages, nil
}

// MarkRead 推进用户已读进度并返回会话成员（供推送已读回执）。
func (s *MessageService) MarkRead(ctx context.Context, userID, convID uuid.UUID, seq int64) ([]uuid.UUID, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	if err := s.convRepo.UpdateLastReadSeq(ctx, convID, userID, seq); err != nil {
		return nil, fmt.Errorf("update read seq: %w", err)
	}
	return s.convRepo.GetMemberIDs(ctx, convID)
}

// TypingTargets 校验成员身份，返回发送者昵称与会话成员（供推送 typing 事件）。
func (s *MessageService) TypingTargets(ctx context.Context, userID, convID uuid.UUID) (string, []uuid.UUID, error) {
	ok, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil || !ok {
		return "", nil, ErrNotMember
	}

	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil || user == nil {
		return "", nil, fmt.Errorf("load user: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return "", nil, err
	}
	return user.Nickname, memberIDs, nil
}

// Recall 撤回消息：仅发送者本人、且在 RecallWindow 内可撤回。
//
// 已撤回的消息重复调用视为幂等成功（Idempotent=true，不再推送）。
func (s *MessageService) Recall(ctx context.Context, userID, messageID uuid.UUID) (*RecallResult, error) {
	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil {
		return nil, ErrMessageNotFound
	}
	if msg.SenderID != userID {
		return nil, ErrNotSender
	}

	// 已撤回：幂等返回，不重复推送。
	if msg.Status == model.MessageStatusRevoked {
		return &RecallResult{Message: msg, Idempotent: true}, nil
	}

	if time.Since(msg.CreatedAt) > RecallWindow {
		return nil, ErrRecallWindowExpired
	}

	flipped, err := s.msgRepo.Recall(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("recall message: %w", err)
	}
	// 并发下已被撤回（flipped=false）同样按幂等处理，不推送。
	if !flipped {
		return &RecallResult{Message: msg, Idempotent: true}, nil
	}
	msg.Status = model.MessageStatusRevoked
	msg.Content = "{}"

	operator, err := s.userRepo.FindByID(ctx, userID)
	if err != nil || operator == nil {
		return nil, fmt.Errorf("load operator: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, msg.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}

	return &RecallResult{
		Message:          msg,
		OperatorNickname: operator.Nickname,
		MemberIDs:        memberIDs,
	}, nil
}

// ReactionResult 表情回应 toggle 结果，供 handler 组帧推送。
type ReactionResult struct {
	Message   *model.Message
	Emoji     string
	Count     int64
	Reacted   bool
	MemberIDs []uuid.UUID
}

// ToggleReaction 切换用户对消息的某个 emoji 回应（有则删、无则加）。
// 已撤回消息视同不存在（不可回应）。
func (s *MessageService) ToggleReaction(ctx context.Context, userID, messageID uuid.UUID, emoji string) (*ReactionResult, error) {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" || len([]rune(emoji)) > 8 {
		return nil, ErrInvalidEmoji
	}

	msg, err := s.msgRepo.FindByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("find message: %w", err)
	}
	if msg == nil || msg.Status != model.MessageStatusNormal {
		return nil, ErrMessageNotFound
	}

	ok, err := s.convRepo.IsMember(ctx, msg.ConversationID, userID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return nil, ErrNotMember
	}

	reacted, count, err := s.reactionRepo.Toggle(ctx, messageID, userID, emoji)
	if err != nil {
		return nil, fmt.Errorf("toggle reaction: %w", err)
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, msg.ConversationID)
	if err != nil {
		return nil, fmt.Errorf("load members: %w", err)
	}

	return &ReactionResult{
		Message:   msg,
		Emoji:     emoji,
		Count:     count,
		Reacted:   reacted,
		MemberIDs: memberIDs,
	}, nil
}

// MessageSearchResult 搜索结果 DTO，供 handler 层 JSON 序列化。
type MessageSearchResult struct {
	MessageID      uuid.UUID `json:"message_id"`
	ConversationID uuid.UUID `json:"conversation_id"`
	ConvName       string    `json:"conv_name"`
	SenderNickname string    `json:"sender_nickname"`
	Excerpt        string    `json:"excerpt"`
	CreatedAt      time.Time `json:"created_at"`
	Seq            int64     `json:"seq"`
}

// Search 全文搜索消息，返回最多 limit 条按时间倒序的结果。
func (s *MessageService) Search(
	ctx context.Context,
	userID uuid.UUID,
	query string,
	convIDStr string,
	beforeStr string,
	limit int,
) ([]MessageSearchResult, bool, error) {
	if len([]rune(query)) < 3 {
		return nil, false, ErrSearchQueryTooShort
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	var convID *uuid.UUID
	if convIDStr != "" {
		id, err := uuid.Parse(convIDStr)
		if err != nil {
			return nil, false, fmt.Errorf("invalid conversation_id: %w", err)
		}
		convID = &id
	}

	var beforeTime *time.Time
	if beforeStr != "" {
		t, err := time.Parse(time.RFC3339, beforeStr)
		if err != nil {
			return nil, false, fmt.Errorf("invalid before timestamp: %w", err)
		}
		beforeTime = &t
	}

	rows, err := s.msgRepo.Search(ctx, userID, query, convID, beforeTime, limit+1)
	if err != nil {
		return nil, false, err
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	results := make([]MessageSearchResult, 0, len(rows))
	for _, row := range rows {
		var content struct {
			Text string `json:"text"`
		}
		_ = json.Unmarshal([]byte(row.Content), &content)
		excerpt := []rune(content.Text)
		if len(excerpt) > 120 {
			excerpt = append(excerpt[:120], []rune("…")...)
		}
		results = append(results, MessageSearchResult{
			MessageID:      row.ID,
			ConversationID: row.ConversationID,
			ConvName:       row.ConvName,
			SenderNickname: row.SenderNickname,
			Excerpt:        string(excerpt),
			CreatedAt:      row.CreatedAt,
			Seq:            row.Seq,
		})
	}
	return results, hasMore, nil
}
