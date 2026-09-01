package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// newAdminSvcForPacks 构造带审计仓库的管理服务（表情包治理动作走审计落库）。
func newAdminSvcForPacks(db *gorm.DB) *AdminService {
	return NewAdminService(
		repository.NewAdminRepository(db),
		repository.NewConversationRepository(db),
		repository.NewUserRepository(db),
		repository.NewFlaggedUGCRepository(db),
		zap.NewNop(),
	)
}

// seedFlaggedPack 发布一个公开包后直接置 flagged=true（模拟包名敏感词命中的落库结果）。
func seedFlaggedPack(t *testing.T, db *gorm.DB, ownerID uuid.UUID, name string) *model.StickerPack {
	t.Helper()
	svc := newStickerSvc(db)
	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"
	detail, err := svc.Publish(context.Background(), ownerID, PublishInput{
		Name: name,
		StickerSources: []StickerSource{
			{Source: "upload", ObjectKey: "images/2026/08/1f0e6d2a-3b9c-4d8e-9f21-7c5a4b6e0d11.png", Width: 64, Height: 64, ContentHash: hash},
		},
	})
	if err != nil {
		t.Fatalf("publish pack: %v", err)
	}
	pack := &model.StickerPack{}
	if err := db.First(pack, "id = ?", detail.Pack.ID).Error; err != nil {
		t.Fatalf("load pack: %v", err)
	}
	return pack
}

// flagPack 直接改库置/清 flagged 标记。
func flagPack(t *testing.T, db *gorm.DB, packID uuid.UUID, flagged bool) {
	t.Helper()
	if err := db.Model(&model.StickerPack{}).Where("id = ?", packID).Update("flagged", flagged).Error; err != nil {
		t.Fatalf("set flagged: %v", err)
	}
}

// TestFlaggedPackHiddenFromMarket 敏感词打标的包从商城暂隐：普通用户与发布者本人
// 都不可见（与 taken_down 的商城口径一致，商城不区分 owner）。
func TestFlaggedPackHiddenFromMarket(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "flag-owner")
	visitor := newTestUser(t, db, "flag-visitor")
	pack := seedFlaggedPack(t, db, owner.ID, "正常名商城包")
	flagPack(t, db, pack.ID, true)

	for _, uid := range []uuid.UUID{visitor.ID, owner.ID} {
		items, _, err := svc.Market(ctx, uid, "", 50)
		if err != nil {
			t.Fatalf("market for %s: %v", uid, err)
		}
		for _, it := range items {
			if it.ID == pack.ID {
				t.Fatalf("flagged pack %s should be hidden from market (viewer %s)", pack.ID, uid)
			}
		}
	}

	// 清标记后自动恢复商城展示
	flagPack(t, db, pack.ID, false)
	for _, uid := range []uuid.UUID{visitor.ID, owner.ID} {
		items, _, err := svc.Market(ctx, uid, "", 50)
		if err != nil {
			t.Fatalf("market after clear for %s: %v", uid, err)
		}
		found := false
		for _, it := range items {
			if it.ID == pack.ID {
				found = true
			}
		}
		if !found {
			t.Fatalf("pack %s should reappear in market after flag cleared (viewer %s)", pack.ID, uid)
		}
	}
}

// TestFlaggedPackDetailVisibility 打标包的详情可见性：无关用户 404，
// 发布者与已添加者保留访问（与 taken_down 同口径）。
func TestFlaggedPackDetailVisibility(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "flag-detail-owner")
	stranger := newTestUser(t, db, "flag-detail-stranger")
	added := newTestUser(t, db, "flag-detail-added")
	pack := seedFlaggedPack(t, db, owner.ID, "正常名详情包")

	// 打标前 added 用户先添加成功
	if err := svc.AddPack(ctx, added.ID, pack.ID); err != nil {
		t.Fatalf("add pack before flag: %v", err)
	}
	flagPack(t, db, pack.ID, true)

	if _, err := svc.PackDetail(ctx, stranger.ID, pack.ID); err != ErrPackNotFound {
		t.Fatalf("stranger should get ErrPackNotFound, got %v", err)
	}
	if _, err := svc.PackDetail(ctx, owner.ID, pack.ID); err != nil {
		t.Fatalf("owner should still view own flagged pack: %v", err)
	}
	if _, err := svc.PackDetail(ctx, added.ID, pack.ID); err != nil {
		t.Fatalf("added user should still view flagged pack: %v", err)
	}

	// 已添加用户的「我的表情包」（EmojiPicker 数据源）不受打标影响
	visible, err := svc.ListPacks(ctx, added.ID)
	if err != nil {
		t.Fatalf("list visible: %v", err)
	}
	found := false
	for _, p := range visible {
		if p.Pack.ID == pack.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("added user's pack list must keep the flagged pack")
	}

	// 清标记后无关用户恢复可访问
	flagPack(t, db, pack.ID, false)
	if _, err := svc.PackDetail(ctx, stranger.ID, pack.ID); err != nil {
		t.Fatalf("stranger should access detail after flag cleared: %v", err)
	}
}

