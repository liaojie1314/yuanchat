package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"go.uber.org/zap"
)

// 朋友圈错误哨兵，handler 据此映射 HTTP 状态码。
var (
	// ErrMomentNotFound 帖子/评论不存在或对调用者不可见。
	// 两种情况合并成同一个错误是刻意的：区分开会泄漏帖子存在性。
	ErrMomentNotFound = errors.New("moment not found")
	// ErrMomentForbidden 可见但无权操作（删他人帖、删他人评论）。
	ErrMomentForbidden = errors.New("moment forbidden")
	// ErrMomentInvalidMedia 媒体数量与判别位不自洽，或正文超长。
	ErrMomentInvalidMedia = errors.New("moment invalid media")
)

// momentPostPreviewRunes 互动列表里帖子正文摘要的截断长度（按 rune）。
const momentPostPreviewRunes = 20

// CreatePostInput 发布入参。
type CreatePostInput struct {
	Content    string
	Media      []model.MomentMediaItem
	MediaKind  int16
	Visibility int16
}

// MomentUserDTO 帖子/评论/互动里内嵌的用户摘要。
type MomentUserDTO struct {
	ID          uuid.UUID `json:"id"`
	Nickname    string    `json:"nickname"`
	AvatarURL   string    `json:"avatar_url"`
	StatusEmoji string    `json:"status_emoji"`
}

// MomentCommentDTO 评论。
type MomentCommentDTO struct {
	ID          uuid.UUID      `json:"id"`
	User        MomentUserDTO  `json:"user"`
	ReplyToUser *MomentUserDTO `json:"reply_to_user"`
	Content     string         `json:"content"`
	CreatedAt   time.Time      `json:"created_at"`
}

// MomentPostDTO 帖子。
//
// media 出的是对象 key 而非签好名的 URL：客户端调既有 /files/download-url 换签
//（那边有进程内签名缓存），服务端逐帖签名会让一次 feed 响应签最多 20×9=180 个 URL。
type MomentPostDTO struct {
	ID         uuid.UUID               `json:"id"`
	User       MomentUserDTO           `json:"user"`
	Content    string                  `json:"content"`
	MediaKind  int16                   `json:"media_kind"`
	Media      []model.MomentMediaItem `json:"media"`
	Visibility int16                   `json:"visibility"`
	LikeCount  int                     `json:"like_count"`
	LikedByMe  bool                    `json:"liked_by_me"`
	Likes      []MomentUserDTO         `json:"likes"`
	Comments   []MomentCommentDTO      `json:"comments"`
	CreatedAt  time.Time               `json:"created_at"`
	Deletable  bool                    `json:"deletable"`
}

// MomentFeedDTO 一页帖子。NextCursor 为空表示已到底。
type MomentFeedDTO struct {
	Posts      []MomentPostDTO `json:"posts"`
	NextCursor string          `json:"next_cursor"`
}

// MomentActivityDTO 一条互动消息。
type MomentActivityDTO struct {
	ID             uuid.UUID     `json:"id"`
	Kind           int16         `json:"kind"`
	PostID         uuid.UUID     `json:"post_id"`
	Actor          MomentUserDTO `json:"actor"`
	CommentPreview string        `json:"comment_preview"`
	PostPreview    string        `json:"post_preview"`
	PostThumbKey   string        `json:"post_thumb_key"`
	Read           bool          `json:"read"`
	CreatedAt      time.Time     `json:"created_at"`
}

// MomentActivitiesDTO 互动消息一页 + 未读数。
type MomentActivitiesDTO struct {
	Activities  []MomentActivityDTO `json:"activities"`
	UnreadCount int64               `json:"unread_count"`
	NextCursor  string              `json:"next_cursor"`
}

// MomentActivityNotifier 把一条互动消息推给帖子作者的在线设备。
//
// 收回调而非直接持有 ws.Dispatcher：internal/ws 已经 import 了 service
//（通话信令 ws/call.go 依赖 service.CallService），service 再反向 import ws
// 会成环。故本层只声明「发生了一条互动」，帧的编码与投递由装配层（router）
// 提供的实现完成；传 nil 表示不推送（测试即如此）。
type MomentActivityNotifier func(act *model.MomentActivity, actor *model.User, preview string)

