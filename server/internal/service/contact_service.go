package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ContactService 可能返回的错误。
var (
	ErrSelfRequest       = errors.New("cannot add yourself as a friend")
	ErrAlreadyFriends    = errors.New("already friends")
	ErrRequestNotFound   = errors.New("friend request not found")
	ErrNotRequestTarget  = errors.New("not the target of this request")
	ErrRequestNotPending = errors.New("request is not pending")
)

// greetingText 同意好友申请后自动发送的打招呼消息（以同意方身份发出）。
const greetingText = "我通过了你的好友申请，现在我们可以开始聊天了"

var digitRe = regexp.MustCompile(`^[0-9]+$`)

// SearchResult 用户搜索结果：用户 + 与当前用户的关系。
type SearchResult struct {
	User *model.User
	// 取值：none | friend | pending_out | pending_in | self
	Relation string
}

// AcceptResult 同意申请的结果，供 handler 构造 WS 推送与 REST 响应。
//
// Greeting 为 nil 表示幂等命中（此前已同意过），无需再推送。
type AcceptResult struct {
	Request        *model.FriendRequest
	Accepter       *model.User
	ConversationID uuid.UUID
	Greeting       *model.Message
	MemberIDs      []uuid.UUID
}

// ContactService 联系人/好友服务：搜索、申请、同意/拒绝、好友列表。
type ContactService struct {
	repo     *repository.ContactRepository
	userRepo *repository.UserRepository
	logger   *zap.Logger
}

func NewContactService(
	repo *repository.ContactRepository,
	userRepo *repository.UserRepository,
	logger *zap.Logger,
) *ContactService {
	return &ContactService{repo: repo, userRepo: userRepo, logger: logger}
}

