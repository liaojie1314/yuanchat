package service

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// TestCreatePost_MediaValidation 媒体数量与判别位必须自洽，否则前端能塞出畸形帖。
func TestCreatePost_MediaValidation(t *testing.T) {
	db := testDB(t)
	svc := NewMomentsService(repository.NewMomentsRepository(db), repository.NewUserRepository(db), nil, zap.NewNop())
	ctx := context.Background()
	author := newTestUser(t, db, "mediaval")

	nine := make([]model.MomentMediaItem, 9)
	for i := range nine {
		nine[i] = model.MomentMediaItem{Key: "images/2026/09/" + uuid.NewString() + ".jpg", W: 10, H: 10}
	}
	ten := append(append([]model.MomentMediaItem{}, nine...), model.MomentMediaItem{Key: "images/x.jpg", W: 1, H: 1})

	cases := []struct {
		name    string
		input   CreatePostInput
		wantErr bool
	}{
		{"九图合法", CreatePostInput{MediaKind: model.MomentMediaKindImage, Media: nine}, false},
		{"十图越界", CreatePostInput{MediaKind: model.MomentMediaKindImage, Media: ten}, true},
		{"图片零项", CreatePostInput{MediaKind: model.MomentMediaKindImage}, true},
		{"视频两项", CreatePostInput{MediaKind: model.MomentMediaKindVideo, Media: nine[:2]}, true},
		{"纯文本", CreatePostInput{Content: "今天天气不错"}, false},
		{"空帖", CreatePostInput{}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := svc.CreatePost(ctx, author.ID, c.input)
			if c.wantErr && err == nil {
				t.Fatalf("应报错但成功了: %+v", got)
			}
			if !c.wantErr && err != nil {
				t.Fatalf("应成功但报错: %v", err)
			}
		})
	}
}

// TestCreatePost_Flagged 敏感词命中只打标，不阻塞发布（与消息/贴纸同口径）；
// 审核台账记下帖子 id，管理端才有东西可处置。
func TestCreatePost_Flagged(t *testing.T) {
	db := testDB(t)
	repo := repository.NewMomentsRepository(db)
	svc := NewMomentsService(repo, repository.NewUserRepository(db), nil, zap.NewNop())
	svc.SetModeration(NewModerationService([]string{"违禁词"}), repository.NewFlaggedUGCRepository(db))
	ctx := context.Background()
	author := newTestUser(t, db, "flagged")

	dto, err := svc.CreatePost(ctx, author.ID, CreatePostInput{Content: "包含违禁词的正文"})
	if err != nil {
		t.Fatalf("命中敏感词不应阻塞发布: %v", err)
	}
	var post model.MomentPost
	if err := db.Where("id = ?", dto.ID).Take(&post).Error; err != nil {
		t.Fatalf("回查帖子: %v", err)
	}
	if !post.Flagged {
		t.Fatal("命中敏感词应置 flagged=true")
	}
	var rec model.FlaggedUGC
	if err := db.Where("ugc_type = ?", model.UGCTypeMomentPost).Take(&rec).Error; err != nil {
		t.Fatalf("回查审核台账: %v", err)
	}
	if rec.TargetID == nil || *rec.TargetID != post.ID {
		t.Fatalf("台账 target_id = %v, want 帖子 id %s", rec.TargetID, post.ID)
	}
	if rec.HitWord != "违禁词" {
		t.Fatalf("hit_word = %q", rec.HitWord)
	}
}