// MomentsService 朋友圈业务逻辑。
//
// 权限的唯一来源是 repository 的可见性作用域：本层每个写操作都先用
// PostByID 取一次帖子，取不到即视为不可见 → ErrMomentNotFound，
// 不另写一套判定（两套判定必然漂移，漂移处就是越权洞）。
type MomentsService struct {
	repo     *repository.MomentsRepository
	userRepo *repository.UserRepository
	notify   MomentActivityNotifier
	logger   *zap.Logger

	moderation *ModerationService
	ugcRepo    *repository.FlaggedUGCRepository
}

// NewMomentsService 创建朋友圈业务服务；notify 为 nil 时不推送互动帧。
func NewMomentsService(repo *repository.MomentsRepository, userRepo *repository.UserRepository, notify MomentActivityNotifier, logger *zap.Logger) *MomentsService {
	return &MomentsService{repo: repo, userRepo: userRepo, notify: notify, logger: logger}
}

// SetModeration 注入敏感词审核（与 UserService.SetUGCModeration 同一惯例，可不注入）。
func (s *MomentsService) SetModeration(m *ModerationService, r *repository.FlaggedUGCRepository) {
	s.moderation = m
	s.ugcRepo = r
}

// flagUGC 记录一条朋友圈敏感词命中。targetID 是命中内容所在帖子/评论的 id，
// 管理端据此定位并删除。台账写失败只告警不回滚业务写入——
// 打标不阻塞发布，审核队列少一条的代价远小于用户发不出内容。
func (s *MomentsService) flagUGC(ctx context.Context, ugcType, content, hitWord string, userID, targetID uuid.UUID) {
	if s.ugcRepo == nil {
		return
	}
	rec := &model.FlaggedUGC{
		UGCType: ugcType, Content: content, HitWord: hitWord,
		UserID: &userID, TargetID: &targetID,
	}
	if err := s.ugcRepo.Create(ctx, rec); err != nil {
		s.logger.Warn("record flagged moment ugc failed",
			zap.String("ugc_type", ugcType), zap.String("user_id", userID.String()), zap.Error(err))
	}
}

// checkModeration 返回命中的敏感词（未注入审核或未命中时为空串）。
func (s *MomentsService) checkModeration(text string) string {
	if s.moderation == nil {
		return ""
	}
	return s.moderation.Check(text)
}

// validateMedia 校验媒体数量与判别位自洽，并拒绝空帖。
//
// 图与视频共用 media 一列，只有判别位能区分；不在这里卡死的话，
// 前端能发出「media_kind=视频但塞了 9 项」这种渲染端无从处理的畸形帖。
func validateMedia(in CreatePostInput) error {
	switch in.MediaKind {
	case model.MomentMediaKindNone:
		if len(in.Media) != 0 {
			return fmt.Errorf("%w: 无媒体帖不应带 media", ErrMomentInvalidMedia)
		}
		if in.Content == "" {
			return fmt.Errorf("%w: 空帖", ErrMomentInvalidMedia)
		}
	case model.MomentMediaKindImage:
		if len(in.Media) < 1 || len(in.Media) > model.MomentMaxImages {
			return fmt.Errorf("%w: 图片数量须为 1-%d", ErrMomentInvalidMedia, model.MomentMaxImages)
		}
	case model.MomentMediaKindVideo:
		if len(in.Media) != 1 {
			return fmt.Errorf("%w: 视频帖只能有 1 项媒体", ErrMomentInvalidMedia)
		}
	default:
		return fmt.Errorf("%w: 未知媒体类型", ErrMomentInvalidMedia)
	}
	for _, m := range in.Media {
		if m.Key == "" {
			return fmt.Errorf("%w: 媒体 key 不能为空", ErrMomentInvalidMedia)
		}
	}
	if utf8.RuneCountInString(in.Content) > model.MomentContentMaxLen {
		return fmt.Errorf("%w: 正文超过 %d 字", ErrMomentInvalidMedia, model.MomentContentMaxLen)
	}
	if in.Visibility != model.MomentVisibilityFriends && in.Visibility != model.MomentVisibilityPrivate {
		return fmt.Errorf("%w: 未知可见性", ErrMomentInvalidMedia)
	}
	return nil
}

