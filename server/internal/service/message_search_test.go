package service

import (
	"context"
	"strings"
	"testing"

	"github.com/yuanchat/server/internal/model"
)

// TestMessageSearchNonempty 任意非空词均可查，去除空白且保持通配符的字面量语义。
func TestMessageSearchNonempty(t *testing.T) {
	f := newEditFixture(t)
	if err := f.db.Model(&model.Message{}).Where("id = ?", f.msgID).
		Update("content", `{"text":"托盘 AI 🙂A 50%_done"}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.Message{ConversationID: f.convID, SenderID: f.senderID, Seq: 2,
		MessageType: model.MessageTypeText, Status: model.MessageStatusNormal, Content: `{"text":"other lorem"}`}).Error; err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"托", "托盘", "A", "AI", "🙂", "🙂A", "%", "_", " \u3000托\t"} {
		t.Run(query, func(t *testing.T) {
			hits, _, err := f.svc.Search(context.Background(), f.senderID, query, "", nil, "", 20)
			if err != nil || len(hits) != 1 || hits[0].MessageID != f.msgID {
				t.Fatalf("query=%q hits=%v err=%v", query, hits, err)
			}
		})
	}
	for _, query := range []string{"", " ", "\u3000\t\r"} {
		t.Run("empty:"+query, func(t *testing.T) {
			_, _, err := f.svc.Search(context.Background(), f.senderID, query, "", nil, "", 20)
			if err == nil || !strings.Contains(err.Error(), "q is required") {
				t.Fatalf("query=%q err=%v, want empty-query rejection", query, err)
			}
		})
	}
}
