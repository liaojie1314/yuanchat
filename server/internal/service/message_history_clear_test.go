package service

import (
	"context"
	"testing"

	"github.com/yuanchat/server/internal/model"
)

// TestClearHistoryPerMember 清空后本人拉不到旧消息，对方不受影响。
func TestClearHistoryPerMember(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate members: %v", err)
	}
	a := newTestUser(t, db, "甲")
	b := newTestUser(t, db, "乙")
	convID := newSendConv(t, db, a, b)
	msgSvc := newMessageSvc(db)
	ctx := context.Background()

	// a、b 各发 2 条
	for i := 0; i < 2; i++ {
		if _, err := msgSvc.SendText(ctx, a.ID, convID, "a-msg", "", nil); err != nil {
			t.Fatalf("send a: %v", err)
		}
		if _, err := msgSvc.SendText(ctx, b.ID, convID, "b-msg", "", nil); err != nil {
			t.Fatalf("send b: %v", err)
		}
	}

	convSvc := newConvSvc(db)
	if err := convSvc.ClearHistory(ctx, a.ID, convID); err != nil {
		t.Fatalf("clear: %v", err)
	}

	aMsgs, _ := msgSvc.GetHistory(ctx, a.ID, convID, 0, 30)
	if len(aMsgs) != 0 {
		t.Fatalf("cleared member should see 0 history, got %d", len(aMsgs))
	}
	bMsgs, _ := msgSvc.GetHistory(ctx, b.ID, convID, 0, 30)
	if len(bMsgs) != 4 {
		t.Fatalf("other member should see all 4, got %d", len(bMsgs))
	}

	// 清空后新发的消息本人可见
	if _, err := msgSvc.SendText(ctx, b.ID, convID, "after-clear", "", nil); err != nil {
		t.Fatalf("send after clear: %v", err)
	}
	aAfter, _ := msgSvc.GetHistory(ctx, a.ID, convID, 0, 30)
	if len(aAfter) != 1 {
		t.Fatalf("cleared member should see only post-clear msg, got %d", len(aAfter))
	}
}

// TestClearHistoryNonMember 非成员清空返回 ErrNotMember。
func TestClearHistoryNonMember(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate members: %v", err)
	}
	a := newTestUser(t, db, "甲")
	b := newTestUser(t, db, "乙")
	outsider := newTestUser(t, db, "丙")
	convID := newSendConv(t, db, a, b)

	if err := newConvSvc(db).ClearHistory(context.Background(), outsider.ID, convID); err == nil {
		t.Fatal("outsider clear should fail")
	}
}
