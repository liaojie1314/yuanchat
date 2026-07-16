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
