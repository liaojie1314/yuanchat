package ws

import (
	"encoding/json"
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