// CreatePost 发布动态。敏感词只打标不阻塞（与消息、贴纸同口径）。
func (s *MomentsService) CreatePost(ctx context.Context, userID uuid.UUID, in CreatePostInput) (*MomentPostDTO, error) {
	if err := validateMedia(in); err != nil {
		return nil, err
	}
	media := in.Media
	if media == nil {
		media = []model.MomentMediaItem{}
	}
	raw, err := json.Marshal(media)
	if err != nil {
		return nil, fmt.Errorf("marshal media: %w", err)
	}

	post := &model.MomentPost{
		UserID:     userID,
		Content:    in.Content,
		Media:      string(raw),
		MediaKind:  in.MediaKind,
		Visibility: in.Visibility,
	}
	hit := s.checkModeration(in.Content)
	post.Flagged = hit != ""

	if err := s.repo.CreatePost(ctx, post); err != nil {
		return nil, fmt.Errorf("create post: %w", err)
	}
	if hit != "" {
		s.flagUGC(ctx, model.UGCTypeMomentPost, in.Content, hit, userID, post.ID)
	}

	users, err := s.usersByIDs(ctx, []uuid.UUID{userID})
	if err != nil {
		return nil, err
	}
	dto := s.buildPostDTO(*post, userID, users, nil, nil)
	return &dto, nil
}

// Post 取单帖；不可见与不存在同样回 ErrMomentNotFound。
func (s *MomentsService) Post(ctx context.Context, viewerID, postID uuid.UUID) (*MomentPostDTO, error) {
	post, err := s.repo.PostByID(ctx, viewerID, postID)
	if err != nil {
		return nil, fmt.Errorf("post: %w", err)
	}
	if post == nil {
		return nil, ErrMomentNotFound
	}
	page, err := s.buildFeedDTO(ctx, viewerID, []model.MomentPost{*post}, 1)
	if err != nil {
		return nil, err
	}
	return &page.Posts[0], nil
}

// Feed 信息流一页。
func (s *MomentsService) Feed(ctx context.Context, viewerID uuid.UUID, cursor string, limit int) (*MomentFeedDTO, error) {
	cur, err := repository.ParseMomentCursor(cursor)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMomentInvalidMedia, err)
	}
	// 多取一条只为判断「还有下一页」，不进结果集
	posts, err := s.repo.Feed(ctx, viewerID, cur, limit+1)
	if err != nil {
		return nil, fmt.Errorf("feed: %w", err)
	}
	return s.buildFeedDTO(ctx, viewerID, posts, limit)
}

// UserPosts 某人主页的一页帖子（非好友得到空列表，不报错）。
func (s *MomentsService) UserPosts(ctx context.Context, viewerID, authorID uuid.UUID, cursor string, limit int) (*MomentFeedDTO, error) {
	cur, err := repository.ParseMomentCursor(cursor)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMomentInvalidMedia, err)
	}
	posts, err := s.repo.UserPosts(ctx, viewerID, authorID, cur, limit+1)
	if err != nil {
		return nil, fmt.Errorf("user posts: %w", err)
	}
	return s.buildFeedDTO(ctx, viewerID, posts, limit)
}

// DeletePost 删除自己的动态；他人的帖子可见但不可删。
func (s *MomentsService) DeletePost(ctx context.Context, userID, postID uuid.UUID) error {
	post, err := s.repo.PostByID(ctx, userID, postID)
	if err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	if post == nil {
		return ErrMomentNotFound
	}
	if post.UserID != userID {
		return ErrMomentForbidden
	}
	if err := s.repo.SoftDeletePost(ctx, postID); err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	return nil
}

// SetLike 点赞 / 取消点赞。可见性先于写入判定：不可见的帖子一律 ErrMomentNotFound。
func (s *MomentsService) SetLike(ctx context.Context, userID, postID uuid.UUID, liked bool) error {
	post, err := s.repo.PostByID(ctx, userID, postID)
	if err != nil {
		return fmt.Errorf("set like: %w", err)
	}
	if post == nil {
		return ErrMomentNotFound
	}
	if !liked {
		if err := s.repo.Unlike(ctx, postID, userID); err != nil {
			return fmt.Errorf("unlike: %w", err)
		}
		return nil
	}
	inserted, err := s.repo.Like(ctx, postID, userID)
	if err != nil {
		return fmt.Errorf("like: %w", err)
	}
	// 重复点赞不再推一次；自赞不通知自己
	if inserted && post.UserID != userID {
		s.recordActivity(ctx, post, userID, model.MomentActivityKindLike, nil, "")
	}
	return nil
}

