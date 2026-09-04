package ws

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/config"
	"github.com/yuanchat/server/internal/model"
	"github.com/yuanchat/server/internal/pkg/jwt"
	"go.uber.org/zap"
)

// decodeErr 从 client.send 取出一帧并断言为 error 帧，返回其 payload。
func decodeErr(t *testing.T, c *Client) ErrorPayload {
	t.Helper()
	select {
	case data := <-c.send:
		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			t.Fatalf("unmarshal envelope: %v", err)
		}
		if env.Type != TypeError {
			t.Fatalf("expected error frame, got %q", env.Type)
		}
		var p ErrorPayload
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			t.Fatalf("unmarshal error payload: %v", err)
		}
		return p
	default:
		t.Fatal("expected an error frame, got none")
		return ErrorPayload{}
	}
}

// assertNoFrame 断言连接缓冲中没有帧（校验通过路径不应回错误帧）。
func assertNoFrame(t *testing.T, c *Client) {
	t.Helper()
	select {
	case data := <-c.send:
		t.Fatalf("expected no frame, got %q", data)
	default:
	}
}

func TestBuildContentTextValid(t *testing.T) {
	c := newTestClient(uuid.Nil)
	p := &SendPayload{Content: ContentPayload{Type: "text", Text: "你好"}, ClientMsgID: "c-1"}

	mt, contentJSON, ok := new(Handler).buildContent(c, p)
	if !ok {
		t.Fatal("valid text should pass")
	}
	if mt != model.MessageTypeText {
		t.Fatalf("message type = %d, want %d", mt, model.MessageTypeText)
	}
	var got model.MessageContentText
	if err := json.Unmarshal([]byte(contentJSON), &got); err != nil {
		t.Fatalf("content not valid json: %v", err)
	}
	if got.Text != "你好" {
		t.Fatalf("text = %q, want 你好", got.Text)
	}
	assertNoFrame(t, c)
}

func TestBuildContentTextEmptyRejected(t *testing.T) {
	c := newTestClient(uuid.Nil)
	_, _, ok := new(Handler).buildContent(c, &SendPayload{Content: ContentPayload{Type: "text", Text: ""}, ClientMsgID: "c-2"})
	if ok {
		t.Fatal("empty text must be rejected")
	}
	e := decodeErr(t, c)
	if e.Code != 400 || e.ClientMsgID != "c-2" {
		t.Fatalf("unexpected error frame: %+v", e)
	}
}

