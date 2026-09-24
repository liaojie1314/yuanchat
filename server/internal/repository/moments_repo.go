package repository

import (
	"context"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// MomentsRepository 朋友圈数据访问。
//
// 全部读路径（feed / 主页 / 单帖 / 点赞 / 评论 / 互动）都必须先过 VisiblePostsScope：
// 只要有一条读写路径绕过它，就是越权——例如 feed 过滤了而点赞接口没过滤时，
// 非好友能给私密帖点赞并把互动消息推给作者。
type MomentsRepository struct {
	db *gorm.DB
}

// NewMomentsRepository 创建朋友圈数据访问对象。
func NewMomentsRepository(db *gorm.DB) *MomentsRepository {
	return &MomentsRepository{db: db}
}

// MomentCursor feed 复合游标。
//
// 只用 created_at 会在同毫秒多帖时漏页/重页（批量导入或同事务连发都会撞时刻），
// 故以 (created_at, id) 做行比较，id 充当 tie-breaker。
type MomentCursor struct {
	CreatedAt time.Time
	ID        uuid.UUID
}

// String 编码为 URL 安全的不透明串（微秒时间戳_uuid，再 base64）。
// 对外不透出内部形状，便于将来换排序键。
func (c MomentCursor) String() string {
	raw := strconv.FormatInt(c.CreatedAt.UnixMicro(), 10) + "_" + c.ID.String()
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// ParseMomentCursor 解析游标串；空串返回 (nil, nil) 表示从最新一页开始。
func ParseMomentCursor(s string) (*MomentCursor, error) {
	if s == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor encoding: %w", err)
	}
	parts := strings.SplitN(string(decoded), "_", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid cursor format")
	}
	micro, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor time: %w", err)
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid cursor id: %w", err)
	}
	return &MomentCursor{CreatedAt: time.UnixMicro(micro).UTC(), ID: id}, nil
}

// VisiblePostsScope 「userID 可见的帖子」作用域，是可见性的唯一判定处。
//
// 可见 = 自己的帖子（含 private）∪ 好友的 friends 档帖子（且双向未拉黑）。
//
// 表结构要点（与 model/contact.go、model/blocklist.go 一致）：
//   - contacts 是单向两行表，列名 contact_user_id，status=1 才算好友，带 deleted_at 软删；
//     删好友是双向软删，故只查「我方向」的行即可
//   - blocklists 列名 target_id，解除拉黑是物理删（无 deleted_at），故不加软删条件
//
// 用 moments_posts 的表别名 p：调用方必须以 Table("moments_posts p") 形式建查询，
// 否则别名对不上。
func (r *MomentsRepository) VisiblePostsScope(userID uuid.UUID) func(*gorm.DB) *gorm.DB {
	return func(db *gorm.DB) *gorm.DB {
		return db.Where(`p.deleted_at IS NULL AND (
			p.user_id = ?
			OR (
				p.visibility = ?
				AND EXISTS (SELECT 1 FROM contacts c
					WHERE c.user_id = ? AND c.contact_user_id = p.user_id
					  AND c.status = ? AND c.deleted_at IS NULL)
				AND NOT EXISTS (SELECT 1 FROM blocklists b
					WHERE (b.user_id = ? AND b.target_id = p.user_id)
					   OR (b.user_id = p.user_id AND b.target_id = ?))
			)
		)`, userID, model.MomentVisibilityFriends, userID, model.ContactStatusAccepted, userID, userID)
	}
}

// baseVisible 建一个已挂可见性作用域、带别名 p 的查询。
func (r *MomentsRepository) baseVisible(ctx context.Context, viewerID uuid.UUID) *gorm.DB {
	return r.db.WithContext(ctx).
		Table("moments_posts p").
		Scopes(r.VisiblePostsScope(viewerID))
}

// CreatePost 插入帖子。
func (r *MomentsRepository) CreatePost(ctx context.Context, p *model.MomentPost) error {
	return r.db.WithContext(ctx).Create(p).Error
}

