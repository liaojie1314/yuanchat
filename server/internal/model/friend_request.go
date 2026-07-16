package model

import (
	"time"

	"github.com/google/uuid"
)

// FriendRequest 好友申请模型。
//
// 每对 (requester, target) 唯一一行：重复申请（含被拒后再申请）
// UPSERT 重置 status=pending 并更新验证消息与时间。
// 已通过的好友关系落在 contacts 表（双向两行），本表仅承载申请生命周期。
type FriendRequest struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	RequesterID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_requester_target" json:"requester_id"`
	TargetID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_requester_target" json:"target_id"`
	Message     *string   `gorm:"type:varchar(200)" json:"message,omitempty"`
	Status      int16     `gorm:"type:smallint;not null;default:0" json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TableName 指定表名
func (FriendRequest) TableName() string {
	return "friend_requests"
}

// FriendRequestStatus 申请状态枚举
const (
	FriendRequestStatusPending  int16 = 0
	FriendRequestStatusAccepted int16 = 1
	FriendRequestStatusRejected int16 = 2
)
