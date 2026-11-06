package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/repository"
	"github.com/yuanchat/server/internal/service"
	"go.uber.org/zap"
)

// newAdminReleaseRouter 挂好 fake 鉴权的管理端版本分发路由。
//
// actor 必须是真实存在的用户：写操作会落 admin_action_logs.actor_id 外键，
// 假 uuid 会在夹具事务里触发外键违规并中止整个事务。
func newAdminReleaseRouter(t *testing.T, db *gorm.DB) (*gin.Engine, uuid.UUID) {
	t.Helper()
	actor := newPackTestUser(t, db, "admin发版员")
	adminSvc := service.NewAdminService(
		repository.NewAdminRepository(db),
		repository.NewConversationRepository(db),
		repository.NewUserRepository(db),
		repository.NewFlaggedUGCRepository(db),
		zap.NewNop(),
	)
	adminSvc.SetReleaseRepo(repository.NewReleaseRepository(db))
	h := NewAdminHandler(adminSvc, nil, nil, nil, zap.NewNop())
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", actor.ID)
		c.Next()
	})
	registerAdminReleaseRoutes(r.Group("/api/v1/admin"), h)
	// 对外端点挂同一个引擎上：发布 / 回滚之后要能立刻验证下发口径变了
	relSvc := service.NewReleaseService(repository.NewReleaseRepository(db), zap.NewNop())
	updateH := NewUpdateHandler(relSvc, &stubPresigner{url: "https://cdn.example/app"}, zap.NewNop())
	r.GET("/api/v1/updates/:platform/:arch", updateH.Check)
	return r, actor.ID
}

func countAuditLogs(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var n int64
	if err := db.Model(&model.AdminActionLog{}).Count(&n).Error; err != nil {
		t.Fatalf("count audit logs: %v", err)
	}
	return n
}

func statusOf(t *testing.T, db *gorm.DB, id string) string {
	t.Helper()
	var rel model.AppRelease
	if err := db.First(&rel, "id = ?", id).Error; err != nil {
		t.Fatalf("load release %s: %v", id, err)
	}
	return rel.Status
}

// createDraft 经 HTTP 登记一条 draft，返回其 id。
func createDraft(t *testing.T, r *gin.Engine, db *gorm.DB, platform, arch, version string) string {
	t.Helper()
	w, resp := doPackJSON(t, r, "POST", "/api/v1/admin/releases", map[string]any{
		"platform": platform, "arch": arch, "version": version, "channel": "stable",
		"object_key": "releases/" + platform + "-" + arch + "-" + version,
		"signature":  "sig", "rollout": 100,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("create draft status = %d resp=%v", w.Code, resp)
	}
	data, _ := resp["data"].(map[string]any)
	id, _ := data["id"].(string)
	if id == "" {
		t.Fatalf("创建响应里没有 id: %v", resp)
	}
	t.Cleanup(func() { db.Exec(`DELETE FROM app_releases WHERE id = ?`, id) })
	return id
}

// TestAdminReleases_CreateWritesAuditLog 写操作必须留审计日志。
//
// 版本分发能把任意字节推给全部客户端，它的权限面比封号还大，
// 没有留痕就查不出「谁在什么时候把哪一版推了出去」。
func TestAdminReleases_CreateWritesAuditLog(t *testing.T) {
	db := packTestDB(t)
	r, _ := newAdminReleaseRouter(t, db)

	before := countAuditLogs(t, db)
	createDraft(t, r, db, "linux", "x86_64", "0.8.0")
	if got := countAuditLogs(t, db); got != before+1 {
		t.Fatalf("审计日志条数 %d → %d，期望 +1", before, got)
	}
}

// TestAdminReleases_PublishThenRollback 回滚就是改一个 status，
// 改完对外端点立刻停止下发 —— 这是坏版本唯一的收敛手段。
func TestAdminReleases_PublishThenRollback(t *testing.T) {
	db := packTestDB(t)
	r, _ := newAdminReleaseRouter(t, db)
	id := createDraft(t, r, db, "linux", "x86_64", "0.8.0")

	// draft 态不下发
	if w := doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1"); w.Code != http.StatusNoContent {
		t.Fatalf("draft 态下发了: status = %d body=%s", w.Code, w.Body.String())
	}

	if w, resp := doPackJSON(t, r, "POST", "/api/v1/admin/releases/"+id+"/publish", nil); w.Code != http.StatusOK {
		t.Fatalf("publish status = %d resp=%v", w.Code, resp)
	}
	if got := statusOf(t, db, id); got != model.ReleaseStatusPublished {
		t.Fatalf("status = %q, want published", got)
	}
	if w := doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1"); w.Code != http.StatusOK {
		t.Fatalf("发布后对外端点应能查到: status = %d body=%s", w.Code, w.Body.String())
	}

	if w, resp := doPackJSON(t, r, "POST", "/api/v1/admin/releases/"+id+"/rollback", nil); w.Code != http.StatusOK {
		t.Fatalf("rollback status = %d resp=%v", w.Code, resp)
	}
	if got := statusOf(t, db, id); got != model.ReleaseStatusRolledBack {
		t.Fatalf("status = %q, want rolled_back", got)
	}
	if w := doGetNoAuth(t, r, "/api/v1/updates/linux/x86_64?version=0.7.0&device=d1"); w.Code != http.StatusNoContent {
		t.Fatalf("回滚后必须立刻停止下发: status = %d body=%s", w.Code, w.Body.String())
	}
}

