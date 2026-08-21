package ws

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
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

func TestBuildContentUnsupportedTypeRejected(t *testing.T) {
	c := newTestClient(uuid.Nil)
	_, _, ok := new(Handler).buildContent(c, &SendPayload{Content: ContentPayload{Type: "video"}, ClientMsgID: "c-v"})
	if ok {
		t.Fatal("unsupported type must be rejected")
	}
	if e := decodeErr(t, c); e.Code != 400 {
		t.Fatalf("unexpected error frame: %+v", e)
	}
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
