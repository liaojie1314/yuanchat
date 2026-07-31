package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// settingsTestEnv 建一个双人单聊 + service（复用包内 testDB/newTestUser 助手）。
func settingsTestEnv(t *testing.T) (svcEnv struct {
	DB   *gorm.DB
	Svc  *ConversationService
	Conv *model.Conversation
	A, B *model.User
}) {
	t.Helper()
	db := testDB(t)
	// dev 库可能尚未跑 goose 009：AutoMigrate 兜底补列（与 contact_service_test.go:39 同范式）
	if err := db.AutoMigrate(&model.ConversationMember{}); err != nil {
		t.Fatalf("automigrate conversation_members: %v", err)
	}
	a := newTestUser(t, db, "甲settings")
	b := newTestUser(t, db, "乙settings")
	conv := &model.Conversation{Type: model.ConversationTypePrivate}
	if err := db.Create(conv).Error; err != nil {
		t.Fatalf("create conv: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(conv) })
	for _, u := range []*model.User{a, b} {
		m := &model.ConversationMember{ConversationID: conv.ID, UserID: u.ID, JoinedAt: time.Now()}
		if err := db.Create(m).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	t.Cleanup(func() {
		db.Where("conversation_id = ?", conv.ID).Delete(&model.ConversationMember{})
	})
	svcEnv.DB = db
	svcEnv.Svc = NewConversationService(
		repository.NewConversationRepository(db), repository.NewMessageRepository(db),
		repository.NewContactRepository(db), repository.NewUserRepository(db), zap.NewNop())
	svcEnv.Conv = conv
	svcEnv.A, svcEnv.B = a, b
	return svcEnv
}

// TestListSurfacesPinnedFields 列表 DTO 透出 is_pinned / pinned_at。
func TestListSurfacesPinnedFields(t *testing.T) {
	env := settingsTestEnv(t)
	now := time.Now()
	if err := env.DB.Model(&model.ConversationMember{}).
		Where("conversation_id = ? AND user_id = ?", env.Conv.ID, env.A.ID).
		Updates(map[string]any{"is_pinned": true, "pinned_at": now}).Error; err != nil {
		t.Fatalf("seed pinned: %v", err)
	}

	dtos, err := env.Svc.List(context.Background(), env.A.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var found bool
	for _, d := range dtos {
		if d.ID == env.Conv.ID {
			found = true
			if !d.IsPinned || d.PinnedAt == nil {
				t.Fatalf("want pinned dto, got %+v", d)
			}
		}
	}
	if !found {
		t.Fatal("conversation not in list")
	}
}

// boolPtr 测试辅助。
func boolPtr(v bool) *bool { return &v }

// TestUpdateSettingsPinMuteRoundTrip 置顶/免打扰开关全流程 + pinned_at 语义。
func TestUpdateSettingsPinMuteRoundTrip(t *testing.T) {
	env := settingsTestEnv(t)
	ctx := context.Background()

	// 置顶：is_pinned=true 且 pinned_at 落时间
	res, err := env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsPinned: boolPtr(true)})
	if err != nil {
		t.Fatalf("pin: %v", err)
	}
	if !res.IsPinned || res.PinnedAt == nil {
		t.Fatalf("want pinned with time, got %+v", res)
	}
	firstPinnedAt := *res.PinnedAt

	// 重复置顶幂等：pinned_at 不刷新（置顶顺序稳定）
	res, err = env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsPinned: boolPtr(true)})
	if err != nil {
		t.Fatalf("re-pin: %v", err)
	}
	if res.PinnedAt == nil || !res.PinnedAt.Equal(firstPinnedAt) {
		t.Fatalf("re-pin should keep pinned_at, want %v got %v", firstPinnedAt, res.PinnedAt)
	}

	// 免打扰
	res, err = env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsMuted: boolPtr(true)})
	if err != nil || !res.IsMuted {
		t.Fatalf("mute: err=%v res=%+v", err, res)
	}
	// 未动 pin 字段：保持置顶
	if !res.IsPinned {
		t.Fatalf("mute must not clear pin, got %+v", res)
	}

	// 取消置顶：pinned_at 清空
	res, err = env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsPinned: boolPtr(false)})
	if err != nil {
		t.Fatalf("unpin: %v", err)
	}
	if res.IsPinned || res.PinnedAt != nil {
		t.Fatalf("want unpinned nil pinned_at, got %+v", res)
	}

	// 对方视角不受影响（member 维度隔离）
	dtos, err := env.Svc.List(ctx, env.B.ID)
	if err != nil {
		t.Fatalf("list b: %v", err)
	}
	for _, d := range dtos {
		if d.ID == env.Conv.ID && (d.IsPinned || d.IsMuted) {
			t.Fatalf("peer settings leaked: %+v", d)
		}
	}

	// 库级断言：取消置顶必须写成 SQL NULL 而非零值时间
	// （gorm map Updates 的 nil → NULL 是本实现的关键假设，只查内存返回值挡不住回退）
	var m model.ConversationMember
	if err := env.DB.Where("conversation_id = ? AND user_id = ?", env.Conv.ID, env.A.ID).
		First(&m).Error; err != nil {
		t.Fatalf("reload member: %v", err)
	}
	if m.PinnedAt != nil || m.IsPinned {
		t.Fatalf("db should be unpinned with NULL pinned_at, got %+v", m)
	}
	if !m.IsMuted { // unpin 不得误伤 is_muted（此前已置 true 且未取消）
		t.Fatal("unpin must not clear mute")
	}
}

// TestUpdateSettingsNonMember 非成员 → ErrNotMember（handler 层映射 403）。
func TestUpdateSettingsNonMember(t *testing.T) {
	env := settingsTestEnv(t)
	outsider := newTestUser(t, env.DB, "丙outsider")
	_, err := env.Svc.UpdateSettings(context.Background(), outsider.ID, env.Conv.ID,
		ConversationSettingsInput{IsMuted: boolPtr(true)})
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("want ErrNotMember, got %v", err)
	}
}

// TestMutedMemberIDs 免打扰成员过滤查询（离线推送用）。
func TestMutedMemberIDs(t *testing.T) {
	env := settingsTestEnv(t)
	ctx := context.Background()
	if _, err := env.Svc.UpdateSettings(ctx, env.A.ID, env.Conv.ID,
		ConversationSettingsInput{IsMuted: boolPtr(true)}); err != nil {
		t.Fatalf("mute a: %v", err)
	}
	repo := repository.NewConversationRepository(env.DB)
	ids, err := repo.MutedMemberIDs(ctx, env.Conv.ID)
	if err != nil {
		t.Fatalf("muted ids: %v", err)
	}
	if len(ids) != 1 || ids[0] != env.A.ID {
		t.Fatalf("want [A], got %v", ids)
	}
}
