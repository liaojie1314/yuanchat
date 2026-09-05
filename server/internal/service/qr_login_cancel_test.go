package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

// TestCancelQRSessionFromScanned 扫码端取消后，被扫端轮询到 canceled 且拿不到令牌。
//
// 取消不删会话键：被扫端只有轮询到 canceled 这一条路径能得知「手机上按了取消」，
// 删键会让它退化成与过期同样的 404，前端就无法区分两种终止原因。
func TestCancelQRSessionFromScanned(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-cancel")

	sess, err := f.svc.CreateQRSession(ctx, "web")
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}

	if err := f.svc.CancelQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("取消会话失败: %v", err)
	}

	got, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("轮询失败: %v", err)
	}
	if got.Status != QRCanceled {
		t.Fatalf("status = %q, want canceled", got.Status)
	}
	if got.Tokens != nil {
		t.Fatalf("canceled 不得下发令牌: %+v", got.Tokens)
	}
	// 取消不重置 TTL：会话生命周期仍从创建那一刻算起
	if d := f.ttl(t, sess.QRToken); d <= 0 || d > 120*time.Second {
		t.Fatalf("取消后 TTL = %v, want ≤120s 且仍在存活", d)
	}
}

// TestCancelQRSessionRejectsPending 未扫码的会话不能被取消 ——
// 取消是「扫码端反悔」，pending 阶段还没有扫码端。
func TestCancelQRSessionRejectsPending(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-cancel-pending")

	sess, err := f.svc.CreateQRSession(ctx, "web")
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}
	if err := f.svc.CancelQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRBadState) {
		t.Fatalf("err = %v, want ErrQRBadState", err)
	}
	// 被拒的取消不得改动状态，否则任何人拿着二维码就能把别人的会话废掉
	got, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("轮询失败: %v", err)
	}
	if got.Status != QRPending {
		t.Fatalf("status = %q, want pending", got.Status)
	}
}

// TestCancelQRSessionRejectsOtherUser 只有扫码的那个用户能取消。
func TestCancelQRSessionRejectsOtherUser(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	scanner := newTestUser(t, f.db, "qr-cancel-scanner")
	other := newTestUser(t, f.db, "qr-cancel-other")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, scanner.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}

	if err := f.svc.CancelQRSession(ctx, sess.QRToken, other.ID); !errors.Is(err, ErrQRWrongUser) {
		t.Fatalf("err = %v, want ErrQRWrongUser", err)
	}
	// 扫码者本人仍能继续确认：外人的取消不得影响这条链路
	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, scanner.ID); err != nil {
		t.Fatalf("确认授权失败: %v", err)
	}
}

// TestCanceledQRSessionCannotBeConfirmed canceled 是终态，取消后再确认拿不到令牌。
//
// 这条是取消的安全底线：若取消后仍能确认，用户在手机上按下的取消就是一句空话。
func TestCanceledQRSessionCannotBeConfirmed(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-cancel-terminal")

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	if err := f.svc.CancelQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("取消会话失败: %v", err)
	}

	if err := f.svc.ConfirmQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRBadState) {
		t.Fatalf("confirm err = %v, want ErrQRBadState", err)
	}
	if err := f.svc.CancelQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRBadState) {
		t.Fatalf("二次取消 err = %v, want ErrQRBadState", err)
	}
	got, err := f.svc.PollQRSession(ctx, sess.QRToken, sess.PollSecret)
	if err != nil {
		t.Fatalf("轮询失败: %v", err)
	}
	if got.Tokens != nil {
		t.Fatalf("已取消的会话下发了令牌: %+v", got.Tokens)
	}
}

// TestCancelQRSessionUnknownTokenIsNotFound 伪造与已过期的码取消时同样得到「不存在」。
func TestCancelQRSessionUnknownTokenIsNotFound(t *testing.T) {
	f := newQRFixture(t)
	ctx := context.Background()
	user := newTestUser(t, f.db, "qr-cancel-forged")

	if err := f.svc.CancelQRSession(ctx, "not-a-real-qr-token", user.ID); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("伪造 token err = %v, want ErrQRNotFound", err)
	}

	sess, _ := f.svc.CreateQRSession(ctx, "web")
	if _, err := f.svc.ScanQRSession(ctx, sess.QRToken, user.ID); err != nil {
		t.Fatalf("标记已扫失败: %v", err)
	}
	f.mr.FastForward(121 * time.Second)
	if err := f.svc.CancelQRSession(ctx, sess.QRToken, user.ID); !errors.Is(err, ErrQRNotFound) {
		t.Fatalf("过期会话 err = %v, want ErrQRNotFound", err)
	}
}
