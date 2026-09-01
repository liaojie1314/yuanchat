package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// testDB 返回独立测试库上的事务句柄（跑完整迁移、用例结束回滚），
// 数据库不可达时跳过集成用例（CI 无 DB 环境仍绿）。
func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	return testutil.NewDB(t)
}

// newTestUser 创建一次性测试用户（短号用时间戳避免冲突，用后删除）。
func newTestUser(t *testing.T, db *gorm.DB, nick string) *model.User {
	t.Helper()
	phone := fmt.Sprintf("199%08d", time.Now().UnixNano()%100000000)
	user := &model.User{
		ID:           uuid.New(),
		Phone:        &phone,
		PasswordHash: "x",
		ShortID:      time.Now().UnixNano()%1_000_000_000 + int64(len(nick)),
		Nickname:     nick,
		Status:       model.UserStatusNormal,
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create test user: %v", err)
	}
	t.Cleanup(func() {
		// 依赖顺序：消息 → 成员/会话 → 申请/联系人 → 用户
		db.Exec(`DELETE FROM messages WHERE sender_id = ?`, user.ID)
		db.Exec(`DELETE FROM conversations WHERE id IN
			(SELECT conversation_id FROM conversation_members WHERE user_id = ?)`, user.ID)
		db.Exec(`DELETE FROM conversation_members WHERE user_id = ?`, user.ID)
		db.Exec(`DELETE FROM friend_requests WHERE requester_id = ? OR target_id = ?`, user.ID, user.ID)
		db.Exec(`DELETE FROM contacts WHERE user_id = ? OR contact_user_id = ?`, user.ID, user.ID)
		db.Unscoped().Delete(user)
	})
	return user
}

func newContactSvc(db *gorm.DB) *ContactService {
	return NewContactService(
		repository.NewContactRepository(db),
		repository.NewUserRepository(db),
		zap.NewNop(),
	)
}

// ========================================
// SendRequest 相关
// ========================================

func TestSendRequestRejectsSelf(t *testing.T) {
	db := testDB(t)
	svc := newContactSvc(db)
	u := newTestUser(t, db, "self-test")

	_, _, err := svc.SendRequest(context.Background(), u.ID, u.ID, "hi")
	if !errors.Is(err, ErrSelfRequest) {
		t.Fatalf("expected ErrSelfRequest, got %v", err)
	}
}

func TestSendRequestRejectsUnknownTarget(t *testing.T) {
	db := testDB(t)
	svc := newContactSvc(db)
	u := newTestUser(t, db, "req-test")

	_, _, err := svc.SendRequest(context.Background(), u.ID, uuid.New(), "hi")
	if !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
}

func TestSendRequestUpsertResetsRejected(t *testing.T) {
	db := testDB(t)
	svc := newContactSvc(db)
	a := newTestUser(t, db, "upsert-a")
	b := newTestUser(t, db, "upsert-b")
	ctx := context.Background()

	req1, _, err := svc.SendRequest(ctx, a.ID, b.ID, "first")
	if err != nil {
		t.Fatalf("first request: %v", err)
	}

	// b 拒绝
	if err := svc.Reject(ctx, b.ID, req1.ID); err != nil {
		t.Fatalf("reject: %v", err)
	}

	// a 再次申请：同一行重置为 pending，消息更新
	req2, _, err := svc.SendRequest(ctx, a.ID, b.ID, "second")
	if err != nil {
		t.Fatalf("re-request after reject: %v", err)
	}

	var row model.FriendRequest
	if err := db.First(&row, "requester_id = ? AND target_id = ?", a.ID, b.ID).Error; err != nil {
		t.Fatalf("load row: %v", err)
	}
	if row.Status != model.FriendRequestStatusPending {
		t.Fatalf("expected pending after re-request, got %d", row.Status)
	}
	if row.Message == nil || *row.Message != "second" {
		t.Fatalf("expected message updated to 'second', got %v", row.Message)
	}
	_ = req2
}

// ========================================
// Accept — 事务闭环
// ========================================

func TestAcceptCreatesFriendshipConversationAndGreeting(t *testing.T) {
	db := testDB(t)
	svc := newContactSvc(db)
	a := newTestUser(t, db, "acc-requester")
	b := newTestUser(t, db, "acc-target")
	ctx := context.Background()

	req, _, err := svc.SendRequest(ctx, a.ID, b.ID, "let's chat")
	if err != nil {
		t.Fatalf("send request: %v", err)
	}

	result, err := svc.Accept(ctx, b.ID, req.ID)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// 1. 双向好友
	for _, pair := range [][2]uuid.UUID{{a.ID, b.ID}, {b.ID, a.ID}} {
		var count int64
		db.Model(&model.Contact{}).
			Where("user_id = ? AND contact_user_id = ? AND status = ?",
				pair[0], pair[1], model.ContactStatusAccepted).
			Count(&count)
		if count != 1 {
			t.Fatalf("expected contact row %s → %s", pair[0], pair[1])
		}
	}

	// 2. 单聊会话（恰好 2 成员）
	if result.ConversationID == uuid.Nil {
		t.Fatal("expected conversation created")
	}
	var memberCount int64
	db.Model(&model.ConversationMember{}).
		Where("conversation_id = ?", result.ConversationID).Count(&memberCount)
	if memberCount != 2 {
		t.Fatalf("expected 2 members, got %d", memberCount)
	}

	// 3. 打招呼消息（同意方身份，seq=1）
	if result.Greeting == nil {
		t.Fatal("expected greeting message")
	}
	if result.Greeting.SenderID != b.ID {
		t.Fatalf("greeting should be sent by accepter, got %s", result.Greeting.SenderID)
	}
	if result.Greeting.Seq != 1 {
		t.Fatalf("expected greeting seq=1, got %d", result.Greeting.Seq)
	}

	// 4. 同意方已读进度已推进（不给自己计未读）
	var member model.ConversationMember
	db.First(&member, "conversation_id = ? AND user_id = ?", result.ConversationID, b.ID)
	if member.LastReadSeq != result.Greeting.Seq {
		t.Fatalf("accepter last_read_seq should be %d, got %d", result.Greeting.Seq, member.LastReadSeq)
	}

	// 5. 好友列表可解析出该会话
	friends, err := svc.ListFriends(ctx, a.ID)
	if err != nil {
		t.Fatalf("list friends: %v", err)
	}
	found := false
	for _, f := range friends {
		if f.UserID == b.ID {
			found = true
			if f.ConversationID == nil || *f.ConversationID != result.ConversationID {
				t.Fatalf("friend list conversation mismatch: %v", f.ConversationID)
			}
		}
	}
	if !found {
		t.Fatal("target not found in requester's friend list")
	}
}