// AddComment 发表评论；敏感词只打标不阻塞。
func (s *MomentsService) AddComment(ctx context.Context, userID, postID uuid.UUID, content string, replyTo *uuid.UUID) (*MomentCommentDTO, error) {
	post, err := s.repo.PostByID(ctx, userID, postID)
	if err != nil {
		return nil, fmt.Errorf("add comment: %w", err)
	}
	if post == nil {
		return nil, ErrMomentNotFound
	}
	n := utf8.RuneCountInString(content)
	if n == 0 || n > model.MomentCommentMaxLen {
		return nil, fmt.Errorf("%w: 评论长度须为 1-%d 字", ErrMomentInvalidMedia, model.MomentCommentMaxLen)
	}

	comment := &model.MomentComment{
		PostID:        postID,
		UserID:        userID,
		ReplyToUserID: replyTo,
		Content:       content,
	}
	hit := s.checkModeration(content)
	comment.Flagged = hit != ""
	if err := s.repo.CreateComment(ctx, comment); err != nil {
		return nil, fmt.Errorf("create comment: %w", err)
	}
	if hit != "" {
		s.flagUGC(ctx, model.UGCTypeMomentComment, content, hit, userID, comment.ID)
	}
	if post.UserID != userID {
		s.recordActivity(ctx, post, userID, model.MomentActivityKindComment, &comment.ID, content)
	}

	ids := []uuid.UUID{userID}
	if replyTo != nil {
		ids = append(ids, *replyTo)
	}
	users, err := s.usersByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	dto := buildCommentDTO(*comment, users)
	return &dto, nil
}

// DeleteComment 删除评论：评论作者与帖子作者都可删，第三方不可。
func (s *MomentsService) DeleteComment(ctx context.Context, userID, commentID uuid.UUID) error {
	comment, err := s.repo.CommentByID(ctx, commentID)
	if err != nil {
		return fmt.Errorf("delete comment: %w", err)
	}
	if comment == nil {
		return ErrMomentNotFound
	}
	// 评论所属帖子若对调用者不可见，连评论存在性也不该泄漏
	post, err := s.repo.PostByID(ctx, userID, comment.PostID)
	if err != nil {
		return fmt.Errorf("delete comment: %w", err)
	}
	if post == nil {
		return ErrMomentNotFound
	}
	if comment.UserID != userID && post.UserID != userID {
		return ErrMomentForbidden
	}
	if err := s.repo.SoftDeleteComment(ctx, commentID); err != nil {
		return fmt.Errorf("delete comment: %w", err)
	}
	return nil
}

// Activities 互动消息一页 + 未读数。
func (s *MomentsService) Activities(ctx context.Context, userID uuid.UUID, cursor string, limit int) (*MomentActivitiesDTO, error) {
	cur, err := repository.ParseMomentCursor(cursor)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMomentInvalidMedia, err)
	}
	rows, err := s.repo.Activities(ctx, userID, cur, limit+1)
	if err != nil {
		return nil, fmt.Errorf("activities: %w", err)
	}
	unread, err := s.repo.UnreadActivityCount(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("activities: %w", err)
	}

	next := ""
	if len(rows) > limit {
		last := rows[limit-1]
		next = repository.MomentCursor{CreatedAt: last.CreatedAt, ID: last.ID}.String()
		rows = rows[:limit]
	}

	actorIDs := make([]uuid.UUID, 0, len(rows))
	postIDs := make([]uuid.UUID, 0, len(rows))
	commentIDs := make([]uuid.UUID, 0, len(rows))
	for _, a := range rows {
		actorIDs = append(actorIDs, a.ActorID)
		postIDs = append(postIDs, a.PostID)
		if a.CommentID != nil {
			commentIDs = append(commentIDs, *a.CommentID)
		}
	}
	users, err := s.usersByIDs(ctx, actorIDs)
	if err != nil {
		return nil, err
	}
	// 帖子摘要与评论预览批量取回，避免逐条回查
	posts, err := s.postsByIDs(ctx, userID, postIDs)
	if err != nil {
		return nil, err
	}
	comments, err := s.commentTexts(ctx, postIDs, commentIDs)
	if err != nil {
		return nil, err
	}

	out := &MomentActivitiesDTO{Activities: make([]MomentActivityDTO, 0, len(rows)), UnreadCount: unread, NextCursor: next}
	for _, a := range rows {
		dto := MomentActivityDTO{
			ID:        a.ID,
			Kind:      a.Kind,
			PostID:    a.PostID,
			Actor:     userDTO(users[a.ActorID]),
			Read:      a.ReadAt != nil,
			CreatedAt: a.CreatedAt,
		}
		if a.CommentID != nil {
			dto.CommentPreview = comments[*a.CommentID]
		}
		if p, ok := posts[a.PostID]; ok {
			dto.PostPreview = truncateRunes(p.Content, momentPostPreviewRunes)
			dto.PostThumbKey = postThumbKey(p)
		}
		out.Activities = append(out.Activities, dto)
	}
	return out, nil
}

