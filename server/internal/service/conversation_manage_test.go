package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// makeFriends 建立双向 accepted 好友关系（用后清理）。
func makeFriends(t *testing.T, db *gorm.DB, a, b uuid.UUID) {
	t.Helper()
	for _, pair := range [][2]uuid.UUID{{a, b}, {b, a}} {
		ct := &model.Contact{UserID: pair[0], ContactUserID: pair[1], Status: model.ContactStatusAccepted}
		if err := db.Create(ct).Error; err != nil {
			t.Fatalf("create contact: %v", err)
		}
		t.Cleanup(func() { db.Unscoped().Delete(ct) })
	}
}

// newManagedGroup 建一个 owner + 若干成员的群，返回会话 ID（清理由 newTestUser 级联）。
func newManagedGroup(t *testing.T, svc *ConversationService, ownerID uuid.UUID, memberIDs []uuid.UUID) uuid.UUID {
	t.Helper()
	dto, _, err := svc.CreateGroup(context.Background(), ownerID, nil, memberIDs)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	return dto.ID
}

func TestRenameGroupByOwner(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "mg-owner")
	m1 := newTestUser(t, db, "mg-m1")
	makeFriends(t, db, owner.ID, m1.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID})

	res, err := svc.RenameGroup(context.Background(), owner.ID, convID, "新群名")
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if res.Name != "新群名" {
		t.Fatalf("got name %q", res.Name)
	}
	if res.SysMsg == nil || res.SysMsg.MessageType != model.MessageTypeSystem {
		t.Fatal("system message not persisted")
	}
	if res.SysMsg.Seq < 2 {
		t.Fatalf("system message seq not incremented: %d", res.SysMsg.Seq)
	}
	if len(res.MemberIDs) != 2 {
		t.Fatalf("member ids: %v", res.MemberIDs)
	}
	var conv model.Conversation
	db.First(&conv, "id = ?", convID)
	if conv.Name == nil || *conv.Name != "新群名" {
		t.Fatal("db name not updated")
	}
}

func TestRenameByNormalMemberForbidden(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "mg-o2")
	m1 := newTestUser(t, db, "mg-m2")
	outsider := newTestUser(t, db, "mg-x2")
	makeFriends(t, db, owner.ID, m1.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID})

	if _, err := svc.RenameGroup(context.Background(), m1.ID, convID, "x"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	if _, err := svc.RenameGroup(context.Background(), outsider.ID, convID, "x"); !errors.Is(err, ErrNotMember) {
		t.Fatalf("want ErrNotMember, got %v", err)
	}
	if _, err := svc.RenameGroup(context.Background(), owner.ID, convID, "   "); !errors.Is(err, ErrInvalidName) {
		t.Fatalf("want ErrInvalidName, got %v", err)
	}
	if _, err := svc.RenameGroup(context.Background(), owner.ID, uuid.New(), "x"); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("want ErrConversationNotFound, got %v", err)
	}
}