// PostByID 取单帖；对 viewerID 不可见时返回 (nil, nil)——调用方据此回 404，
// 不区分「不存在」与「无权看」，避免泄漏帖子存在性。
func (r *MomentsRepository) PostByID(ctx context.Context, viewerID, postID uuid.UUID) (*model.MomentPost, error) {
	var post model.MomentPost
	err := r.baseVisible(ctx, viewerID).Select("p.*").Where("p.id = ?", postID).Take(&post).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("post by id: %w", err)
	}
	return &post, nil
}

// applyCursor 给查询加复合游标条件与排序。
func applyCursor(q *gorm.DB, cursor *MomentCursor, limit int) *gorm.DB {
	if cursor != nil {
		// 行比较：Postgres 原生支持 (a, b) < (x, y) 的字典序语义
		q = q.Where("(p.created_at, p.id) < (?, ?)", cursor.CreatedAt, cursor.ID)
	}
	return q.Order("p.created_at DESC, p.id DESC").Limit(limit)
}

// Feed 信息流：本人 + 好友的可见帖，时间倒序。
func (r *MomentsRepository) Feed(ctx context.Context, viewerID uuid.UUID, cursor *MomentCursor, limit int) ([]model.MomentPost, error) {
	var posts []model.MomentPost
	q := applyCursor(r.baseVisible(ctx, viewerID).Select("p.*"), cursor, limit)
	if err := q.Scan(&posts).Error; err != nil {
		return nil, fmt.Errorf("feed: %w", err)
	}
	return posts, nil
}

// UserPosts 某人的主页帖子（同样过可见性作用域）。
//
// 非好友查别人主页会得到空列表而非错误：存在性不泄漏。
func (r *MomentsRepository) UserPosts(ctx context.Context, viewerID, authorID uuid.UUID, cursor *MomentCursor, limit int) ([]model.MomentPost, error) {
	var posts []model.MomentPost
	q := applyCursor(r.baseVisible(ctx, viewerID).Select("p.*").Where("p.user_id = ?", authorID), cursor, limit)
	if err := q.Scan(&posts).Error; err != nil {
		return nil, fmt.Errorf("user posts: %w", err)
	}
	return posts, nil
}

// SoftDeletePost 软删帖子。软删而非物理删：与全仓口径一致，且
// GC 对软删帖的媒体仍算「在用」（见 ObjectACLRepository.ReferencedKeys 注释）。
func (r *MomentsRepository) SoftDeletePost(ctx context.Context, postID uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).
		Model(&model.MomentPost{}).
		Where("id = ? AND deleted_at IS NULL", postID).
		Update("deleted_at", now).Error
}

// Like 点赞。返回 inserted 表示本次是否真的新增了一行——
// 重复点赞返回 false，调用方据此不重复写互动消息（否则连点能刷屏作者红点）。
func (r *MomentsRepository) Like(ctx context.Context, postID, userID uuid.UUID) (bool, error) {
	res := r.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model.MomentLike{PostID: postID, UserID: userID})
	if res.Error != nil {
		return false, fmt.Errorf("like: %w", res.Error)
	}
	return res.RowsAffected > 0, nil
}

// Unlike 取消点赞（不存在时静默成功，幂等）。
func (r *MomentsRepository) Unlike(ctx context.Context, postID, userID uuid.UUID) error {
	return r.db.WithContext(ctx).
		Where("post_id = ? AND user_id = ?", postID, userID).
		Delete(&model.MomentLike{}).Error
}

// LikersByPost 批量取点赞者 ID（按点赞时间正序），供 feed 一次性组装 DTO，
// 避免每帖一次查询的 N+1。
func (r *MomentsRepository) LikersByPost(ctx context.Context, postIDs []uuid.UUID) (map[uuid.UUID][]uuid.UUID, error) {
	out := make(map[uuid.UUID][]uuid.UUID, len(postIDs))
	if len(postIDs) == 0 {
		return out, nil
	}
	var rows []model.MomentLike
	err := r.db.WithContext(ctx).
		Where("post_id IN ?", postIDs).
		Order("created_at ASC").
		Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("likers by post: %w", err)
	}
	for _, row := range rows {
		out[row.PostID] = append(out[row.PostID], row.UserID)
	}
	return out, nil
}

