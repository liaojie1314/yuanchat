package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/service"
	"github.com/yuanchat/server/internal/testutil"
	"go.uber.org/zap"
)

const testTurnSecret = "s3cret-for-test"

// newCallRouter 装一个只挂通话两个端点的路由。
// asUser 非零时模拟已登录（直接往 gin.Context 里塞 user_id，跳过 JWT 中间件）。
func newCallRouter(t *testing.T, enabled bool, asUser uuid.UUID) (*gin.Engine, *service.CallService) {
	t.Helper()
	rdb, _ := testutil.NewRedis(t)
	svc := service.NewCallService(rdb, config.TurnConfig{
		Enabled: enabled, Host: "turn.test", Port: 3478,
		Realm: "yuanchat", StaticAuthSecret: testTurnSecret, CredentialTTL: time.Hour,
	}, zap.NewNop())
	h := NewCallHandler(svc, nil, zap.NewNop())

	r := gin.New()
	r.Use(func(c *gin.Context) {
		if asUser != uuid.Nil {
			c.Set("user_id", asUser)
		}
		c.Next()
	})
	r.GET("/calls/ice-servers", h.GetICEServers)
	r.GET("/calls/:call_id", h.GetCall)
	return r, svc
}

func doGet(r *gin.Engine, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

// TestICEServersRequiresAuth 未登录拿不到 TURN 凭据 —— 凭据就是中继配额，
// 匿名可取等于把带宽敞开给任何人。
func TestICEServersRequiresAuth(t *testing.T) {
	r, _ := newCallRouter(t, true, uuid.Nil)
	if w := doGet(r, "/calls/ice-servers"); w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

// TestICEServersShape 返回 STUN + TURN 两项，凭据可被 coturn 的口径复算。
func TestICEServersShape(t *testing.T) {
	uid := uuid.New()
	r, _ := newCallRouter(t, true, uid)
	w := doGet(r, "/calls/ice-servers")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Data service.ICEServersDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Data.ICEServers) != 2 {
		t.Fatalf("应有 STUN + TURN 两项，实得 %d", len(resp.Data.ICEServers))
	}
	turn := resp.Data.ICEServers[1]
	parts := strings.SplitN(turn.Username, ":", 2)
	if len(parts) != 2 || parts[1] != uid.String() {
		t.Fatalf("username = %q，期望 <expiry>:%s", turn.Username, uid)
	}
	mac := hmac.New(sha1.New, []byte(testTurnSecret))
	mac.Write([]byte(turn.Username))
	if want := base64.StdEncoding.EncodeToString(mac.Sum(nil)); turn.Credential != want {
		t.Errorf("credential = %q, want %q", turn.Credential, want)
	}
}

// TestICEServersDisabledOnlySTUN 关掉 TURN 时只回 STUN，不下发空凭据 ——
// 空 username/credential 会让客户端以为有中继可用，实际连不上。
func TestICEServersDisabledOnlySTUN(t *testing.T) {
	r, _ := newCallRouter(t, false, uuid.New())
	w := doGet(r, "/calls/ice-servers")

	var resp struct {
		Data service.ICEServersDTO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Data.ICEServers) != 1 {
		t.Fatalf("应只有 STUN 一项，实得 %d", len(resp.Data.ICEServers))
	}
}

// TestGetCallNotFound 房间不存在返回 404，不返回空对象。
func TestGetCallNotFound(t *testing.T) {
	r, _ := newCallRouter(t, true, uuid.New())
	if w := doGet(r, "/calls/"+uuid.New().String()); w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

// TestGetCallRejectsBadID 非 UUID 的 call_id 是 400 而不是 404。
func TestGetCallRejectsBadID(t *testing.T) {
	r, _ := newCallRouter(t, true, uuid.New())
	if w := doGet(r, "/calls/not-a-uuid"); w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

// TestGetCallForbidsNonParticipant 非房间参与者读不到快照。
//
// 快照里含各方的 conn_id，那是信令的定址凭据 —— 泄露出去等于把
// 「往任意参与者连接上塞帧」的门票发给了外人。
func TestGetCallForbidsNonParticipant(t *testing.T) {
	outsider := uuid.New()
	r, svc := newCallRouter(t, true, outsider)
	room, _, err := svc.Create(context.Background(), uuid.New(), "conn-a",
		uuid.New(), service.CallMediaAudio, []uuid.UUID{uuid.New()})
	if err != nil {
		t.Fatal(err)
	}

	if w := doGet(r, "/calls/"+room.CallID.String()); w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", w.Code)
	}
}

// TestGetCallReturnsSnapshotForParticipant 参与者能读到房间快照（桌面通话窗口靠它渲染）。
func TestGetCallReturnsSnapshotForParticipant(t *testing.T) {
	caller := uuid.New()
	r, svc := newCallRouter(t, true, caller)
	room, _, err := svc.Create(context.Background(), caller, "conn-a",
		uuid.New(), service.CallMediaVideo, []uuid.UUID{uuid.New()})
	if err != nil {
		t.Fatal(err)
	}

	w := doGet(r, "/calls/"+room.CallID.String())
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			CallID       uuid.UUID `json:"call_id"`
			Media        string    `json:"media"`
			State        string    `json:"state"`
			Participants []struct {
				UserID uuid.UUID `json:"user_id"`
				State  string    `json:"state"`
			} `json:"participants"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.CallID != room.CallID || resp.Data.Media != "video" || resp.Data.State != "ringing" {
		t.Errorf("快照字段不符: %+v", resp.Data)
	}
	if len(resp.Data.Participants) != 2 {
		t.Errorf("参与者数 = %d, want 2", len(resp.Data.Participants))
	}
}