// TestFlaggedPackNotAddable 打标期间拒绝新添加（含发布者本人），
// 防止敏感词包在放行前经 id 直链进用户表情列表。
func TestFlaggedPackNotAddable(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	svc := newStickerSvc(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "flag-add-owner")
	pack := seedFlaggedPack(t, db, owner.ID, "正常名添加包")
	flagPack(t, db, pack.ID, true)

	if err := svc.AddPack(ctx, owner.ID, pack.ID); err != ErrPackNotAvailable {
		t.Fatalf("want ErrPackNotAvailable for flagged pack, got %v", err)
	}
	flagPack(t, db, pack.ID, false)
	if err := svc.AddPack(ctx, owner.ID, pack.ID); err != nil {
		t.Fatalf("add after flag cleared: %v", err)
	}
}

// TestAdminUntakedownAndOfficial 表情包治理动作：恢复上架清 taken_down、
// 官方标识切换落库，且两个动作都写入审计日志。
func TestAdminUntakedownAndOfficial(t *testing.T) {
	db := testDB(t)
	migrateSvcStickerTables(t, db)
	stickerSvc := newStickerSvc(db)
	adminSvc := newAdminSvcForPacks(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "admin-pack-owner")
	pack := seedFlaggedPack(t, db, owner.ID, "正常名治理包")
	flagPack(t, db, pack.ID, false)

	// 下架后从商城消失，恢复上架后重新可见
	if err := adminSvc.TakeDownStickerPack(ctx, owner.ID, pack.ID); err != nil {
		t.Fatalf("takedown: %v", err)
	}
	items, _, err := stickerSvc.Market(ctx, owner.ID, "", 50)
	if err != nil {
		t.Fatalf("market after takedown: %v", err)
	}
	for _, it := range items {
		if it.ID == pack.ID {
			t.Fatal("taken down pack must not appear in market")
		}
	}
	if err := adminSvc.UntakeDownStickerPack(ctx, owner.ID, pack.ID); err != nil {
		t.Fatalf("untakedown: %v", err)
	}
	items, _, err = stickerSvc.Market(ctx, owner.ID, "", 50)
	if err != nil {
		t.Fatalf("market after untakedown: %v", err)
	}
	found := false
	for _, it := range items {
		if it.ID == pack.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("pack must reappear in market after untakedown")
	}

	// 官方标识切换：true / false 都落库
	if err := adminSvc.SetStickerPackOfficial(ctx, owner.ID, pack.ID, true); err != nil {
		t.Fatalf("set official true: %v", err)
	}
	var got model.StickerPack
	if err := db.First(&got, "id = ?", pack.ID).Error; err != nil {
		t.Fatalf("reload pack: %v", err)
	}
	if !got.IsOfficial {
		t.Fatal("is_official should be true after set")
	}
	if err := adminSvc.SetStickerPackOfficial(ctx, owner.ID, pack.ID, false); err != nil {
		t.Fatalf("set official false: %v", err)
	}
	if err := db.First(&got, "id = ?", pack.ID).Error; err != nil {
		t.Fatalf("reload pack: %v", err)
	}
	if got.IsOfficial {
		t.Fatal("is_official should be false after unset")
	}

	// 审计留痕：untakedown 与两次 official 切换各一条
	var untakeCount, officialCount int64
	db.Model(&model.AdminActionLog{}).
		Where("action = ? AND target_id = ?", model.AdminActionUntakeDownPack, pack.ID.String()).
		Count(&untakeCount)
	db.Model(&model.AdminActionLog{}).
		Where("action = ? AND target_id = ?", model.AdminActionSetPackOfficial, pack.ID.String()).
		Count(&officialCount)
	if untakeCount != 1 || officialCount != 2 {
		t.Fatalf("audit logs: untakedown=%d official=%d, want 1 and 2", untakeCount, officialCount)
	}

	// 不存在的包返回 ErrPackNotFound
	if err := adminSvc.UntakeDownStickerPack(ctx, owner.ID, uuid.New()); err != ErrPackNotFound {
		t.Fatalf("untakedown missing pack: want ErrPackNotFound, got %v", err)
	}
	if err := adminSvc.SetStickerPackOfficial(ctx, owner.ID, uuid.New(), true); err != ErrPackNotFound {
		t.Fatalf("official missing pack: want ErrPackNotFound, got %v", err)
	}
}