func TestBuildContentImageValid(t *testing.T) {
	c := newTestClient(uuid.Nil)
	p := &SendPayload{
		Content: ContentPayload{
			Type: "image", Key: "images/2026/07/abc.png", Width: 800, Height: 600, Size: 123456,
		},
		ClientMsgID: "c-img",
	}

	mt, contentJSON, ok := new(Handler).buildContent(c, p)
	if !ok {
		t.Fatal("valid image should pass")
	}
	if mt != model.MessageTypeImage {
		t.Fatalf("message type = %d, want %d", mt, model.MessageTypeImage)
	}
	// 落库 JSON 必须往返图片元数据，供前端渲染 + 取下载 URL。
	var got struct {
		Key    string `json:"key"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
		Size   int64  `json:"size"`
	}
	if err := json.Unmarshal([]byte(contentJSON), &got); err != nil {
		t.Fatalf("content not valid json: %v", err)
	}
	if got.Key != "images/2026/07/abc.png" || got.Width != 800 || got.Height != 600 || got.Size != 123456 {
		t.Fatalf("image content did not round-trip: %+v", got)
	}
	assertNoFrame(t, c)
}

func TestBuildContentImageInvalidRejected(t *testing.T) {
	cases := map[string]ContentPayload{
		"missing key":  {Type: "image", Key: "", Width: 1, Height: 1, Size: 1},
		"zero width":   {Type: "image", Key: "images/2026/07/a.png", Width: 0, Height: 1, Size: 1},
		"zero height":  {Type: "image", Key: "images/2026/07/a.png", Width: 1, Height: 0, Size: 1},
		"zero size":    {Type: "image", Key: "images/2026/07/a.png", Width: 1, Height: 1, Size: 0},
		"negative dim": {Type: "image", Key: "images/2026/07/a.png", Width: -5, Height: 1, Size: 1},
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			c := newTestClient(uuid.Nil)
			_, _, ok := new(Handler).buildContent(c, &SendPayload{Content: content, ClientMsgID: "c-bad"})
			if ok {
				t.Fatalf("%s: invalid image must be rejected", name)
			}
			e := decodeErr(t, c)
			if e.Code != 400 || e.ClientMsgID != "c-bad" {
				t.Fatalf("%s: unexpected error frame: %+v", name, e)
			}
		})
	}
}

// TestBuildContentUnsupportedTypeRejected 未支持的 content.type 一律 400。
// 样本用 location（本仓没有该通路）；video 已是受支持类型，见下方 video 用例。
func TestBuildContentUnsupportedTypeRejected(t *testing.T) {
	c := newTestClient(uuid.Nil)
	_, _, ok := new(Handler).buildContent(c, &SendPayload{Content: ContentPayload{Type: "location"}, ClientMsgID: "c-v"})
	if ok {
		t.Fatal("unsupported type must be rejected")
	}
	if e := decodeErr(t, c); e.Code != 400 {
		t.Fatalf("unexpected error frame: %+v", e)
	}
}

// TestBuildContentVideoValid 合法视频帧落库为 MessageTypeVideo，
// 且 content JSON 与 model.MessageContentVideo 同构（thumb_key/时长/宽高往返一致）。
func TestBuildContentVideoValid(t *testing.T) {
	c := newTestClient(uuid.Nil)
	p := &SendPayload{Content: ContentPayload{
		Type: "video", Key: "files/2026/09/v.mp4", ThumbKey: "images/2026/09/t.jpg",
		Name: "v.mp4", Size: 1024, Duration: 12, Width: 1280, Height: 720,
	}, ClientMsgID: "c-video-1"}

	mt, contentJSON, ok := new(Handler).buildContent(c, p)
	if !ok {
		t.Fatalf("valid video should pass, got error frame: %+v", decodeErr(t, c))
	}
	if mt != model.MessageTypeVideo {
		t.Fatalf("expected MessageTypeVideo(%d), got %d", model.MessageTypeVideo, mt)
	}
	var stored model.MessageContentVideo
	if err := json.Unmarshal([]byte(contentJSON), &stored); err != nil {
		t.Fatalf("content is not MessageContentVideo json: %v", err)
	}
	want := model.MessageContentVideo{
		Key: "files/2026/09/v.mp4", ThumbKey: "images/2026/09/t.jpg",
		Name: "v.mp4", Size: 1024, Duration: 12, Width: 1280, Height: 720,
	}
	if stored != want {
		t.Fatalf("video content did not round-trip: got %+v want %+v", stored, want)
	}
	assertNoFrame(t, c)
}

// TestBuildContentVideoInvalid 视频字段校验：缺 thumb_key / 时长为 0 / 超 120s /
// 名称为空 / 名称超 255 字符都必须 400 且不落库。
//
// 时长上限取闭区间上界：120 通过、121 拒绝（spec M2）。
func TestBuildContentVideoInvalid(t *testing.T) {
	cases := map[string]ContentPayload{
		"missing thumb": {Type: "video", Key: "files/k.mp4", Name: "k.mp4", Size: 1, Duration: 3, Width: 1, Height: 1},
		"missing key":   {Type: "video", ThumbKey: "images/t.jpg", Name: "k.mp4", Size: 1, Duration: 3, Width: 1, Height: 1},
		"zero duration": {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Name: "k.mp4", Size: 1, Width: 1, Height: 1},
		"over 120s":     {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Name: "k.mp4", Size: 1, Duration: 121, Width: 1, Height: 1},
		"empty name":    {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Size: 1, Duration: 3, Width: 1, Height: 1},
		"name too long": {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Name: strings.Repeat("视", 256), Size: 1, Duration: 3, Width: 1, Height: 1},
		"zero size":     {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Name: "k.mp4", Duration: 3, Width: 1, Height: 1},
		"zero width":    {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Name: "k.mp4", Size: 1, Duration: 3, Height: 1},
		"zero height":   {Type: "video", Key: "files/k.mp4", ThumbKey: "images/t.jpg", Name: "k.mp4", Size: 1, Duration: 3, Width: 1},
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			c := newTestClient(uuid.Nil)
			p := &SendPayload{Content: content, ClientMsgID: "c-video-bad"}
			if _, _, ok := new(Handler).buildContent(c, p); ok {
				t.Fatalf("%s: expected rejection", name)
			}
			e := decodeErr(t, c)
			if e.Code != 400 || e.ClientMsgID != "c-video-bad" {
				t.Fatalf("%s: unexpected error frame: %+v", name, e)
			}
		})
	}
}

// TestBuildContentVideoDurationBoundary 120s 恰好在上限内（闭区间上界）。
func TestBuildContentVideoDurationBoundary(t *testing.T) {
	c := newTestClient(uuid.Nil)
	p := &SendPayload{Content: ContentPayload{
		Type: "video", Key: "files/2026/09/v.mp4", ThumbKey: "images/2026/09/t.jpg",
		Name: "v.mp4", Size: 1, Duration: 120, Width: 2, Height: 2,
	}, ClientMsgID: "c-video-120"}
	if _, _, ok := new(Handler).buildContent(c, p); !ok {
		t.Fatalf("duration=120 应通过（上限为闭区间），got %+v", decodeErr(t, c))
	}
	assertNoFrame(t, c)
}

// TestBuildContentSticker 贴纸分支：字段齐全时落库为 MessageTypeSticker，
// content JSON 含 sticker_id/key/width/height；字段缺失时报 400 且 ok=false。
func TestBuildContentSticker(t *testing.T) {
	c := newTestClient(uuid.Nil)
	stickerID := uuid.New()
	p := &SendPayload{
		Content: ContentPayload{
			Type: "sticker", StickerID: stickerID.String(), Key: "images/2026/08/abc.png", Width: 96, Height: 96,
		},
		ClientMsgID: "c-sticker",
	}
	// 无 resolver 的裸 Handler：退化为字段校验，落库仍取客户端传值。
	// 生产装配必然注入 resolver（见 TestBuildContentStickerUsesResolverValues）。
	msgType, contentJSON, ok := new(Handler).buildContent(c, p)
	if !ok {
		t.Fatalf("expected ok, got error frame")
	}
	if msgType != model.MessageTypeSticker {
		t.Fatalf("want MessageTypeSticker(8), got %d", msgType)
	}
	var parsed struct {
		StickerID string `json:"sticker_id"`
		Key       string `json:"key"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
	}
	if err := json.Unmarshal([]byte(contentJSON), &parsed); err != nil {
		t.Fatalf("unmarshal content: %v", err)
	}
	if parsed.StickerID != stickerID.String() || parsed.Key != p.Content.Key || parsed.Width != 96 || parsed.Height != 96 {
		t.Fatalf("content mismatch: %+v", parsed)
	}
	assertNoFrame(t, c)
}