// Search 精确匹配查找用户：11 位纯数字按手机号，其余纯数字按元聊号（short_id），
// 含 @ 按邮箱；其他形式一律视为未命中（不做模糊搜索，防用户枚举）。
func (s *ContactService) Search(ctx context.Context, selfID uuid.UUID, q string) (*SearchResult, error) {
	q = strings.TrimSpace(q)

	var user *model.User
	var err error
	switch {
	case q == "":
		return nil, ErrUserNotFound
	case strings.Contains(q, "@"):
		user, err = s.userRepo.FindByEmail(ctx, q)
	case digitRe.MatchString(q) && len(q) == 11:
		user, err = s.userRepo.FindByPhone(ctx, q)
	case digitRe.MatchString(q):
		sid, perr := strconv.ParseInt(q, 10, 64)
		if perr != nil {
			return nil, ErrUserNotFound
		}
		user, err = s.userRepo.FindByShortID(ctx, sid)
	default:
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("search user: %w", err)
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	relation, err := s.relationOf(ctx, selfID, user.ID)
	if err != nil {
		return nil, err
	}
	return &SearchResult{User: user, Relation: relation}, nil
}

// relationOf 计算目标用户与当前用户的关系标签。
func (s *ContactService) relationOf(ctx context.Context, selfID, otherID uuid.UUID) (string, error) {
	if selfID == otherID {
		return "self", nil
	}
	isFriend, err := s.repo.IsFriend(ctx, selfID, otherID)
	if err != nil {
		return "", fmt.Errorf("check friendship: %w", err)
	}
	if isFriend {
		return "friend", nil
	}
	out, in, err := s.repo.FindPendingBetween(ctx, selfID, otherID)
	if err != nil {
		return "", fmt.Errorf("check pending: %w", err)
	}
	if out {
		return "pending_out", nil
	}
	if in {
		return "pending_in", nil
	}
	return "none", nil
}

// SendRequest 发起好友申请（幂等 UPSERT）。
// 返回落库申请与申请人资料（供推送 contact.request 给目标用户）。
func (s *ContactService) SendRequest(
	ctx context.Context,
	requesterID, targetID uuid.UUID,
	message string,
) (*model.FriendRequest, *model.User, error) {
	if requesterID == targetID {
		return nil, nil, ErrSelfRequest
	}

	target, err := s.userRepo.FindByID(ctx, targetID)
	if err != nil {
		return nil, nil, fmt.Errorf("find target: %w", err)
	}
	if target == nil {
		return nil, nil, ErrUserNotFound
	}

	isFriend, err := s.repo.IsFriend(ctx, requesterID, targetID)
	if err != nil {
		return nil, nil, fmt.Errorf("check friendship: %w", err)
	}
	if isFriend {
		return nil, nil, ErrAlreadyFriends
	}

	requester, err := s.userRepo.FindByID(ctx, requesterID)
	if err != nil || requester == nil {
		return nil, nil, fmt.Errorf("load requester: %w", err)
	}

	req := &model.FriendRequest{
		RequesterID: requesterID,
		TargetID:    targetID,
		Message:     strPtr(strings.TrimSpace(message)),
		Status:      model.FriendRequestStatusPending,
	}
	if err := s.repo.UpsertRequest(ctx, req); err != nil {
		return nil, nil, fmt.Errorf("upsert request: %w", err)
	}
	return req, requester, nil
}

// ListRequests 查当前用户相关的全部申请（收到 + 发出）。
func (s *ContactService) ListRequests(ctx context.Context, userID uuid.UUID) ([]repository.RequestWithUsers, error) {
	return s.repo.ListRequestsByUser(ctx, userID)
}

// ListFriends 查好友列表（含对应单聊会话 ID）。
func (s *ContactService) ListFriends(ctx context.Context, userID uuid.UUID) ([]repository.FriendWithConv, error) {
	return s.repo.ListFriends(ctx, userID)
}

// Accept 同意好友申请。事务内原子完成：
//
//  1. 申请状态翻转（WHERE status=pending 并发守卫）
//  2. 双向 contacts 两行 UPSERT
//  3. get-or-create 双人单聊会话
//  4. 以同意方身份发打招呼消息（复用 CreateWithSeq，tx 内为 savepoint）
//     并推进同意方已读进度（自己发的不计未读）
//
// 幂等：已 accepted 的申请直接返回既有会话（Greeting=nil，不重复推送）。
func (s *ContactService) Accept(ctx context.Context, userID, requestID uuid.UUID) (*AcceptResult, error) {
	req, err := s.repo.FindRequestByID(ctx, requestID)
	if err != nil {
		return nil, fmt.Errorf("find request: %w", err)
	}
	if req == nil {
		return nil, ErrRequestNotFound
	}
	if req.TargetID != userID {
		return nil, ErrNotRequestTarget
	}

	accepter, err := s.userRepo.FindByID(ctx, userID)
	if err != nil || accepter == nil {
		return nil, fmt.Errorf("load accepter: %w", err)
	}

	// 幂等：重复同意返回既有会话，不再建关系/发消息
	if req.Status == model.FriendRequestStatusAccepted {
		convID, err := findPrivateConvID(ctx, s.repo.DB(), req.RequesterID, req.TargetID)
		if err != nil {
			return nil, fmt.Errorf("find conversation: %w", err)
		}
		return &AcceptResult{Request: req, Accepter: accepter, ConversationID: convID}, nil
	}
	if req.Status != model.FriendRequestStatusPending {
		return nil, ErrRequestNotPending
	}

	result := &AcceptResult{Request: req, Accepter: accepter}

	err = s.repo.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1. 状态翻转（并发下只有一个请求能成功）
		res := tx.Model(&model.FriendRequest{}).
			Where("id = ? AND status = ?", requestID, model.FriendRequestStatusPending).
			Update("status", model.FriendRequestStatusAccepted)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrRequestNotPending
		}

		// 2. 双向好友关系（UPSERT：曾删除/拒绝的关系行复活为 accepted）
		pairs := [][2]uuid.UUID{
			{req.RequesterID, req.TargetID},
			{req.TargetID, req.RequesterID},
		}
		for _, pair := range pairs {
			contact := &model.Contact{
				UserID:        pair[0],
				ContactUserID: pair[1],
				Status:        model.ContactStatusAccepted,
				Source:        strPtr("friend_request"),
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "user_id"}, {Name: "contact_user_id"}},
				DoUpdates: clause.Assignments(map[string]any{
					"status":     model.ContactStatusAccepted,
					"deleted_at": nil,
					"updated_at": gorm.Expr("now()"),
				}),
			}).Create(contact).Error; err != nil {
				return err
			}
		}

		// 3. get-or-create 单聊会话
		convID, err := findPrivateConvID(ctx, tx, req.RequesterID, req.TargetID)
		if err != nil {
			return err
		}
		if convID == uuid.Nil {
			conv := &model.Conversation{Type: model.ConversationTypePrivate}
			if err := tx.Create(conv).Error; err != nil {
				return err
			}
			for _, uid := range []uuid.UUID{req.RequesterID, req.TargetID} {
				member := &model.ConversationMember{
					ConversationID: conv.ID,
					UserID:         uid,
					Role:           model.MemberRoleNormal,
					JoinedAt:       time.Now(),
				}
				if err := tx.Create(member).Error; err != nil {
					return err
				}
			}
			convID = conv.ID
		}
		result.ConversationID = convID

		// 4. 打招呼消息（同意方身份；CreateWithSeq 在 tx 内成为 savepoint）
		content, err := json.Marshal(model.MessageContentText{Text: greetingText})
		if err != nil {
			return err
		}
		msg := &model.Message{
			ConversationID: convID,
			SenderID:       userID,
			MessageType:    model.MessageTypeText,
			Content:        string(content),
			Status:         model.MessageStatusNormal,
		}
		if err := repository.NewMessageRepository(tx).CreateWithSeq(ctx, msg); err != nil {
			return err
		}
		result.Greeting = msg

		// 自己发的打招呼不计入自己的未读
		return tx.Model(&model.ConversationMember{}).
			Where("conversation_id = ? AND user_id = ? AND last_read_seq < ?", convID, userID, msg.Seq).
			Update("last_read_seq", msg.Seq).Error
	})
	if err != nil {
		return nil, err
	}

	req.Status = model.FriendRequestStatusAccepted
	result.MemberIDs = []uuid.UUID{req.RequesterID, req.TargetID}

	s.logger.Info("friend request accepted",
		zap.String("request_id", requestID.String()),
		zap.String("conversation_id", result.ConversationID.String()))
	return result, nil
}

