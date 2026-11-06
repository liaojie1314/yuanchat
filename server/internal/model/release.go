package model

import (
	"time"

	"github.com/google/uuid"
)

// AppRelease OTA 版本记录（迁移 023）。
//
// 一条记录就是「某平台某架构某渠道的某个版本」，对外更新端点按
// (platform, arch, channel, status) 找最新的 published 下发。
//
// Signature 只存 release 流水线产出的 minisign .sig 文本内容 ——
// 签名私钥不入库也不进管理端进程，管理端只做登记。
// Android 的 APK 没有 minisign 签名，客户端靠 Sha256 校验，故两个字段并存。
type AppRelease struct {
	ID       uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Platform string    `gorm:"type:varchar(16);not null" json:"platform"`
	Arch     string    `gorm:"type:varchar(24);not null" json:"arch"`
	Version  string    `gorm:"type:varchar(32);not null" json:"version"`
	Channel  string    `gorm:"type:varchar(16);not null;default:stable" json:"channel"`
	Notes    string    `gorm:"type:text;not null;default:''" json:"notes"`
	// ObjectKey 安装包在对象存储里的键；对外下发时现签预签名 URL。
	ObjectKey string `gorm:"type:text;not null" json:"object_key"`
	// Signature minisign .sig 文本内容（桌面端 Tauri updater 校验用）。
	Signature string `gorm:"type:text;not null;default:''" json:"signature"`
	// Sha256 安装包摘要（Android 自装前校验用）。
	Sha256 string `gorm:"type:varchar(64);not null;default:''" json:"sha256"`
	Size   int64  `gorm:"not null;default:0" json:"size"`
	// MinVersion 最低支持版本；客户端低于它即判强制更新。NULL 表示不设下限。
	MinVersion *string `gorm:"type:varchar(32)" json:"min_version,omitempty"`
	// Mandatory 无条件强制更新，与 MinVersion 取或。
	Mandatory bool `gorm:"not null;default:false" json:"mandatory"`
	// Rollout 灰度比例 0-100。0 是运营的「暂停下发」开关，100 是全量。
	//
	// 刻意**不写** gorm 的 default 标签：带 default 的字段取零值时 GORM 会把它
	// 整条省出 INSERT，于是「rollout=0 暂停下发」会被库里的 DEFAULT 100 顶成全量 ——
	// 这是把暂停开关变成全量开关，方向正好相反。
	// 列上的 DEFAULT 100 仍在（迁移 023），只对不经本结构体的手写 SQL 生效；
	// 经本结构体建记录时不填 rollout 即 0，fail-closed。
	Rollout int16 `gorm:"type:smallint;not null" json:"rollout"`
	// Status draft / published / rolled_back，取值见 ReleaseStatus* 常量。
	Status      string     `gorm:"type:varchar(16);not null;default:draft" json:"status"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
	CreatedBy   *uuid.UUID `gorm:"type:uuid" json:"created_by,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// TableName 指定表名。
func (AppRelease) TableName() string { return "app_releases" }

// ReleaseStatus 版本状态枚举。
//
// 回滚是独立状态而非删除记录：坏版本要留着痕迹，且「回滚过」与「从未发过」
// 对运营是两回事。
const (
	ReleaseStatusDraft      = "draft"
	ReleaseStatusPublished  = "published"
	ReleaseStatusRolledBack = "rolled_back"
)

// ReleaseChannel 渠道枚举。
const (
	ReleaseChannelStable = "stable"
	ReleaseChannelBeta   = "beta"
)
