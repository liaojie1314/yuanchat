package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
)

// unreadOf 取指定会话在该用户列表里的未读数；会话不在列表里直接失败。
func unreadOf(t *testing.T, svc *ConversationService, userID, convID uuid.UUID) int64 {
	t.Helper()
	dtos, err := svc.List(context.Background(), userID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, d := range dtos {
		if d.ID == convID {
			return d.UnreadCount
		}
	}
	t.Fatalf("会话 %s 不在用户 %s 的列表里", convID, userID)
	return 0
}

// TestUnreadExcludesOwnMessages 未读数不能把自己发的消息算进去。
//
// 未读是 last_seq - last_read_seq，而 seq 全会话共享、自己发的消息同样占号。
// 真实症状：用手机发完消息，同一账号在电脑端就看到一条「未读」—— 发送方只在
// 进入会话时上报已读，发完并不会再报一次，服务端的 last_read_seq 因此永远落在
// 自己那几条之后。转发更明显：一次最多 9 个会话，全部凭空多出未读。
func TestUnreadExcludesOwnMessages(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate members: %v", err)
	}
	a := newTestUser(t, db, "甲自读")
	b := newTestUser(t, db, "乙自读")
	convID := newSendConv(t, db, a, b)
	msgSvc := newMessageSvc(db)
	convSvc := newConvSvc(db)
	ctx := context.Background()

	// b 发 2 条：对 a 是实打实的未读
	for i := 0; i < 2; i++ {
		if _, err := msgSvc.SendText(ctx, b.ID, convID, "from-b", "", nil); err != nil {
			t.Fatalf("send from b: %v", err)
		}
	}
	if got := unreadOf(t, convSvc, a.ID, convID); got != 2 {
		t.Fatalf("a 应有 2 条未读，实得 %d", got)
	}

	// a 从另一台设备发 3 条，期间不上报已读 —— 这三条对 a 自己不是未读
	for i := 0; i < 3; i++ {
		if _, err := msgSvc.SendText(ctx, a.ID, convID, "from-a", "", nil); err != nil {
			t.Fatalf("send from a: %v", err)
		}
	}
	if got := unreadOf(t, convSvc, a.ID, convID); got != 2 {
		t.Fatalf("a 自己发的 3 条不该算未读，期望仍是 2，实得 %d（减掉 own_unread 了吗）", got)
	}

	// 对端视角：只有 a 发的 3 条算未读，b 自己那 2 条不算
	if got := unreadOf(t, convSvc, b.ID, convID); got != 3 {
		t.Fatalf("b 应有 3 条未读（仅 a 发的），实得 %d", got)
	}

	// 读到底后两边归零
	if _, err := msgSvc.MarkRead(ctx, a.ID, convID, 5); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	if got := unreadOf(t, convSvc, a.ID, convID); got != 0 {
		t.Fatalf("读到底应为 0，实得 %d", got)
	}
}