func TestAcceptIsIdempotent(t *testing.T) {
	db := testDB(t)
	svc := newContactSvc(db)
	a := newTestUser(t, db, "idem-a")
	b := newTestUser(t, db, "idem-b")
	ctx := context.Background()

	req, _, _ := svc.SendRequest(ctx, a.ID, b.ID, "")
	first, err := svc.Accept(ctx, b.ID, req.ID)
	if err != nil {
		t.Fatalf("first accept: %v", err)
	}

	second, err := svc.Accept(ctx, b.ID, req.ID)
	if err != nil {
		t.Fatalf("second accept should be idempotent, got %v", err)
	}
	if second.ConversationID != first.ConversationID {
		t.Fatalf("idempotent accept should return same conversation")
	}
	if second.Greeting != nil {
		t.Fatal("idempotent accept must not send another greeting")
	}

	// 消息只有一条
	var msgCount int64
	db.Model(&model.Message{}).
		Where("conversation_id = ?", first.ConversationID).Count(&msgCount)
	if msgCount != 1 {
		t.Fatalf("expected exactly 1 greeting message, got %d", msgCount)
	}
}

func TestAcceptRejectsNonTarget(t *testing.T) {
	db := testDB(t)
	svc := newContactSvc(db)
	a := newTestUser(t, db, "auth-a")
	b := newTestUser(t, db, "auth-b")
	c := newTestUser(t, db, "auth-c")
	ctx := context.Background()

	req, _, _ := svc.SendRequest(ctx, a.ID, b.ID, "")

	// 申请方自己不能同意
	if _, err := svc.Accept(ctx, a.ID, req.ID); !errors.Is(err, ErrNotRequestTarget) {
		t.Fatalf("requester accepting own request: expected ErrNotRequestTarget, got %v", err)
	}
	// 无关第三人不能同意
	if _, err := svc.Accept(ctx, c.ID, req.ID); !errors.Is(err, ErrNotRequestTarget) {
		t.Fatalf("third party accepting: expected ErrNotRequestTarget, got %v", err)
	}
	// 无关第三人不能拒绝
	if err := svc.Reject(ctx, c.ID, req.ID); !errors.Is(err, ErrNotRequestTarget) {
		t.Fatalf("third party rejecting: expected ErrNotRequestTarget, got %v", err)
	}
}

// ========================================
// Search — relation 判定
// ========================================

func TestSearchRelations(t *testing.T) {
	db := testDB(t)
	svc := newContactSvc(db)
	a := newTestUser(t, db, "rel-a")
	b := newTestUser(t, db, "rel-b")
	ctx := context.Background()

	// 自己
	r, err := svc.Search(ctx, a.ID, *a.Phone)
	if err != nil || r.Relation != "self" {
		t.Fatalf("expected self, got %v / %v", r, err)
	}

	// 无关系
	r, err = svc.Search(ctx, a.ID, *b.Phone)
	if err != nil || r.Relation != "none" {
		t.Fatalf("expected none, got %v / %v", r, err)
	}

	// 我发出的 / 我收到的待处理申请
	req, _, _ := svc.SendRequest(ctx, a.ID, b.ID, "")
	r, _ = svc.Search(ctx, a.ID, *b.Phone)
	if r.Relation != "pending_out" {
		t.Fatalf("expected pending_out, got %s", r.Relation)
	}
	r, _ = svc.Search(ctx, b.ID, *a.Phone)
	if r.Relation != "pending_in" {
		t.Fatalf("expected pending_in, got %s", r.Relation)
	}

	// 已是好友
	if _, err := svc.Accept(ctx, b.ID, req.ID); err != nil {
		t.Fatalf("accept: %v", err)
	}
	r, _ = svc.Search(ctx, a.ID, *b.Phone)
	if r.Relation != "friend" {
		t.Fatalf("expected friend, got %s", r.Relation)
	}

	// short_id 精确查
	r, err = svc.Search(ctx, a.ID, fmt.Sprintf("%d", b.ShortID))
	if err != nil || r.User.ID != b.ID {
		t.Fatalf("short_id search failed: %v / %v", r, err)
	}

	// 未命中
	if _, err := svc.Search(ctx, a.ID, "nonexistent-user"); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
}
