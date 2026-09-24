package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// momentsTestDB 返回独立测试库上的事务句柄（跑完整迁移、用例结束回滚）。
func momentsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	return testutil.NewDB(t)
}

// newMomentsTestUser 建一次性用户（handler 层用例）。
func newMomentsTestUser(t *testing.T, db *gorm.DB, tag string) *model.User {
	t.Helper()
	phone := fmt.Sprintf("199%08d", time.Now().UnixNano()%100000000)
	user := &model.User{
		ID:           uuid.New(),
		Phone:        &phone,
		PasswordHash: "x",
		ShortID:      time.Now().UnixNano()%1_000_000_000 + int64(len(tag)),
		Nickname:     tag,
		Status:       model.UserStatusNormal,
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatalf("create test user: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM contacts WHERE user_id = ? OR contact_user_id = ?`, user.ID, user.ID)
		db.Unscoped().Delete(user)
	})
	time.Sleep(time.Nanosecond)
	return user
}

// momentsRouterState 记录「当前登录用户」，用例内可切换身份。
var momentsRouterState struct {
	current uuid.UUID
}

// newMomentsEngine 挂载朋友圈端点到独立 gin 引擎（注册顺序与 router.go 一致），
// 以中间件模拟 AuthRequired 注入 user_id。
func newMomentsEngine(svc *service.MomentsService) *gin.Engine {
	h := NewMomentsHandler(svc, zap.NewNop())
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", momentsRouterState.current)
		c.Next()
	})
	g := r.Group("/api/v1/moments")
	g.GET("/feed", h.Feed)
	g.GET("/activities", h.Activities)
	g.POST("/activities/read", h.MarkRead)
	g.DELETE("/comments/:id", h.DeleteComment)
	g.GET("/user/:id", h.UserPosts)
	g.POST("", h.Create)
	g.GET("/:id", h.Get)
	g.DELETE("/:id", h.Delete)
	g.POST("/:id/like", h.Like)
	g.DELETE("/:id/like", h.Unlike)
	g.POST("/:id/comments", h.AddComment)
	return r
}

// doMomentsJSON 发一个 JSON 请求并解出响应体。
func doMomentsJSON(t *testing.T, r *gin.Engine, method, target string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var resp map[string]any
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response %q: %v", w.Body.String(), err)
		}
	}
	return w, resp
}

// TestMomentsGet_StrangerIs404 非好友取帖必须 404 而非 403，且 body 里不得出现任何帖子字段。
//
// 若不可见回 403 而不存在回 404，攻击者能靠状态码差异逐个 UUID 探测帖子是否存在。
func TestMomentsGet_StrangerIs404(t *testing.T) {
	db := momentsTestDB(t)
	repo := repository.NewMomentsRepository(db)
	svc := service.NewMomentsService(repo, repository.NewUserRepository(db), nil, zap.NewNop())
	ctx := context.Background()

	author := newMomentsTestUser(t, db, "m404author")
	stranger := newMomentsTestUser(t, db, "m404stranger")
	post := &model.MomentPost{UserID: author.ID, Content: "秘密内容", Visibility: model.MomentVisibilityFriends}
	if err := repo.CreatePost(ctx, post); err != nil {
		t.Fatalf("create post: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(post) })

	eng := newMomentsEngine(svc)

	// 作者本人取得到
	momentsRouterState.current = author.ID
	if w, resp := doMomentsJSON(t, eng, http.MethodGet, "/api/v1/moments/"+post.ID.String(), nil); w.Code != http.StatusOK {
		t.Fatalf("作者取自己的帖子应 200，got %d %v", w.Code, resp)
	}

	// 非好友取不到：状态码与 body 都不得泄漏任何东西
	momentsRouterState.current = stranger.ID
	w, resp := doMomentsJSON(t, eng, http.MethodGet, "/api/v1/moments/"+post.ID.String(), nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("非好友取帖应 404，got %d %v", w.Code, resp)
	}
	if _, ok := resp["data"]; ok {
		t.Fatalf("404 响应仍带 data 字段，可能泄漏帖子内容: %v", resp)
	}
	if body := w.Body.String(); strings.Contains(body, "秘密内容") || strings.Contains(body, post.ID.String()) || strings.Contains(body, author.ID.String()) {
		t.Fatalf("404 响应体泄漏了帖子信息: %s", body)
	}
}

// TestMomentsFeedRouteNotShadowedByID 静态段 /moments/feed 不得被 /moments/:id 吞掉。
//
// 顺序写反时 gin 会把 "feed" 当 :id 解析 UUID，客户端拿到 400 而不是 feed。
func TestMomentsFeedRouteNotShadowedByID(t *testing.T) {
	db := momentsTestDB(t)
	svc := service.NewMomentsService(repository.NewMomentsRepository(db), repository.NewUserRepository(db), nil, zap.NewNop())
	viewer := newMomentsTestUser(t, db, "feedroute")
	momentsRouterState.current = viewer.ID

	w, resp := doMomentsJSON(t, newMomentsEngine(svc), http.MethodGet, "/api/v1/moments/feed", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("/moments/feed 应 200，got %d %v（静态段可能被 :id 吞掉）", w.Code, resp)
	}
	if _, ok := resp["data"]; !ok {
		t.Fatalf("feed 响应缺 data: %v", resp)
	}
}