// DeleteFriend 双向软删好友关系（contacts 两行）。幂等。
// 单聊会话与历史消息保留（前端可选择性隐藏或允许重新加好友后继续对话）。
// 自删（userID == friendID）视为无效请求。
func (s *ContactService) DeleteFriend(ctx context.Context, userID, friendID uuid.UUID) error {
	if userID == friendID {
		return ErrSelfRequest
	}
	return s.repo.Delete(ctx, userID, friendID)
}

// Reject 拒绝好友申请（仅 target 本人、仅 pending 可拒；不推送给申请方）。
func (s *ContactService) Reject(ctx context.Context, userID, requestID uuid.UUID) error {
	req, err := s.repo.FindRequestByID(ctx, requestID)
	if err != nil {
		return fmt.Errorf("find request: %w", err)
	}
	if req == nil {
		return ErrRequestNotFound
	}
	if req.TargetID != userID {
		return ErrNotRequestTarget
	}
	if req.Status != model.FriendRequestStatusPending {
		return ErrRequestNotPending
	}

	res := s.repo.DB().WithContext(ctx).Model(&model.FriendRequest{}).
		Where("id = ? AND status = ?", requestID, model.FriendRequestStatusPending).
		Update("status", model.FriendRequestStatusRejected)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrRequestNotPending
	}
	return nil
}

// findPrivateConvID 查双方共同所在、恰好 2 人的单聊会话 ID；无则返回 uuid.Nil。
//
// db 可以是根连接或事务句柄。注意：gorm Raw().Scan 不能直接扫进 uuid.UUID
// （驱动返回 string），用 string 中转。
func findPrivateConvID(ctx context.Context, db *gorm.DB, a, b uuid.UUID) (uuid.UUID, error) {
	var idStr string
	err := db.WithContext(ctx).Raw(`
		SELECT c.id FROM conversations c
		WHERE c.type = ? AND c.deleted_at IS NULL
		  AND (SELECT count(*) FROM conversation_members m WHERE m.conversation_id = c.id) = 2
		  AND NOT EXISTS (
		    SELECT 1 FROM conversation_members m
		    WHERE m.conversation_id = c.id AND m.user_id NOT IN (?, ?)
		  )
		LIMIT 1`, model.ConversationTypePrivate, a, b).Scan(&idStr).Error
	if err != nil || idStr == "" {
		return uuid.Nil, err
	}
	return uuid.Parse(idStr)
}
