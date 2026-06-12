package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Contact 联系人关系模型
type Contact struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID        uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_user_contact" json:"user_id"`
	ContactUserID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_user_contact" json:"contact_user_id"`
	Remark        *string   `gorm:"type:varchar(50)" json:"remark,omitempty"`
	Status        int16     `gorm:"type:smallint;default:0" json:"status"`
	Source        *string   `gorm:"type:varchar(50)" json:"source,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

// TableName 指定表名
func (Contact) TableName() string {
	return "contacts"
}

// ContactStatus 联系人状态枚举
const (
	ContactStatusPending  int16 = 0
	ContactStatusAccepted int16 = 1
	ContactStatusRejected int16 = 2
	ContactStatusDeleted  int16 = 3
)