// TestAdminReleases_RolloutOutOfRange400 灰度比例越界必须 400。
func TestAdminReleases_RolloutOutOfRange400(t *testing.T) {
	db := packTestDB(t)
	r, _ := newAdminReleaseRouter(t, db)

	for i, bad := range []int{-1, 101} {
		w, resp := doPackJSON(t, r, "POST", "/api/v1/admin/releases", map[string]any{
			"platform": "linux", "arch": "x86_64",
			"version": "0.9." + string(rune('0'+i)), "channel": "stable",
			"object_key": "k", "rollout": bad,
		})
		if w.Code != http.StatusBadRequest {
			t.Errorf("rollout=%d status = %d, want 400, resp=%v", bad, w.Code, resp)
		}
	}
}

// TestAdminReleases_InvalidVersions400 版本和最低版本必须可解析，拒绝时不写版本或审计记录。
func TestAdminReleases_InvalidVersions400(t *testing.T) {
	db := packTestDB(t)
	r, _ := newAdminReleaseRouter(t, db)
	before := countAuditLogs(t, db)
	for _, tc := range []struct{ version, minimum string }{
		{"not-semver", ""},
		{"1.2.3-01", ""},
		{"1.2.3", "later"},
		{"1.2.4", "1.2.3-01"},
	} {
		w, resp := doPackJSON(t, r, "POST", "/api/v1/admin/releases", map[string]any{
			"platform": "linux", "arch": "x86_64", "version": tc.version,
			"min_version": tc.minimum, "object_key": "releases/test", "rollout": 100,
		})
		if w.Code != http.StatusBadRequest {
			t.Errorf("version=%q min_version=%q status=%d，期望400，resp=%v", tc.version, tc.minimum, w.Code, resp)
		}
	}
	var count int64
	if err := db.Model(&model.AppRelease{}).Count(&count).Error; err != nil || count != 0 {
		t.Errorf("非法版本不应落库: count=%d err=%v", count, err)
	}
	if countAuditLogs(t, db) != before {
		t.Error("拒绝非法版本时不应写审计记录")
	}
}

// TestAdminReleases_VersionCompatibility 保留短版本、v 前缀及标准预发布和构建元数据。
func TestAdminReleases_VersionCompatibility(t *testing.T) {
	db := packTestDB(t)
	r, _ := newAdminReleaseRouter(t, db)
	for _, version := range []string{"1", "v1.2", "1.2.3-rc.2+build.7"} {
		w, resp := doPackJSON(t, r, "POST", "/api/v1/admin/releases", map[string]any{
			"platform": "linux", "arch": "x86_64", "version": version,
			"min_version": "v0.8", "object_key": "releases/test", "rollout": 100,
		})
		if w.Code != http.StatusOK {
			t.Fatalf("兼容版本%q不应被拒绝: status=%d resp=%v", version, w.Code, resp)
		}
		data, _ := resp["data"].(map[string]any)
		if data["version"] != version || data["min_version"] != "v0.8" {
			t.Fatalf("版本身份不应被改写: resp=%v", resp)
		}
	}
}