func TestRenameOnPrivateConvFails(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	a := newTestUser(t, db, "mg-pa")
	b := newTestUser(t, db, "mg-pb")

	conv := model.Conversation{Type: model.ConversationTypePrivate}
	if err := db.Create(&conv).Error; err != nil {
		t.Fatalf("create private conv: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(&conv) })
	for _, uid := range []uuid.UUID{a.ID, b.ID} {
		if err := db.Create(&model.ConversationMember{ConversationID: conv.ID, UserID: uid}).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}

	if _, err := svc.RenameGroup(context.Background(), a.ID, conv.ID, "x"); !errors.Is(err, ErrNotGroup) {
		t.Fatalf("want ErrNotGroup, got %v", err)
	}
}

func TestInviteAddsMembersWithReadSeq(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "mg-io")
	m1 := newTestUser(t, db, "mg-im1")
	newbie := newTestUser(t, db, "mg-inew")
	makeFriends(t, db, owner.ID, m1.ID)
	makeFriends(t, db, owner.ID, newbie.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID})

	var before model.Conversation
	db.First(&before, "id = ?", convID)

	res, err := svc.InviteMembers(context.Background(), owner.ID, convID, []uuid.UUID{newbie.ID})
	if err != nil {
		t.Fatalf("invite: %v", err)
	}
	if res.MemberCount != 3 || len(res.NewMemberIDs) != 1 || res.NewMemberIDs[0] != newbie.ID {
		t.Fatalf("bad result: %+v", res)
	}
	if res.SysMsg == nil || res.SysMsg.MessageType != model.MessageTypeSystem {
		t.Fatal("system message not persisted")
	}

	var member model.ConversationMember
	if err := db.Where("conversation_id = ? AND user_id = ?", convID, newbie.ID).First(&member).Error; err != nil {
		t.Fatalf("member row missing: %v", err)
	}
	// 新成员 last_read_seq = 邀请前 last_seq → 只有邀请系统消息 1 条未读
	if member.LastReadSeq != before.LastSeq {
		t.Fatalf("last_read_seq = %d, want %d", member.LastReadSeq, before.LastSeq)
	}
	if res.NewMemberDTO == nil || res.NewMemberDTO.UnreadCount != 1 {
		t.Fatalf("NewMemberDTO: %+v", res.NewMemberDTO)
	}
}

func TestInviteNonFriendFails(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "mg-nfo")
	m1 := newTestUser(t, db, "mg-nfm")
	stranger := newTestUser(t, db, "mg-nfs")
	makeFriends(t, db, owner.ID, m1.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID})

	if _, err := svc.InviteMembers(context.Background(), owner.ID, convID, []uuid.UUID{stranger.ID}); !errors.Is(err, ErrNotAllFriends) {
		t.Fatalf("want ErrNotAllFriends, got %v", err)
	}
	// 已在群成员被剔除 → 全部已在群 = 无有效成员
	if _, err := svc.InviteMembers(context.Background(), owner.ID, convID, []uuid.UUID{m1.ID}); !errors.Is(err, ErrNoValidMembers) {
		t.Fatalf("want ErrNoValidMembers, got %v", err)
	}
}

func TestKickByOwner(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "mg-ko")
	m1 := newTestUser(t, db, "mg-km")
	makeFriends(t, db, owner.ID, m1.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID})

	res, err := svc.KickMember(context.Background(), owner.ID, convID, m1.ID)
	if err != nil {
		t.Fatalf("kick: %v", err)
	}
	if res.RemovedID != m1.ID {
		t.Fatalf("RemovedID = %v", res.RemovedID)
	}
	if res.SysMsg == nil {
		t.Fatal("system message not persisted")
	}
	var count int64
	db.Model(&model.ConversationMember{}).Where("conversation_id = ? AND user_id = ?", convID, m1.ID).Count(&count)
	if count != 0 {
		t.Fatal("member row not deleted")
	}
	if len(res.MemberIDs) != 1 || res.MemberIDs[0] != owner.ID {
		t.Fatalf("remaining members: %v", res.MemberIDs)
	}
}

func TestKickForbidden(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "mg-kfo")
	m1 := newTestUser(t, db, "mg-kfm1")
	m2 := newTestUser(t, db, "mg-kfm2")
	makeFriends(t, db, owner.ID, m1.ID)
	makeFriends(t, db, owner.ID, m2.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID, m2.ID})

	// 普通成员踢平级 → forbidden
	if _, err := svc.KickMember(context.Background(), m1.ID, convID, m2.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("normal kick peer: want ErrForbidden, got %v", err)
	}
	// 任何人踢群主 → forbidden
	if _, err := svc.KickMember(context.Background(), m1.ID, convID, owner.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("kick owner: want ErrForbidden, got %v", err)
	}
	// 踢不在群者 → member not found
	if _, err := svc.KickMember(context.Background(), owner.ID, convID, uuid.New()); !errors.Is(err, ErrGroupMemberNotFound) {
		t.Fatalf("kick outsider: want ErrGroupMemberNotFound, got %v", err)
	}
}

