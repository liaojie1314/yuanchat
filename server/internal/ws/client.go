package ws

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// sendBufferSize 每连接发送缓冲帧数；写满说明客户端消费过慢，帧会被丢弃。
const sendBufferSize = 64

// Client 是一条已鉴权的 WebSocket 连接。
type Client struct {
	userID   uuid.UUID
	deviceID string
	conn     *websocket.Conn
	send     chan []byte

	hub     *Hub
	handler *Handler
	logger  *zap.Logger
}

// readPump 持续读取客户端帧并派发给 Handler。
// 连接出错或客户端关闭时退出，并从 Hub 摘除自己。
//
// pong handler 顺延读超时：只要客户端在 pongTimeout 内响应 ping，连接就保活。
func (c *Client) readPump(maxMessageSize int64, pongTimeout time.Duration) {
	defer func() {
		c.hub.Unregister(c)
		close(c.send)
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongTimeout))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongTimeout))
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				c.logger.Warn("ws read error", zap.Error(err), zap.String("user_id", c.userID.String()))
			}
			return
		}

		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			c.sendError(400, "invalid envelope", "")
			continue
		}
		c.handler.dispatch(c, &env)
	}
}

// writePump 消费发送通道并定期发 ping。send 通道关闭或写失败时退出。
func (c *Client) writePump(pingInterval, writeTimeout time.Duration) {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case data, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// sendError 向当前连接推送一帧错误。
func (c *Client) sendError(code int, message, clientMsgID string) {
	data, err := Encode(TypeError, ErrorPayload{Code: code, Message: message, ClientMsgID: clientMsgID})
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}