// TestAdminReleases_DuplicateVersion409 重复登记同一版是运营误操作，
// 要挡住而非产出两条互相覆盖的记录。
func TestAdminReleases_DuplicateVersion409(t *testing.T) {
	db := packTestDB(t)
	r, _ := newAdminReleaseRouter(t, db)
	createDraft(t, r, db, "linux", "x86_64", "0.8.0")

	w, resp := doPackJSON(t, r, "POST", "/api/v1/admin/releases", map[string]any{
		"platform": "linux", "arch": "x86_64", "version": "0.8.0", "channel": "stable",
		"object_key": "k", "rollout": 100,
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409, resp=%v", w.Code, resp)
	}
}

// TestAdminReleases_PatchOnlyMutableFields 只放行灰度/强制/说明三项。
//
// 平台/架构/版本号/对象键是身份，改它们等于换一条记录，
// 该走「新建 + 回滚旧的」而不是原地改 —— 原地改会让已经收到旧 URL 的客户端
// 和新客户端拿到互相矛盾的同一版本号。
func TestAdminReleases_PatchOnlyMutableFields(t *testing.T) {
	db := packTestDB(t)
	r, _ := newAdminReleaseRouter(t, db)
	id := createDraft(t, r, db, "linux", "x86_64", "0.8.0")

	w, resp := doPackJSON(t, r, "PATCH", "/api/v1/admin/releases/"+id, map[string]any{
		"rollout": 30, "mandatory": true, "notes": "改过的说明",
		// 以下两项必须被忽略
		"version":    "9.9.9",
		"object_key": "releases/evil",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("patch status = %d resp=%v", w.Code, resp)
	}

	var rel model.AppRelease
	if err := db.First(&rel, "id = ?", id).Error; err != nil {
		t.Fatalf("load release: %v", err)
	}
	if rel.Rollout != 30 || !rel.Mandatory || rel.Notes != "改过的说明" {
		t.Fatalf("可改字段未生效: rollout=%d mandatory=%v notes=%q", rel.Rollout, rel.Mandatory, rel.Notes)
	}
	if rel.Version != "0.8.0" {
		t.Fatalf("version 被改成了 %q —— 版本号是身份，不得原地改", rel.Version)
	}
	if rel.ObjectKey == "releases/evil" {
		t.Fatal("object_key 被改掉了 —— 对象键是身份，不得原地改")
	}
}

// TestAdminReleases_ListFilters 列表按平台/渠道/状态筛选。
func TestAdminReleases_ListFilters(t *testing.T) {
	db := packTestDB(t)
	r, _ := newAdminReleaseRouter(t, db)
	createDraft(t, r, db, "linux", "x86_64", "0.8.0")
	createDraft(t, r, db, "windows", "x86_64", "0.8.0")

	w, resp := doPackJSON(t, r, "GET", "/api/v1/admin/releases?platform=linux", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("list status = %d resp=%v", w.Code, resp)
	}
	raw, err := json.Marshal(resp["data"])
	if err != nil {
		t.Fatalf("marshal data: %v", err)
	}
	var rows []model.AppRelease
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(rows) == 0 {
		t.Fatal("按 platform=linux 筛选结果为空")
	}
	for _, row := range rows {
		if row.Platform != "linux" {
			t.Fatalf("筛选未生效，混进了 %s", row.Platform)
		}
	}
}

// TestAdminReleases_PublishUnknownID404 不存在的 id 必须 404 而非静默成功。
func TestAdminReleases_PublishUnknownID404(t *testing.T) {
	db := packTestDB(t)
	r, _ := newAdminReleaseRouter(t, db)

	w, resp := doPackJSON(t, r, "POST",
		"/api/v1/admin/releases/"+uuid.NewString()+"/publish", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, resp=%v", w.Code, resp)
	}
}
