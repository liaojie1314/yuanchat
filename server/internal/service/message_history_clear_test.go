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

// TestClearHistoryResetsUnread 清空同时推进 last_read_seq：
// 否则未读数仍计入已被过滤、再也拉不回的旧消息（列表显示未读但点进去是空的）。
func TestClearHistoryResetsUnread(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate members: %v", err)
	}
	a := newTestUser(t, db, "甲unread")
	b := newTestUser(t, db, "乙unread")
	convID := newSendConv(t, db, a, b)
	msgSvc := newMessageSvc(db)
	convSvc := newConvSvc(db)
	ctx := context.Background()

	// b 发 3 条，a 一条没读 → a 未读 3
	for i := 0; i < 3; i++ {
		if _, err := msgSvc.SendText(ctx, b.ID, convID, "unread-msg", "", nil); err != nil {
			t.Fatalf("send: %v", err)
		}
	}
	dtos, err := convSvc.List(ctx, a.ID)
	if err != nil {
		t.Fatalf("list before clear: %v", err)
	}
	for _, d := range dtos {
		if d.ID == convID && d.UnreadCount != 3 {
			t.Fatalf("want 3 unread before clear, got %d", d.UnreadCount)
		}
	}

	if err := convSvc.ClearHistory(ctx, a.ID, convID); err != nil {
		t.Fatalf("clear: %v", err)
	}

	dtos2, err := convSvc.List(ctx, a.ID)
	if err != nil {
		t.Fatalf("list after clear: %v", err)
	}
	var found bool
	for _, d := range dtos2 {
		if d.ID == convID {
			found = true
			if d.UnreadCount != 0 {
				t.Fatalf("clear should zero unread, got %d", d.UnreadCount)
			}
			if d.LastMessage != nil {
				t.Fatalf("clear should drop last_message preview, got %+v", d.LastMessage)
			}
		}
	}
	if !found {
		t.Fatal("conversation not in list")
	}

	// 对方未读语义不受影响：b 自己发的消息本就已读，仍为 0；且预览仍在
	bDtos, _ := convSvc.List(ctx, b.ID)
	for _, d := range bDtos {
		if d.ID == convID && d.LastMessage == nil {
			t.Fatal("peer should still see last_message preview")
		}
	}

	// 重复清空幂等：不报错、不回退
	if err := convSvc.ClearHistory(ctx, a.ID, convID); err != nil {
		t.Fatalf("repeat clear should be idempotent: %v", err)
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
