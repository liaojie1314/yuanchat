package model

import (
	"time"

	"github.com/google/uuid"
)

// StickerPack 表情包：官方预置，或用户自主发布（OwnerID 非空）后进入商城公开可见。
//
// OwnerID 为 NULL 同时表示「官方包」与「发布者已注销」两种情况，用 IsOfficial 区分；
// 外键 ON DELETE SET NULL（迁移 015）：发布者注销后其发布的包保留，已添加者不受影响。
type StickerPack struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name       string    `gorm:"type:varchar(64);not null" json:"name"`
	CoverURL   *string   `gorm:"type:varchar(500)" json:"cover_url,omitempty"`
	IsOfficial bool      `gorm:"not null;default:false" json:"is_official"`
	Sort       int       `gorm:"not null;default:0" json:"sort"`
	// OwnerID 发布者；官方包与「发布者已注销」均为 NULL。
	OwnerID *uuid.UUID `gorm:"type:uuid" json:"owner_id,omitempty"`
	// IsPublic 是否在商城公开可见（官方包 true；用户发布时置 true）。
	IsPublic bool `gorm:"not null;default:false" json:"is_public"`
	// Flagged 包名命中敏感词的打标（进 admin 审核队列，不影响展示）。
	Flagged bool `gorm:"not null;default:false" json:"flagged,omitempty"`
	// TakenDown 下架标记：admin 处置举报后置位，商城不再展示，已添加者保留。
	TakenDown bool      `gorm:"not null;default:false" json:"taken_down,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (StickerPack) TableName() string { return "sticker_packs" }

// UserStickerPack 用户「添加」的表情包关系（我的表情包 = 官方包 + 已添加包）。
// 是关系表而非内容快照：发布者后续增删贴纸时，已添加者下次拉取即看到新版本。
type UserStickerPack struct {
	ID     uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_usp_user_pack" json:"user_id"`
	PackID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_usp_user_pack" json:"pack_id"`
	// Sort 用户自定义排序位（未来「拖拽排序我的表情包」预留，当前恒为 0）。
	Sort      int       `gorm:"not null;default:0" json:"sort"`
	CreatedAt time.Time `json:"created_at"`
}

func (UserStickerPack) TableName() string { return "user_sticker_packs" }

// Sticker 单张贴纸：属于某个表情包（PackID 非空，官方/公共），
// 或属于某用户的个人收藏（OwnerID 非空，PackID 为空）——两者互斥，不会同时非空。
//
// OwnerID + ContentHash 的 uniqueIndex tag 必须与迁移 011 的
// CONSTRAINT idx_stickers_owner_hash 保持一致：测试用 AutoMigrate 建表，
// 缺 tag 会建出没有唯一约束的表，去重用例就只验证了应用层 SELECT、
// 从未验证真实 DB 约束（生产走 goose，约束是有的）。
type Sticker struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PackID      *uuid.UUID `gorm:"type:uuid" json:"pack_id,omitempty"`
	OwnerID     *uuid.UUID `gorm:"type:uuid;uniqueIndex:idx_stickers_owner_hash" json:"owner_id,omitempty"`
	ObjectKey   string     `gorm:"type:varchar(255);not null" json:"object_key"`
	Width       int        `gorm:"not null" json:"width"`
	Height      int        `gorm:"not null" json:"height"`
	ContentHash string     `gorm:"type:varchar(64);not null;uniqueIndex:idx_stickers_owner_hash" json:"content_hash"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (Sticker) TableName() string { return "stickers" }