// TestSetLike_Forbidden 非好友点赞必须被拒，且不留下互动消息。
//
// 这是越权的典型形态：feed 过滤了而写路径没过滤时，陌生人能给私密帖点赞并推红点。
func TestSetLike_Forbidden(t *testing.T) {
	db := testDB(t)
	repo := repository.NewMomentsRepository(db)
	svc := NewMomentsService(repo, repository.NewUserRepository(db), nil, zap.NewNop())
	ctx := context.Background()

	author := newTestUser(t, db, "likeauth")
	stranger := newTestUser(t, db, "likestr")
	post := &model.MomentPost{UserID: author.ID, Content: "hi", Visibility: model.MomentVisibilityFriends}
	if err := repo.CreatePost(ctx, post); err != nil {
		t.Fatalf("create post: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(post) })

	if err := svc.SetLike(ctx, stranger.ID, post.ID, true); err == nil {
		t.Fatal("非好友点赞应被拒")
	}
	var acts int64
	db.Model(&model.MomentActivity{}).Where("post_id = ?", post.ID).Count(&acts)
	if acts != 0 {
		t.Fatalf("被拒的点赞仍写了 %d 条互动消息", acts)
	}
}

// TestSelfInteractionNoActivity 自赞自评不写互动消息，否则自己的操作会点亮自己的红点。
func TestSelfInteractionNoActivity(t *testing.T) {
	db := testDB(t)
	repo := repository.NewMomentsRepository(db)
	svc := NewMomentsService(repo, repository.NewUserRepository(db), nil, zap.NewNop())
	ctx := context.Background()

	author := newTestUser(t, db, "selfact")
	post := &model.MomentPost{UserID: author.ID, Content: "hi", Visibility: model.MomentVisibilityFriends}
	if err := repo.CreatePost(ctx, post); err != nil {
		t.Fatalf("create post: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(post) })

	if err := svc.SetLike(ctx, author.ID, post.ID, true); err != nil {
		t.Fatalf("自己点赞自己应允许: %v", err)
	}
	if _, err := svc.AddComment(ctx, author.ID, post.ID, "自评", nil); err != nil {
		t.Fatalf("自己评论自己应允许: %v", err)
	}

	n, err := repo.UnreadActivityCount(ctx, author.ID)
	if err != nil {
		t.Fatalf("unread count: %v", err)
	}
	if n != 0 {
		t.Fatalf("自赞自评产生了 %d 条互动消息，want 0", n)
	}
}

// TestDeleteComment_Permission 评论作者与帖子作者都能删，第三方不能。
func TestDeleteComment_Permission(t *testing.T) {
	db := testDB(t)
	repo := repository.NewMomentsRepository(db)
	svc := NewMomentsService(repo, repository.NewUserRepository(db), nil, zap.NewNop())
	ctx := context.Background()

	author := newTestUser(t, db, "delcauth")
	commenter := newTestUser(t, db, "delccmt")
	third := newTestUser(t, db, "delcthird")
	for _, pair := range [][2]uuid.UUID{{author.ID, commenter.ID}, {commenter.ID, author.ID}, {author.ID, third.ID}, {third.ID, author.ID}} {
		c := &model.Contact{UserID: pair[0], ContactUserID: pair[1], Status: model.ContactStatusAccepted}
		if err := db.Create(c).Error; err != nil {
			t.Fatalf("create contact: %v", err)
		}
		t.Cleanup(func() { db.Unscoped().Delete(c) })
	}

	post := &model.MomentPost{UserID: author.ID, Content: "hi", Visibility: model.MomentVisibilityFriends}
	if err := repo.CreatePost(ctx, post); err != nil {
		t.Fatalf("create post: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(post) })

	mk := func(t *testing.T) uuid.UUID {
		t.Helper()
		dto, err := svc.AddComment(ctx, commenter.ID, post.ID, "评论正文", nil)
		if err != nil {
			t.Fatalf("add comment: %v", err)
		}
		return dto.ID
	}

	if err := svc.DeleteComment(ctx, third.ID, mk(t)); err == nil {
		t.Fatal("第三方不应能删评论")
	}
	if err := svc.DeleteComment(ctx, commenter.ID, mk(t)); err != nil {
		t.Fatalf("评论作者应能删: %v", err)
	}
	if err := svc.DeleteComment(ctx, author.ID, mk(t)); err != nil {
		t.Fatalf("帖子作者应能删: %v", err)
	}
}

// TestCommentTooLong 评论超长被拒（边界值：500 通过、501 拒）。
func TestCommentTooLong(t *testing.T) {
	db := testDB(t)
	repo := repository.NewMomentsRepository(db)
	svc := NewMomentsService(repo, repository.NewUserRepository(db), nil, zap.NewNop())
	ctx := context.Background()

	author := newTestUser(t, db, "cmtlen")
	post := &model.MomentPost{UserID: author.ID, Content: "hi", Visibility: model.MomentVisibilityFriends}
	if err := repo.CreatePost(ctx, post); err != nil {
		t.Fatalf("create post: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(post) })

	// 用中文字符验证按 rune 而非 byte 计长
	if _, err := svc.AddComment(ctx, author.ID, post.ID, strings.Repeat("字", model.MomentCommentMaxLen), nil); err != nil {
		t.Fatalf("500 字应通过: %v", err)
	}
	if _, err := svc.AddComment(ctx, author.ID, post.ID, strings.Repeat("字", model.MomentCommentMaxLen+1), nil); err == nil {
		t.Fatal("501 字应被拒")
	}
}
