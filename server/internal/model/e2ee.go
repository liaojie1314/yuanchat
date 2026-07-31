package model

import (
	"time"

	"github.com/google/uuid"
)

// E2EEIdentity 用户的长期身份密钥与当前 signed prekey（公钥部分）。
// 服务端只存公钥，任何私钥都不经过服务端。
//
// 注意：GORM 默认把 SignedPreKeyID 转为 signed_pre_key_id，与迁移里的
// signed_prekey_id 不符，故 prekey 相关字段显式声明 column 名。
type E2EEIdentity struct {
	UserID                uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	IdentityDHPublicKey   string    `gorm:"column:identity_dh_public_key;type:varchar(64);not null" json:"identity_dh_public_key"`
	IdentitySignPublicKey string    `gorm:"column:identity_sign_public_key;type:varchar(64);not null" json:"identity_sign_public_key"`
	SignedPreKeyID        int       `gorm:"column:signed_prekey_id;not null" json:"signed_prekey_id"`
	SignedPreKeyPublic    string    `gorm:"column:signed_prekey_public;type:varchar(64);not null" json:"signed_prekey_public"`
	SignedPreKeySignature string    `gorm:"column:signed_prekey_signature;type:varchar(128);not null" json:"signed_prekey_signature"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

// TableName 指定表名。
func (E2EEIdentity) TableName() string { return "e2ee_identities" }

// E2EEOneTimePreKey 一次性预密钥。分发即删，用尽后协商降级为 3DH。
type E2EEOneTimePreKey struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_otk_user_key,priority:1" json:"user_id"`
	KeyID     int       `gorm:"column:key_id;not null;uniqueIndex:idx_otk_user_key,priority:2" json:"key_id"`
	PublicKey string    `gorm:"column:public_key;type:varchar(64);not null" json:"public_key"`
	CreatedAt time.Time `json:"created_at"`
}

// TableName 指定表名。
func (E2EEOneTimePreKey) TableName() string { return "e2ee_one_time_prekeys" }

// E2EEKeyBackup 客户端 PIN 加密后的密钥备份 blob。
// 服务端无法解密（不知道 PIN），仅作存储与分发。
type E2EEKeyBackup struct {
	UserID     uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	CipherBlob string    `gorm:"type:text;not null" json:"cipher_blob"`
	Salt       string    `gorm:"type:varchar(64);not null" json:"salt"`
	Version    int       `gorm:"not null;default:1" json:"version"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// TableName 指定表名。
func (E2EEKeyBackup) TableName() string { return "e2ee_key_backups" }