// CreateComment 插入评论。
func (r *MomentsRepository) CreateComment(ctx context.Context, c *model.MomentComment) error {
	return r.db.WithContext(ctx).Create(c).Error
}

// CommentByID 取单条未删评论（删评论鉴权要先拿到它的作者）。
func (r *MomentsRepository) CommentByID(ctx context.Context, id uuid.UUID) (*model.MomentComment, error) {
	var c model.MomentComment
	err := r.db.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", id).Take(&c).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("comment by id: %w", err)
	}
	return &c, nil
}

// CommentsByPost 批量取未删评论（按时间正序），同样是为了避免 feed 的 N+1。
func (r *MomentsRepository) CommentsByPost(ctx context.Context, postIDs []uuid.UUID) (map[uuid.UUID][]model.MomentComment, error) {
	out := make(map[uuid.UUID][]model.MomentComment, len(postIDs))
	if len(postIDs) == 0 {
		return out, nil
	}
	var rows []model.MomentComment
	err := r.db.WithContext(ctx).
		Where("post_id IN ? AND deleted_at IS NULL", postIDs).
		Order("created_at ASC").
		Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("comments by post: %w", err)
	}
	for _, row := range rows {
		out[row.PostID] = append(out[row.PostID], row)
	}
	return out, nil
}

// SoftDeleteComment 软删评论。
func (r *MomentsRepository) SoftDeleteComment(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).
		Model(&model.MomentComment{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Update("deleted_at", time.Now()).Error
}

// CreateActivity 写一条互动消息。
func (r *MomentsRepository) CreateActivity(ctx context.Context, a *model.MomentActivity) error {
	return r.db.WithContext(ctx).Create(a).Error
}

// activitiesBase 互动消息的公共查询：join 帖子过滤软删。
//
// 删帖只置 moments_posts.deleted_at，互动行仍在表里；不在读路径 join 过滤的话，
// 删掉的帖子会继续在互动列表里留条目、继续点亮红点，且点进去是 404。
func (r *MomentsRepository) activitiesBase(ctx context.Context, userID uuid.UUID) *gorm.DB {
	return r.db.WithContext(ctx).
		Table("moments_activities a").
		Joins("JOIN moments_posts p ON p.id = a.post_id AND p.deleted_at IS NULL").
		Where("a.user_id = ?", userID)
}

// Activities 互动消息列表（时间倒序，复合游标）。
func (r *MomentsRepository) Activities(ctx context.Context, userID uuid.UUID, cursor *MomentCursor, limit int) ([]model.MomentActivity, error) {
	q := r.activitiesBase(ctx, userID).Select("a.*")
	if cursor != nil {
		q = q.Where("(a.created_at, a.id) < (?, ?)", cursor.CreatedAt, cursor.ID)
	}
	var list []model.MomentActivity
	if err := q.Order("a.created_at DESC, a.id DESC").Limit(limit).Scan(&list).Error; err != nil {
		return nil, fmt.Errorf("activities: %w", err)
	}
	return list, nil
}

// UnreadActivityCount 未读互动数（红点用）。
func (r *MomentsRepository) UnreadActivityCount(ctx context.Context, userID uuid.UUID) (int64, error) {
	var n int64
	err := r.activitiesBase(ctx, userID).Where("a.read_at IS NULL").Count(&n).Error
	if err != nil {
		return 0, fmt.Errorf("unread activity count: %w", err)
	}
	return n, nil
}

// MarkActivitiesRead 标记已读；ids 为空表示把该用户的未读全部标掉。
func (r *MomentsRepository) MarkActivitiesRead(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) error {
	q := r.db.WithContext(ctx).
		Model(&model.MomentActivity{}).
		Where("user_id = ? AND read_at IS NULL", userID)
	if len(ids) > 0 {
		q = q.Where("id IN ?", ids)
	}
	return q.Update("read_at", time.Now()).Error
}
