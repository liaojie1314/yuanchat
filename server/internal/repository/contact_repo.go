package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// FriendWithConv 好友列表查询的投影结果：好友资料 + 对应单聊会话。
type FriendWithConv struct {
	UserID         uuid.UUID  `json:"user_id"`
	Nickname       string     `json:"nickname"`
	AvatarURL      *string    `json:"avatar_url"`
	ShortID        int64      `json:"short_id"`
	ConversationID *uuid.UUID `json:"conversation_id"`
}

// RequestWithUsers 申请列表投影：申请行 + 双方资料。
type RequestWithUsers struct {
	model.FriendRequest
	RequesterNickname  string  `json:"requester_nickname"`
	RequesterAvatarURL *string `json:"requester_avatar_url"`
	RequesterShortID   int64   `json:"requester_short_id"`
	TargetNickname     string  `json:"target_nickname"`
	TargetAvatarURL    *string `json:"target_avatar_url"`
	TargetShortID      int64   `json:"target_short_id"`
}

// ContactRepository 处理 contacts / friend_requests 表。
type ContactRepository struct {
	db *gorm.DB
}

func NewContactRepository(db *gorm.DB) *ContactRepository {
	return &ContactRepository{db: db}
}

// DB 暴露底层连接供 service 层组织跨仓储事务。
func (r *ContactRepository) DB() *gorm.DB {
	return r.db
}

// IsFriend 双方是否已是好友（contacts 中存在 accepted 正向行即视为好友，
// 写入时恒双向成对，单查一向足够）。
func (r *ContactRepository) IsFriend(ctx context.Context, userID, otherID uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&model.Contact{}).
		Where("user_id = ? AND contact_user_id = ? AND status = ?", userID, otherID, model.ContactStatusAccepted).
		Count(&count).Error
	return count > 0, err
}

// UpsertRequest 幂等发起申请：同 (requester, target) 已有行时重置为 pending 并更新验证消息。
// 返回落库后的申请行（含 ID，供推送）。
func (r *ContactRepository) UpsertRequest(ctx context.Context, req *model.FriendRequest) error {
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "requester_id"}, {Name: "target_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"message":    req.Message,
				"status":     model.FriendRequestStatusPending,
				"updated_at": gorm.Expr("now()"),
			}),
		}).
		Create(req).Error
}

// FindRequestByID 按 ID 查申请，不存在返回 nil。
func (r *ContactRepository) FindRequestByID(ctx context.Context, id uuid.UUID) (*model.FriendRequest, error) {
	var req model.FriendRequest
	err := r.db.WithContext(ctx).First(&req, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &req, err
}

// FindPendingBetween 查双方向的 pending 申请（搜索结果 relation 判定用）。
// 返回 (出向 pending, 入向 pending)。
func (r *ContactRepository) FindPendingBetween(ctx context.Context, userID, otherID uuid.UUID) (bool, bool, error) {
	var rows []model.FriendRequest
	err := r.db.WithContext(ctx).
		Where("status = ?", model.FriendRequestStatusPending).
		Where("(requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)",
			userID, otherID, otherID, userID).
		Find(&rows).Error
	if err != nil {
		return false, false, err
	}
	var out, in bool
	for _, row := range rows {
		if row.RequesterID == userID {
			out = true
		} else {
			in = true
		}
	}
	return out, in, nil
}

// ListRequestsByUser 查用户相关的全部申请（收到的 + 发出的），按更新时间倒序。
func (r *ContactRepository) ListRequestsByUser(ctx context.Context, userID uuid.UUID) ([]RequestWithUsers, error) {
	var items []RequestWithUsers
	err := r.db.WithContext(ctx).
		Table("friend_requests fr").
		Select(`fr.*,
			ru.nickname AS requester_nickname, ru.avatar_url AS requester_avatar_url, ru.short_id AS requester_short_id,
			tu.nickname AS target_nickname, tu.avatar_url AS target_avatar_url, tu.short_id AS target_short_id`).
		Joins("JOIN users ru ON ru.id = fr.requester_id").
		Joins("JOIN users tu ON tu.id = fr.target_id").
		Where("fr.requester_id = ? OR fr.target_id = ?", userID, userID).
		Order("fr.updated_at DESC").
		Scan(&items).Error
	return items, err
}

// ListFriends 查用户的好友列表，并解析每个好友对应的单聊会话 ID。
//
// 会话解析：双方共同所在、恰好 2 人的 private 会话（accept 时必建，
// 正常数据下不为空；LEFT JOIN 容忍历史脏数据）。
func (r *ContactRepository) ListFriends(ctx context.Context, userID uuid.UUID) ([]FriendWithConv, error) {
	var items []FriendWithConv
	err := r.db.WithContext(ctx).
		Table("contacts ct").
		Select(`ct.contact_user_id AS user_id, u.nickname, u.avatar_url, u.short_id,
			(SELECT c.id FROM conversations c
			 JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ct.user_id
			 JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ct.contact_user_id
			 WHERE c.type = ? AND c.deleted_at IS NULL
			   AND (SELECT count(*) FROM conversation_members m3 WHERE m3.conversation_id = c.id) = 2
			 LIMIT 1) AS conversation_id`,
			model.ConversationTypePrivate).
		Joins("JOIN users u ON u.id = ct.contact_user_id").
		Where("ct.user_id = ? AND ct.status = ? AND ct.deleted_at IS NULL", userID, model.ContactStatusAccepted).
		Order("u.nickname ASC").
		Scan(&items).Error
	return items, err
}

// FriendIDs 返回用户全部好友的用户 ID（presence 广播目标）。
func (r *ContactRepository) FriendIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.db.WithContext(ctx).
		Model(&model.Contact{}).
		Where("user_id = ? AND status = ? AND deleted_at IS NULL", userID, model.ContactStatusAccepted).
		Pluck("contact_user_id", &ids).Error
	return ids, err
}
