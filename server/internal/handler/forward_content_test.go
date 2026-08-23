package handler

import (
	"testing"

	"github.com/google/uuid"
	"github.com/yuanchat/server/internal/model"
)

// TestContentPayloadFromMessage 转发时的 content 重建必须覆盖每一种可转发消息类型。
//
// 缺 case 的后果不是编译错误也不是 500，而是落进 default 分支变成空文本：
// 目标会话全员（含转发者自己）实时看到空气泡、会话列表预览变空串，刷新后走 REST
// 历史才正确渲染——典型"刷新一下就好了"的诡异 bug。贴纸（type 8）此前正是如此。
//
// 本用例是纯函数表驱动：新增消息类型忘了补 case 时立刻红。
func TestContentPayloadFromMessage(t *testing.T) {
	t.Run("text", func(t *testing.T) {
		got, ok := contentPayloadFromMessage(&model.Message{
			MessageType: model.MessageTypeText,
			Content:     `{"text":"你好"}`,
		})
		if !ok || got.Type != "text" || got.Text != "你好" {
			t.Fatalf("text: ok=%v got=%+v", ok, got)
		}
	})

	t.Run("image", func(t *testing.T) {
		got, ok := contentPayloadFromMessage(&model.Message{
			MessageType: model.MessageTypeImage,
			Content:     `{"key":"images/2026/08/a.png","width":100,"height":200,"size":1234}`,
		})
		if !ok || got.Type != "image" || got.Key != "images/2026/08/a.png" ||
			got.Width != 100 || got.Height != 200 || got.Size != 1234 {
			t.Fatalf("image: ok=%v got=%+v", ok, got)
		}
	})

	t.Run("file", func(t *testing.T) {
		got, ok := contentPayloadFromMessage(&model.Message{
			MessageType: model.MessageTypeFile,
			Content:     `{"key":"files/2026/08/a.pdf","name":"报告.pdf","size":99}`,
		})
		if !ok || got.Type != "file" || got.Name != "报告.pdf" || got.Size != 99 {
			t.Fatalf("file: ok=%v got=%+v", ok, got)
		}
	})

	t.Run("voice", func(t *testing.T) {
		got, ok := contentPayloadFromMessage(&model.Message{
			MessageType: model.MessageTypeVoice,
			Content:     `{"key":"voices/2026/08/a.webm","duration":7,"size":88}`,
		})
		if !ok || got.Type != "voice" || got.Duration != 7 || got.Size != 88 {
			t.Fatalf("voice: ok=%v got=%+v", ok, got)
		}
	})

	// 回归：贴纸此前落 default 变空文本气泡
	t.Run("sticker", func(t *testing.T) {
		id := uuid.New().String()
		got, ok := contentPayloadFromMessage(&model.Message{
			MessageType: model.MessageTypeSticker,
			Content:     `{"sticker_id":"` + id + `","key":"images/2026/08/s.png","width":96,"height":96}`,
		})
		if !ok {
			t.Fatalf("sticker should be forwardable, got ok=false")
		}
		if got.Type != "sticker" || got.StickerID != id || got.Key != "images/2026/08/s.png" ||
			got.Width != 96 || got.Height != 96 {
			t.Fatalf("sticker: got=%+v", got)
		}
	})

	// system / e2ee / video：服务层已拒绝转发（system、e2ee）或没有任何写入路径（video）。
	// 此处要求 ok=false 而不是"空文本"——宁可不推实时帧（刷新后由 REST 正确渲染），
	// 也不要向全员扇出一个语义错误的空气泡。
	for _, tc := range []struct {
		name    string
		msgType int16
	}{
		{"system", model.MessageTypeSystem},
		{"e2ee", model.MessageTypeE2EE},
		{"video", model.MessageTypeVideo},
		{"unknown", int16(99)},
	} {
		t.Run(tc.name+"-not-rebuildable", func(t *testing.T) {
			if _, ok := contentPayloadFromMessage(&model.Message{
				MessageType: tc.msgType,
				Content:     `{}`,
			}); ok {
				t.Fatalf("%s should not be rebuilt into a content payload", tc.name)
			}
		})
	}
}
