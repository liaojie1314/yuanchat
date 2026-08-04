package service

import (
	"testing"

	"github.com/yuanchat/server/internal/model"
)

// TestA7ColumnsExist 兜底确认 010 新列可用（AutoMigrate 补列）。
func TestA7ColumnsExist(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}, &model.Conversation{}); err != nil {
		t.Fatalf("automigrate a7 columns: %v", err)
	}
}
