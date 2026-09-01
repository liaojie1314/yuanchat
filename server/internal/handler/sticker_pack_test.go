package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

// packTestDB 连接本地开发库（deploy/docker-compose.yml 的 postgres :5434）。
// 数据库不可达时跳过集成用例（CI 无 DB 环境仍绿）。
func packTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := "host=localhost port=5434 user=yuanchat password=yuanchat_dev dbname=yuanchat sslmode=disable"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:                 gormlogger.Default.LogMode(gormlogger.Silent),
		NamingStrategy:         schema.NamingStrategy{SingularTable: true},
		SkipDefaultTransaction: true,
	})
	if err != nil {
		t.Skipf("dev postgres unavailable, skip integration test: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil || sqlDB.Ping() != nil {
		t.Skip("dev postgres unavailable, skip integration test")
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.StickerPack{}, &model.Sticker{}, &model.UserStickerPack{}); err != nil {
		t.Fatalf("migrate sticker tables: %v", err)
	}
	return db
}

// newPackTestUser 建一次性用户（handler 层用例）。
func newPackTestUser(t *testing.T, db *gorm.DB, tag string) *model.User {
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
		db.Exec(`DELETE FROM user_sticker_packs WHERE user_id = ? OR pack_id IN
			(SELECT id FROM sticker_packs WHERE owner_id = ?)`, user.ID, user.ID)
		db.Unscoped().Delete(user)
	})
	time.Sleep(time.Nanosecond)
	return user
}

// packRouterState 记录"当前登录用户"，用例内可切换身份。
var packRouterState struct {
	current uuid.UUID
}

// newPackEngine 挂载表情包端点到独立 gin 引擎（路由注册顺序与 router.go 一致），
// 以中间件模拟 AuthRequired 注入 user_id。
func newPackEngine(svc *service.StickerService) *gin.Engine {
	h := NewStickerHandler(svc, zap.NewNop())
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", packRouterState.current)
		c.Next()
	})
	g := r.Group("/api/v1")
	g.GET("/sticker-packs", h.ListPacks)
	g.GET("/sticker-packs/market", h.Market)
	g.GET("/sticker-packs/:id", h.PackDetail)
	g.POST("/sticker-packs/:id/add", h.AddPack)
	g.DELETE("/sticker-packs/:id/add", h.RemovePack)
	return r
}

func doPackJSON(t *testing.T, r *gin.Engine, method, target string, body any) (*httptest.ResponseRecorder, map[string]any) {
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

// packData 取出统一响应里的 data 对象。
func packData(t *testing.T, resp map[string]any) map[string]any {
	t.Helper()
	data, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatalf("response has no data object: %v", resp)
	}
	return data
}