func TestLeaveGroup(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "mg-lo")
	m1 := newTestUser(t, db, "mg-lm")
	makeFriends(t, db, owner.ID, m1.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID})

	// 群主退群 → 拒绝
	if _, err := svc.LeaveGroup(context.Background(), owner.ID, convID); !errors.Is(err, ErrOwnerCannotLeave) {
		t.Fatalf("owner leave: want ErrOwnerCannotLeave, got %v", err)
	}

	res, err := svc.LeaveGroup(context.Background(), m1.ID, convID)
	if err != nil {
		t.Fatalf("leave: %v", err)
	}
	if res.RemovedID != m1.ID || res.SysMsg == nil {
		t.Fatalf("bad result: %+v", res)
	}
	var count int64
	db.Model(&model.ConversationMember{}).Where("conversation_id = ? AND user_id = ?", convID, m1.ID).Count(&count)
	if count != 0 {
		t.Fatal("member row not deleted")
	}
}

func TestDissolveGroup(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "mg-do")
	m1 := newTestUser(t, db, "mg-dm")
	makeFriends(t, db, owner.ID, m1.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID})

	// 非群主 → forbidden
	if _, err := svc.DissolveGroup(context.Background(), m1.ID, convID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member dissolve: want ErrForbidden, got %v", err)
	}

	memberIDs, err := svc.DissolveGroup(context.Background(), owner.ID, convID)
	if err != nil {
		t.Fatalf("dissolve: %v", err)
	}
	if len(memberIDs) != 2 {
		t.Fatalf("member ids: %v", memberIDs)
	}
	var conv model.Conversation
	if err := db.Unscoped().First(&conv, "id = ?", convID).Error; err != nil {
		t.Fatalf("load dissolved conv: %v", err)
	}
	if !conv.DeletedAt.Valid {
		t.Fatal("conversation not soft-deleted")
	}
	// 解散后再操作 → not found（软删过滤）
	if _, err := svc.RenameGroup(context.Background(), owner.ID, convID, "x"); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("post-dissolve rename: want ErrConversationNotFound, got %v", err)
	}
}

// memberRole 查询成员当前角色（不存在时 -1）。
func memberRole(t *testing.T, db *gorm.DB, convID, userID uuid.UUID) int16 {
	t.Helper()
	var m model.ConversationMember
	err := db.First(&m, "conversation_id = ? AND user_id = ?", convID, userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return -1
	}
	if err != nil {
		t.Fatalf("load member: %v", err)
	}
	return m.Role
}

func TestAppointAdmin(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "ra-o")
	m1 := newTestUser(t, db, "ra-m1")
	m2 := newTestUser(t, db, "ra-m2")
	outsider := newTestUser(t, db, "ra-x")
	makeFriends(t, db, owner.ID, m1.ID)
	makeFriends(t, db, owner.ID, m2.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID, m2.ID})

	res, err := svc.AppointAdmin(context.Background(), owner.ID, convID, m1.ID)
	if err != nil {
		t.Fatalf("appoint: %v", err)
	}
	if memberRole(t, db, convID, m1.ID) != model.MemberRoleAdmin {
		t.Fatal("target role not updated to admin")
	}
	if res.SysMsg == nil || res.SysMsg.MessageType != model.MessageTypeSystem {
		t.Fatal("system message not persisted")
	}
	if len(res.RoleChanges) != 1 || res.RoleChanges[0].UserID != m1.ID || res.RoleChanges[0].NewRole != model.MemberRoleAdmin {
		t.Fatalf("role changes: %+v", res.RoleChanges)
	}
	if len(res.MemberIDs) != 3 {
		t.Fatalf("member ids: %v", res.MemberIDs)
	}

	// 已是管理员 → ErrAlreadyAdmin
	if _, err := svc.AppointAdmin(context.Background(), owner.ID, convID, m1.ID); !errors.Is(err, ErrAlreadyAdmin) {
		t.Fatalf("want ErrAlreadyAdmin, got %v", err)
	}
	// 管理员无权任命
	if _, err := svc.AppointAdmin(context.Background(), m1.ID, convID, m2.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin appoint: want ErrForbidden, got %v", err)
	}
	// 目标不在群内
	if _, err := svc.AppointAdmin(context.Background(), owner.ID, convID, outsider.ID); !errors.Is(err, ErrGroupMemberNotFound) {
		t.Fatalf("outsider target: want ErrGroupMemberNotFound, got %v", err)
	}
	// 目标是群主
	if _, err := svc.AppointAdmin(context.Background(), owner.ID, convID, owner.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("appoint owner: want ErrForbidden, got %v", err)
	}
}

