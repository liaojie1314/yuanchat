package repository

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
)

// befriend 建立 a→b 的单向已接受好友行（contacts 是单向两行表）。
func befriend(t *testing.T, db *gorm.DB, a, b uuid.UUID) {
	t.Helper()
	c := &model.Contact{UserID: a, ContactUserID: b, Status: model.ContactStatusAccepted}
	if err := db.Create(c).Error; err != nil {
		t.Fatalf("create contact: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(c) })
}

// newPost 建一条帖子并登记清理。
func newPost(t *testing.T, db *gorm.DB, author uuid.UUID, visibility int16) *model.MomentPost {
	t.Helper()
	p := &model.MomentPost{UserID: author, Content: "hello", Visibility: visibility}
	if err := db.Create(p).Error; err != nil {
		t.Fatalf("create post: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(p) })
	return p
}

// TestVisiblePostsScope 可见性是全部读路径的唯一闸门，四种关系逐一验证。
func TestVisiblePostsScope(t *testing.T) {
	db := testDB(t)
	repo := NewMomentsRepository(db)
	ctx := context.Background()

	author := newTestUser(t, db, "author").ID
	friend := newTestUser(t, db, "friend").ID
	stranger := newTestUser(t, db, "stranger").ID
	befriend(t, db, friend, author)
	befriend(t, db, author, friend)

	friendsPost := newPost(t, db, author, model.MomentVisibilityFriends)
	privatePost := newPost(t, db, author, model.MomentVisibilityPrivate)

	// 好友看得到 friends 档
	if got, err := repo.PostByID(ctx, friend, friendsPost.ID); err != nil || got == nil {
		t.Fatalf("好友应能看到 friends 档帖子: got=%v err=%v", got, err)
	}
	// 好友看不到 private 档
	if got, _ := repo.PostByID(ctx, friend, privatePost.ID); got != nil {
		t.Fatal("好友不应看到 private 档帖子")
	}
	// 作者自己看得到 private 档
	if got, err := repo.PostByID(ctx, author, privatePost.ID); err != nil || got == nil {
		t.Fatalf("作者应能看到自己的 private 帖子: got=%v err=%v", got, err)
	}
	// 非好友看不到 friends 档
	if got, _ := repo.PostByID(ctx, stranger, friendsPost.ID); got != nil {
		t.Fatal("非好友不应看到 friends 档帖子")
	}
}

// TestVisiblePostsScope_Blocked 拉黑是双向阻断：任一方向的拉黑行都让帖子互相不可见。
func TestVisiblePostsScope_Blocked(t *testing.T) {
	db := testDB(t)
	repo := NewMomentsRepository(db)
	ctx := context.Background()

	author := newTestUser(t, db, "blkauthor").ID
	viewer := newTestUser(t, db, "blkviewer").ID
	befriend(t, db, viewer, author)
	befriend(t, db, author, viewer)
	post := newPost(t, db, author, model.MomentVisibilityFriends)

	// 前置：未拉黑时可见
	if got, _ := repo.PostByID(ctx, viewer, post.ID); got == nil {
		t.Fatal("拉黑前应可见")
	}

	// 作者拉黑观看者（viewer 是被拉黑方）
	b := &model.Blocklist{UserID: author, TargetID: viewer}
	if err := db.Create(b).Error; err != nil {
		t.Fatalf("create blocklist: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(b) })

	if got, _ := repo.PostByID(ctx, viewer, post.ID); got != nil {
		t.Fatal("被作者拉黑后不应看到该作者的帖子")
	}
}

// TestUserPosts_StrangerGetsEmpty 非好友查别人主页得到空列表，而不是错误。
//
// 回 403 会泄漏「这个人存在且发过帖」；空列表让调用方无从区分
// 「没发过」与「不给你看」。feed 同理（非好友的帖子根本不进结果集）。
func TestUserPosts_StrangerGetsEmpty(t *testing.T) {
	db := testDB(t)
	repo := NewMomentsRepository(db)
	ctx := context.Background()

	author := newTestUser(t, db, "upauthor").ID
	stranger := newTestUser(t, db, "upstranger").ID
	newPost(t, db, author, model.MomentVisibilityFriends)

	got, err := repo.UserPosts(ctx, stranger, author, nil, 20)
	if err != nil {
		t.Fatalf("UserPosts 不应报错，应回空列表: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("非好友看到了 %d 条帖子", len(got))
	}

	feed, err := repo.Feed(ctx, stranger, nil, 20)
	if err != nil {
		t.Fatalf("feed: %v", err)
	}
	for _, p := range feed {
		if p.UserID == author {
			t.Fatal("非好友的帖子进了 feed")
		}
	}
}

// TestFeedCursor 同一时刻写入的多帖必须不漏不重——单 created_at 游标会在这里翻车。
func TestFeedCursor(t *testing.T) {
	db := testDB(t)
	repo := NewMomentsRepository(db)
	ctx := context.Background()

	author := newTestUser(t, db, "cursor").ID
	// 同一事务里连写 5 帖：NOW() 在事务内是同一时刻，created_at 完全相同
	var posts []*model.MomentPost
	err := db.Transaction(func(tx *gorm.DB) error {
		for i := 0; i < 5; i++ {
			p := &model.MomentPost{UserID: author, Content: "p", Visibility: model.MomentVisibilityFriends}
			if err := tx.Create(p).Error; err != nil {
				return err
			}
			posts = append(posts, p)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("create posts: %v", err)
	}
	t.Cleanup(func() {
		for _, p := range posts {
			db.Unscoped().Delete(p)
		}
	})

	seen := map[uuid.UUID]int{}
	var cursor *MomentCursor
	for page := 0; page < 5; page++ {
		batch, err := repo.Feed(ctx, author, cursor, 2)
		if err != nil {
			t.Fatalf("feed page %d: %v", page, err)
		}
		if len(batch) == 0 {
			break
		}
		for _, p := range batch {
			seen[p.ID]++
		}
		last := batch[len(batch)-1]
		cursor = &MomentCursor{CreatedAt: last.CreatedAt, ID: last.ID}
	}

	if len(seen) != 5 {
		t.Fatalf("分页共见到 %d 帖，want 5（漏页）", len(seen))
	}
	for id, n := range seen {
		if n != 1 {
			t.Fatalf("帖子 %s 出现 %d 次，want 1（重页）", id, n)
		}
	}
}

// TestLikeIdempotent 连点两次只留一行，且第二次 inserted=false（据此不重复推互动消息）。
func TestLikeIdempotent(t *testing.T) {
	db := testDB(t)
	repo := NewMomentsRepository(db)
	ctx := context.Background()

	author := newTestUser(t, db, "likeauthor").ID
	liker := newTestUser(t, db, "liker").ID
	post := newPost(t, db, author, model.MomentVisibilityFriends)

	first, err := repo.Like(ctx, post.ID, liker)
	if err != nil || !first {
		t.Fatalf("首次点赞应 inserted=true: %v %v", first, err)
	}
	second, err := repo.Like(ctx, post.ID, liker)
	if err != nil {
		t.Fatalf("重复点赞不应报错: %v", err)
	}
	if second {
		t.Fatal("重复点赞应 inserted=false，否则会重复推送互动消息")
	}

	var count int64
	db.Model(&model.MomentLike{}).Where("post_id = ?", post.ID).Count(&count)
	if count != 1 {
		t.Fatalf("点赞行数 = %d, want 1", count)
	}

	// 取消点赞同样幂等
	if err := repo.Unlike(ctx, post.ID, liker); err != nil {
		t.Fatalf("取消点赞: %v", err)
	}
	if err := repo.Unlike(ctx, post.ID, liker); err != nil {
		t.Fatalf("重复取消点赞不应报错: %v", err)
	}
}

// TestCommentsByPost 软删评论不得出现在批量读结果里。
func TestCommentsByPost(t *testing.T) {
	db := testDB(t)
	repo := NewMomentsRepository(db)
	ctx := context.Background()

	author := newTestUser(t, db, "cmtauthor").ID
	post := newPost(t, db, author, model.MomentVisibilityFriends)

	alive := &model.MomentComment{PostID: post.ID, UserID: author, Content: "留着"}
	dead := &model.MomentComment{PostID: post.ID, UserID: author, Content: "删掉"}
	for _, c := range []*model.MomentComment{alive, dead} {
		if err := repo.CreateComment(ctx, c); err != nil {
			t.Fatalf("create comment: %v", err)
		}
		t.Cleanup(func() { db.Unscoped().Delete(c) })
	}
	if err := repo.SoftDeleteComment(ctx, dead.ID); err != nil {
		t.Fatalf("soft delete comment: %v", err)
	}

	got, err := repo.CommentsByPost(ctx, []uuid.UUID{post.ID})
	if err != nil {
		t.Fatalf("comments by post: %v", err)
	}
	list := got[post.ID]
	if len(list) != 1 || list[0].ID != alive.ID {
		t.Fatalf("软删评论仍被读出：%+v", list)
	}
}

// TestUnreadActivityCount 未读计数与批量标已读。
func TestUnreadActivityCount(t *testing.T) {
	db := testDB(t)
	repo := NewMomentsRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "actowner").ID
	actor := newTestUser(t, db, "actactor").ID
	post := newPost(t, db, owner, model.MomentVisibilityFriends)

	for i := 0; i < 3; i++ {
		a := &model.MomentActivity{UserID: owner, ActorID: actor, PostID: post.ID, Kind: model.MomentActivityKindLike}
		if err := repo.CreateActivity(ctx, a); err != nil {
			t.Fatalf("create activity: %v", err)
		}
		t.Cleanup(func() { db.Unscoped().Delete(a) })
	}

	n, err := repo.UnreadActivityCount(ctx, owner)
	if err != nil || n != 3 {
		t.Fatalf("未读计数 = %d (err=%v), want 3", n, err)
	}
	// ids 为空表示全部标已读
	if err := repo.MarkActivitiesRead(ctx, owner, nil); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	n, err = repo.UnreadActivityCount(ctx, owner)
	if err != nil || n != 0 {
		t.Fatalf("标已读后未读计数 = %d (err=%v), want 0", n, err)
	}
}

// TestActivitiesExcludeDeletedPost 删帖后互动消息必须一并消失（读时 join 过滤）。
func TestActivitiesExcludeDeletedPost(t *testing.T) {
	db := testDB(t)
	repo := NewMomentsRepository(db)
	ctx := context.Background()

	owner := newTestUser(t, db, "delowner").ID
	actor := newTestUser(t, db, "delactor").ID
	post := newPost(t, db, owner, model.MomentVisibilityFriends)
	a := &model.MomentActivity{UserID: owner, ActorID: actor, PostID: post.ID, Kind: model.MomentActivityKindLike}
	if err := repo.CreateActivity(ctx, a); err != nil {
		t.Fatalf("create activity: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(a) })

	if err := repo.SoftDeletePost(ctx, post.ID); err != nil {
		t.Fatalf("soft delete post: %v", err)
	}

	list, err := repo.Activities(ctx, owner, nil, 20)
	if err != nil {
		t.Fatalf("activities: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("删帖后互动消息仍可见：%+v", list)
	}
	n, err := repo.UnreadActivityCount(ctx, owner)
	if err != nil || n != 0 {
		t.Fatalf("删帖后未读计数 = %d (err=%v), want 0", n, err)
	}
}