// seedPackRow 建一次性表情包（handler 层用例）。
func seedPackRow(t *testing.T, db *gorm.DB, mutate func(*model.StickerPack)) *model.StickerPack {
	t.Helper()
	pack := &model.StickerPack{Name: fmt.Sprintf("h包-%s", uuid.NewString()[:8])}
	if mutate != nil {
		mutate(pack)
	}
	if err := db.Create(pack).Error; err != nil {
		t.Fatalf("create pack: %v", err)
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM user_sticker_packs WHERE pack_id = ?`, pack.ID)
		db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, pack.ID)
		db.Unscoped().Delete(pack)
	})
	return pack
}

// TestMarketEndpoint 商城端点：列表项字段齐全、added 正确、next_cursor 终止时为 null。
func TestMarketEndpoint(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngine(svc)
	ctx := context.Background()

	alice := newPackTestUser(t, db, "mk端点")
	owner := newPackTestUser(t, db, "mk端点主")
	base := time.Now().Add(-time.Hour)
	p1 := seedPackRow(t, db, func(p *model.StickerPack) {
		p.OwnerID = &owner.ID
		p.IsPublic = true
		p.CreatedAt = base
	})
	if err := svc.AddPack(ctx, alice.ID, p1.ID); err != nil {
		t.Fatalf("add: %v", err)
	}

	packRouterState.current = alice.ID
	w, resp := doPackJSON(t, r, http.MethodGet, "/api/v1/sticker-packs/market?limit=50", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%v", w.Code, resp)
	}
	data := packData(t, resp)
	raw, err := json.Marshal(data["packs"])
	if err != nil {
		t.Fatalf("marshal packs: %v", err)
	}
	var packs []struct {
		ID           uuid.UUID `json:"id"`
		Name         string    `json:"name"`
		CoverURL     *string   `json:"cover_url"`
		OwnerName    *string   `json:"owner_name"`
		IsOfficial   bool      `json:"is_official"`
		StickerCount int64     `json:"sticker_count"`
		Added        bool      `json:"added"`
		CreatedAt    string    `json:"created_at"`
	}
	if err := json.Unmarshal(raw, &packs); err != nil {
		t.Fatalf("unmarshal packs: %v", err)
	}
	var found bool
	for _, p := range packs {
		if p.ID != p1.ID {
			continue
		}
		found = true
		if !p.Added {
			t.Fatal("added should be true for the pack alice added")
		}
		if p.IsOfficial || p.OwnerName == nil || *p.OwnerName != owner.Nickname {
			t.Fatalf("list item fields wrong: %+v", p)
		}
		if p.CreatedAt == "" {
			t.Fatal("created_at must be present (contract field)")
		}
	}
	if !found {
		t.Fatalf("pack %s missing from market response (%d packs)", p1.ID, len(packs))
	}
	// 端点按 limit（默认 20）分页：仅当窗口未满时才断言 next_cursor 为 null
	// （-race 下其他包的用例会并行写入同一开发库，可能把窗口填满）
	if _, ok := data["next_cursor"]; !ok {
		t.Fatal("next_cursor key must always be present (null when no more pages)")
	}
	if len(packs) < 50 && data["next_cursor"] != nil {
		t.Fatalf("next_cursor should be null when fewer than one page, got %v", data["next_cursor"])
	}
}

// TestMarketEndpointInvalidCursor 非法游标 → 400。
func TestMarketEndpointInvalidCursor(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngine(svc)
	packRouterState.current = uuid.New()
	w, _ := doPackJSON(t, r, http.MethodGet, "/api/v1/sticker-packs/market?cursor=not-a-time", nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

// TestPackDetailEndpoint 详情端点：契约字段（pack.is_owner / owner_name / stickers / added）。
func TestPackDetailEndpoint(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngine(svc)

	owner := newPackTestUser(t, db, "详情端点主")
	pack := seedPackRow(t, db, func(p *model.StickerPack) { p.OwnerID = &owner.ID; p.IsPublic = true })
	packID := pack.ID
	st := model.Sticker{
		PackID:      &packID,
		ObjectKey:   "images/2026/08/detail.png",
		Width:       96,
		Height:      96,
		ContentHash: fmt.Sprintf("%064x", time.Now().UnixNano()),
	}
	if err := db.Create(&st).Error; err != nil {
		t.Fatalf("create sticker: %v", err)
	}
	t.Cleanup(func() { db.Unscoped().Delete(&st) })

	packRouterState.current = owner.ID
	w, resp := doPackJSON(t, r, http.MethodGet, "/api/v1/sticker-packs/"+pack.ID.String(), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%v", w.Code, resp)
	}
	detail := packData(t, resp)
	pk, ok := detail["pack"].(map[string]any)
	if !ok {
		t.Fatalf("detail.pack missing: %v", detail)
	}
	if pk["is_owner"] != true || pk["owner_name"] != owner.Nickname {
		t.Fatalf("pack fields wrong: %v", pk)
	}
	if _, ok := pk["flagged"]; !ok {
		t.Fatal("pack.flagged must be present (contract field)")
	}
	if _, ok := pk["taken_down"]; ok {
		t.Fatal("pack.taken_down must not be exposed to normal users (contract)")
	}
	stickers, ok := detail["stickers"].([]any)
	if !ok || len(stickers) != 1 {
		t.Fatalf("stickers should have 1 item, got %v", detail["stickers"])
	}
	if s0 := stickers[0].(map[string]any); s0["object_key"] != "images/2026/08/detail.png" {
		t.Fatalf("sticker item fields wrong: %v", s0)
	}
	if detail["added"] != false {
		t.Fatalf("added should be false, got %v", detail["added"])
	}

	// 不存在 → 404
	w, _ = doPackJSON(t, r, http.MethodGet, "/api/v1/sticker-packs/"+uuid.New().String(), nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("missing pack status = %d, want 404", w.Code)
	}
	// 非法 id → 400
	w, _ = doPackJSON(t, r, http.MethodGet, "/api/v1/sticker-packs/not-a-uuid", nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad id status = %d, want 400", w.Code)
	}
}

// TestAddRemovePackEndpoint 添加/移除端点：幂等、下架包 404、移除后 added 翻转。
func TestAddRemovePackEndpoint(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngine(svc)

	alice := newPackTestUser(t, db, "添加端点")
	pack := seedPackRow(t, db, func(p *model.StickerPack) { p.IsPublic = true })
	downed := seedPackRow(t, db, func(p *model.StickerPack) { p.IsPublic = true; p.TakenDown = true })

	packRouterState.current = alice.ID
	// 重复添加均 200（幂等）
	for i := 0; i < 2; i++ {
		w, resp := doPackJSON(t, r, http.MethodPost, "/api/v1/sticker-packs/"+pack.ID.String()+"/add", nil)
		if w.Code != http.StatusOK || packData(t, resp)["message"] != "added" {
			t.Fatalf("add round %d: status=%d resp=%v", i, w.Code, resp)
		}
	}
	// 下架包不可添加
	w, _ := doPackJSON(t, r, http.MethodPost, "/api/v1/sticker-packs/"+downed.ID.String()+"/add", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("downed pack add status = %d, want 404", w.Code)
	}

	// GET /sticker-packs（语义扩展：官方 + 已添加）里能看到刚添加的包
	w, resp := doPackJSON(t, r, http.MethodGet, "/api/v1/sticker-packs", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list status = %d", w.Code)
	}
	raw, _ := json.Marshal(packData(t, resp)["packs"])
	var list []struct {
		Pack struct {
			ID uuid.UUID `json:"id"`
		} `json:"pack"`
		Stickers []any `json:"stickers"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	seen := false
	for _, pd := range list {
		if pd.Pack.ID == pack.ID {
			seen = true
			if pd.Stickers == nil {
				t.Fatal("stickers must be an array (contract: {pack, stickers})")
			}
		}
	}
	if !seen {
		t.Fatalf("added pack %s should appear in GET /sticker-packs", pack.ID)
	}

	// 移除（含重复移除幂等）后从列表消失
	for i := 0; i < 2; i++ {
		w, resp := doPackJSON(t, r, http.MethodDelete, "/api/v1/sticker-packs/"+pack.ID.String()+"/add", nil)
		if w.Code != http.StatusOK || packData(t, resp)["message"] != "removed" {
			t.Fatalf("remove round %d: status=%d resp=%v", i, w.Code, resp)
		}
	}
	added, err := svc.PackDetail(context.Background(), alice.ID, pack.ID)
	if err != nil {
		t.Fatalf("detail after remove: %v", err)
	}
	if added.Added {
		t.Fatal("pack should no longer be added after DELETE")
	}
}

// ---------- 自主发布与编辑管理端点 ----------

// newPackEngineFull 全量路由引擎（含发布/管理端点，注册顺序与 router.go 一致），
// 注入确定性的 publicURL 便于断言封面 URL。
func newPackEngineFull(svc *service.StickerService) *gin.Engine {
	svc.SetPublicURL(func(k string) string { return "http://minio:9000/yuanchat/" + k })
	h := NewStickerHandler(svc, zap.NewNop())
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", packRouterState.current)
		c.Next()
	})
	g := r.Group("/api/v1")
	g.GET("/sticker-packs", h.ListPacks)
	g.GET("/sticker-packs/market", h.Market)
	g.GET("/sticker-packs/mine", h.ListMyPacks)
	g.POST("/sticker-packs", h.Publish)
	g.GET("/sticker-packs/:id", h.PackDetail)
	g.PATCH("/sticker-packs/:id", h.UpdatePack)
	g.DELETE("/sticker-packs/:id", h.DeleteMinePack)
	g.POST("/sticker-packs/:id/add", h.AddPack)
	g.DELETE("/sticker-packs/:id/add", h.RemovePack)
	g.POST("/sticker-packs/:id/stickers", h.AddPackSticker)
	g.DELETE("/sticker-packs/:id/stickers/:stickerId", h.RemovePackSticker)
	return r
}