// TestBuildContentStickerRejectsNonUUID sticker_id 必须是合法 UUID。
// 原实现只判非空，可塞满帧上限（64KB）的垃圾落进 messages.content JSONB
// 并向全会话扇出，绕过文本路径的 4000 字上限。
func TestBuildContentStickerRejectsNonUUID(t *testing.T) {
	c := newTestClient(uuid.Nil)
	p := &SendPayload{
		Content: ContentPayload{
			Type: "sticker", StickerID: strings.Repeat("x", 5000),
			Key: "images/2026/08/abc.png", Width: 96, Height: 96,
		},
		ClientMsgID: "c-sticker-huge",
	}
	if _, _, ok := new(Handler).buildContent(c, p); ok {
		t.Fatal("expected ok=false for non-uuid sticker_id")
	}
	if e := decodeErr(t, c); e.Code != 400 {
		t.Fatalf("unexpected error frame: %+v", e)
	}
}

// TestBuildContentStickerUsesResolverValues 注入 resolver 后，落库的 key/宽高
// 一律取服务端权威值，客户端传来的一概不采信（防止把任意 files/ 下的 key
// 或别人的贴纸当自己的发出去）。
func TestBuildContentStickerUsesResolverValues(t *testing.T) {
	c := newTestClient(uuid.Nil)
	stickerID := uuid.New()
	h := new(Handler)
	var gotSender, gotSticker uuid.UUID
	h.SetStickerResolver(func(_ context.Context, senderID, sid uuid.UUID) (string, int, int, error) {
		gotSender, gotSticker = senderID, sid
		return "images/2026/08/authoritative.png", 64, 48, nil
	})

	p := &SendPayload{
		Content: ContentPayload{
			// 客户端谎称 key 指向别处、尺寸也不对
			Type: "sticker", StickerID: stickerID.String(),
			Key: "files/2026/08/secret.pdf", Width: 999, Height: 999,
		},
		ClientMsgID: "c-sticker-override",
	}
	_, contentJSON, ok := h.buildContent(c, p)
	if !ok {
		t.Fatalf("expected ok, got error frame")
	}
	var parsed struct {
		Key    string `json:"key"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	}
	if err := json.Unmarshal([]byte(contentJSON), &parsed); err != nil {
		t.Fatalf("unmarshal content: %v", err)
	}
	if parsed.Key != "images/2026/08/authoritative.png" || parsed.Width != 64 || parsed.Height != 48 {
		t.Fatalf("client-supplied values leaked into content: %+v", parsed)
	}
	if gotSender != c.userID || gotSticker != stickerID {
		t.Fatalf("resolver got wrong args: sender=%s sticker=%s", gotSender, gotSticker)
	}
	assertNoFrame(t, c)
}

// TestBuildContentStickerResolverRejects resolver 报错（贴纸不属于发送者 / 不存在）
// 时回 403 且不落库。
func TestBuildContentStickerResolverRejects(t *testing.T) {
	c := newTestClient(uuid.Nil)
	h := new(Handler)
	h.SetStickerResolver(func(_ context.Context, _, _ uuid.UUID) (string, int, int, error) {
		return "", 0, 0, errors.New("not found")
	})
	p := &SendPayload{
		Content: ContentPayload{
			Type: "sticker", StickerID: uuid.New().String(),
			Key: "images/2026/08/abc.png", Width: 96, Height: 96,
		},
		ClientMsgID: "c-sticker-forbidden",
	}
	if _, _, ok := h.buildContent(c, p); ok {
		t.Fatal("expected ok=false when resolver rejects")
	}
	if e := decodeErr(t, c); e.Code != 403 {
		t.Fatalf("want 403, got %+v", e)
	}
}

// TestBuildContentStickerMissingFields 缺字段时报 400，不落库。
func TestBuildContentStickerMissingFields(t *testing.T) {
	c := newTestClient(uuid.Nil)
	p := &SendPayload{Content: ContentPayload{Type: "sticker"}, ClientMsgID: "c-sticker-bad"}
	_, _, ok := new(Handler).buildContent(c, p)
	if ok {
		t.Fatal("expected ok=false for missing sticker fields")
	}
	if e := decodeErr(t, c); e.Code != 400 {
		t.Fatalf("unexpected error frame: %+v", e)
	}
}

// ========================================
// ServeWS —— token_version 建连校验
// ========================================

// fakeVersions 是 TokenVersionReader 的测试替身，返回固定版本号或固定错误。
type fakeVersions struct {
	v   int
	err error
}

func (f *fakeVersions) TokenVersion(_ context.Context, _ uuid.UUID) (int, error) {
	return f.v, f.err
}

// newServeWSFixture 构造一个可直接调用 ServeWS 的 Handler 与配套令牌签发器。
func newServeWSFixture(t *testing.T, versions TokenVersionReader) (*Handler, *jwt.Generator) {
	t.Helper()
	gen := jwt.NewGenerator("ws-test-secret", 15*time.Minute, 7*24*time.Hour)
	hub := NewHub(4, zap.NewNop())
	h := NewHandler(hub, nil, gen, config.WebSocketConfig{}, false, zap.NewNop(), versions)
	return h, gen
}

// serveWS 用 httptest 直接驱动 ServeWS，返回响应记录器。
// 记录器不实现 http.Hijacker，因此一旦执行到协议升级就必然失败；
// 这些用例只关心升级之前的鉴权判定，故足够。
func serveWS(h *Handler, token string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ws?token="+token, nil)
	h.ServeWS(rec, req)
	return rec
}

func TestServeWSRejectsStaleTokenVersion(t *testing.T) {
	// 令牌签发时 tv=0，库中已是 1（模拟改密后）
	h, gen := newServeWSFixture(t, &fakeVersions{v: 1})
	pair, err := gen.GeneratePair(uuid.New(), "web", 0)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	if rec := serveWS(h, pair.AccessToken); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestServeWSRejectsWhenVersionLookupFails(t *testing.T) {
	// 读不到版本号时必须拒绝建连（fail closed），不能放行
	h, gen := newServeWSFixture(t, &fakeVersions{err: errors.New("db down")})
	pair, err := gen.GeneratePair(uuid.New(), "web", 0)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	if rec := serveWS(h, pair.AccessToken); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestServeWSAcceptsCurrentTokenVersion(t *testing.T) {
	// 版本一致时不得因该校验被拒；后续升级在 httptest 下失败属预期
	h, gen := newServeWSFixture(t, &fakeVersions{v: 3})
	pair, err := gen.GeneratePair(uuid.New(), "web", 3)
	if err != nil {
		t.Fatalf("generate pair: %v", err)
	}

	if rec := serveWS(h, pair.AccessToken); rec.Code == http.StatusUnauthorized {
		t.Fatal("版本一致的 access 令牌不应被 token_version 校验拒绝")
	}
}
