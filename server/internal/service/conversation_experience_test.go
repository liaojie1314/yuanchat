package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
)

// TestA7ColumnsExist 兜底确认 010 新列可用（AutoMigrate 补列）。
func TestA7ColumnsExist(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}, &model.Conversation{}); err != nil {
		t.Fatalf("automigrate a7 columns: %v", err)
	}
}

// TestUpdateAnnouncementByAdmin 管理员可更新公告，普通成员 403，非成员 ErrNotMember。
func TestUpdateAnnouncementByAdmin(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.Conversation{}, &model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	owner := newTestUser(t, db, "群主")
	member := newTestUser(t, db, "普通")
	outsider := newTestUser(t, db, "外人")
	svc := newConvSvc(db)
	makeFriends(t, db, owner.ID, member.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{member.ID})
	ctx := context.Background()

	res, _, updatedAt, err := svc.UpdateAnnouncement(ctx, owner.ID, convID, "新公告内容")
	if err != nil {
		t.Fatalf("owner update announcement: %v", err)
	}
	if res.SysMsg == nil || res.SysMsg.MessageType != model.MessageTypeSystem {
		t.Fatal("should emit system message")
	}
	if updatedAt == nil {
		t.Fatal("announcement_updated_at should be set")
	}

	// 库级断言：service 返回值正常但没落库属于假绿，必须读回真状态
	var conv model.Conversation
	if err := db.First(&conv, "id = ?", convID).Error; err != nil {
		t.Fatalf("reload conversation: %v", err)
	}
	if conv.Announcement == nil || *conv.Announcement != "新公告内容" {
		t.Fatalf("announcement not persisted, got %v", conv.Announcement)
	}
	if conv.AnnouncementUpdatedAt == nil {
		t.Fatal("announcement_updated_at not persisted")
	}

	// 列表 DTO 透出公告
	dtos, err := svc.List(ctx, owner.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var inList bool
	for _, d := range dtos {
		if d.ID == convID {
			inList = true
			if d.Announcement == nil || *d.Announcement != "新公告内容" {
				t.Fatalf("DTO should surface announcement, got %v", d.Announcement)
			}
		}
	}
	if !inList {
		t.Fatal("conversation not in list")
	}

	if _, _, _, err := svc.UpdateAnnouncement(ctx, member.ID, convID, "x"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("normal member should get ErrForbidden, got %v", err)
	}
	if _, _, _, err := svc.UpdateAnnouncement(ctx, outsider.ID, convID, "x"); !errors.Is(err, ErrNotMember) {
		t.Fatalf("outsider should get ErrNotMember, got %v", err)
	}

	// 超长报专用哨兵（非复用 ErrInvalidName）
	long := strings.Repeat("公", 1001)
	if _, _, _, err := svc.UpdateAnnouncement(ctx, owner.ID, convID, long); !errors.Is(err, ErrInvalidAnnouncement) {
		t.Fatalf("1001 runes should be ErrInvalidAnnouncement, got %v", err)
	}

	// 空串清除：库中回到 NULL
	if _, cleared, _, err := svc.UpdateAnnouncement(ctx, owner.ID, convID, ""); err != nil {
		t.Fatalf("clear announcement: %v", err)
	} else if cleared != nil {
		t.Fatalf("cleared announcement should be nil, got %q", *cleared)
	}
	var conv2 model.Conversation
	if err := db.First(&conv2, "id = ?", convID).Error; err != nil {
		t.Fatalf("reload after clear: %v", err)
	}
	if conv2.Announcement != nil {
		t.Fatalf("clear should NULL announcement, got %q", *conv2.Announcement)
	}
}

// TestUpdateMyAlias 任意成员可改自己的群昵称，超 30 字符 ErrInvalidAlias，成员列表署名生效。
func TestUpdateMyAlias(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	owner := newTestUser(t, db, "群主")
	member := newTestUser(t, db, "普通成员本名")
	svc := newConvSvc(db)
	makeFriends(t, db, owner.ID, member.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{member.ID})
	ctx := context.Background()

	if err := svc.UpdateMyAlias(ctx, member.ID, convID, "群里的我"); err != nil {
		t.Fatalf("member set alias: %v", err)
	}
	members, err := svc.Members(ctx, owner.ID, convID)
	if err != nil {
		t.Fatalf("members: %v", err)
	}
	var found bool
	for _, m := range members {
		if m.UserID == member.ID {
			found = true
			if m.Nickname != "群里的我" {
				t.Fatalf("alias should override nickname in member list, got %q", m.Nickname)
			}
		}
	}
	if !found {
		t.Fatal("member not in list")
	}

	// 超长报 ErrInvalidAlias
	long := ""
	for i := 0; i < 31; i++ {
		long += "x"
	}
	if err := svc.UpdateMyAlias(ctx, member.ID, convID, long); !errors.Is(err, ErrInvalidAlias) {
		t.Fatalf("31 chars should be ErrInvalidAlias, got %v", err)
	}

	// 空串 = 清除，署名回退本名
	if err := svc.UpdateMyAlias(ctx, member.ID, convID, ""); err != nil {
		t.Fatalf("clear alias: %v", err)
	}
	members2, _ := svc.Members(ctx, owner.ID, convID)
	for _, m := range members2 {
		if m.UserID == member.ID {
			if m.Nickname != "普通成员本名" {
				t.Fatalf("cleared alias should fall back to nickname, got %q", m.Nickname)
			}
			// 清除写 SQL NULL：与「从未设置」同一种状态，JSON 上 alias 字段整个消失
			if m.Alias != nil {
				t.Fatalf("cleared alias should be NULL, got %q", *m.Alias)
			}
		}
	}
}

// TestAliasSigningRealtimeAndPrivate alias 署名在实时发送/历史投影一致，且单聊不受影响。
//
// 覆盖 SendContent 的群会话 alias 覆盖分支（成员列表用例够不到），
// 并回归「单聊不得设 alias」——否则历史 COALESCE 会显示 alias 而实时显示本名。
func TestAliasSigningRealtimeAndPrivate(t *testing.T) {
	db := testDB(t)
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}
	owner := newTestUser(t, db, "群主sig")
	member := newTestUser(t, db, "本名sig")
	svc := newConvSvc(db)
	msgSvc := newMessageSvc(db)
	makeFriends(t, db, owner.ID, member.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{member.ID})
	ctx := context.Background()

	if err := svc.UpdateMyAlias(ctx, member.ID, convID, "群昵称sig"); err != nil {
		t.Fatalf("set alias: %v", err)
	}

	// 实时发送署名取 alias
	res, err := msgSvc.SendText(ctx, member.ID, convID, "hi", "", nil)
	if err != nil {
		t.Fatalf("group send: %v", err)
	}
	if res.SenderNickname != "群昵称sig" {
		t.Fatalf("realtime group signing should use alias, got %q", res.SenderNickname)
	}

	// 历史投影署名同样取 alias（与实时一致）
	hist, err := msgSvc.GetHistory(ctx, owner.ID, convID, 0, 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	var seen bool
	for _, m := range hist {
		if m.SenderID == member.ID {
			seen = true
			if m.SenderNickname != "群昵称sig" {
				t.Fatalf("history signing should use alias, got %q", m.SenderNickname)
			}
		}
	}
	if !seen {
		t.Fatal("member message missing from history")
	}

	// 清除后实时署名回退本名
	if err := svc.UpdateMyAlias(ctx, member.ID, convID, ""); err != nil {
		t.Fatalf("clear alias: %v", err)
	}
	res2, err := msgSvc.SendText(ctx, member.ID, convID, "hi2", "", nil)
	if err != nil {
		t.Fatalf("group send after clear: %v", err)
	}
	if res2.SenderNickname != "本名sig" {
		t.Fatalf("cleared alias should fall back to nickname, got %q", res2.SenderNickname)
	}

	// 单聊：不允许设 alias（群类型守卫），署名恒为用户本名
	pa := newTestUser(t, db, "私聊甲sig")
	pb := newTestUser(t, db, "私聊乙sig")
	pconv := newSendConv(t, db, pa, pb)
	if err := svc.UpdateMyAlias(ctx, pa.ID, pconv, "私聊别名"); !errors.Is(err, ErrNotGroup) {
		t.Fatalf("private conversation alias should be ErrNotGroup, got %v", err)
	}
	pres, err := msgSvc.SendText(ctx, pa.ID, pconv, "p", "", nil)
	if err != nil {
		t.Fatalf("private send: %v", err)
	}
	if pres.SenderNickname != "私聊甲sig" {
		t.Fatalf("private realtime signing should use nickname, got %q", pres.SenderNickname)
	}
	ph, err := msgSvc.GetHistory(ctx, pb.ID, pconv, 0, 10)
	if err != nil {
		t.Fatalf("private history: %v", err)
	}
	if len(ph) != 1 || ph[0].SenderNickname != "私聊甲sig" {
		t.Fatalf("private history signing should use nickname, got %+v", ph)
	}
}