// TestPublishEndpoint 发布端点：upload 来源 + sticker-covers 封面 → 详情响应；
// 包名/来源校验失败 → 400。
func TestPublishEndpoint(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngineFull(svc)

	alice := newPackTestUser(t, db, "发布端点")
	packRouterState.current = alice.ID
	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"
	body := gin.H{
		"name":              "端点发布包",
		"cover_object_key":  "sticker-covers/2026/08/cafebabe.png",
		"cover_width":       300,
		"cover_height":      300,
		"sticker_sources": []gin.H{
			{"source": "upload", "object_key": "images/2026/08/abcd1234.png", "width": 96, "height": 96, "content_hash": hash},
		},
	}
	w, resp := doPackJSON(t, r, http.MethodPost, "/api/v1/sticker-packs", body)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%v", w.Code, resp)
	}
	detail := packData(t, resp)
	pk := detail["pack"].(map[string]any)
	if pk["name"] != "端点发布包" || pk["is_owner"] != true || pk["is_official"] != false {
		t.Fatalf("published pack fields wrong: %v", pk)
	}
	if pk["cover_url"] != "http://minio:9000/yuanchat/sticker-covers/2026/08/cafebabe.png" {
		t.Fatalf("cover_url should be public URL, got %v", pk["cover_url"])
	}
	if detail["added"] != false {
		t.Fatalf("publish response added should be false, got %v", detail["added"])
	}
	if len(detail["stickers"].([]any)) != 1 {
		t.Fatalf("want 1 sticker, got %v", detail["stickers"])
	}
	packID := pk["id"].(string)

	// 包名缺失 / 来源为空 → 400
	w, _ = doPackJSON(t, r, http.MethodPost, "/api/v1/sticker-packs", gin.H{
		"name": "没有贴纸的包", "sticker_sources": []gin.H{},
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty sources status = %d, want 400", w.Code)
	}
	w, _ = doPackJSON(t, r, http.MethodPost, "/api/v1/sticker-packs", gin.H{
		"name": "错误来源", "sticker_sources": []gin.H{{"source": "steal"}},
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad source status = %d, want 400", w.Code)
	}

	// 发布成功后包真实入库且公开
	var count int64
	db.Model(&model.StickerPack{}).Where("id = ? AND is_public = TRUE AND owner_id = ?", packID, alice.ID).Count(&count)
	if count != 1 {
		t.Fatal("published pack should be public and owned in DB")
	}
	t.Cleanup(func() {
		db.Exec(`DELETE FROM stickers WHERE pack_id = ?`, packID)
		db.Unscoped().Delete(&model.StickerPack{}, "id = ?", packID)
	})
}

// TestPublishEndpointLimit 达发布上限（20）后 → 400 + 独立业务码 4003
// （前端按 code 识别专属文案，不能依赖 message 字符串）。
func TestPublishEndpointLimit(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngineFull(svc)

	alice := newPackTestUser(t, db, "发布满仓")
	rows := make([]model.StickerPack, 0, 20)
	for i := 0; i < 20; i++ {
		owner := alice.ID
		rows = append(rows, model.StickerPack{Name: fmt.Sprintf("满仓-%d-%s", i, uuid.NewString()[:8]), OwnerID: &owner, IsPublic: true})
	}
	if err := db.CreateInBatches(rows, 50).Error; err != nil {
		t.Fatalf("seed packs: %v", err)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM sticker_packs WHERE owner_id = ?`, alice.ID) })

	packRouterState.current = alice.ID
	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"
	w, resp := doPackJSON(t, r, http.MethodPost, "/api/v1/sticker-packs", gin.H{
		"name": "超限包",
		"sticker_sources": []gin.H{
			{"source": "upload", "object_key": "images/2026/08/abcd1234.png", "width": 96, "height": 96, "content_hash": hash},
		},
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("over limit status = %d, want 400", w.Code)
	}
	if code, _ := resp["code"].(float64); code != 4003 {
		t.Fatalf("over limit code = %v, want 4003", resp["code"])
	}
}

// TestUpdatePackEndpoint 编辑端点：本人 200、他人 403、不存在 404。
func TestUpdatePackEndpoint(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngineFull(svc)

	owner := newPackTestUser(t, db, "编辑端点主")
	stranger := newPackTestUser(t, db, "编辑端点客")
	pack := seedPackRow(t, db, func(p *model.StickerPack) { p.OwnerID = &owner.ID; p.IsPublic = true })

	packRouterState.current = stranger.ID
	w, _ := doPackJSON(t, r, http.MethodPatch, "/api/v1/sticker-packs/"+pack.ID.String(), gin.H{"name": "抢改"})
	if w.Code != http.StatusForbidden {
		t.Fatalf("stranger patch status = %d, want 403", w.Code)
	}

	packRouterState.current = owner.ID
	w, resp := doPackJSON(t, r, http.MethodPatch, "/api/v1/sticker-packs/"+pack.ID.String(), gin.H{"name": "端点改名"})
	if w.Code != http.StatusOK {
		t.Fatalf("owner patch status = %d body=%v", w.Code, resp)
	}
	if pk := packData(t, resp)["pack"].(map[string]any); pk["name"] != "端点改名" {
		t.Fatalf("rename not reflected: %v", pk)
	}

	w, _ = doPackJSON(t, r, http.MethodPatch, "/api/v1/sticker-packs/"+uuid.New().String(), gin.H{"name": "无"})
	if w.Code != http.StatusNotFound {
		t.Fatalf("missing pack patch status = %d, want 404", w.Code)
	}
}

// TestMyPacksEndpoint 我发布的端点：is_owner 恒 true。
func TestMyPacksEndpoint(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngineFull(svc)

	owner := newPackTestUser(t, db, "我的发布端点")
	seedPackRow(t, db, func(p *model.StickerPack) { p.OwnerID = &owner.ID; p.IsPublic = true })

	packRouterState.current = owner.ID
	w, resp := doPackJSON(t, r, http.MethodGet, "/api/v1/sticker-packs/mine", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	raw, _ := json.Marshal(packData(t, resp)["packs"])
	var packs []map[string]any
	if err := json.Unmarshal(raw, &packs); err != nil {
		t.Fatalf("unmarshal packs: %v", err)
	}
	found := false
	for _, p := range packs {
		if p["name"] != nil && len(packs) > 0 {
			if isOwner, ok := p["is_owner"].(bool); ok && isOwner {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("mine list should contain an is_owner=true pack, got %v", packs)
	}
}

// TestDeleteMineEndpoint 删除端点：本人 200 且包消失、他人 403、不存在 404。
func TestDeleteMineEndpoint(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngineFull(svc)

	owner := newPackTestUser(t, db, "删除端点主")
	stranger := newPackTestUser(t, db, "删除端点客")
	pack := seedPackRow(t, db, func(p *model.StickerPack) { p.OwnerID = &owner.ID; p.IsPublic = true })

	packRouterState.current = stranger.ID
	w, _ := doPackJSON(t, r, http.MethodDelete, "/api/v1/sticker-packs/"+pack.ID.String(), nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("stranger delete status = %d, want 403", w.Code)
	}

	packRouterState.current = owner.ID
	w, resp := doPackJSON(t, r, http.MethodDelete, "/api/v1/sticker-packs/"+pack.ID.String(), nil)
	if w.Code != http.StatusOK || packData(t, resp)["message"] != "deleted" {
		t.Fatalf("owner delete: status=%d resp=%v", w.Code, resp)
	}
	var count int64
	db.Model(&model.StickerPack{}).Where("id = ?", pack.ID).Count(&count)
	if count != 0 {
		t.Fatal("pack should be gone")
	}
	w, _ = doPackJSON(t, r, http.MethodDelete, "/api/v1/sticker-packs/"+pack.ID.String(), nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want 404", w.Code)
	}
}

// TestAddRemovePackStickerEndpoint 包内贴纸端点：本人追加/移除 200、他人 403。
func TestAddRemovePackStickerEndpoint(t *testing.T) {
	db := packTestDB(t)
	svc := service.NewStickerService(repository.NewStickerRepository(db), zap.NewNop())
	r := newPackEngineFull(svc)

	owner := newPackTestUser(t, db, "包贴纸端点主")
	stranger := newPackTestUser(t, db, "包贴纸端点客")
	pack := seedPackRow(t, db, func(p *model.StickerPack) { p.OwnerID = &owner.ID; p.IsPublic = true })
	const hash = "5b6642cf4331eb911b475ea8fb19d09cbc073c73b55a10134928984daee7fc41"

	packRouterState.current = stranger.ID
	w, _ := doPackJSON(t, r, http.MethodPost, "/api/v1/sticker-packs/"+pack.ID.String()+"/stickers", gin.H{
		"source": "upload", "object_key": "images/2026/08/abcd1234.png", "width": 96, "height": 96, "content_hash": hash,
	})
	if w.Code != http.StatusForbidden {
		t.Fatalf("stranger add sticker status = %d, want 403", w.Code)
	}

	packRouterState.current = owner.ID
	w, _ = doPackJSON(t, r, http.MethodPost, "/api/v1/sticker-packs/"+pack.ID.String()+"/stickers", gin.H{
		"source": "upload", "object_key": "images/2026/08/abcd1234.png", "width": 96, "height": 96, "content_hash": hash,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("owner add sticker status = %d", w.Code)
	}
	var st model.Sticker
	if err := db.First(&st, "pack_id = ?", pack.ID).Error; err != nil {
		t.Fatalf("sticker should be in pack: %v", err)
	}

	w, _ = doPackJSON(t, r, http.MethodDelete, "/api/v1/sticker-packs/"+pack.ID.String()+"/stickers/"+st.ID.String(), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("owner remove sticker status = %d", w.Code)
	}
	var count int64
	db.Model(&model.Sticker{}).Where("id = ?", st.ID).Count(&count)
	if count != 0 {
		t.Fatal("sticker should be removed")
	}
}
