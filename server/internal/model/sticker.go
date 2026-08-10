package model

import (
	"time"

	"github.com/google/uuid"
)

// StickerPack 表情包（官方预置或未来第三方来源）。
type StickerPack struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name       string    `gorm:"type:varchar(64);not null" json:"name"`
	CoverURL   *string   `gorm:"type:varchar(500)" json:"cover_url,omitempty"`
	IsOfficial bool      `gorm:"not null;default:false" json:"is_official"`
	Sort       int       `gorm:"not null;default:0" json:"sort"`
	CreatedAt  time.Time `json:"created_at"`
}

func (StickerPack) TableName() string { return "sticker_packs" }

// Sticker 单张贴纸：属于某个表情包（PackID 非空，官方/公共），
// 或属于某用户的个人收藏（OwnerID 非空，PackID 为空）——两者互斥，不会同时非空。
type Sticker struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PackID      *uuid.UUID `gorm:"type:uuid" json:"pack_id,omitempty"`
	OwnerID     *uuid.UUID `gorm:"type:uuid" json:"owner_id,omitempty"`
	ObjectKey   string     `gorm:"type:varchar(255);not null" json:"object_key"`
	Width       int        `gorm:"not null" json:"width"`
	Height      int        `gorm:"not null" json:"height"`
	ContentHash string     `gorm:"type:varchar(64);not null" json:"content_hash"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (Sticker) TableName() string { return "stickers" }