// MarkActivitiesRead 标记互动消息已读；ids 为空表示全部标已读。
func (s *MomentsService) MarkActivitiesRead(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) error {
	if err := s.repo.MarkActivitiesRead(ctx, userID, ids); err != nil {
		return fmt.Errorf("mark activities read: %w", err)
	}
	return nil
}

// recordActivity 写互动消息并推送通知。写失败只记日志：点赞/评论本体已落库，
// 少一条通知不该让整个操作失败。
func (s *MomentsService) recordActivity(ctx context.Context, post *model.MomentPost, actorID uuid.UUID, kind int16, commentID *uuid.UUID, preview string) {
	act := &model.MomentActivity{
		UserID:    post.UserID,
		ActorID:   actorID,
		PostID:    post.ID,
		CommentID: commentID,
		Kind:      kind,
	}
	if err := s.repo.CreateActivity(ctx, act); err != nil {
		s.logger.Warn("create moment activity failed", zap.String("post_id", post.ID.String()), zap.Error(err))
		return
	}
	if s.notify == nil {
		return
	}
	actor, err := s.userRepo.FindByID(ctx, actorID)
	if err != nil || actor == nil {
		s.logger.Warn("load moment actor failed", zap.String("actor_id", actorID.String()), zap.Error(err))
		return
	}
	// 不因推送失败回滚点赞/评论：互动消息已落库，前端下次拉 /activities 仍能看到
	s.notify(act, actor, truncateRunes(preview, momentPostPreviewRunes))
}

// buildFeedDTO 把一页帖子组装成 DTO：点赞者与评论批量取回，避免每帖一次查询。
// posts 比 limit 多出的那条只用来生成 NextCursor，不进结果集。
func (s *MomentsService) buildFeedDTO(ctx context.Context, viewerID uuid.UUID, posts []model.MomentPost, limit int) (*MomentFeedDTO, error) {
	out := &MomentFeedDTO{Posts: make([]MomentPostDTO, 0, len(posts))}
	if len(posts) > limit {
		last := posts[limit-1]
		out.NextCursor = repository.MomentCursor{CreatedAt: last.CreatedAt, ID: last.ID}.String()
		posts = posts[:limit]
	}
	if len(posts) == 0 {
		return out, nil
	}

	postIDs := make([]uuid.UUID, 0, len(posts))
	for _, p := range posts {
		postIDs = append(postIDs, p.ID)
	}
	likers, err := s.repo.LikersByPost(ctx, postIDs)
	if err != nil {
		return nil, fmt.Errorf("build feed: %w", err)
	}
	comments, err := s.repo.CommentsByPost(ctx, postIDs)
	if err != nil {
		return nil, fmt.Errorf("build feed: %w", err)
	}

	// 一次取齐作者 + 点赞者 + 评论者 + 被回复者
	idSet := map[uuid.UUID]struct{}{}
	for _, p := range posts {
		idSet[p.UserID] = struct{}{}
	}
	for _, list := range likers {
		for _, id := range list {
			idSet[id] = struct{}{}
		}
	}
	for _, list := range comments {
		for _, c := range list {
			idSet[c.UserID] = struct{}{}
			if c.ReplyToUserID != nil {
				idSet[*c.ReplyToUserID] = struct{}{}
			}
		}
	}
	ids := make([]uuid.UUID, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	users, err := s.usersByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}

	for _, p := range posts {
		out.Posts = append(out.Posts, s.buildPostDTO(p, viewerID, users, likers[p.ID], comments[p.ID]))
	}
	return out, nil
}

