package ws

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestEncodeDecodeRoundTrip(t *testing.T) {
	convID := uuid.New()
	msgID := uuid.New()

	data, err := Encode(TypeMessageAck, AckPayload{
		ClientMsgID:    "c-123",
		MessageID:      msgID,
		ConversationID: convID,
		Seq:            42,
		Timestamp:      1718123456789,
	})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	if env.Type != TypeMessageAck {
		t.Fatalf("type = %q, want %q", env.Type, TypeMessageAck)
	}

	var p AckPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if p.ClientMsgID != "c-123" || p.Seq != 42 || p.MessageID != msgID || p.ConversationID != convID {
		t.Fatalf("payload mismatch: %+v", p)
	}
}

func TestDecodeClientSendFrame(t *testing.T) {
	convID := uuid.New()
	raw := `{"type":"message.send","payload":{"conversation_id":"` + convID.String() +
		`","content":{"type":"text","text":"你好"},"client_msg_id":"c-9"}}`

	var env Envelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Type != TypeMessageSend {
		t.Fatalf("type = %q", env.Type)
	}

	var p SendPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if p.ConversationID != convID || p.Content.Text != "你好" || p.ClientMsgID != "c-9" {
		t.Fatalf("payload mismatch: %+v", p)
	}
}

func TestDecodeClientSendImageFrame(t *testing.T) {
	convID := uuid.New()
	raw := `{"type":"message.send","payload":{"conversation_id":"` + convID.String() +
		`","content":{"type":"image","key":"images/2026/07/abc.png","width":800,"height":600,"size":123456},"client_msg_id":"c-img"}}`

	var env Envelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	var p SendPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if p.Content.Type != "image" || p.Content.Key != "images/2026/07/abc.png" ||
		p.Content.Width != 800 || p.Content.Height != 600 || p.Content.Size != 123456 {
		t.Fatalf("image payload mismatch: %+v", p.Content)
	}
}

func TestImageReceiveFrameRoundTrip(t *testing.T) {
	convID := uuid.New()
	msgID := uuid.New()
	senderID := uuid.New()

	data, err := Encode(TypeMessageReceive, ReceivePayload{
		MessageID:      msgID,
		ConversationID: convID,
		SenderID:       senderID,
		SenderNickname: "Ada",
		Content: ContentPayload{
			Type:   "image",
			Key:    "images/2026/07/abc.png",
			Width:  1024,
			Height: 768,
			Size:   987654,
		},
		Seq:       7,
		Timestamp: 1718123456789,
	})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	var p ReceivePayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if p.Content.Type != "image" || p.Content.Key != "images/2026/07/abc.png" ||
		p.Content.Width != 1024 || p.Content.Height != 768 || p.Content.Size != 987654 {
		t.Fatalf("image content did not round-trip: %+v", p.Content)
	}
}

// TestTextContentOmitsImageFields text 帧不得因新增字段而序列化出空的 image 元数据。
func TestTextContentOmitsImageFields(t *testing.T) {
	data, err := Encode(TypeMessageReceive, ReceivePayload{
		Content: ContentPayload{Type: "text", Text: "hi"},
	})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var env Envelope
	_ = json.Unmarshal(data, &env)
	var m map[string]any
	_ = json.Unmarshal(env.Payload, &m)
	content, _ := m["content"].(map[string]any)
	for _, f := range []string{"key", "width", "height", "size"} {
		if _, exists := content[f]; exists {
			t.Fatalf("text content should omit image field %q, got content=%v", f, content)
		}
	}
}

func TestErrorPayloadOmitsEmptyClientMsgID(t *testing.T) {
	data, err := Encode(TypeError, ErrorPayload{Code: 400, Message: "bad"})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	var env Envelope
	_ = json.Unmarshal(data, &env)
	var m map[string]any
	_ = json.Unmarshal(env.Payload, &m)
	if _, exists := m["client_msg_id"]; exists {
		t.Fatal("empty client_msg_id should be omitted")
	}
}