func TestRevokeAdmin(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "rr-o")
	m1 := newTestUser(t, db, "rr-m1")
	m2 := newTestUser(t, db, "rr-m2")
	makeFriends(t, db, owner.ID, m1.ID)
	makeFriends(t, db, owner.ID, m2.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID, m2.ID})

	if _, err := svc.AppointAdmin(context.Background(), owner.ID, convID, m1.ID); err != nil {
		t.Fatalf("seed appoint: %v", err)
	}

	// 管理员无权免除
	if _, err := svc.RevokeAdmin(context.Background(), m1.ID, convID, m1.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin revoke: want ErrForbidden, got %v", err)
	}
	// 目标不是管理员
	if _, err := svc.RevokeAdmin(context.Background(), owner.ID, convID, m2.ID); !errors.Is(err, ErrNotAdmin) {
		t.Fatalf("normal target: want ErrNotAdmin, got %v", err)
	}

	res, err := svc.RevokeAdmin(context.Background(), owner.ID, convID, m1.ID)
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if memberRole(t, db, convID, m1.ID) != model.MemberRoleNormal {
		t.Fatal("target role not reset to normal")
	}
	if len(res.RoleChanges) != 1 || res.RoleChanges[0].NewRole != model.MemberRoleNormal {
		t.Fatalf("role changes: %+v", res.RoleChanges)
	}
	if res.SysMsg == nil {
		t.Fatal("system message not persisted")
	}
}

func TestTransferOwner(t *testing.T) {
	db := testDB(t)
	svc := newConvSvc(db)
	owner := newTestUser(t, db, "to-o")
	m1 := newTestUser(t, db, "to-m1")
	outsider := newTestUser(t, db, "to-x")
	makeFriends(t, db, owner.ID, m1.ID)
	convID := newManagedGroup(t, svc, owner.ID, []uuid.UUID{m1.ID})

	// 转给自己
	if _, err := svc.TransferOwner(context.Background(), owner.ID, convID, owner.ID); !errors.Is(err, ErrCannotTransferToSelf) {
		t.Fatalf("self transfer: want ErrCannotTransferToSelf, got %v", err)
	}
	// 非群主
	if _, err := svc.TransferOwner(context.Background(), m1.ID, convID, owner.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member transfer: want ErrForbidden, got %v", err)
	}
	// 目标不在群内
	if _, err := svc.TransferOwner(context.Background(), owner.ID, convID, outsider.ID); !errors.Is(err, ErrGroupMemberNotFound) {
		t.Fatalf("outsider transfer: want ErrGroupMemberNotFound, got %v", err)
	}

	res, err := svc.TransferOwner(context.Background(), owner.ID, convID, m1.ID)
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	// 事务两端角色都翻转
	if memberRole(t, db, convID, m1.ID) != model.MemberRoleOwner {
		t.Fatal("new owner role not updated")
	}
	if memberRole(t, db, convID, owner.ID) != model.MemberRoleAdmin {
		t.Fatal("old owner not demoted to admin")
	}
	if len(res.RoleChanges) != 2 {
		t.Fatalf("role changes: %+v", res.RoleChanges)
	}
	if res.SysMsg == nil {
		t.Fatal("system message not persisted")
	}
	// 原群主已非 owner，再转让 → forbidden
	if _, err := svc.TransferOwner(context.Background(), owner.ID, convID, m1.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("double transfer: want ErrForbidden, got %v", err)
	}
}