// buildPostDTO 组装单帖 DTO。
func (s *MomentsService) buildPostDTO(p model.MomentPost, viewerID uuid.UUID, users map[uuid.UUID]model.User, likers []uuid.UUID, comments []model.MomentComment) MomentPostDTO {
	dto := MomentPostDTO{
		ID:         p.ID,
		User:       userDTO(users[p.UserID]),
		Content:    p.Content,
		MediaKind:  p.MediaKind,
		Media:      decodeMedia(p.Media),
		Visibility: p.Visibility,
		LikeCount:  len(likers),
		Likes:      make([]MomentUserDTO, 0, len(likers)),
		Comments:   make([]MomentCommentDTO, 0, len(comments)),
		CreatedAt:  p.CreatedAt,
		Deletable:  p.UserID == viewerID,
	}
	for _, id := range likers {
		if id == viewerID {
			dto.LikedByMe = true
		}
		dto.Likes = append(dto.Likes, userDTO(users[id]))
	}
	for _, c := range comments {
		dto.Comments = append(dto.Comments, buildCommentDTO(c, users))
	}
	return dto
}

// buildCommentDTO 组装评论 DTO。
func buildCommentDTO(c model.MomentComment, users map[uuid.UUID]model.User) MomentCommentDTO {
	dto := MomentCommentDTO{
		ID:        c.ID,
		User:      userDTO(users[c.UserID]),
		Content:   c.Content,
		CreatedAt: c.CreatedAt,
	}
	if c.ReplyToUserID != nil {
		u := userDTO(users[*c.ReplyToUserID])
		dto.ReplyToUser = &u
	}
	return dto
}

// userDTO 用户摘要。状态经 EffectiveStatus 取，直接读字段会把已过期状态吐出去。
func userDTO(u model.User) MomentUserDTO {
	emoji, _ := u.EffectiveStatus(time.Now())
	avatar := ""
	if u.AvatarURL != nil {
		avatar = *u.AvatarURL
	}
	return MomentUserDTO{ID: u.ID, Nickname: u.Nickname, AvatarURL: avatar, StatusEmoji: emoji}
}

// usersByIDs 批量取用户并按 id 索引（去重由 FindByIDs 的 IN 查询天然完成）。
func (s *MomentsService) usersByIDs(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]model.User, error) {
	out := map[uuid.UUID]model.User{}
	if len(ids) == 0 {
		return out, nil
	}
	users, err := s.userRepo.FindByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("load users: %w", err)
	}
	for _, u := range users {
		out[u.ID] = u
	}
	return out, nil
}

// postsByIDs 批量取对 viewer 可见的帖子，用于互动列表的正文与封面摘要。
func (s *MomentsService) postsByIDs(ctx context.Context, viewerID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]model.MomentPost, error) {
	out := map[uuid.UUID]model.MomentPost{}
	for _, id := range ids {
		if _, ok := out[id]; ok {
			continue
		}
		p, err := s.repo.PostByID(ctx, viewerID, id)
		if err != nil {
			return nil, fmt.Errorf("load activity posts: %w", err)
		}
		if p != nil {
			out[id] = *p
		}
	}
	return out, nil
}

// commentTexts 取互动消息引用到的评论正文（按帖子批量读，再按 id 挑）。
func (s *MomentsService) commentTexts(ctx context.Context, postIDs []uuid.UUID, commentIDs []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	if len(commentIDs) == 0 {
		return out, nil
	}
	byPost, err := s.repo.CommentsByPost(ctx, postIDs)
	if err != nil {
		return nil, fmt.Errorf("load activity comments: %w", err)
	}
	wanted := map[uuid.UUID]struct{}{}
	for _, id := range commentIDs {
		wanted[id] = struct{}{}
	}
	for _, list := range byPost {
		for _, c := range list {
			if _, ok := wanted[c.ID]; ok {
				out[c.ID] = truncateRunes(c.Content, momentPostPreviewRunes)
			}
		}
	}
	return out, nil
}

// decodeMedia 解析落库的 media jsonb；解析失败当作无媒体（不让脏数据把整页读挂）。
func decodeMedia(raw string) []model.MomentMediaItem {
	out := []model.MomentMediaItem{}
	if raw == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []model.MomentMediaItem{}
	}
	return out
}

// postThumbKey 取帖子首个媒体的展示 key：视频用封面，图片用原图，无媒体为空串。
func postThumbKey(p model.MomentPost) string {
	media := decodeMedia(p.Media)
	if len(media) == 0 {
		return ""
	}
	if media[0].ThumbKey != "" {
		return media[0].ThumbKey
	}
	return media[0].Key
}

// truncateRunes 按 rune 截断——按 byte 截会把中文切半，前端渲染出乱码。
func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	runes := []rune(s)
	return string(runes[:n])
}
